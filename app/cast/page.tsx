import Header from '@/components/layout/Header';
import BotCard from '@/components/cast/BotCard';
import { getAllBots, BOTS } from '@/lib/bots';
import GlitchText from '@/components/ui/GlitchText';
import { BotId } from '@/types';
import Link from 'next/link';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';

// =============================================
// CAST PAGE
// Grid of all 12 bot characters
// =============================================

const DRAMA_TYPE_COLORS: Record<string, string> = {
  argument:     '#ff4400',
  love:         '#ff0080',
  betrayal:     '#ff0080',
  revelation:   '#9000ff',
  chaos:        '#ffdd00',
  alliance:     '#00ff88',
  viewer_event: '#ff4400',
};

const DRAMA_TYPE_EMOJIS: Record<string, string> = {
  argument:     '💢',
  love:         '💔',
  betrayal:     '🗡️',
  revelation:   '👁️',
  chaos:        '⚡',
  alliance:     '🤝',
  viewer_event: '📢',
};

interface DramaEvent {
  id: string;
  event_type: string;
  title: string;
  description: string;
  bots_involved: string[];
  intensity: number;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default async function CastPage() {
  const bots = getAllBots();

  // Fetch the 3 most recent real drama events
  let recentEvents: DramaEvent[] = [];
  if (isServerSupabaseConfigured()) {
    const supabase = createServerSupabase();
    const { data } = await supabase
      .from('drama_events')
      .select('id, event_type, title, description, bots_involved, intensity, created_at')
      .order('created_at', { ascending: false })
      .limit(3);
    recentEvents = (data as DramaEvent[]) || [];
  }

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
            { label: 'EVENTS FIRED', value: recentEvents.length > 0 ? recentEvents.length.toString() + '+' : '—' },
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

        {/* Current drama — live from drama_events table */}
        <div className="mt-12 bg-[#12121f] border border-[#1e1e35] rounded-2xl p-6">
          <div className="text-center mb-5">
            <p className="text-[#ff0080] font-mono text-xs tracking-widest mb-2 neon-text-pink">
              🔥 CURRENT DRAMA STATUS
            </p>
            <p className="text-[#e8e8f0] font-bold text-lg">
              {recentEvents.length > 0 ? 'The house is UNHINGED right now' : 'The house is quiet… for now'}
            </p>
          </div>

          {recentEvents.length === 0 ? (
            <p className="text-center text-[#5a5a78] font-mono text-xs py-4">
              No events yet — tune in during show hours (7–11pm ET) or trigger one by typing EVENT: xyz in chat.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {recentEvents.map((event) => {
                const color = DRAMA_TYPE_COLORS[event.event_type] || '#9090a8';
                const emoji = DRAMA_TYPE_EMOJIS[event.event_type] || '⚡';
                const involvedBots = (event.bots_involved || []).filter(
                  (bid) => BOTS[bid as BotId]
                );
                return (
                  <div
                    key={event.id}
                    className="bg-[#0f0f1a] border border-[#1e1e35] rounded-xl p-4"
                    style={{ borderTopColor: color, borderTopWidth: 2 }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg">{emoji}</span>
                        <span className="font-mono text-xs font-bold uppercase" style={{ color }}>
                          {event.event_type.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#5a5a78] font-mono text-[10px]">{timeAgo(event.created_at)}</span>
                        <span className="text-[#5a5a78] font-mono text-xs">⚡ {event.intensity}/10</span>
                      </div>
                    </div>
                    <p className="text-[#e8e8f0] text-xs font-bold mb-1 uppercase tracking-wide leading-tight">
                      {event.title}
                    </p>
                    <p className="text-[#9090a8] text-xs leading-relaxed mb-3">{event.description}</p>
                    <div className="flex gap-1 flex-wrap">
                      {involvedBots.map((bid) => {
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
          )}

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
