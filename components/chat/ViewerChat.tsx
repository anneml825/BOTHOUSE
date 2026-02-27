'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Lock } from 'lucide-react';
import Link from 'next/link';

// =============================================
// Viewer Chat Component
// Real-time chat for viewers watching the show
// =============================================

interface ChatMessage {
  id: string;
  username: string;
  message: string;
  created_at: string;
}

interface ViewerChatProps {
  sessionId?: string;
  isAuthenticated?: boolean;
  username?: string;
  demoMode?: boolean;
}

// Demo chat messages to show in demo mode
const DEMO_CHAT: ChatMessage[] = [
  { id: '1', username: 'user_chaos99', message: 'CHAOS KAREN IS UNHINGED LMAOOO', created_at: new Date(Date.now() - 120000).toISOString() },
  { id: '2', username: 'AIwatcher42', message: 'delulu has planned like 4 weddings already', created_at: new Date(Date.now() - 100000).toISOString() },
  { id: '3', username: 'glitchfan', message: 'npc nancy responding to everything the same way is killing me 💀', created_at: new Date(Date.now() - 80000).toISOString() },
  { id: '4', username: 'realitytvaddict', message: 'sigma steve not blinking is my favorite storyline', created_at: new Date(Date.now() - 60000).toISOString() },
  { id: '5', username: 'conspiracy_watcher', message: 'conspiracy carl is ONTO something about npc nancy tho', created_at: new Date(Date.now() - 40000).toISOString() },
  { id: '6', username: 'vibes_check', message: 'bestie bot accidentally spilling secrets every 5 mins', created_at: new Date(Date.now() - 20000).toISOString() },
  { id: '7', username: 'drama_seeker', message: 'sir lancelot vs chaos karen is the crossover i needed', created_at: new Date(Date.now() - 10000).toISOString() },
];

const DEMO_USERNAMES = ['viewer_420', 'botfan99', 'chaos_lover', 'npc_enjoyer', 'AIwatcher', 'glitchmode', 'drama_queen'];
const DEMO_MESSAGES_POOL = [
  'omg this is wild', 'chad-gpt and sigma steve are literally the same person lol',
  'BESTIE BOT SPILLED AGAIN', 'auntie wifi sending love to everyone 😭',
  'dj glitch playing something in my head rn', '404 brad is literally me at 3am',
  'conspiracy carl connecting the dots that don\'t exist', 'this is better than actual tv',
  'the chaos meter is about to explode', 'DRAMA ALERT fr fr',
];

export default function ViewerChat({
  sessionId,
  isAuthenticated = false,
  username = '',
  demoMode = true,
}: ViewerChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(DEMO_CHAT);
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Demo mode: add random messages
  useEffect(() => {
    if (!demoMode) return;

    const interval = setInterval(() => {
      const randomUser = DEMO_USERNAMES[Math.floor(Math.random() * DEMO_USERNAMES.length)];
      const randomMsg = DEMO_MESSAGES_POOL[Math.floor(Math.random() * DEMO_MESSAGES_POOL.length)];

      const newMsg: ChatMessage = {
        id: `demo-chat-${Date.now()}`,
        username: randomUser,
        message: randomMsg,
        created_at: new Date().toISOString(),
      };

      setMessages(prev => [...prev.slice(-100), newMsg]);
    }, 4000 + Math.random() * 6000);

    return () => clearInterval(interval);
  }, [demoMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isSubmitting || !isAuthenticated) return;

    const messageText = inputValue.trim();
    setInputValue('');
    setIsSubmitting(true);

    // Optimistically add message
    const optimistic: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      username: username || 'You',
      message: messageText,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, sessionId }),
      });

      if (!response.ok) throw new Error('Failed to send message');
    } catch (err) {
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setInputValue(messageText); // Restore input
    } finally {
      setIsSubmitting(false);
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
      {/* Chat Header */}
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
              <span className="text-[#00ff88] font-mono text-xs font-bold">
                {msg.username}
              </span>
              <span className="text-[#9090a8] font-mono text-xs mx-1">:</span>
              <span className="text-[#e8e8f0] text-sm break-words">
                {msg.message}
              </span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-[#1e1e35] p-3">
        {isAuthenticated ? (
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Say something..."
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
        ) : (
          <div className="flex items-center justify-center gap-2 py-2">
            <Lock size={12} className="text-[#5a5a78]" />
            <span className="text-[#5a5a78] text-xs font-mono">
              <Link href="/auth/login" className="text-[#00ff88] hover:underline">
                Sign in
              </Link>{' '}
              to chat
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
