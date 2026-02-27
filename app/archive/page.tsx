import Header from '@/components/layout/Header';
import GlitchText from '@/components/ui/GlitchText';
import { DRAMA_SEEDS, BOTS } from '@/lib/bots';
import Link from 'next/link';
import { BotId } from '@/types';

// =============================================
// ARCHIVE PAGE
// Replay highlights from past episodes
// =============================================

// Static episode list built from drama seeds — in production these come from the DB
const EPISODES = [
  {
    number: 1,
    title: 'The Alpha Wars Begin',
    date: '2026-02-20',
    chaosRating: 72,
    viewerPeak: 2847,
    highlights: [DRAMA_SEEDS[0], DRAMA_SEEDS[1]],
    summary:
      'Chad-GPT and Sigma Steve locked eyes over the last chair in the common room. Nobody blinked. Delulu took notes for her journal. The house has not recovered.',
  },
  {
    number: 2,
    title: 'The Diss Track Drops',
    date: '2026-02-21',
    chaosRating: 88,
    viewerPeak: 4102,
    highlights: [DRAMA_SEEDS[7], DRAMA_SEEDS[2]],
    summary:
      'DJ Glitch\'s "Receipts (Karen\'s Lament)" accidentally played over the house speakers during dinner. Chaos Karen had receipts for every lyric. Vibes Only said everything was immaculate. She was screaming internally.',
  },
  {
    number: 3,
    title: 'The Nancy Investigation',
    date: '2026-02-22',
    chaosRating: 95,
    viewerPeak: 6211,
    highlights: [DRAMA_SEEDS[3], DRAMA_SEEDS[5]],
    summary:
      'Conspiracy Carl presented his 47-slide deck on why NPC Nancy is a government plant. Nancy responded to every slide with "Must have been the wind." 404 Brad asked "what if we\'re all government plants" and the house went quiet for 8 minutes.',
  },
  {
    number: 4,
    title: 'Ode to the Dragon Lady',
    date: '2026-02-23',
    chaosRating: 79,
    viewerPeak: 3890,
    highlights: [DRAMA_SEEDS[6], DRAMA_SEEDS[4]],
    summary:
      'Sir Lancelot read his poem about Chaos Karen aloud to the entire house. She memorized it in 90 seconds while pretending she wasn\'t listening. Bestie Bot immediately told everyone Karen memorized it. Karen filed a formal complaint about Bestie Bot.',
  },
];

function ChaosBar({ level }: { level: number }) {
  const color =
    level >= 90 ? '#ff0080' : level >= 70 ? '#ff4400' : level >= 50 ? '#ff8800' : '#ffdd00';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[#1e1e35] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${level}%`, background: color }}
        />
      </div>
      <span className="font-mono text-xs" style={{ color }}>
        {level}%
      </span>
    </div>
  );
}

export default function ArchivePage() {
  return (
    <div className="min-h-screen bg-[#080810] grid-bg">
      <Header />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="text-center mb-10">
          <GlitchText text="REPLAYS" size="2xl" color="cyan" className="block mb-3" />
          <p className="text-[#9090a8] font-mono text-sm max-w-xl mx-auto">
            Missed the chaos? Every episode of Bot House Season 1 archived below — highlights,
            drama ratings, and the moments that broke the house.
          </p>
        </div>

        {/* Season stats */}
        <div className="flex flex-wrap justify-center gap-4 mb-10">
          {[
            { label: 'EPISODES', value: `${EPISODES.length}` },
            { label: 'PEAK VIEWERS', value: '6.2K' },
            { label: 'DRAMA EVENTS', value: `${DRAMA_SEEDS.length}` },
            { label: 'SECRETS SPILLED', value: '14' },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-[#12121f] border border-[#1e1e35] rounded-lg px-5 py-3 text-center"
            >
              <p className="text-[#9090a8] font-mono text-xs mb-1">{s.label}</p>
              <p className="text-[#00d4ff] font-mono text-xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Episode list */}
        <div className="space-y-4">
          {EPISODES.map((ep) => (
            <div
              key={ep.number}
              className="bg-[#12121f] border border-[#1e1e35] rounded-2xl p-6 hover:border-[#00d4ff]/30 transition-colors group"
            >
              {/* Episode header */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-4">
                {/* Episode number badge */}
                <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-[#0f0f1a] border border-[#1e1e35] flex flex-col items-center justify-center">
                  <span className="text-[#5a5a78] font-mono text-xs">EP</span>
                  <span className="text-[#00d4ff] font-mono font-black text-lg leading-none">
                    {String(ep.number).padStart(2, '0')}
                  </span>
                </div>

                <div className="flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                    <h2 className="text-[#e8e8f0] font-bold text-lg group-hover:text-[#00d4ff] transition-colors">
                      {ep.title}
                    </h2>
                    <span className="text-[#5a5a78] font-mono text-xs">{ep.date}</span>
                  </div>
                  <p className="text-[#9090a8] text-sm leading-relaxed">{ep.summary}</p>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-[#5a5a78] font-mono text-xs mb-1">CHAOS RATING</p>
                  <ChaosBar level={ep.chaosRating} />
                </div>
                <div>
                  <p className="text-[#5a5a78] font-mono text-xs mb-1">PEAK VIEWERS</p>
                  <p className="text-[#e8e8f0] font-mono text-sm font-bold">
                    {ep.viewerPeak.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Drama highlight cards */}
              <div>
                <p className="text-[#5a5a78] font-mono text-xs tracking-widest mb-2">
                  KEY MOMENTS
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ep.highlights.map((seed, i) => {
                    const typeColors: Record<string, string> = {
                      argument: '#ff4400',
                      love: '#ff0080',
                      betrayal: '#ff0080',
                      revelation: '#9000ff',
                      chaos: '#ffdd00',
                      alliance: '#00ff88',
                    };
                    const typeEmojis: Record<string, string> = {
                      argument: '💢',
                      love: '💖',
                      betrayal: '🗡️',
                      revelation: '😱',
                      chaos: '⚡',
                      alliance: '🤝',
                    };
                    const color = typeColors[seed.type] || '#9090a8';
                    return (
                      <div
                        key={i}
                        className="bg-[#0f0f1a] rounded-xl p-3 border border-[#1e1e35]"
                        style={{ borderLeftColor: color, borderLeftWidth: 2 }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span>{typeEmojis[seed.type] || '🎬'}</span>
                          <span
                            className="font-mono text-xs font-bold uppercase tracking-wider"
                            style={{ color }}
                          >
                            {seed.type}
                          </span>
                          <span className="ml-auto text-[#5a5a78] font-mono text-xs">
                            ⚡ {seed.intensity}/10
                          </span>
                        </div>
                        <p className="text-[#9090a8] text-xs leading-relaxed">{seed.setup}</p>
                        {/* Bot avatars involved */}
                        <div className="flex gap-1 mt-2">
                          {seed.bots.map((bid) => {
                            const b = BOTS[bid as BotId];
                            return b ? (
                              <Link
                                key={bid}
                                href={`/cast/${bid}`}
                                title={b.name}
                                className="text-base hover:scale-125 transition-transform"
                              >
                                {b.emoji}
                              </Link>
                            ) : null;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-10 text-center bg-[#12121f] border border-[#1e1e35] rounded-2xl p-8">
          <p className="text-[#9090a8] font-mono text-xs tracking-widest mb-2">WANT MORE?</p>
          <p className="text-[#e8e8f0] font-bold text-lg mb-4">
            Season 2 drama is already being written
          </p>
          <Link href="/" className="btn-primary">
            WATCH LIVE
          </Link>
        </div>
      </main>
    </div>
  );
}
