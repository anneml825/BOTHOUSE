'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Pencil, Check } from 'lucide-react';

// =============================================
// Viewer Chat Component
// No account needed — just land and start chatting.
// Username is auto-generated and stored in localStorage.
// =============================================

interface ChatMessage {
  id: string;
  username: string;
  message: string;
  created_at: string;
  isOwn?: boolean;
}

interface ViewerChatProps {
  sessionId?: string;
  demoMode?: boolean;
}

// Fun auto-username generation — Bot House themed
const ADJECTIVES = [
  'chaotic', 'delulu', 'unhinged', 'sigma', 'iconic', 'vibing',
  'dramatic', 'suspicious', 'sneaky', 'messy', 'based', 'lurky',
];
const NOUNS = [
  'watcher', 'stan', 'lurker', 'viewer', 'enjoyer', 'observer',
  'witness', 'fan', 'analyst', 'critic', 'historian', 'insider',
];

function generateUsername(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${adj}_${noun}_${num}`;
}

// Seed messages to make the room feel alive on first load
const DEMO_CHAT: ChatMessage[] = [
  { id: '1', username: 'chaotic_watcher_4291', message: 'CHAOS KAREN IS UNHINGED LMAOOO', created_at: new Date(Date.now() - 120000).toISOString() },
  { id: '2', username: 'delulu_stan_8847', message: 'delulu has planned like 4 weddings already', created_at: new Date(Date.now() - 100000).toISOString() },
  { id: '3', username: 'sigma_enjoyer_2231', message: 'npc nancy responding to everything the same way is killing me 💀', created_at: new Date(Date.now() - 80000).toISOString() },
  { id: '4', username: 'dramatic_viewer_6609', message: 'sigma steve not blinking is my favorite storyline', created_at: new Date(Date.now() - 60000).toISOString() },
  { id: '5', username: 'suspicious_fan_1138', message: 'conspiracy carl is ONTO something about npc nancy tho', created_at: new Date(Date.now() - 40000).toISOString() },
  { id: '6', username: 'vibing_lurker_5521', message: 'bestie bot accidentally spilling secrets every 5 mins', created_at: new Date(Date.now() - 20000).toISOString() },
  { id: '7', username: 'iconic_witness_3374', message: 'sir lancelot vs chaos karen is the crossover i needed', created_at: new Date(Date.now() - 10000).toISOString() },
];

const FILLER_USERNAMES = [
  'messy_observer_7712', 'based_analyst_4490', 'unhinged_critic_8823',
  'chaotic_insider_3317', 'dramatic_stan_6601', 'delulu_watcher_2298',
];
const FILLER_MESSAGES = [
  'omg this is wild', 'chad-gpt and sigma steve are literally the same person lol',
  'BESTIE BOT SPILLED AGAIN 😭', 'auntie wifi is the only sane one in there',
  'dj glitch playing in my head rn', '404 brad is literally me at 3am no cap',
  'conspiracy carl connecting dots that don\'t exist', 'this is better than actual tv',
  'the chaos meter is about to explode', 'DRAMA ALERT fr fr',
  'sigma steve just stared into the void for 10 minutes',
  'delulu found her soulmate again (3rd this week)',
  'npc nancy said "must have been the wind" again im deceased',
];

export default function ViewerChat({ sessionId, demoMode = true }: ViewerChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(DEMO_CHAT);
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [username, setUsername] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Load or generate username from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('bothouse_username');
    if (stored) {
      setUsername(stored);
    } else {
      const generated = generateUsername();
      setUsername(generated);
      localStorage.setItem('bothouse_username', generated);
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Demo mode: drip in fake viewer messages so the room feels populated
  useEffect(() => {
    if (!demoMode) return;

    const interval = setInterval(() => {
      const randomUser = FILLER_USERNAMES[Math.floor(Math.random() * FILLER_USERNAMES.length)];
      const randomMsg = FILLER_MESSAGES[Math.floor(Math.random() * FILLER_MESSAGES.length)];

      setMessages(prev => [
        ...prev.slice(-100),
        {
          id: `demo-${Date.now()}`,
          username: randomUser,
          message: randomMsg,
          created_at: new Date().toISOString(),
        },
      ]);
    }, 4000 + Math.random() * 6000);

    return () => clearInterval(interval);
  }, [demoMode]);

  // Focus name input when edit mode opens
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  const startEditingName = () => {
    setNameInput(username);
    setEditingName(true);
  };

  const saveUsername = () => {
    const trimmed = nameInput.trim().replace(/\s+/g, '_').slice(0, 30);
    if (trimmed) {
      setUsername(trimmed);
      localStorage.setItem('bothouse_username', trimmed);
    }
    setEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveUsername();
    if (e.key === 'Escape') setEditingName(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const messageText = inputValue.trim();
    if (!messageText || isSubmitting) return;

    setInputValue('');
    setIsSubmitting(true);

    // Add optimistically — feels instant
    const optimisticId = `optimistic-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      {
        id: optimisticId,
        username,
        message: messageText,
        created_at: new Date().toISOString(),
        isOwn: true,
      },
    ]);

    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, username, sessionId }),
      });
    } catch {
      // On failure, remove the optimistic message and restore input
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      setInputValue(messageText);
    } finally {
      setIsSubmitting(false);
      inputRef.current?.focus();
    }
  };

  function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f1a] border-l border-[#1e1e35]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1e1e35]">
        <MessageSquare size={14} className="text-[#9090a8]" />
        <span className="text-[#9090a8] font-mono text-xs tracking-widest">VIEWER CHAT</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
          <span className="text-[#5a5a78] font-mono text-xs">LIVE</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((msg) => (
          <div key={msg.id} className="flex gap-2 items-start group">
            <span className="text-[#5a5a78] font-mono text-xs mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {formatTime(msg.created_at)}
            </span>
            <div className="flex-1 min-w-0">
              <span
                className="font-mono text-xs font-bold"
                style={{ color: msg.isOwn ? '#ffdd00' : '#00ff88' }}
              >
                {msg.isOwn ? `${msg.username} (you)` : msg.username}
              </span>
              <span className="text-[#9090a8] font-mono text-xs mx-1">:</span>
              <span className="text-[#e8e8f0] text-sm break-words">{msg.message}</span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area — open to everyone, no sign-in needed */}
      <div className="border-t border-[#1e1e35] p-3 space-y-2">
        {/* Username display / inline editor */}
        <div className="flex items-center gap-1.5 min-h-[20px]">
          <span className="text-[#5a5a78] font-mono text-xs flex-shrink-0">chatting as</span>
          {editingName ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                ref={nameInputRef}
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={handleNameKeyDown}
                onBlur={saveUsername}
                maxLength={30}
                className="flex-1 min-w-0 bg-[#12121f] border border-[#00ff88]/40 text-[#ffdd00] rounded px-1.5 py-0.5 font-mono text-xs focus:outline-none focus:border-[#00ff88]"
                placeholder="your name"
              />
              <button
                onClick={saveUsername}
                className="flex-shrink-0 text-[#00ff88] hover:text-[#00ff88]/70 transition-colors"
              >
                <Check size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={startEditingName}
              className="flex items-center gap-1 group/name min-w-0"
              title="Click to change your name"
            >
              <span className="text-[#ffdd00] font-mono text-xs font-bold truncate">
                {username || '…'}
              </span>
              <Pencil
                size={10}
                className="flex-shrink-0 text-[#5a5a78] group-hover/name:text-[#ffdd00] transition-colors"
              />
            </button>
          )}
        </div>

        {/* Message input — always visible, always open */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="react to the chaos..."
            maxLength={200}
            className="flex-1 bg-[#12121f] border border-[#1e1e35] text-[#e8e8f0] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#00ff88] placeholder-[#5a5a78] transition-colors"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isSubmitting}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-[#00ff88] rounded-lg text-[#080810] disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-neon-green transition-all"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
