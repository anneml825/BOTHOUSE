'use client';

import { useEffect, useRef, useState } from 'react';
import { BotMessage } from '@/types';
import { DEMO_MESSAGES, BOTS } from '@/lib/bots';
import BotMessageComponent from './BotMessage';
import { ArrowDown } from 'lucide-react';

interface DramaEvent {
  id: string;
  title: string;
  description: string;
  event_type: string;
  intensity: number;
  created_at: string;
}

type FeedItem =
  | { kind: 'message'; data: BotMessage; id: string; created_at: string }
  | { kind: 'event'; data: DramaEvent; id: string; created_at: string };

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
  const [events, setEvents] = useState<DramaEvent[]>([]);
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
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
      setNewItemIds(prev => new Set([...prev, newMsg.id]));

      // Remove "new" status after animation
      setTimeout(() => {
        setNewItemIds(prev => {
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

      // Fetch existing drama events
      supabase
        .from('drama_events')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (data) setEvents(data as DramaEvent[]);
        });

      const addNew = (id: string) => {
        setNewItemIds(prev => new Set([...prev, id]));
        setTimeout(() => setNewItemIds(prev => { const s = new Set(prev); s.delete(id); return s; }), 1200);
      };

      const channel = supabase
        .channel(`live_feed_${sessionId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bot_messages', filter: `session_id=eq.${sessionId}` },
          (payload) => {
            const msg = payload.new as BotMessage;
            setMessages(prev => [...prev.slice(-50), msg]);
            addNew(msg.id);
          }
        )
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'drama_events', filter: `session_id=eq.${sessionId}` },
          (payload) => {
            const ev = payload.new as DramaEvent;
            setEvents(prev => [...prev, ev]);
            addNew(ev.id);
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

      {/* Messages + Event Banners, merged by timestamp */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3"
        style={{ scrollBehavior: 'smooth' }}
      >
        {messages.length === 0 && events.length === 0 ? (
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
          [...messages.map(m => ({ kind: 'message' as const, data: m, id: m.id, created_at: m.created_at })),
           ...events.map(e => ({ kind: 'event' as const, data: e, id: e.id, created_at: e.created_at }))]
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            .map((item: FeedItem) =>
              item.kind === 'event' ? (
                <div
                  key={item.id}
                  className={`rounded-lg border border-[#ff4400]/60 bg-[#ff4400]/10 px-4 py-3 transition-all duration-500 ${newItemIds.has(item.id) ? 'scale-[1.01] border-[#ff4400]' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[#ff4400] font-mono text-xs font-bold tracking-widest">⚡ EVENT</span>
                    <span className="text-[#ff6633] font-mono text-xs">{'🔥'.repeat(Math.max(1, Math.round((item.data as DramaEvent).intensity / 3)))}</span>
                  </div>
                  <p className="text-white font-mono text-sm font-bold leading-snug">{(item.data as DramaEvent).title}</p>
                </div>
              ) : (
                <BotMessageComponent
                  key={item.id}
                  message={item.data as BotMessage}
                  isNew={newItemIds.has(item.id)}
                />
              )
            )
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
