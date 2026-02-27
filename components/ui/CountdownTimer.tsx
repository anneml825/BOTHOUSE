'use client';

import { useState, useEffect } from 'react';

// =============================================
// Countdown Timer Component
// Shows time until next live session
// =============================================

interface CountdownTimerProps {
  targetTime: Date;
  label?: string;
}

interface TimeLeft {
  hours: number;
  minutes: number;
  seconds: number;
}

function calculateTimeLeft(target: Date): TimeLeft {
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return { hours: 0, minutes: 0, seconds: 0 };

  return {
    hours: Math.floor(diff / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export default function CountdownTimer({
  targetTime,
  label = 'NEXT SESSION IN',
}: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(calculateTimeLeft(targetTime));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft(targetTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetTime]);

  const { hours, minutes, seconds } = timeLeft;
  const isExpired = hours === 0 && minutes === 0 && seconds === 0;

  if (isExpired) {
    return (
      <div className="text-center">
        <p className="text-[#00ff88] font-mono text-sm tracking-widest mb-2">{label}</p>
        <p className="text-[#00ff88] font-mono text-4xl font-bold neon-text-green animate-pulse">
          STARTING NOW
        </p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <p className="text-[#9090a8] font-mono text-xs tracking-widest mb-3 uppercase">{label}</p>
      <div className="flex items-center justify-center gap-2">
        {/* Hours */}
        <div className="flex flex-col items-center">
          <div className="bg-[#12121f] border border-[#1e1e35] rounded-lg w-16 h-16 flex items-center justify-center">
            <span className="text-[#00ff88] font-mono text-2xl font-bold neon-text-green">
              {pad(hours)}
            </span>
          </div>
          <span className="text-[#5a5a78] font-mono text-xs mt-1">HRS</span>
        </div>

        <span className="text-[#5a5a78] font-mono text-2xl font-bold mb-4">:</span>

        {/* Minutes */}
        <div className="flex flex-col items-center">
          <div className="bg-[#12121f] border border-[#1e1e35] rounded-lg w-16 h-16 flex items-center justify-center">
            <span className="text-[#00ff88] font-mono text-2xl font-bold neon-text-green">
              {pad(minutes)}
            </span>
          </div>
          <span className="text-[#5a5a78] font-mono text-xs mt-1">MIN</span>
        </div>

        <span className="text-[#5a5a78] font-mono text-2xl font-bold mb-4">:</span>

        {/* Seconds */}
        <div className="flex flex-col items-center">
          <div className="bg-[#12121f] border border-[#1e1e35] rounded-lg w-16 h-16 flex items-center justify-center">
            <span
              className="text-[#9090a8] font-mono text-2xl font-bold"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {pad(seconds)}
            </span>
          </div>
          <span className="text-[#5a5a78] font-mono text-xs mt-1">SEC</span>
        </div>
      </div>
    </div>
  );
}
