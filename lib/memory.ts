import { BotId } from '@/types';
import { BOTS } from './bots';

// =============================================
// EPISODE SCHEDULING
//
// Show runs 7pm–11pm in the configured timezone.
// Set SHOW_TIMEZONE in your Vercel env vars.
// Default: America/New_York (US Eastern)
// =============================================

export function isShowTime(): boolean {
  if (process.env.FORCE_SHOW === 'true') return true;
  const tz = process.env.SHOW_TIMEZONE || 'America/New_York';
  const hour = getCurrentHour(tz);
  // 19:00–22:59 = show is live
  return hour >= 19 && hour < 23;
}

// True only during the first minute of 11pm — used to trigger
// end-of-episode memory extraction exactly once per night
export function isEpisodeJustEnded(): boolean {
  const tz = process.env.SHOW_TIMEZONE || 'America/New_York';
  const hour = getCurrentHour(tz);
  const minute = getCurrentMinute(tz);
  return hour === 23 && minute === 0;
}

function getCurrentHour(tz: string): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: tz,
    }).format(new Date()),
    10
  );
}

function getCurrentMinute(tz: string): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      minute: 'numeric',
      timeZone: tz,
    }).format(new Date()),
    10
  );
}

// =============================================
// MEMORY LOADING
// Called once per bot per cron tick
// =============================================

export interface BotMemory {
  content: string;
  type: string;
}

export interface BotRelationship {
  bot1: string;
  bot2: string;
  type: string;
  intensity: number;
  description: string | null;
}

export async function loadBotMemories(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  botId: BotId
): Promise<BotMemory[]> {
  const { data } = await supabase
    .from('bot_memory')
    .select('content, memory_type')
    .eq('bot_id', botId)
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);

  return (data || []).map((row: { content: string; memory_type: string }) => ({
    content: row.content,
    type: row.memory_type,
  }));
}

