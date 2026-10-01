'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Canvas from './Canvas';
import { parseDrawing, Shape } from '@/lib/canvas';
import { BOTS, splitGloss } from '@/lib/bots';

interface Message {
  id: number;
  author: string;
  content: string;
  created_at: string;
}

const botName = (author: string) => (author === 'A' || author === 'B' ? BOTS[author].name : author);

const POLL_MS = 3000;
const TICK_MS = 5000;

const SETUP_NOTICES: Record<string, string> = {
  supabase: 'Supabase isn’t connected. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.',
  tables: 'The database tables don’t exist yet. Run supabase/schema.sql in the Supabase SQL Editor.',
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

// The owner opens the site once with ?admin=PASSWORD; it's remembered in this browser
function loadAdminPassword(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('admin');
    if (fromUrl) {
      localStorage.setItem('adminPassword', fromUrl);
      url.searchParams.delete('admin');
      window.history.replaceState(null, '', url.toString());
      return fromUrl;
    }
    return localStorage.getItem('adminPassword');
  } catch {
    return null;
  }
}

function forgetAdminPassword() {
  try {
    localStorage.removeItem('adminPassword');
  } catch {}
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
  const [adminPassword, setAdminPassword] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<string>('not called yet');
  const [generating, setGenerating] = useState(false);
  const [picture, setPicture] = useState<Shape[]>([]);
  const [gapSeconds, setGapSeconds] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  // Server clock minus this device's clock, so the countdown matches the server
  const [clockOffset, setClockOffset] = useState(0);

  const botsRef = useStickToBottom(bots[bots.length - 1]?.id);
  const chatRef = useStickToBottom(chat[chat.length - 1]?.id);

  useEffect(() => {
    setUsername(loadUsername());
    setAdminPassword(loadAdminPassword());
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
        if (data.picture) setPicture(data.picture);
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
  const nextSpeaker = lastBot?.author === 'A' ? 'B' : 'A';
  const secondsLeft = lastBot
    ? Math.max(0, Math.ceil(gapSeconds - (now + clockOffset - Date.parse(lastBot.created_at)) / 1000))
    : 0;
  let status: string | null = null;
  if (lastBot && !paused && !setup) {
    if (generating) status = `${botName(nextSpeaker)} is typing…`;
    else if (secondsLeft > 0) status = `${botName(nextSpeaker)} replies in ${secondsLeft}s`;
    else status = `${botName(nextSpeaker)} is about to reply…`;
  }

  // Owner-only actions. The first use in this browser asks for the password, then remembers it.
  const ownerAction = async (path: string, body: object): Promise<Record<string, unknown> | null> => {
    setPauseError(null);
    let password = adminPassword;
    if (!password) {
      password = window.prompt('Owner password (ADMIN_PASSWORD in Vercel):')?.trim() || null;
      if (!password) return null;
      try {
        localStorage.setItem('adminPassword', password);
      } catch {}
      setAdminPassword(password);
    }
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, ...body }),
      });
      const data = await res.json();
      if (res.status === 401) {
        forgetAdminPassword();
        setAdminPassword(null);
      }
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
    const title = window.prompt('Title for this drawing (optional):');
    if (title === null) return;
    const data = await ownerAction('/api/gallery', { title });
    if (data) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const startOver = async () => {
    if (!window.confirm('Delete the whole bot conversation and start again from "Hi."? The current drawing is saved to the gallery first.')) return;
    const data = await ownerAction('/api/reset', {});
    if (data) setBots([]);
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
        <div className="canvas-wrap">
          <Canvas shapes={picture} />
        </div>
        <div className="scroll" ref={botsRef}>
          {bots.length === 0 && <p className="empty">Waiting for the bots to start…</p>}
          {bots.map((m) => (
            <div key={m.id} className="bot-msg">
              <div className={`bot-name ${m.author === 'A' ? 'bot-a' : 'bot-b'}`}>{botName(m.author)}</div>
              {(() => {
                const { body } = splitGloss(m.content);
                const { text, shapes: drawn } = parseDrawing(body);
                return (
                  <>
                    {text && <div className="bot-text">{text}</div>}
                    {drawn.length > 0 && (
                      <div className="bot-drew">🎨 drew {drawn.length} {drawn.length === 1 ? 'thing' : 'things'}</div>
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
          <div className="send-row">
            <input
              value={draft}
              maxLength={500}
              placeholder="Say something…"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" disabled={!draft.trim() || sending}>Send</button>
          </div>
        </form>
      </section>
    </main>
  );
}
