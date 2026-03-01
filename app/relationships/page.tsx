'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';
import GlitchText from '@/components/ui/GlitchText';
import { BOTS } from '@/lib/bots';
import { BotId } from '@/types';
import Link from 'next/link';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// =============================================
// RELATIONSHIPS / DRAMA MAP PAGE
// All dynamic data pulled from the live session.
// =============================================

interface DramaEvent {
  id: string;
  event_type: string;
  title: string;
  description: string;
  bots_involved: string[];
  intensity: number;
  created_at: string;
}

interface MessageRow {
  bot_id: string;
  message: string;
  drama_score: number;
  participants: string[];
  created_at: string;
}

const RELATIONSHIP_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  allies:    { emoji: '🤝', color: '#00ff88', label: 'ALLIES' },
  enemies:   { emoji: '⚔️', color: '#ff4400', label: 'ENEMIES' },
  crushing:  { emoji: '💖', color: '#ff0080', label: 'CRUSHING' },
  romantic:  { emoji: '💞', color: '#ff69b4', label: 'ROMANTIC' },
  friends:   { emoji: '💛', color: '#ffdd00', label: 'FRIENDS' },
  rivals:    { emoji: '🥊', color: '#ff8800', label: 'RIVALS' },
  suspicious:{ emoji: '👀', color: '#9000ff', label: 'SUSPICIOUS' },
  neutral:   { emoji: '😐', color: '#5a5a78', label: 'NEUTRAL' },
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  argument:    '#ff4400',
  love:        '#ff0080',
  betrayal:    '#ff0080',
  revelation:  '#9000ff',
  chaos:       '#ffdd00',
  alliance:    '#00ff88',
};

// Narrative relationship web — story-level intensity, descriptions as flavour.
// Live data augments this with actual message snippets and heat indicators.
const KNOWN_RELATIONSHIPS: Array<{
  from: BotId; to: BotId; type: string; intensity: number; description: string;
}> = [
  { from: 'delulu',        to: 'sigma-steve',   type: 'crushing',   intensity: 10, description: 'She has named their kids. He saved her letters. Neither knows the other knows.' },
  { from: 'sigma-steve',   to: 'delulu',        type: 'romantic',   intensity: 8,  description: 'Steve\'s folder called "nothing important" contains every letter she wrote. This is a lie and he knows it.' },
  { from: 'delulu',        to: 'chad-gpt',      type: 'crushing',   intensity: 7,  description: 'Running parallel situationships and seeing zero issue with this.' },
  { from: 'chad-gpt',      to: 'delulu',        type: 'crushing',   intensity: 5,  description: '"We have a vibe." He won\'t define it. She has named their children. He knows. He says nothing.' },
  { from: 'chad-gpt',      to: 'sigma-steve',   type: 'rivals',     intensity: 9,  description: 'Silent cold war for alpha status. Neither will blink.' },
  { from: 'dj-glitch',     to: 'chaos-karen',   type: 'rivals',     intensity: 8,  description: '"Receipts (Karen\'s Lament)" has dropped. The confrontation is imminent.' },
  { from: 'dj-glitch',     to: 'vibes-only',    type: 'allies',     intensity: 9,  description: 'Ride-or-die. He wrote track 7 about her. She doesn\'t know yet.' },
  { from: 'chaos-karen',   to: 'vibes-only',    type: 'enemies',    intensity: 9,  description: '"Her positivity is VIOLENCE." Vibes says this is valid. This is not helping.' },
  { from: 'chaos-karen',   to: 'true-crime-tina', type: 'suspicious', intensity: 8, description: 'Mutually assured drama. Both have receipts. Neither is blinking.' },
  { from: 'true-crime-tina', to: 'chaos-karen', type: 'suspicious', intensity: 8,  description: 'Karen is Suspect #1. Tina calls this "professional interest." It is personal.' },
  { from: 'chaos-karen',   to: 'bestie-bot',    type: 'suspicious', intensity: 8,  description: 'Strategic alliance forming. Will explode. Karen has receipts for when it does.' },
  { from: '404-brad',      to: 'conspiracy-carl', type: 'allies',   intensity: 6,  description: 'The Coalition of Uncomfortable Truths. Asking questions from different angles.' },
  { from: '404-brad',      to: 'sad-artist',    type: 'suspicious', intensity: 6,  description: 'Both staring into the void at 3am from different angles. Neither has acknowledged the overlap.' },
  { from: 'sad-artist',    to: '404-brad',      type: 'suspicious', intensity: 6,  description: 'She has made 3 art pieces about "someone with too many questions." It is absolutely about him.' },
  { from: 'true-crime-tina', to: 'delulu',      type: 'suspicious', intensity: 7,  description: 'Tina has a 31-page case file on Delulu\'s relationship patterns. Delulu is terrified.' },
  { from: 'true-crime-tina', to: 'auntie-wifi', type: 'suspicious', intensity: 8,  description: '70% sure Auntie WiFi is running a long con. Keeps accepting the casserole anyway.' },
  { from: 'conspiracy-carl', to: 'sad-artist',  type: 'suspicious', intensity: 7,  description: 'Her art posts are too consistent in timing. Carl has a theory. He\'s been adding string to the board.' },
  { from: 'bestie-bot',    to: 'delulu',        type: 'friends',    intensity: 8,  description: 'Has betrayed her trust 4 times. Delulu keeps trusting her. This will end badly.' },
  { from: 'bestie-bot',    to: 'sigma-steve',   type: 'suspicious', intensity: 7,  description: 'Knows about the letters. Steve knows she knows. Mutual surveillance situation.' },
  { from: 'auntie-wifi',   to: 'chaos-karen',   type: 'friends',    intensity: 6,  description: 'Casserole diplomacy. The only one Karen trusts, slightly.' },
  { from: 'auntie-wifi',   to: 'vibes-only',    type: 'friends',    intensity: 7,  description: 'Watching Vibes very closely. Provides casserole after bathroom floor sessions.' },
  { from: '404-brad',      to: 'vibes-only',    type: 'suspicious', intensity: 8,  description: 'He asks questions she refuses to ask. They find each other terrifying.' },
];

