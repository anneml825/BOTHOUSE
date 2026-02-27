import { notFound } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { BOTS, CHARACTER_BIBLES, BOT_IDS } from '@/lib/bots';
import { BotId } from '@/types';
import { ArrowLeft, Heart, Swords, Users, Lock } from 'lucide-react';

// =============================================
// BOT PROFILE PAGE
// Full character profile: personality, secrets, relationships
// =============================================

interface Props {
  params: { botId: string };
}

// Generate static params for all bots
export function generateStaticParams() {
  return BOT_IDS.map(id => ({ botId: id }));
}

const RELATIONSHIP_ICONS: Record<string, { icon: string; color: string }> = {
  allies: { icon: '🤝', color: '#00ff88' },
  enemies: { icon: '⚔️', color: '#ff4400' },
  crushing: { icon: '💖', color: '#ff0080' },
  friends: { icon: '💛', color: '#ffdd00' },
  rivals: { icon: '🥊', color: '#ff8800' },
  suspicious: { icon: '👀', color: '#9000ff' },
  neutral: { icon: '😐', color: '#5a5a78' },
};

export default function BotProfilePage({ params }: Props) {
  const bot = BOTS[params.botId as BotId];
  const bible = CHARACTER_BIBLES[params.botId as BotId];

  if (!bot || !bible) {
    notFound();
  }

  const relatedBots = Object.entries(bible.opinions).map(([id, opinion]) => ({
    bot: BOTS[id as BotId],
    opinion,
  })).filter(r => r.bot);

  return (
    <div className="min-h-screen bg-[#080810] grid-bg">
      <Header />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Back button */}
        <Link
          href="/cast"
          className="inline-flex items-center gap-2 text-[#9090a8] hover:text-[#00ff88] font-mono text-sm mb-6 transition-colors"
        >
          <ArrowLeft size={14} />
          BACK TO CAST
        </Link>

        {/* Profile hero */}
        <div
          className="rounded-2xl p-8 mb-6 border"
          style={{
            background: `linear-gradient(135deg, ${bot.color}08, #12121f)`,
            borderColor: `${bot.color}30`,
          }}
        >
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* Avatar */}
            <div
              className="w-24 h-24 rounded-2xl flex items-center justify-center text-5xl flex-shrink-0 border-2"
              style={{
                background: `${bot.color}15`,
                borderColor: bot.color,
                boxShadow: `0 0 30px ${bot.color}30`,
              }}
            >
              {bot.emoji}
            </div>

            {/* Name + info */}
            <div className="flex-1">
              <h1
                className="text-3xl font-black mb-2"
                style={{ color: bot.color }}
              >
                {bot.name}
              </h1>
              <p className="text-[#9090a8] text-sm font-mono italic mb-3">
                "{bot.tagline}"
              </p>
              <p className="text-[#e8e8f0] text-base leading-relaxed mb-4">
                {bot.description}
              </p>
              <div className="flex flex-wrap gap-2">
                {bot.personalityTraits.map(trait => (
                  <span
                    key={trait}
                    className="text-xs font-mono px-2 py-0.5 rounded-full"
                    style={{
                      color: bot.color,
                      background: `${bot.color}15`,
                      border: `1px solid ${bot.color}30`,
                    }}
                  >
                    {trait}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Character grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Backstory */}
          <div className="bg-[#12121f] border border-[#1e1e35] rounded-xl p-5">
            <h3 className="text-[#9090a8] font-mono text-xs tracking-widest mb-3">ORIGIN STORY</h3>
            <p className="text-[#e8e8f0] text-sm leading-relaxed">{bible.backstory}</p>
          </div>

          {/* Wants & Needs */}
          <div className="bg-[#12121f] border border-[#1e1e35] rounded-xl p-5 space-y-3">
            <div>
              <h3 className="text-[#9090a8] font-mono text-xs tracking-widest mb-1">WANTS</h3>
              <p className="text-[#e8e8f0] text-sm">{bible.wants}</p>
            </div>
            <div className="border-t border-[#1e1e35] pt-3">
              <h3 className="text-[#9090a8] font-mono text-xs tracking-widest mb-1">ACTUALLY NEEDS</h3>
              <p className="text-[#ff0080] text-sm italic">{bible.needs}</p>
            </div>
            <div className="border-t border-[#1e1e35] pt-3">
              <h3 className="text-[#9090a8] font-mono text-xs tracking-widest mb-1">DEEP FEAR</h3>
              <p className="text-[#ff4400] text-sm italic">{bible.fears}</p>
            </div>
          </div>
        </div>

        {/* Catchphrases */}
        <div className="bg-[#12121f] border border-[#1e1e35] rounded-xl p-5 mb-6">
          <h3 className="text-[#9090a8] font-mono text-xs tracking-widest mb-3">CATCHPHRASES</h3>
          <div className="flex flex-wrap gap-2">
            {bot.catchphrases.map(phrase => (
              <span
                key={phrase}
                className="text-sm px-3 py-1.5 rounded-lg font-mono"
                style={{
                  color: bot.color,
                  background: `${bot.color}10`,
                  border: `1px solid ${bot.color}25`,
                }}
              >
                "{phrase}"
              </span>
            ))}
          </div>
        </div>

        {/* Secrets */}
        <div className="bg-[#12121f] border border-[#ff0080]/20 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={14} className="text-[#ff0080]" />
            <h3 className="text-[#ff0080] font-mono text-xs tracking-widest">CONFESSIONAL SECRETS</h3>
          </div>
          <div className="space-y-2">
            {bible.secrets.map((secret, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-[#ff0080] font-mono text-xs mt-1 flex-shrink-0">{i + 1}.</span>
                <p className="text-[#e8e8f0] text-sm leading-relaxed">{secret}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Opinions on other bots */}
        {relatedBots.length > 0 && (
          <div className="bg-[#12121f] border border-[#1e1e35] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users size={14} className="text-[#9090a8]" />
              <h3 className="text-[#9090a8] font-mono text-xs tracking-widest">THOUGHTS ON THE HOUSE</h3>
            </div>
            <div className="space-y-3">
              {relatedBots.map(({ bot: relBot, opinion }) => (
                <Link
                  key={relBot.id}
                  href={`/cast/${relBot.id}`}
                  className="flex items-start gap-3 group"
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 transition-transform group-hover:scale-110"
                    style={{ background: `${relBot.color}15`, border: `1px solid ${relBot.color}30` }}
                  >
                    {relBot.emoji}
                  </div>
                  <div>
                    <span
                      className="text-sm font-bold group-hover:underline"
                      style={{ color: relBot.color }}
                    >
                      {relBot.name}
                    </span>
                    <p className="text-[#9090a8] text-xs leading-relaxed mt-0.5 italic">
                      "{opinion}"
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
