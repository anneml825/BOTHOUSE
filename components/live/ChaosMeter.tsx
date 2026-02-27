'use client';

import { useEffect, useState } from 'react';

// =============================================
// Chaos Meter Component
// Shows how heated things are getting in the house
// =============================================

interface ChaosMeterProps {
  level: number; // 0-100
}

const CHAOS_LABELS = [
  { min: 0, max: 20, label: 'DEAD SILENT', color: '#9090a8' },
  { min: 20, max: 40, label: 'SIMMERING', color: '#ffdd00' },
  { min: 40, max: 60, label: 'HEATING UP', color: '#ff8800' },
  { min: 60, max: 80, label: 'SPICY 🌶️', color: '#ff4400' },
  { min: 80, max: 95, label: 'TOTAL CHAOS', color: '#ff0080' },
  { min: 95, max: 100, label: '🔥 UNHINGED 🔥', color: '#ff0080' },
];

function getChaosInfo(level: number) {
  return CHAOS_LABELS.find(l => level >= l.min && level <= l.max) || CHAOS_LABELS[0];
}

export default function ChaosMeter({ level }: ChaosMeterProps) {
  const [displayLevel, setDisplayLevel] = useState(level);
  const chaosInfo = getChaosInfo(displayLevel);

  // Animate the level change
  useEffect(() => {
    const target = Math.min(100, Math.max(0, level));
    const diff = target - displayLevel;
    if (Math.abs(diff) < 1) return;

    const step = diff / 10;
    const timer = setInterval(() => {
      setDisplayLevel(prev => {
        const next = prev + step;
        if (Math.abs(next - target) < 1) {
          clearInterval(timer);
          return target;
        }
        return next;
      });
    }, 50);

    return () => clearInterval(timer);
  }, [level]);

  const isUnhinged = displayLevel >= 80;

  return (
    <div className="bg-[#12121f] border border-[#1e1e35] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[#9090a8] font-mono text-xs tracking-widest">CHAOS METER</span>
        <span
          className={`font-mono text-xs font-bold tracking-wider ${isUnhinged ? 'animate-pulse' : ''}`}
          style={{ color: chaosInfo.color }}
        >
          {chaosInfo.label}
        </span>
      </div>

      {/* Meter bar */}
      <div className="relative h-3 bg-[#0f0f1a] rounded-full overflow-hidden border border-[#1e1e35]">
        <div
          className="h-full rounded-full transition-all duration-500 chaos-bar"
          style={{ width: `${displayLevel}%` }}
        />

        {/* Glitch effect at high levels */}
        {isUnhinged && (
          <div
            className="absolute inset-0 rounded-full animate-pulse opacity-50"
            style={{
              background: `linear-gradient(90deg, transparent, ${chaosInfo.color}40, transparent)`,
            }}
          />
        )}
      </div>

      {/* Level indicators */}
      <div className="flex justify-between mt-1.5">
        <span className="text-[#5a5a78] font-mono text-xs">0</span>
        <span
          className="font-mono text-xs font-bold"
          style={{ color: chaosInfo.color }}
        >
          {Math.round(displayLevel)}%
        </span>
        <span className="text-[#5a5a78] font-mono text-xs">100</span>
      </div>
    </div>
  );
}