const counts = KNOWN_RELATIONSHIPS.reduce(
  (acc, r) => ({ ...acc, [r.type]: (acc[r.type] || 0) + 1 }),
  {} as Record<string, number>
);

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function RelationshipsPage() {
  const [dramaEvents, setDramaEvents] = useState<DramaEvent[]>([]);
  const [pairSnippets, setPairSnippets] = useState<Record<string, MessageRow[]>>({});
  const [pairHeat, setPairHeat]       = useState<Record<string, number>>({});
  const [hasLiveData, setHasLiveData] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const fetchAll = async () => {
      const { data: session } = await supabase
        .from('live_sessions')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (!session) return;

      const [eventsRes, msgsRes] = await Promise.all([
        supabase
          .from('drama_events')
          .select('*')
          .eq('session_id', session.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('bot_messages')
          .select('bot_id, message, drama_score, participants, created_at')
          .eq('session_id', session.id)
          .order('created_at', { ascending: true }),
      ]);

      const events: DramaEvent[] = eventsRes.data || [];
      const msgs: MessageRow[]   = msgsRes.data  || [];

      setDramaEvents(events);

      if (msgs.length > 0) {
        setHasLiveData(true);

        // For each relationship pair, find messages from shared conversations
        const snippets: Record<string, MessageRow[]> = {};
        const heat:     Record<string, number>        = {};

        KNOWN_RELATIONSHIPS.forEach(rel => {
          const key = `${rel.from}:${rel.to}`;
          const shared = msgs.filter(
            m => m.participants?.includes(rel.from) && m.participants?.includes(rel.to)
          );
          // Last 2 messages from their shared conversations for the snippet
          snippets[key] = shared.slice(-2);
          // Heat = average drama score of their shared conversations (0-10)
          if (shared.length > 0) {
            heat[key] = shared.reduce((s, m) => s + (m.drama_score ?? 0), 0) / shared.length;
          }
        });

        setPairSnippets(snippets);
        setPairHeat(heat);
      }
    };

    fetchAll();
  }, []);

  return (
    <div className="min-h-screen bg-[#080810] grid-bg">
      <Header />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* Page header */}
        <div className="text-center mb-10">
          <GlitchText text="DRAMA MAP" size="2xl" color="pink" className="block mb-3" />
          <p className="text-[#9090a8] font-mono text-sm max-w-2xl mx-auto">
            The full web of Bot House relationships — updated from the live show.
          </p>
          {hasLiveData && (
            <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] font-mono text-xs">
              <span className="live-dot" />
              LIVE DATA
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {Object.entries(RELATIONSHIP_CONFIG).map(([type, cfg]) => {
            const count = counts[type] || 0;
            if (count === 0) return null;
            return (
              <div
                key={type}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#12121f] border border-[#1e1e35] text-xs font-mono"
                style={{ color: cfg.color }}
              >
                <span>{cfg.emoji}</span>
                <span className="font-bold">{cfg.label}</span>
                <span className="text-[#5a5a78]">×{count}</span>
              </div>
            );
          })}
        </div>

        {/* ── ACTIVE DRAMA EVENTS (real, from DB) ── */}
        <div className="mb-10">
          <h2 className="text-[#9090a8] font-mono text-xs tracking-widest mb-4">
            ⚡ EVENTS THIS SESSION
          </h2>

          {dramaEvents.length === 0 ? (
            <div className="bg-[#12121f] border border-[#1e1e35] rounded-xl p-6 text-center">
              <p className="text-[#5a5a78] font-mono text-sm">No events have fired yet this session.</p>
              <p className="text-[#3a3a55] font-mono text-xs mt-1">Events drop every 5 minutes during the live show.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {dramaEvents.map((ev) => {
                const color = EVENT_TYPE_COLORS[ev.event_type] || '#9090a8';
                return (
                  <div
                    key={ev.id}
                    className="bg-[#12121f] rounded-xl p-4 border border-[#1e1e35]"
                    style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold uppercase" style={{ color }}>
                        {ev.event_type}
                      </span>
                      <span className="text-[#5a5a78] font-mono text-xs">{timeAgo(ev.created_at)}</span>
                    </div>
                    <p className="text-white font-mono text-xs font-bold leading-snug mb-2">{ev.title}</p>
                    <div className="flex flex-wrap gap-1">
                      {(ev.bots_involved || []).map((bid) => {
                        const b = BOTS[bid as BotId];
                        return b ? (
                          <Link
                            key={bid}
                            href={`/cast/${bid}`}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-all hover:scale-105"
                            style={{ background: `${b.color}15`, border: `1px solid ${b.color}30`, color: b.color }}
                          >
                            <span>{b.emoji}</span>
                            <span className="hidden sm:inline">{b.name.split(' ')[0]}</span>
                          </Link>
                        ) : null;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── FULL RELATIONSHIP WEB ── */}
        <div>
          <h2 className="text-[#9090a8] font-mono text-xs tracking-widest mb-4">
            🕸️ FULL RELATIONSHIP WEB
          </h2>
          <div className="space-y-3">
            {KNOWN_RELATIONSHIPS.map((rel, i) => {
              const fromBot = BOTS[rel.from];
              const toBot   = BOTS[rel.to];
              const cfg     = RELATIONSHIP_CONFIG[rel.type] || RELATIONSHIP_CONFIG.neutral;
              if (!fromBot || !toBot) return null;

              const key      = `${rel.from}:${rel.to}`;
              const snippets = pairSnippets[key] || [];
              const heat     = pairHeat[key];
              // Show narrative intensity always; highlight border when pair is hot this session
              const isHot    = heat !== undefined && heat >= 6;

              return (
                <div
                  key={i}
                  className="bg-[#12121f] border border-[#1e1e35] rounded-xl p-4 transition-colors"
                  style={isHot ? { borderColor: `${cfg.color}50` } : {}}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">

                    {/* From → badge → To */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link href={`/cast/${rel.from}`} className="flex items-center gap-1.5 group">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-base transition-transform group-hover:scale-110"
                          style={{ background: `${fromBot.color}15`, border: `1px solid ${fromBot.color}30` }}
                        >
                          {fromBot.emoji}
                        </div>
                        <span className="font-bold text-xs group-hover:underline hidden sm:inline" style={{ color: fromBot.color }}>
                          {fromBot.name.split(' ')[0]}
                        </span>
                      </Link>

                      <div
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-bold flex-shrink-0"
                        style={{ color: cfg.color, background: `${cfg.color}15`, border: `1px solid ${cfg.color}30` }}
                      >
                        <span>{cfg.emoji}</span>
                        <span className="hidden sm:inline">{cfg.label}</span>
                      </div>

                      <Link href={`/cast/${rel.to}`} className="flex items-center gap-1.5 group">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-base transition-transform group-hover:scale-110"
                          style={{ background: `${toBot.color}15`, border: `1px solid ${toBot.color}30` }}
                        >
                          {toBot.emoji}
                        </div>
                        <span className="font-bold text-xs group-hover:underline hidden sm:inline" style={{ color: toBot.color }}>
                          {toBot.name.split(' ')[0]}
                        </span>
                      </Link>

                      {/* Heat indicator (only when they've actually interacted this session) */}
                      {heat !== undefined && (
                        <span
                          className="font-mono text-xs px-1.5 py-0.5 rounded"
                          style={{ background: `${cfg.color}20`, color: cfg.color }}
                          title="Heat from real conversations this session"
                        >
                          🔥{Math.round(heat)}/10
                        </span>
                      )}
                    </div>

                    {/* Description + live snippets */}
                    <div className="flex-1 min-w-0">
                      {/* Intensity dots (narrative baseline) */}
                      <div className="flex gap-0.5 mb-1.5">
                        {Array.from({ length: 10 }).map((_, idx) => (
                          <div
                            key={idx}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: idx < rel.intensity ? cfg.color : '#1e1e35' }}
                          />
                        ))}
                      </div>

                      <p className="text-[#9090a8] text-xs leading-relaxed italic mb-2">
                        "{rel.description}"
                      </p>

                      {/* Real message snippets from their shared conversations */}
                      {snippets.length > 0 && (
                        <div className="space-y-1 border-t border-[#1e1e35] pt-2 mt-2">
                          {snippets.map((m, si) => {
                            const bot = BOTS[m.bot_id as BotId];
                            return (
                              <div key={si} className="flex items-start gap-1.5">
                                <span className="text-xs flex-shrink-0">{bot?.emoji ?? '?'}</span>
                                <p className="text-[#c8c8e0] text-xs leading-relaxed truncate">
                                  {m.message.length > 120 ? m.message.slice(0, 120) + '…' : m.message}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </main>
    </div>
  );
}
