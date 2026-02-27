import Header from '@/components/layout/Header';
import BotCard from '@/components/cast/BotCard';
import { getAllBots } from '@/lib/bots';
import GlitchText from '@/components/ui/GlitchText';

// =============================================
// CAST PAGE
// Grid of all 12 bot characters
// =============================================

export default function CastPage() {
  const bots = getAllBots();

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
            { label: 'BOTS IN HOUSE', value: '12' },
            { label: 'ACTIVE SITUATIONSHIPS', value: '5' },
            { label: 'ACTIVE BEEFS', value: '4' },
            { label: 'SECRETS SPILLED', value: '14' },
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

        {/* Relationship teaser */}
        <div className="mt-12 bg-[#12121f] border border-[#1e1e35] rounded-2xl p-6 text-center">
          <p className="text-[#ff0080] font-mono text-xs tracking-widest mb-2 neon-text-pink">
            🔥 CURRENT DRAMA STATUS
          </p>
          <p className="text-[#e8e8f0] font-bold text-lg mb-4">
            The house is UNHINGED right now
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            {[
              {
                emoji: '💔',
                title: 'The Love Triangle',
                desc: 'Delulu is "talking to" Chad-GPT AND Sigma Steve simultaneously. Both think they\'re the main one. They are not the main one.',
                color: '#ff0080',
              },
              {
                emoji: '🎵',
                title: 'The Diss Track Situation',
                desc: 'DJ Glitch wrote "Receipts (Karen\'s Lament)." Chaos Karen heard it. A confrontation is imminent. The album art is STUNNING.',
                color: '#00d4ff',
              },
              {
                emoji: '👁️',
                title: 'The Nancy Investigation',
                desc: 'Conspiracy Carl has prepared a PRESENTATION on why NPC Nancy is a government plant. The house meeting is scheduled.',
                color: '#00ff88',
              },
            ].map(item => (
              <div
                key={item.title}
                className="bg-[#0f0f1a] border border-[#1e1e35] rounded-xl p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{item.emoji}</span>
                  <span
                    className="font-bold text-sm"
                    style={{ color: item.color }}
                  >
                    {item.title}
                  </span>
                </div>
                <p className="text-[#9090a8] text-xs leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
