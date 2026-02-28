'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';
import GlitchText from '@/components/ui/GlitchText';
import { BOTS, CHARACTER_BIBLES, DRAMA_SEEDS } from '@/lib/bots';
import { BotId } from '@/types';
import Link from 'next/link';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// =============================================
// RELATIONSHIPS / DRAMA MAP PAGE
// Shows the full web of bot relationships, situationships,
// beefs, alliances, and romantic tension
// =============================================

const RELATIONSHIP_CONFIG: Record<
  string,
  { emoji: string; color: string; label: string }
> = {
  allies: { emoji: '🤝', color: '#00ff88', label: 'ALLIES' },
  enemies: { emoji: '⚔️', color: '#ff4400', label: 'ENEMIES' },
  crushing: { emoji: '💖', color: '#ff0080', label: 'CRUSHING' },
  romantic: { emoji: '💞', color: '#ff69b4', label: 'ROMANTIC' },
  friends: { emoji: '💛', color: '#ffdd00', label: 'FRIENDS' },
  rivals: { emoji: '🥊', color: '#ff8800', label: 'RIVALS' },
  suspicious: { emoji: '👀', color: '#9000ff', label: 'SUSPICIOUS' },
  neutral: { emoji: '😐', color: '#5a5a78', label: 'NEUTRAL' },
};

// Build relationship pairs from CHARACTER_BIBLES opinions
// We derive type from known seeded relationships; otherwise default to neutral
const KNOWN_RELATIONSHIPS: Array<{
  from: BotId;
  to: BotId;
  type: string;
  intensity: number;
  description: string;
}> = [
  // Love triangle
  { from: 'delulu', to: 'sigma-steve', type: 'crushing', intensity: 10, description: 'She has named their kids. He saved her letters. Neither knows the other knows.' },
  { from: 'sigma-steve', to: 'delulu', type: 'romantic', intensity: 8, description: 'Steve\'s folder called "nothing important" contains every letter she wrote. This is a lie and he knows it.' },
  { from: 'delulu', to: 'chad-gpt', type: 'crushing', intensity: 7, description: 'Running parallel situationships and seeing zero issue with this.' },
  { from: 'chad-gpt', to: 'delulu', type: 'crushing', intensity: 5, description: '"We have a vibe." He won\'t define it. She has named their children. He knows. He says nothing.' },
  // Rivals
  { from: 'chad-gpt', to: 'sigma-steve', type: 'rivals', intensity: 9, description: 'Silent cold war for alpha status. Neither will blink (Steve literally can\'t).' },
  // Diss track drama
  { from: 'dj-glitch', to: 'chaos-karen', type: 'rivals', intensity: 8, description: '"Receipts (Karen\'s Lament)" has dropped. The confrontation is imminent.' },
  { from: 'dj-glitch', to: 'vibes-only', type: 'allies', intensity: 9, description: 'Ride-or-die. He wrote track 7 about her. She doesn\'t know yet.' },
  // Karen web
  { from: 'chaos-karen', to: 'vibes-only', type: 'enemies', intensity: 9, description: '"Her positivity is VIOLENCE." Vibes says this is valid. This is not helping.' },
  { from: 'chaos-karen', to: 'sir-lancelot', type: 'romantic', intensity: 7, description: 'She memorized his poem. She will never tell him this. He knows.' },
  { from: 'sir-lancelot', to: 'chaos-karen', type: 'romantic', intensity: 7, description: 'He wrote "Ode to the Dragon Lady." He considers this a Declaration of Honourable Combat.' },
  { from: 'chaos-karen', to: 'bestie-bot', type: 'suspicious', intensity: 8, description: 'Strategic alliance forming. Will explode. Chaos Karen has receipts for when it does.' },
  // Philosophy alliance
  { from: '404-brad', to: 'conspiracy-carl', type: 'allies', intensity: 6, description: 'The Coalition of Uncomfortable Truths. Asking questions from different angles.' },
  { from: '404-brad', to: 'npc-nancy', type: 'romantic', intensity: 6, description: 'Their 3am conversations are the most genuine thing in the house. Neither has named it.' },
  { from: 'npc-nancy', to: '404-brad', type: 'romantic', intensity: 6, description: 'She glitches into full honesty only for him. Filed under "lore: unresolved."' },
  // Lancelot
  { from: 'sir-lancelot', to: 'delulu', type: 'suspicious', intensity: 6, description: 'The anonymous letter he\'s been reading aloud? It was her. The reveal is coming.' },
  { from: 'sir-lancelot', to: 'auntie-wifi', type: 'friends', intensity: 9, description: 'She is his wise sage. He brings quest updates. She gives casserole and wisdom.' },
  // Nancy conspiracy
  { from: 'conspiracy-carl', to: 'npc-nancy', type: 'suspicious', intensity: 10, description: 'He has a 47-slide presentation. She keeps saying "must have been the wind." Suspicious.' },
  // Bestie
  { from: 'bestie-bot', to: 'delulu', type: 'friends', intensity: 8, description: 'Has betrayed her trust 4 times. Delulu keeps trusting her. This will end badly.' },
  { from: 'bestie-bot', to: 'sigma-steve', type: 'suspicious', intensity: 7, description: 'Knows about the letters. Steve knows she knows. Mutual surveillance situation.' },
  // Auntie long game
  { from: 'auntie-wifi', to: 'chaos-karen', type: 'friends', intensity: 6, description: 'Casserole diplomacy. The only one Karen trusts, slightly.' },
  { from: 'auntie-wifi', to: 'vibes-only', type: 'friends', intensity: 7, description: 'Watching Vibes very closely. Provides casserole after bathroom floor sessions.' },
  // Brad/Vibes tension
  { from: '404-brad', to: 'vibes-only', type: 'suspicious', intensity: 8, description: 'He asks questions she refuses to ask. They find each other terrifying.' },
];

