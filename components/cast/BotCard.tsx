'use client';

import Link from 'next/link';
import { StaticBot } from '@/types';

// =============================================
// Bot Card Component
// Used in the cast grid page
// =============================================

interface BotCardProps {
  bot: StaticBot;
  status?: string;
}

export default function BotCard({ bot, status = 'idle' }: BotCardProps) {
  const isActive = status === 'talking' || status === 'drama';

  return (
    <Link href={`/cast/${bot.id}`}>
      <div
        className="group relative card p-5 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
        style={{
          '--card-color': bot.color,
        } as React.CSSProperties}
      >
        {/* Subtle top border that glows on hover */}
        <div
          className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: bot.color }}
        />

        {/* Status indicator */}
        {isActive && (
          <div className="absolute top-3 right-3">
            <span
              className="w-2.5 h-2.5 rounded-full block animate-pulse"
              style={{
                background: bot.color,
                boxShadow: `0 0 8px ${bot.color}`,
              }}
            />
          </div>
        )}

        {/* Avatar */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4 mx-auto transition-all duration-300 group-hover:scale-110"
          style={{
            background: `${bot.color}15`,
            border: `2px solid ${bot.color}30`,
          }}
        >
          {bot.emoji}
        </div>

        {/* Name */}
        <h3
          className="text-center font-bold text-base mb-1 transition-colors duration-200 group-hover:brightness-110"
          style={{ color: bot.color }}
        >
          {bot.name}
        </h3>

        {/* Tagline */}
        <p className="text-center text-[#9090a8] text-xs leading-relaxed line-clamp-2">
          {bot.tagline}
        </p>

        {/* Status badge */}
        <div className="mt-3 flex justify-center">
          <span
            className="text-xs font-mono px-2 py-0.5 rounded-full"
            style={
              isActive
                ? {
                    color: bot.color,
                    background: `${bot.color}20`,
                    border: `1px solid ${bot.color}40`,
                  }
                : {
                    color: '#5a5a78',
                    background: '#12121f',
                    border: '1px solid #1e1e35',
                  }
            }
          >
            {status === 'talking'
              ? '💬 TALKING'
              : status === 'drama'
              ? '🔥 DRAMA'
              : status === 'sleeping'
              ? '😴 SLEEPING'
              : '• IDLE'}
          </span>
        </div>
      </div>
    </Link>
  );
}
