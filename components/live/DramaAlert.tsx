'use client';

import { useState, useEffect } from 'react';
import { X, Zap } from 'lucide-react';
import { DramaEvent } from '@/types';

// =============================================
// Drama Alert Component
// Pops up when something big happens in the house
// =============================================

interface DramaAlertProps {
  event: DramaEvent;
  onDismiss: () => void;
}

const EVENT_TYPE_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  argument: { emoji: '💢', color: '#ff4400', label: 'BEEF ALERT' },
  alliance: { emoji: '🤝', color: '#00ff88', label: 'ALLIANCE FORMED' },
  love: { emoji: '💖', color: '#ff0080', label: 'LOVE CONNECTION' },
  betrayal: { emoji: '🗡️', color: '#ff0080', label: 'BETRAYAL!' },
  revelation: { emoji: '😱', color: '#9000ff', label: 'BIG REVEAL' },
  chaos: { emoji: '⚡', color: '#ffdd00', label: 'PURE CHAOS' },
};

export default function DramaAlert({ event, onDismiss }: DramaAlertProps) {
  const [visible, setVisible] = useState(true);
  const config = EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.chaos;

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // Wait for animation
    }, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!visible) return null;

  return (
    <div
      className="drama-alert fixed top-20 right-4 z-50 max-w-sm w-full"
      style={{ boxShadow: `0 0 30px ${config.color}40` }}
    >
      <div
        className="rounded-xl border p-4 backdrop-blur-md"
        style={{
          background: `${config.color}15`,
          borderColor: `${config.color}50`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap size={14} style={{ color: config.color }} />
            <span
              className="font-mono text-xs font-bold tracking-widest"
              style={{ color: config.color }}
            >
              {config.label}
            </span>
          </div>
          <button
            onClick={() => { setVisible(false); setTimeout(onDismiss, 300); }}
            className="text-[#5a5a78] hover:text-[#9090a8] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Event content */}
        <div className="flex items-start gap-3">
          <span className="text-2xl">{config.emoji}</span>
          <div>
            <p className="text-[#e8e8f0] font-bold text-sm">{event.title}</p>
            <p className="text-[#9090a8] text-xs mt-1">{event.description}</p>

            {/* Bots involved */}
            {event.bots_involved.length > 0 && (
              <p className="text-xs mt-2" style={{ color: `${config.color}90` }}>
                Involving: {event.bots_involved.join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* Intensity bar */}
        <div className="mt-3 h-1 bg-[#0f0f1a] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${event.intensity * 10}%`,
              background: config.color,
              boxShadow: `0 0 8px ${config.color}`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// =============================================
// Demo drama alert (for testing without DB)
// =============================================
export function DemoAlert() {
  const demoEvent: DramaEvent = {
    id: 'demo-1',
    session_id: null,
    event_type: 'argument',
    title: 'CHAD-GPT vs SIGMA STEVE',
    description: 'They\'re both trying to be the alpha. It\'s getting ugly.',
    bots_involved: ['chad-gpt', 'sigma-steve'],
    intensity: 8,
    created_at: new Date().toISOString(),
  };

  return <DramaAlert event={demoEvent} onDismiss={() => {}} />;
}