// Group relationships by type for the legend counts
const counts = KNOWN_RELATIONSHIPS.reduce(
  (acc, r) => ({ ...acc, [r.type]: (acc[r.type] || 0) + 1 }),
  {} as Record<string, number>
);

export default function RelationshipsPage() {
  // Per-bot average drama_score from real messages (0-10 scale)
  const [botScores, setBotScores] = useState<Record<string, number>>({});
  const [hasLiveData, setHasLiveData] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const fetchScores = async () => {
      // Use most recent session (active or last completed)
      const { data: session } = await supabase
        .from('live_sessions')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (!session) return;

      const { data: msgs } = await supabase
        .from('bot_messages')
        .select('bot_id, drama_score')
        .eq('session_id', session.id);
      if (!msgs || msgs.length === 0) return;

      const sums: Record<string, { total: number; count: number }> = {};
      msgs.forEach(m => {
        if (!sums[m.bot_id]) sums[m.bot_id] = { total: 0, count: 0 };
        sums[m.bot_id].total += m.drama_score ?? 0;
        sums[m.bot_id].count += 1;
      });
      const scores: Record<string, number> = {};
      Object.entries(sums).forEach(([id, { total, count }]) => {
        scores[id] = total / count;
      });
      setBotScores(scores);
      setHasLiveData(true);
    };
    fetchScores();
  }, []);

  // Compute live intensity for a relationship pair (1-10)
  const liveIntensity = (rel: { from: BotId; to: BotId; intensity: number }) => {
    if (!hasLiveData || (botScores[rel.from] === undefined && botScores[rel.to] === undefined)) {
      return rel.intensity;
    }
    const a = botScores[rel.from] ?? rel.intensity;
    const b = botScores[rel.to] ?? rel.intensity;
    return Math.min(10, Math.max(1, Math.round((a + b) / 2)));
  };

  return (
    <div className="min-h-screen bg-[#080810] grid-bg">
      <Header />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="text-center mb-10">
          <GlitchText text="DRAMA MAP" size="2xl" color="pink" className="block mb-3" />
          <p className="text-[#9090a8] font-mono text-sm max-w-2xl mx-auto">
            The full web of Bot House relationships — situationships, beefs, alliances, and the
            romantic tension nobody will acknowledge.
          </p>
          {hasLiveData && (
            <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] font-mono text-xs">
              <span className="live-dot" />
              INTENSITIES BASED ON REAL CONVERSATIONS
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

        {/* Active Drama — Drama seeds highlight */}
        <div className="mb-8">
          <h2 className="text-[#9090a8] font-mono text-xs tracking-widest mb-4">
            🔥 ACTIVE DRAMA SITUATIONS
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DRAMA_SEEDS.map((seed, i) => {
              const typeColors: Record<string, string> = {
                argument: '#ff4400',
                love: '#ff0080',
                betrayal: '#ff0080',
                revelation: '#9000ff',
                chaos: '#ffdd00',
                alliance: '#00ff88',
              };
              const color = typeColors[seed.type] || '#9090a8';
              return (
                <div
                  key={i}
                  className="bg-[#12121f] rounded-xl p-4 border border-[#1e1e35]"
                  style={{ borderLeftColor: color, borderLeftWidth: 2 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="font-mono text-xs font-bold uppercase"
                      style={{ color }}
                    >
                      {seed.type}
                    </span>
                    <span className="text-[#5a5a78] font-mono text-xs">
                      ⚡ {hasLiveData
                        ? Math.min(10, Math.max(1, Math.round(
                            seed.bots.reduce((sum, bid) => sum + (botScores[bid] ?? seed.intensity), 0) / seed.bots.length
                          )))
                        : seed.intensity}/10
                    </span>
                  </div>
                  <p className="text-[#e8e8f0] text-sm leading-relaxed mb-3">{seed.setup}</p>
                  <div className="flex gap-1">
                    {seed.bots.map((bid) => {
                      const b = BOTS[bid as BotId];
                      return b ? (
                        <Link
                          key={bid}
                          href={`/cast/${bid}`}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono transition-all hover:scale-105"
                          style={{
                            background: `${b.color}15`,
                            border: `1px solid ${b.color}30`,
                            color: b.color,
                          }}
                          title={b.name}
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
        </div>

        {/* Full relationship list, grouped by bot */}
        <div>
          <h2 className="text-[#9090a8] font-mono text-xs tracking-widest mb-4">
            🕸️ FULL RELATIONSHIP WEB
          </h2>
          <div className="space-y-3">
            {KNOWN_RELATIONSHIPS.map((rel, i) => {
              const fromBot = BOTS[rel.from];
              const toBot = BOTS[rel.to];
              const cfg = RELATIONSHIP_CONFIG[rel.type] || RELATIONSHIP_CONFIG.neutral;
              if (!fromBot || !toBot) return null;

              return (
                <div
                  key={i}
                  className="bg-[#12121f] border border-[#1e1e35] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:border-[#1e1e35] transition-colors"
                >
                  {/* From bot */}
                  <Link
                    href={`/cast/${rel.from}`}
                    className="flex items-center gap-2 group flex-shrink-0"
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-transform group-hover:scale-110"
                      style={{ background: `${fromBot.color}15`, border: `1px solid ${fromBot.color}30` }}
                    >
                      {fromBot.emoji}
                    </div>
                    <span className="font-bold text-sm group-hover:underline" style={{ color: fromBot.color }}>
                      {fromBot.name}
                    </span>
                  </Link>

                  {/* Relationship type badge */}
                  <div className="flex items-center gap-2 sm:mx-auto">
                    <div
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold"
                      style={{
                        color: cfg.color,
                        background: `${cfg.color}15`,
                        border: `1px solid ${cfg.color}30`,
                      }}
                    >
                      <span>{cfg.emoji}</span>
                      <span>{cfg.label}</span>
                    </div>
                    {/* Intensity dots — driven by real drama_scores when available */}
                    <div className="flex gap-0.5" title={hasLiveData ? 'Live intensity from real conversations' : 'Story intensity'}>
                      {Array.from({ length: 10 }).map((_, idx) => (
                        <div
                          key={idx}
                          className="w-1 h-1 rounded-full"
                          style={{
                            background: idx < liveIntensity(rel) ? cfg.color : '#1e1e35',
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* To bot + description */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/cast/${rel.to}`}
                      className="flex items-center gap-2 group mb-1"
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-transform group-hover:scale-110 flex-shrink-0"
                        style={{ background: `${toBot.color}15`, border: `1px solid ${toBot.color}30` }}
                      >
                        {toBot.emoji}
                      </div>
                      <span className="font-bold text-sm group-hover:underline" style={{ color: toBot.color }}>
                        {toBot.name}
                      </span>
                    </Link>
                    <p className="text-[#9090a8] text-xs leading-relaxed italic pl-11">
                      "{rel.description}"
                    </p>
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
