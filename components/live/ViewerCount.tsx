'use client';

import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';

// =============================================
// Viewer Count Component
// Shows how many people are watching live
// =============================================

interface ViewerCountProps {
  count: number;
  isLive?: boolean;
}

export default function ViewerCount({ count, isLive = true }: ViewerCountProps) {
  const [displayCount, setDisplayCount] = useState(count);

  // Animate count changes
  useEffect(() => {
    const diff = count - displayCount;
    if (diff === 0) return;

    const steps = 10;
    const stepSize = diff / steps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      if (step >= steps) {
        setDisplayCount(count);
        clearInterval(timer);
      } else {
        setDisplayCount(prev => Math.round(prev + stepSize));
      }
    }, 50);

    return () => clearInterval(timer);
  }, [count]);

  if (!isLive) return null;

  return (
    <div className="flex items-center gap-2 bg-[#12121f] border border-[#1e1e35] rounded-lg px-3 py-2">
      <Eye size={14} className="text-[#9090a8]" />
      <span className="text-[#e8e8f0] font-mono text-sm font-bold">
        {displayCount.toLocaleString()}
      </span>
      <span className="text-[#5a5a78] font-mono text-xs">watching</span>
    </div>
  );
}
