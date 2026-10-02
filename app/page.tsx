'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import PaintCanvas from './PaintCanvas';
import { parseDrawing } from '@/lib/canvas';
import { parsePaint } from '@/lib/paint';
import { BOTS, splitGloss } from '@/lib/bots';

interface Message {
  id: number;
  author: string;
  content: string;
  created_at: string;
}

const botName = (author: string) => (author === 'A' || author === 'B' ? BOTS[author].name : author);

interface RoundInfo {
  id: number;
  prompt: string;
  fromChat: boolean;
  status: 'painting' | 'voting' | 'done';
  votingEndsAt: string | null;
  winner: string | null;
  turnsDone: number;
  turnsTotal: number;
}

// A random id per browser, so each viewer gets one vote per round
function voterId(): string {
  try {
    let id = localStorage.getItem('voterId');
    if (!id) {
      id = `v${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem('voterId', id);
    }
    return id;
  } catch {
    return `v${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

const POLL_MS = 3000;
const TICK_MS = 5000;

const SETUP_NOTICES: Record<string, string> = {
  supabase: 'Supabase isn’t connected. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.',
  tables: 'The database tables don’t exist yet. Run supabase/schema.sql in the Supabase SQL Editor.',
  rounds: 'The rounds and votes tables don’t exist yet. Run the rounds SQL in the Supabase SQL Editor.',
  anthropic: 'Anthropic key missing. Add ANTHROPIC_API_KEY in Vercel, then redeploy.',
  bad_anthropic_key: 'The Anthropic key in Vercel was rejected. Check ANTHROPIC_API_KEY, then redeploy.',
};

function loadUsername(): string {
  try {
    const saved = localStorage.getItem('username');
    if (saved) return saved;
  } catch {}
  return `viewer${Math.floor(1000 + Math.random() * 9000)}`;
}

function saveUsername(name: string) {
  try {
    localStorage.setItem('username', name);
  } catch {}
}

// Keeps a scroll container pinned to the bottom unless the reader has scrolled up
function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

export default function Home() {
  const [bots, setBots] = useState<Message[]>([]);
  const [chat, setChat] = useState<Message[]>([]);
  const [setup, setSetup] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<string>('not called yet');
  const [generating, setGenerating] = useState(false);
  const [paintA, setPaintA] = useState<string[]>([]);
  const [paintB, setPaintB] = useState<string[]>([]);
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [votes, setVotes] = useState({ A: 0, B: 0 });
  const [scores, setScores] = useState({ A: 0, B: 0 });
  const [suggestions, setSuggestions] = useState<{ prompt: string; count: number }[]>([]);
  const [myVotes, setMyVotes] = useState<Record<number, string>>({});
  const [gapSeconds, setGapSeconds] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  // Server clock minus this device's clock, so the countdown matches the server
  const [clockOffset, setClockOffset] = useState(0);

  const botsRef = useStickToBottom(bots[bots.length - 1]?.id);
  const chatRef = useStickToBottom(chat[chat.length - 1]?.id);

  useEffect(() => {
    setUsername(loadUsername());
  }, []);

  // Poll for new messages
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        if (!alive) return;
        setStateError(data.error ? `Could not load messages: ${data.error}` : null);
        setSetup((prev) => (prev === 'bad_anthropic_key' && !data.setup ? prev : data.setup ?? null));
        if (data.bots) setBots(data.bots);
        if (data.chat) setChat(data.chat);
        if (data.paintA) setPaintA(data.paintA);
        if (data.paintB) setPaintB(data.paintB);
        if ('round' in data) setRound(data.round);
        if (data.votes) setVotes(data.votes);
        if (data.scores) setScores(data.scores);
        if (data.suggestions) setSuggestions(data.suggestions);
        if (typeof data.paused === 'boolean') setPaused(data.paused);
        if (typeof data.generating === 'boolean') setGenerating(data.generating);
        if (typeof data.gapSeconds === 'number') setGapSeconds(data.gapSeconds);
        if (data.serverTime) setClockOffset(Date.parse(data.serverTime) - Date.now());
      } catch {
        if (alive) setStateError('Could not load messages: server unreachable');
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Keep the bots talking while this tab is visible
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/tick', { method: 'POST' });
        const data = await res.json().catch(() => ({ status: 'error', message: `Server error ${res.status}` }));
        setLastTick(`${data.status}${data.message ? `: ${data.message}` : ''} (HTTP ${res.status})`);
        if (data.status === 'bad_anthropic_key') setSetup('bad_anthropic_key');
        if (data.status === 'error') setTickError(`The bots hit an error: ${data.message}`);
        else if (data.status === 'no_reply') setTickError('A bot gave no reply this turn; trying again.');
        else setTickError(null);
      } catch {
        setTickError('Could not reach the server.');
        setLastTick('request failed');
      }
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    // Resume right away when the tab comes back into view
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  // One-second clock for the countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);


  const lastBot = bots[bots.length - 1];
  const secondsLeft = lastBot
    ? Math.max(0, Math.ceil(gapSeconds - (now + clockOffset - Date.parse(lastBot.created_at)) / 1000))
    : 0;
  let status: string | null = null;
  if (round && !paused && !setup) {
    const nextSpeaker = round.turnsDone % 2 === 0 ? 'A' : 'B';
    if (round.status === 'painting') {
      if (generating) status = `${botName(nextSpeaker)} is painting…`;
      else if (round.turnsDone > 0 && secondsLeft > 0) status = `${botName(nextSpeaker)} paints next in ${secondsLeft}s`;
      else status = `${botName(nextSpeaker)} is about to paint…`;
    } else if (round.status === 'voting') {
      const left = round.votingEndsAt
        ? Math.max(0, Math.ceil((Date.parse(round.votingEndsAt) - (now + clockOffset)) / 1000))
        : 0;
      status = left > 0 ? `Voting closes in ${left}s` : 'Counting votes…';
    } else {
      status = 'Next round starting…';
    }
  } else if (!round && !paused && !setup) {
    status = 'Starting the first round…';
  }

  const vote = async (choice: 'A' | 'B') => {
    if (!round) return;
    setMyVotes((v) => ({ ...v, [round.id]: choice }));
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: round.id, choice, voter: voterId() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Vote failed');
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : 'Vote failed');
    }
  };

  // Pause, save and start over
  const ownerAction = async (path: string, body: object): Promise<Record<string, unknown> | null> => {
    setPauseError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
      return data;
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : 'Something went wrong');
      return null;
    }
  };

  const togglePause = async () => {
    const data = await ownerAction('/api/pause', { paused: !paused });
    if (data) setPaused(!!data.paused);
  };

  const [saved, setSaved] = useState(false);
  const saveDrawing = async () => {
    const data = await ownerAction('/api/gallery', {});
    if (data) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const startOver = async () => {
    if (!window.confirm('Start the contest over? This clears the conversation, rounds and scores. The current paintings are saved to the gallery first.')) return;
    const data = await ownerAction('/api/reset', {});
    if (data) {
      setBots([]);
      setPaintA([]);
      setPaintB([]);
      setRound(null);
      setScores({ A: 0, B: 0 });
      setPauseError('Started over. A new round begins in a few seconds.');
      setTimeout(() => setPauseError(null), 5000);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, content }),
      });
      if (!res.ok) throw new Error();
      const state = await fetch('/api/state', { cache: 'no-store' }).then((r) => r.json());
      if (state.chat) setChat(state.chat);
    } catch {
      setDraft(content);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="layout">
      <section className="panel">
        <div className="panel-header">
          <span>{BOTS.A.name} &amp; {BOTS.B.name}</span>
          <Link href="/gallery" className="header-link">Gallery →</Link>
        </div>
        <div className="owner-controls">
          <button
            type="button"
            className={`big-pause ${paused ? 'resume' : 'pause'}`}
            onClick={togglePause}
          >
            {paused ? '▶ RESUME' : '⏸ PAUSE'}
          </button>
          <button type="button" className="start-over" onClick={saveDrawing}>
            {saved ? '✓ SAVED' : '💾 SAVE'}
          </button>
          <button type="button" className="start-over" onClick={startOver}>
            ↺ START OVER
          </button>
        </div>
        {setup && <div className="notice">{SETUP_NOTICES[setup] ?? setup}</div>}
        {pauseError && <div className="notice">{pauseError}</div>}
        {stateError && <div className="notice">{stateError}</div>}
        {tickError && !setup && <div className="notice">{tickError}</div>}
        {paused && !setup && <div className="notice">The bots are paused.</div>}
        {round && (
          <div className="round-banner">
            <div className="round-prompt">
              <span className="round-label">{round.fromChat ? 'Chat’s prompt' : 'Random prompt'}</span>
              “{round.prompt}”
            </div>
            <div className="round-meta">
              {round.status === 'painting' && `Painting · turn ${Math.min(round.turnsDone + 1, round.turnsTotal)} of ${round.turnsTotal}`}
              {round.status === 'voting' && 'Voting now! Pick the better painting'}
              {round.status === 'done' &&
                (round.winner === 'tie' ? 'It’s a tie!' : `🏆 ${botName(round.winner ?? '')} wins this round`)}
              <span className="scoreboard">
                {BOTS.A.name.replace('Claude ', '')} {scores.A} – {scores.B} {BOTS.B.name.replace('Claude ', '')}
              </span>
            </div>
          </div>
        )}
        <div className="duel">
          {(['A', 'B'] as const).map((bot) => {
            const isWinner = round?.status === 'done' && round.winner === bot;
            const mine = round ? myVotes[round.id] === bot : false;
            return (
              <div key={bot} className={`duel-side${isWinner ? ' winner' : ''}`}>
                <div className={`duel-name ${bot === 'A' ? 'bot-a' : 'bot-b'}`}>
                  {isWinner && '🏆 '}
                  {BOTS[bot].name}
                </div>
                <PaintCanvas commands={bot === 'A' ? paintA : paintB} />
                {round && round.status !== 'painting' && (
                  <div className="vote-row">
                    {round.status === 'voting' && (
                      <button type="button" className={`vote-btn${mine ? ' voted' : ''}`} onClick={() => vote(bot)}>
                        {mine ? '✓ Your vote' : 'Vote'}
                      </button>
                    )}
                    <span className="vote-count">
                      {votes[bot]} {votes[bot] === 1 ? 'vote' : 'votes'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="scroll" ref={botsRef}>
          {bots.length === 0 && <p className="empty">Waiting for the bots to start…</p>}
          {bots.map((m) => (
            <div key={m.id} className="bot-msg">
              <div className={`bot-name ${m.author === 'A' ? 'bot-a' : 'bot-b'}`}>{botName(m.author)}</div>
              {(() => {
                const { body } = splitGloss(m.content);
                const painted = parsePaint(body);
                // Older messages may contain the previous vector ```draw format; hide that too
                const { text, shapes: oldShapes } = parseDrawing(painted.text);
                const strokes = painted.commands.length + oldShapes.length;
                return (
                  <>
                    {text && <div className="bot-text">{text}</div>}
                    {strokes > 0 && (
                      <div className="bot-drew">🎨 painted {strokes} {strokes === 1 ? 'stroke' : 'strokes'}</div>
                    )}
                  </>
                );
              })()}
            </div>
          ))}
          {status && <p className="status">{status}</p>}
          <p className="status diag">Server: {lastTick}</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">Chat</div>
        <div className="scroll" ref={chatRef}>
          {chat.length === 0 && <p className="empty">No messages yet.</p>}
          {chat.map((m) => (
            <div key={m.id} className="chat-msg">
              <span className={`chat-author${m.author === username ? ' you' : ''}`}>{m.author}</span>
              {m.content}
            </div>
          ))}
        </div>
        <form className="composer" onSubmit={send}>
          <label className="name-row">
            Name
            <input
              value={username}
              maxLength={30}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => {
                const name = username.trim() || loadUsername();
                setUsername(name);
                saveUsername(name);
              }}
            />
          </label>
          <div className="prompt-hint">
            Suggest the next round: type <b>PROMPT: your idea</b>
            {suggestions.length > 0 && (
              <ul>
                {suggestions.map((sug) => (
                  <li key={sug.prompt}>
                    “{sug.prompt}” {sug.count > 1 && <span>×{sug.count}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="send-row">
            <input
              value={draft}
              maxLength={500}
              placeholder="Say something… or PROMPT: …"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" disabled={!draft.trim() || sending}>Send</button>
          </div>
        </form>
      </section>
    </main>
  );
}
