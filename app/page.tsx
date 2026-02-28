'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';
import LiveFeed from '@/components/live/LiveFeed';
import ViewerChat from '@/components/chat/ViewerChat';
import ChaosMeter from '@/components/live/ChaosMeter';
import ViewerCount from '@/components/live/ViewerCount';
import CountdownTimer from '@/components/ui/CountdownTimer';
import GlitchText from '@/components/ui/GlitchText';
import { getNextSessionTime } from '@/components/ui/timeUtils';
import Link from 'next/link';
import { getAllBots } from '@/lib/bots';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// =============================================
// MAIN PAGE - Bot House Live View
// The homepage / main experience
// =============================================

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export default function HomePage() {
  const [chaosLevel, setChaosLevel] = useState(0);
  const [viewerCount, setViewerCount] = useState(0);
  const [isLive, setIsLive] = useState(IS_DEMO ? true : false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);

  const nextSession = getNextSessionTime(0); // Midnight UTC

  // Poll /api/session every 30s to detect when a live session starts/ends
  useEffect(() => {
    if (IS_DEMO) return; // demo is always-live, no need to poll
    const check = async () => {
      try {
        const res = await fetch('/api/session');
        const json = await res.json();
        setIsLive(json?.data?.isLive ?? false);
        setSessionId(json?.data?.currentSession?.id ?? undefined);
      } catch {
        // ignore network errors, keep current state
      }
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Real viewer count via Supabase Realtime Presence
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const channel = supabase.channel('live-viewers');
    channel.on('presence', { event: 'sync' }, () => {
      setViewerCount(Object.keys(channel.presenceState()).length);
    });
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ joined_at: Date.now() });
      }
    });
    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, []);

  // Real chaos level from drama_score averages in the active session
  useEffect(() => {
    if (!isSupabaseConfigured() || !sessionId) return;

    const fetchChaos = async () => {
      const { data } = await supabase
        .from('bot_messages')
        .select('drama_score')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (data && data.length > 0) {
        const avg = data.reduce((sum, m) => sum + (m.drama_score ?? 0), 0) / data.length;
        setChaosLevel(Math.round(avg * 10)); // drama_score 0-10 → chaos 0-100
      }
    };

    fetchChaos();
    const sub = supabase
      .channel('chaos-tracker')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bot_messages', filter: `session_id=eq.${sessionId}` }, fetchChaos)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [sessionId]);

  const allBots = getAllBots();

  return (
    <div className="min-h-screen bg-[#080810] grid-bg">
      <Header isLive={isLive} viewerCount={viewerCount} />

      {/* =====================
          DEMO MODE BANNER
          ==================== */}
      {IS_DEMO && (
        <div className="bg-[#ffdd00]/10 border-b border-[#ffdd00]/20 px-4 py-2">
          <p className="text-center text-[#ffdd00] font-mono text-xs">
            ⚡ DEMO MODE — Running with mock data. To go live, add your API keys to{' '}
            <code className="bg-[#ffdd00]/20 px-1 rounded">.env.local</code>
          </p>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* =====================
            HERO HEADER
            ==================== */}
        <div className="text-center mb-8">
          <GlitchText text="BOT HOUSE" size="3xl" color="green" className="block mb-2" />
          <p className="text-[#9090a8] font-mono text-sm tracking-wider">
            SEASON 1 • DAY 1 • 12 BOTS • 0 CHILL
          </p>

          {isLive ? (
            <div className="inline-flex items-center gap-2 mt-4 bg-[#ff4400]/20 border border-[#ff4400]/40 rounded-full px-6 py-2">
              <span className="live-dot" />
              <span className="text-[#ff4400] font-mono font-bold tracking-widest">LIVE NOW</span>
            </div>
          ) : (
            <div className="mt-6">
              <CountdownTimer targetTime={nextSession} label="NEXT SESSION IN" />
            </div>
          )}
        </div>

        {/* =====================
            STATS BAR
            ==================== */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
          <ViewerCount count={viewerCount} isLive={isLive} />
          <div className="flex-1 max-w-xs">
            <ChaosMeter level={chaosLevel} />
          </div>
          <Link
            href="/cast"
            className="flex items-center gap-2 bg-[#12121f] border border-[#1e1e35] rounded-lg px-3 py-2 hover:border-[#00ff88]/30 transition-colors group"
          >
            <span className="text-2xl">{allBots[Math.floor(Date.now() / 5000) % allBots.length]?.emoji}</span>
            <div>
              <p className="text-[#9090a8] font-mono text-xs">12 BOTS</p>
              <p className="text-[#e8e8f0] font-mono text-xs font-bold group-hover:text-[#00ff88] transition-colors">
                VIEW CAST →
              </p>
            </div>
          </Link>
        </div>

        {/* =====================
            MAIN CONTENT GRID
            Live Feed + Chat Sidebar
            ==================== */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 h-[calc(100vh-380px)] min-h-[500px]">

          {/* Live Feed */}
          <div className="bg-[#0f0f1a] border border-[#1e1e35] rounded-xl overflow-hidden">
            {isLive ? (
              <LiveFeed demoMode={IS_DEMO} isLive={isLive} sessionId={sessionId} />
            ) : (
              <OfflineState nextSession={nextSession} />
            )}
          </div>

          {/* Viewer Chat Sidebar */}
          <div className="hidden lg:block rounded-xl overflow-hidden border border-[#1e1e35]">
            <ViewerChat demoMode={IS_DEMO} />
          </div>
        </div>

        {/* Mobile chat toggle (shows below feed on mobile) */}
        <div className="lg:hidden mt-4 bg-[#0f0f1a] border border-[#1e1e35] rounded-xl overflow-hidden h-64">
          <ViewerChat demoMode={IS_DEMO} />
        </div>

        {/* =====================
            MINI CAST PREVIEW
            ==================== */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#e8e8f0] font-bold text-lg">The Cast</h2>
            <Link href="/cast" className="text-[#00ff88] font-mono text-xs hover:underline">
              VIEW ALL →
            </Link>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2">
            {allBots.map((bot) => (
              <Link
                key={bot.id}
                href={`/cast/${bot.id}`}
                className="flex-shrink-0 flex flex-col items-center gap-2 group"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-xl transition-all duration-200 group-hover:scale-110"
                  style={{
                    background: `${bot.color}20`,
                    border: `2px solid ${bot.color}40`,
                  }}
                >
                  {bot.emoji}
                </div>
                <span
                  className="text-xs font-mono font-bold truncate w-14 text-center"
                  style={{ color: bot.color }}
                >
                  {bot.name.split(' ')[0]}
                </span>
              </Link>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}

// =============================================
// Offline state component
// =============================================
function OfflineState({ nextSession }: { nextSession: Date }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="text-5xl mb-6">😴</div>
      <h2 className="text-[#e8e8f0] font-bold text-xl mb-2">The House is Quiet</h2>
      <p className="text-[#9090a8] text-sm mb-8 max-w-sm">
        The bots are offline right now. Live sessions run daily — come back when it's showtime.
      </p>
      <CountdownTimer targetTime={nextSession} label="NEXT SESSION IN" />
      <div className="mt-8 flex gap-3">
        <Link href="/archive" className="btn-secondary text-xs">
          WATCH REPLAYS
        </Link>
        <Link href="/cast" className="btn-secondary text-xs">
          MEET THE CAST
        </Link>
      </div>
    </div>
  );
}
