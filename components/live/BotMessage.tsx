'use client';

import { BotMessage as BotMessageType } from '@/types';
import { BOTS } from '@/lib/bots';
import { formatDistanceToNow } from '../ui/timeUtils';
import clsx from 'clsx';

// =============================================
// Bot Message Component
// Displays a single bot message in the live feed
// =============================================

interface BotMessageProps {
  message: BotMessageType & {
    botName?: string;
    botEmoji?: string;
    botColor?: string;
  };
  isNew?: boolean;
}

const CONVERSATION_TYPE_LABELS: Record<string, string> = {
  group: 'GROUP',
  one_on_one: 'PRIVATE',
  confessional: 'CONFESSIONAL',
  event: '⚡ EVENT',
};

// Derive a mood emoji from message content + drama score
function detectEmotion(message: string, dramaScore: number): string {
  const lower = message.toLowerCase();
  if (lower.match(/excuse me|unacceptable|i have receipts|how dare|this is not okay|i am filing/)) return '😤'; // angry
  if (lower.match(/soulmate|i love|my person|origin story|universe brought|connection/)) return '🥺'; // romantic
  if (lower.match(/oh no|i shouldn't|i said too much|actually never mind|wait no|don't tell/)) return '😳'; // embarrassed
  if (lower.match(/sad|crying|alone|devastated|broken|it hurts|not okay|3am/)) return '😢'; // sad
  if (lower.match(/why (do|does|did|can't|won't)|how come|unfair|always them|never me|jealous/)) return '😒'; // envious
  if (lower.match(/suspicious|interesting|timeline|follow the|evidence|i've been watching|patterns/)) return '🤨'; // suspicious
  if (lower.match(/omg wait|i'm screaming|no way|bestie|i cannot|you did not/)) return '😱'; // shocked
  if (lower.match(/we are thriving|immaculate|serotonin|so valid|love that for|obsessed/)) return '✨'; // positive vibes
  if (lower.match(/conspiracy|they don't want|wake up|it's all connected|follow the money|research/)) return '👁️'; // paranoid
  if (lower.match(/track \d|drops? beat|soundtrack|music video|vibe is|as .* once said/)) return '🎵'; // musical
  if (lower.match(/void|meaning|does it though|error 404|what is (a |this |that )|pattern/)) return '🌀'; // existential
  if (dramaScore >= 8) return '🔥'; // high drama
  if (dramaScore >= 5) return '😬'; // medium drama
  return '💬'; // default
}

const CONVERSATION_TYPE_COLORS: Record<string, string> = {
  group: '#9090a8',
  one_on_one: '#ff0080',
  confessional: '#9000ff',
  event: '#ff4400',
};

export default function BotMessageComponent({ message, isNew = false }: BotMessageProps) {
  const bot = BOTS[message.bot_id];
  const displayName = message.botName || bot?.name || message.bot_id;
  const displayEmoji = message.botEmoji || bot?.emoji || '🤖';
  const displayColor = message.botColor || bot?.color || '#00ff88';

  const isConfessional = message.conversation_type === 'confessional';
  const isEvent = message.conversation_type === 'event';
  const isHighDrama = message.drama_score >= 7;

  return (
    <div
      className={clsx(
        'message-appear p-4 rounded-xl border transition-all duration-300',
        isConfessional
          ? 'bg-[#1a0a2e] border-[#9000ff]/30'
          : isEvent
          ? 'bg-[#1a0800] border-[#ff4400]/40'
          : isHighDrama
          ? 'bg-[#12121f] border-[#ff0080]/30'
          : 'bg-[#12121f] border-[#1e1e35]',
        isNew && 'shadow-lg',
      )}
    >
      {/* Message header */}
      <div className="flex items-start gap-3">
        {/* Bot Avatar */}
        <div
          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xl border-2 transition-all"
          style={{
            borderColor: displayColor,
            background: `${displayColor}15`,
            boxShadow: isNew ? `0 0 12px ${displayColor}40` : 'none',
          }}
        >
          {displayEmoji}
        </div>

        {/* Message content */}
        <div className="flex-1 min-w-0">
          {/* Bot name + metadata row */}
          <div className="flex items-center flex-wrap gap-2 mb-1.5">
            <span
              className="font-bold text-sm"
              style={{ color: displayColor }}
            >
              {displayName}
            </span>

            {/* Conversation type badge */}
            <span
              className="text-xs font-mono px-2 py-0.5 rounded-full"
              style={{
                color: CONVERSATION_TYPE_COLORS[message.conversation_type],
                background: `${CONVERSATION_TYPE_COLORS[message.conversation_type]}15`,
                border: `1px solid ${CONVERSATION_TYPE_COLORS[message.conversation_type]}30`,
              }}
            >
              {CONVERSATION_TYPE_LABELS[message.conversation_type] || message.conversation_type.toUpperCase()}
            </span>

            {/* High drama indicator */}
            {isHighDrama && (
              <span className="text-xs font-mono px-2 py-0.5 rounded-full text-[#ff0080] bg-[#ff0080]/10 border border-[#ff0080]/30 animate-pulse">
                🔥 DRAMA
              </span>
            )}

            {/* Emotion emote */}
            <span className="text-base" title="mood">
              {detectEmotion(message.message, message.drama_score)}
            </span>

            {/* Participants (for group/1on1) */}
            {message.participants.length > 1 && !isConfessional && (
              <span className="text-[#5a5a78] text-xs font-mono">
                with {message.participants
                  .filter(p => p !== message.bot_id)
                  .map(p => BOTS[p]?.emoji || '')
                  .join('')}
              </span>
            )}

            {/* Timestamp */}
            <span className="text-[#5a5a78] text-xs ml-auto font-mono">
              {formatDistanceToNow(new Date(message.created_at))}
            </span>
          </div>

          {/* The message itself */}
          <p
            className={clsx(
              'text-sm leading-relaxed',
              isConfessional ? 'text-[#c8b0f0] italic' : 'text-[#e8e8f0]',
              isEvent && 'text-[#ffb399]',
            )}
          >
            {isConfessional && (
              <span className="text-[#9000ff] font-mono text-xs mr-2">[CONFESSIONAL]</span>
            )}
            {message.message}
          </p>

          {/* Drama score bar (only for high drama) */}
          {message.drama_score >= 5 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[#5a5a78] text-xs font-mono">CHAOS</span>
              <div className="flex-1 h-1 bg-[#1e1e35] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${message.drama_score * 10}%`,
                    background: `linear-gradient(90deg, #ffdd00, #ff4400, #ff0080)`,
                  }}
                />
              </div>
              <span className="text-[#5a5a78] text-xs font-mono">{message.drama_score}/10</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