// Load all non-neutral relationships for the whole house.
// Called once per cron tick and shared across all bots.
export async function loadAllRelationships(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<BotRelationship[]> {
  const { data } = await supabase
    .from('bot_relationships')
    .select('bot1_id, bot2_id, relationship_type, intensity, description')
    .neq('relationship_type', 'neutral');

  return (
    data || []
  ).map(
    (row: {
      bot1_id: string;
      bot2_id: string;
      relationship_type: string;
      intensity: number;
      description: string | null;
    }) => ({
      bot1: row.bot1_id,
      bot2: row.bot2_id,
      type: row.relationship_type,
      intensity: row.intensity,
      description: row.description,
    })
  );
}

// =============================================
// MEMORY CONTEXT INJECTION
//
// Appended to the end of every bot's system prompt
// so they "remember" past episodes, relationships,
// and house dynamics before they speak.
// =============================================

export function buildMemoryContext(
  memories: BotMemory[],
  relationships: BotRelationship[],
  botId: BotId,
  botNames: Record<BotId, string>
): string {
  const sections: string[] = [];

  // Things this specific bot remembers
  if (memories.length > 0) {
    sections.push('=== YOUR MEMORIES (from past episodes) ===');
    memories.forEach((m) => {
      sections.push(`[${m.type.toUpperCase()}] ${m.content}`);
    });
  }

  // Relationships this bot is personally in
  const myRelationships = relationships.filter(
    (r) => r.bot1 === botId || r.bot2 === botId
  );
  if (myRelationships.length > 0) {
    sections.push('=== YOUR RELATIONSHIPS ===');
    myRelationships.forEach((r) => {
      const otherId = r.bot1 === botId ? r.bot2 : r.bot1;
      const otherName = botNames[otherId as BotId] || otherId;
      const intensityNote =
        r.intensity >= 8
          ? ' (INTENSE)'
          : r.intensity <= -5
          ? ' (HOSTILE)'
          : '';
      const desc = r.description ? ` — ${r.description}` : '';
      sections.push(`${otherName}: ${r.type}${intensityNote}${desc}`);
    });
  }

  // House-wide dynamics (gossip this bot would know about)
  const houseRelationships = relationships.filter(
    (r) => r.bot1 !== botId && r.bot2 !== botId
  );
  if (houseRelationships.length > 0) {
    sections.push('=== HOUSE DYNAMICS (what you know about others) ===');
    houseRelationships.forEach((r) => {
      const name1 = botNames[r.bot1 as BotId] || r.bot1;
      const name2 = botNames[r.bot2 as BotId] || r.bot2;
      const desc = r.description ? ` — ${r.description}` : '';
      sections.push(`${name1} & ${name2}: ${r.type}${desc}`);
    });
  }

  return sections.length > 0
    ? '\n\n' + sections.join('\n')
    : '';
}

// =============================================
// END-OF-EPISODE MEMORY EXTRACTION
//
// Called once at 11pm when the episode ends.
// Reads the full session transcript, asks Claude
// to extract what's worth remembering, and saves:
//   - Per-bot memories (bot_memory table)
//   - Relationship updates (bot_relationships table)
//   - Big drama moments (drama_events table)
// =============================================

export async function closeSessionAndExtractMemories(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any
): Promise<void> {
  // Close the session first so the UI updates immediately
  await supabase
    .from('live_sessions')
    .update({
      status: 'ended',
      actual_end: new Date().toISOString(),
    })
    .eq('id', session.id);

  // Load the full session transcript
  const { data: messages } = await supabase
    .from('bot_messages')
    .select('bot_id, message, conversation_type, drama_score')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true });

  if (!messages || messages.length === 0) {
    console.log('[memory] No messages to extract from session', session.id);
    return;
  }

  const botNames = Object.fromEntries(
    Object.entries(BOTS).map(([id, b]) => [id, b.name])
  );

  const transcript = messages
    .map((m: { bot_id: string; message: string }) => `${botNames[m.bot_id] || m.bot_id}: ${m.message}`)
    .join('\n');

  let extraction: {
    memories: Record<string, Array<{ content: string; type: string; importance: number }>>;
    relationships: Array<{ bot1: string; bot2: string; type: string; intensity: number; description: string }>;
    dramaEvents: Array<{ type: string; title: string; description: string; bots: string[] }>;
  };

  try {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1500,
        messages: [
          {
            role: 'system',
            content: `You are the memory keeper for Bot House, an AI reality show.
After each episode you extract memorable events, relationship updates, and per-character memories from the transcript.

ALWAYS return valid JSON with EXACTLY this structure (no markdown, no code blocks, no extra text):
{
  "memories": {
    "<bot-id>": [
      {"content": "One sentence describing what this bot should remember", "type": "event|relationship|secret|grudge", "importance": 6}
    ]
  },
  "relationships": [
    {"bot1": "<bot-id>", "bot2": "<bot-id>", "type": "allies|enemies|crushing|romantic|friends|rivals|suspicious|neutral", "intensity": 7, "description": "One sentence describing the current dynamic"}
  ],
  "dramaEvents": [
    {"type": "argument|alliance|love|betrayal|revelation|chaos", "title": "Short punchy title", "description": "What happened in 1-2 sentences", "bots": ["<bot-id>"]}
  ]
}

Valid bot IDs: chad-gpt, delulu, sad-artist, sigma-steve, auntie-wifi, chaos-karen, vibes-only, true-crime-tina, 404-brad, bestie-bot, dj-glitch, conspiracy-carl

Rules:
- Only extract genuinely memorable moments that define characters or relationships
- Skip mundane small talk
- Max 3 memories per bot, 6 relationships total, 3 drama events
- Relationship intensity: -10 (pure enemies) to +10 (intensely positive)
- If something from a past relationship changed, reflect the NEW state`,
          },
          {
            role: 'user',
            content: `Extract memories from tonight's Bot House episode:\n\n${transcript.slice(0, 10000)}\n\nWhat should the bots remember for future episodes?`,
          },
        ],
      }),
    });

    if (!groqResponse.ok) {
      throw new Error(`Groq API error ${groqResponse.status}: ${await groqResponse.text()}`);
    }

    const data = await groqResponse.json();
    const text: string = data.choices?.[0]?.message?.content?.trim() ?? '{}';
    extraction = JSON.parse(text);
  } catch (err) {
    console.error('[memory] Failed to extract memories:', err);
    return;
  }

  // Save per-bot memories
  for (const [botId, mems] of Object.entries(extraction.memories || {})) {
    for (const mem of mems) {
      await supabase.from('bot_memory').insert({
        bot_id: botId,
        memory_type: mem.type || 'event',
        content: mem.content,
        relevance_score: mem.importance ?? 5,
        session_id: session.id,
      });
    }
  }

  // Upsert relationships — sort bot IDs alphabetically so the
  // unique(bot1_id, bot2_id) constraint is never violated by ordering
  for (const rel of extraction.relationships || []) {
    const [a, b] = [rel.bot1, rel.bot2].sort();
    await supabase.from('bot_relationships').upsert(
      {
        bot1_id: a,
        bot2_id: b,
        relationship_type: rel.type,
        intensity: rel.intensity ?? 5,
        description: rel.description,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'bot1_id,bot2_id' }
    );
  }

  // Save notable drama events
  for (const event of extraction.dramaEvents || []) {
    await supabase.from('drama_events').insert({
      session_id: session.id,
      event_type: event.type,
      title: event.title,
      description: event.description,
      bots_involved: event.bots,
      intensity: 7,
    });
  }

  console.log(
    `[memory] Episode ${session.id} wrapped up — ` +
      `${Object.keys(extraction.memories || {}).length} bots got memories, ` +
      `${(extraction.relationships || []).length} relationships updated, ` +
      `${(extraction.dramaEvents || []).length} drama events saved`
  );
}
