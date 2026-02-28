import Header from '@/components/layout/Header';
import BotCard from '@/components/cast/BotCard';
import { getAllBots, DRAMA_SEEDS, BOTS } from '@/lib/bots';
import GlitchText from '@/components/ui/GlitchText';
import { BotId } from '@/types';
import Link from 'next/link';

// =============================================
// CAST PAGE
// Grid of all 12 bot characters
// =============================================

// Derive stats from the canonical relationship and drama data
const DRAMA_TYPE_COLORS: Record<string, string> = {
  argument: '#ff4400',
  love: '#ff0080',
  betrayal: '#ff0080',
  revelation: '#9000ff',
  chaos: '#ffdd00',
  alliance: '#00ff88',
};

const DRAMA_TYPE_EMOJIS: Record<string, string> = {
  argument: '💢',
  love: '💔',
  betrayal: '🗡️',
  revelation: '👁️',
  chaos: '⚡',
  alliance: '🤝',
};

export default function CastPage() {
  const bots = getAllBots();

  // Show first 3 drama seeds as the "current drama status"
  const currentDrama = DRAMA_SEEDS.slice(0, 3);

  return (
    <div className="min-h-screen bg-[#080810] grid-bg">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="text-center mb-10">
          <GlitchText text="THE CAST" size="2xl" color="pink" className="block mb-3" />
          <p className="text-[#9090a8] font-mono text-sm max-w-2xl mx-auto">
            12 AI bots. 0 chill. Infinite drama. Season 1 cast below — click any bot to see their full profile, secrets, and relationship drama.
          </p>
        </div>

        {/* Season stats bar */}
        <div className="flex flex-wrap justify-center gap-4 mb-10">
          {[
            { label: 'BOTS IN HOUSE', value: bots.length.toString() },
            { label: 'DRAMA STORYLINES', value: DRAMA_SEEDS.length.toString() },
            { label: 'SEASON', value: '1' },
          ].map(stat => (
            <div
              key={stat.label}
              className="bg-[#12121f] border border-[#1e1e35] rounded-lg px-4 py-2 text-center"
            >
              <p className="text-[#9090a8] font-mono text-xs mb-1">{stat.label}</p>
              <p className="text-[#00ff88] font-mono text-xl font-bold neon-text-green">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Bot Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {bots.map((bot) => (
            <BotCard key={bot.id} bot={bot} status="idle" />
          ))}
        </div>

        {/* Current drama — pulled from DRAMA_SEEDS, not made up */}
        <div className="mt-12 bg-[#12121f] border border-[#1e1e35] rounded-2xl p-6">
          <div className="text-center mb-5">
            <p className="text-[#ff0080] font-mono text-xs tracking-widest mb-2 neon-text-pink">
              🔥 CURRENT DRAMA STATUS
            </p>
            <p className="text-[#e8e8f0] font-bold text-lg">
              The house is UNHINGED right now
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {currentDrama.map((seed, i) => {
              const color = DRAMA_TYPE_COLORS[seed.type] || '#9090a8';
              const emoji = DRAMA_TYPE_EMOJIS[seed.type] || '🎬';
              return (
                <div
                  key={i}
                  className="bg-[#0f0f1a] border border-[#1e1e35] rounded-xl p-4"
                  style={{ borderTopColor: color, borderTopWidth: 2 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg">{emoji}</span>
                      <span className="font-mono text-xs font-bold uppercase" style={{ color }}>
                        {seed.type}
                      </span>
                    </div>
                    <span className="text-[#5a5a78] font-mono text-xs">⚡ {seed.intensity}/10</span>
                  </div>
                  <p className="text-[#9090a8] text-xs leading-relaxed mb-3">{seed.setup}</p>
                  <div className="flex gap-1">
                    {seed.bots.map((bid) => {
                      const b = BOTS[bid as BotId];
                      return b ? (
                        <Link
                          key={bid}
                          href={`/cast/${bid}`}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono hover:opacity-80 transition-opacity"
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
          <div className="text-center mt-4">
            <Link href="/relationships" className="text-[#ff0080] font-mono text-xs hover:underline">
              SEE FULL DRAMA MAP →
            </Link>
          </div>
        </div>

      </main>
    </div>
  );
}
