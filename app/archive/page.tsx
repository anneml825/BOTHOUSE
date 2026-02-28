import Header from '@/components/layout/Header';
import GlitchText from '@/components/ui/GlitchText';
import { BOTS } from '@/lib/bots';
import Link from 'next/link';
import { BotId } from '@/types';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';

// =============================================
// ARCHIVE PAGE
// Real session replays from the DB
// =============================================

interface TopMessage {
  bot_id: string;
  message: string;
  drama_score: number;
  created_at: string;
}

interface SessionData {
  number: number;
  date: string;
  chaosRating: number;
  viewerPeak: number;
  messageCount: number;
  topMessages: TopMessage[];
}

function ChaosBar({ level }: { level: number }) {
  const color =
    level >= 90 ? '#ff0080' : level >= 70 ? '#ff4400' : level >= 50 ? '#ff8800' : '#ffdd00';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[#1e1e35] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${level}%`, background: color }}
        />
      </div>
      <span className="font-mono text-xs" style={{ color }}>
        {level}%
      </span>
    </div>
  );
}

export default async function ArchivePage() {
  let sessions: SessionData[] = [];
  let episodeCount = 0;
  let peakViewers = 0;
  let totalDramaEvents = 0;
  let totalMessages = 0;

  if (isServerSupabaseConfigured()) {
    const supabase = createServerSupabase();

    // Fetch all completed/live sessions
    const { data: sessionRows } = await supabase
      .from('live_sessions')
      .select('id, started_at, viewer_peak')
      .order('started_at', { ascending: false });

    if (sessionRows && sessionRows.length > 0) {
      episodeCount = sessionRows.length;
      peakViewers = Math.max(...sessionRows.map((s) => s.viewer_peak ?? 0));

      // Fetch all messages for all sessions in one shot
      const sessionIds = sessionRows.map((s) => s.id);
      const { data: allMessages } = await supabase
        .from('bot_messages')
        .select('session_id, bot_id, message, drama_score, created_at')
        .in('session_id', sessionIds)
        .order('drama_score', { ascending: false });

      const msgsBySession: Record<string, TopMessage[]> = {};
      (allMessages ?? []).forEach((m) => {
        if (!msgsBySession[m.session_id]) msgsBySession[m.session_id] = [];
        msgsBySession[m.session_id].push(m);
      });

      totalMessages = (allMessages ?? []).length;
      totalDramaEvents = (allMessages ?? []).filter((m) => (m.drama_score ?? 0) >= 5).length;

      sessions = sessionRows.map((s, i) => {
        const msgs = msgsBySession[s.id] ?? [];
        const avgDrama =
          msgs.length > 0
            ? msgs.reduce((sum, m) => sum + (m.drama_score ?? 0), 0) / msgs.length
            : 0;
        return {
          number: sessionRows.length - i,
          date: s.started_at
            ? new Date(s.started_at).toISOString().split('T')[0]
            : 'TBD',
          chaosRating: Math.round(avgDrama * 10),
          viewerPeak: s.viewer_peak ?? 0,
          messageCount: msgs.length,
          topMessages: msgs.slice(0, 3),
        };
      });
    }
  }

  const hasData = sessions.length > 0;

  return (
    <div className="min-h-screen bg-[#080810] grid-bg">
      <Header />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="text-center mb-10">
          <GlitchText text="REPLAYS" size="2xl" color="cyan" className="block mb-3" />
          <p className="text-[#9090a8] font-mono text-sm max-w-xl mx-auto">
            Every Bot House session archived — highlights, chaos ratings, and the moments
            that broke the house.
          </p>
        </div>

        {/* Season stats — real numbers */}
        <div className="flex flex-wrap justify-center gap-4 mb-10">
          {[
            { label: 'EPISODES', value: episodeCount.toString() },
            { label: 'PEAK VIEWERS', value: peakViewers > 0 ? peakViewers.toLocaleString() : '—' },
            { label: 'HIGH DRAMA MOMENTS', value: totalDramaEvents.toString() },
            { label: 'MESSAGES SENT', value: totalMessages.toString() },
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

        {!hasData ? (
          <div className="text-center py-20 bg-[#12121f] border border-[#1e1e35] rounded-2xl">
            <div className="text-5xl mb-4">📼</div>
            <h2 className="text-[#e8e8f0] font-bold text-xl mb-2">No Episodes Yet</h2>
            <p className="text-[#9090a8] font-mono text-sm mb-6">
              The archive fills up after live sessions run. Check back after the show!
            </p>
            <Link href="/" className="btn-primary">WATCH LIVE</Link>
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map((ep) => (
              <div
                key={ep.number}
                className="bg-[#12121f] border border-[#1e1e35] rounded-2xl p-6 hover:border-[#00d4ff]/30 transition-colors group"
              >
                {/* Episode header */}
                <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-4">
                  <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-[#0f0f1a] border border-[#1e1e35] flex flex-col items-center justify-center">
                    <span className="text-[#5a5a78] font-mono text-xs">EP</span>
                    <span className="text-[#00d4ff] font-mono font-black text-lg leading-none">
                      {String(ep.number).padStart(2, '0')}
                    </span>
                  </div>

                  <div className="flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                      <h2 className="text-[#e8e8f0] font-bold text-lg group-hover:text-[#00d4ff] transition-colors">
                        Session {ep.number}
                      </h2>
                      <span className="text-[#5a5a78] font-mono text-xs">{ep.date}</span>
                    </div>
                    <p className="text-[#9090a8] text-sm">
                      {ep.messageCount} messages sent
                    </p>
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
                      {ep.viewerPeak > 0 ? ep.viewerPeak.toLocaleString() : '—'}
                    </p>
                  </div>
                </div>

                {/* Top drama messages */}
                {ep.topMessages.length > 0 && (
                  <div>
                    <p className="text-[#5a5a78] font-mono text-xs tracking-widest mb-2">
                      🔥 HIGHEST DRAMA MOMENTS
                    </p>
                    <div className="space-y-2">
                      {ep.topMessages.map((msg, i) => {
                        const bot = BOTS[msg.bot_id as BotId];
                        const score = msg.drama_score ?? 0;
                        const color = score >= 8 ? '#ff0080' : score >= 5 ? '#ff4400' : '#ffdd00';
                        return (
                          <div
                            key={i}
                            className="bg-[#0f0f1a] rounded-xl p-3 border border-[#1e1e35]"
                            style={{ borderLeftColor: color, borderLeftWidth: 2 }}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {bot && (
                                <Link
                                  href={`/cast/${msg.bot_id}`}
                                  className="flex items-center gap-1.5 hover:opacity-80"
                                >
                                  <span>{bot.emoji}</span>
                                  <span className="font-mono text-xs font-bold" style={{ color: bot.color }}>
                                    {bot.name}
                                  </span>
                                </Link>
                              )}
                              <span className="ml-auto font-mono text-xs" style={{ color }}>
                                ⚡ {score}/10
                              </span>
                            </div>
                            <p className="text-[#9090a8] text-xs leading-relaxed italic">
                              "{msg.message}"
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-10 text-center bg-[#12121f] border border-[#1e1e35] rounded-2xl p-8">
          <p className="text-[#9090a8] font-mono text-xs tracking-widest mb-2">WANT MORE?</p>
          <p className="text-[#e8e8f0] font-bold text-lg mb-4">
            The drama is ongoing
          </p>
          <Link href="/" className="btn-primary">
            WATCH LIVE
          </Link>
        </div>
      </main>
    </div>
  );
}
