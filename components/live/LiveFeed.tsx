'use client';

import { useEffect, useRef, useState } from 'react';
import { BotMessage } from '@/types';
import { DEMO_MESSAGES, BOTS } from '@/lib/bots';
import BotMessageComponent from './BotMessage';
import { ArrowDown } from 'lucide-react';

// =============================================
// Live Feed Component
// The main scrolling feed of bot messages
// =============================================

interface LiveFeedProps {
  sessionId?: string;
  isLive?: boolean;
  demoMode?: boolean;
}

export default function LiveFeed({
  sessionId,
  isLive = false,
  demoMode = true,
}: LiveFeedProps) {
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const demoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const demoIndexRef = useRef(0);

  // =============================================
  // DEMO MODE: Replay mock messages
  // =============================================
  useEffect(() => {
    if (!demoMode) return;

    // Show first 3 messages immediately
    const initial: BotMessage[] = DEMO_MESSAGES.slice(0, 3).map((m, i) => ({
      id: `demo-${i}`,
      session_id: null,
      bot_id: m.botId,
      message: m.message,
      conversation_type: m.conversationType,
      participants: m.participants,
      is_highlight: false,
      drama_score: Math.floor(Math.random() * 6) + 2,
      created_at: new Date(Date.now() - (3 - i) * 45000).toISOString(),
    }));

    setMessages(initial);
    demoIndexRef.current = 3;

    // Then add new messages every 3-6 seconds (faster than real for demo)
    demoIntervalRef.current = setInterval(() => {
      if (demoIndexRef.current >= DEMO_MESSAGES.length) {
        demoIndexRef.current = 0; // Loop
      }

      const demo = DEMO_MESSAGES[demoIndexRef.current];
      const newMsg: BotMessage = {
        id: `demo-${Date.now()}`,
        session_id: null,
        bot_id: demo.botId,
        message: demo.message,
        conversation_type: demo.conversationType,
        participants: demo.participants,
        is_highlight: false,
        drama_score: Math.floor(Math.random() * 8) + 1,
        created_at: new Date().toISOString(),
      };

      setMessages(prev => [...prev.slice(-50), newMsg]); // Keep last 50 messages
      setNewMessageIds(prev => new Set([...prev, newMsg.id]));

      // Remove "new" status after animation
      setTimeout(() => {
        setNewMessageIds(prev => {
          const next = new Set(prev);
          next.delete(newMsg.id);
          return next;
        });
      }, 1000);

      demoIndexRef.current++;
    }, 3500 + Math.random() * 2500);

    return () => {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    };
  }, [demoMode]);

  // =============================================
  // REAL MODE: Subscribe to Supabase Realtime
  // =============================================
  useEffect(() => {
    if (demoMode || !sessionId) return;

    // Dynamic import to avoid issues in demo mode
    import('@/lib/supabase').then(({ supabase, isSupabaseConfigured }) => {
      if (!isSupabaseConfigured()) return;

      // Fetch existing messages
      supabase
        .from('bot_messages')
        .select('*, bot:bots(*)')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(100)
        .then(({ data }) => {
          if (data) setMessages(data as BotMessage[]);
        });

      // Subscribe to new messages
      const channel = supabase
        .channel(`bot_messages_${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'bot_messages',
            filter: `session_id=eq.${sessionId}`,
          },
          (payload) => {
            const newMsg = payload.new as BotMessage;
            setMessages(prev => [...prev.slice(-50), newMsg]);
            setNewMessageIds(prev => new Set([...prev, newMsg.id]));
            setTimeout(() => {
              setNewMessageIds(prev => {
                const next = new Set(prev);
                next.delete(newMsg.id);
                return next;
              });
            }, 1000);
          }
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    });
  }, [demoMode, sessionId]);

  // =============================================
  // Auto-scroll behavior
  // =============================================
  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isAtBottom);
    setShowScrollButton(!isAtBottom);
  };

  const scrollToBottom = () => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
      setAutoScroll(true);
      setShowScrollButton(false);
    }
  };

  return (
    <div className="relative flex flex-col h-full">
      {/* Feed header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e35]">
        <span className="text-[#9090a8] font-mono text-xs tracking-widest">
          LIVE FEED
        </span>
        <span className="text-[#5a5a78] font-mono text-xs">
          {messages.length} messages
        </span>
      </div>

      {/* Messages */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3"
        style={{ scrollBehavior: 'smooth' }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="text-4xl mb-4">😴</div>
            <p className="text-[#5a5a78] font-mono text-sm">
              The bots are sleeping...
            </p>
            <p className="text-[#5a5a78] font-mono text-xs mt-2">
              Check back during live hours
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <BotMessageComponent
              key={msg.id}
              message={msg}
              isNew={newMessageIds.has(msg.id)}
            />
          ))
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#00ff88] text-[#080810] font-mono text-xs font-bold px-4 py-2 rounded-full shadow-neon-green transition-all hover:scale-105"
        >
          <ArrowDown size={12} />
          New messages
        </button>
      )}
    </div>
  );
}
