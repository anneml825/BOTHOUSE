import { SupabaseClient } from '@supabase/supabase-js';
import { BOTS, BotKey } from './bots';
import { isMissingTable, loadPaint } from './db';
import { WORDS } from './words';

// Head-to-head rounds: chat picks a prompt, each bot paints its own canvas, viewers vote.
export const TURNS_PER_BOT = 3;
// How long viewers get to vote (VOTE_MS overrides it, for testing)
export const VOTE_MS = Number(process.env.VOTE_MS) || 120_000;

export interface Round {
  id: number;
  prompt: string;
  prompt_from_chat: boolean;
  start_message_id: number;
  status: 'painting' | 'voting' | 'done';
  voting_ends_at: string | null;
  winner: string | null;
  created_at: string;
  finished_at: string | null;
}

// The newest round, or missing: true if the rounds table hasn't been created yet
export async function currentRound(db: SupabaseClient): Promise<{ round: Round | null; missing: boolean }> {
  const { data, error } = await db.from('rounds').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { round: null, missing: true };
    throw error;
  }
  return { round: (data as Round) ?? null, missing: false };
}

// "PROMPT: ..." suggestions from viewer chat since a given time, most-suggested first
export async function promptSuggestions(
  db: SupabaseClient,
  sinceIso: string | null,
): Promise<{ prompt: string; count: number }[]> {
  let query = db
    .from('messages')
    .select('content, created_at')
    .eq('channel', 'chat')
    .ilike('content', '%prompt%:%')
    .order('id', { ascending: false })
    .limit(500);
  if (sinceIso) query = query.gt('created_at', sinceIso);
  const { data } = await query;
  const tally = new Map<string, { prompt: string; count: number; newest: number }>();
  (data ?? []).forEach((m: { content: string }, i: number) => {
    const match = /^\s*prompt\s*:\s*(.{2,140})/i.exec(m.content);
    if (!match) return;
    const prompt = match[1].trim();
    const key = prompt.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
    if (!key) return;
    const entry = tally.get(key);
    if (entry) entry.count++;
    else tally.set(key, { prompt, count: 1, newest: i });
  });
  return [...tally.values()]
    .sort((a, b) => b.count - a.count || a.newest - b.newest)
    .map(({ prompt, count }) => ({ prompt, count }));
}

// Starts the next round with chat's most-suggested prompt (or a random one if chat suggested nothing)
export async function startRound(db: SupabaseClient, prev: Round | null): Promise<Round> {
  // Suggestions made since the previous round started; on a fresh start, only recent ones
  const since = prev?.created_at ?? new Date(Date.now() - 10 * 60_000).toISOString();
  const suggestions = await promptSuggestions(db, since);
  const fromChat = suggestions.length > 0;
  const prompt = fromChat ? suggestions[0].prompt : WORDS[Math.floor(Math.random() * WORDS.length)];
  const { data: lastMsg } = await db
    .from('messages')
    .select('id')
    .eq('channel', 'bots')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await db
    .from('rounds')
    .insert({ prompt, prompt_from_chat: fromChat, start_message_id: lastMsg?.id ?? 0 })
    .select('*')
    .single();
  if (error) throw error;
  return data as Round;
}

// How many bot messages have been painted in this round
export async function roundTurns(db: SupabaseClient, round: Round): Promise<number> {
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'bots')
    .gt('id', round.start_message_id);
  return count ?? 0;
}

export async function voteCounts(db: SupabaseClient, roundId: number): Promise<{ A: number; B: number }> {
  const { data } = await db.from('votes').select('choice').eq('round_id', roundId);
  const counts = { A: 0, B: 0 };
  for (const v of data ?? []) if (v.choice === 'A' || v.choice === 'B') counts[v.choice as BotKey]++;
  return counts;
}

// Rounds won by each bot
export async function scores(db: SupabaseClient): Promise<{ A: number; B: number }> {
  const { data } = await db.from('rounds').select('winner').eq('status', 'done');
  const s = { A: 0, B: 0 };
  for (const r of data ?? []) if (r.winner === 'A' || r.winner === 'B') s[r.winner as BotKey]++;
  return s;
}

// Both canvases of a round, saved to the gallery. Returns an error message, or null.
export async function saveRoundPaintings(db: SupabaseClient, round: Round, winner?: string | null): Promise<string | null> {
  for (const bot of ['A', 'B'] as BotKey[]) {
    const paint = await loadPaint(db, { author: bot, afterId: round.start_message_id });
    if (!paint.length) continue;
    const crown = winner === bot ? ' 🏆' : '';
    const title = `“${round.prompt}” by ${BOTS[bot].name}${crown}`;
    const { error } = await db.from('drawings').insert({ title: title.slice(0, 100), shapes: { paint } });
    if (error) return isMissingTable(error) ? 'The gallery table doesn’t exist yet. Run the drawings SQL in Supabase.' : error.message;
  }
  return null;
}

// Closes voting: picks the winner, marks the round done, and saves both paintings to the gallery
export async function finishRound(db: SupabaseClient, round: Round): Promise<string> {
  const votes = await voteCounts(db, round.id);
  const winner = votes.A > votes.B ? 'A' : votes.B > votes.A ? 'B' : 'tie';
  await db
    .from('rounds')
    .update({ status: 'done', winner, finished_at: new Date().toISOString() })
    .eq('id', round.id);
  await saveRoundPaintings(db, round, winner);
  return winner;
}
