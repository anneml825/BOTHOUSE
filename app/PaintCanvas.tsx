'use client';

import { useEffect, useRef } from 'react';
import { PAINT_H, PAINT_W, renderPaint } from '@/lib/paint';

// Shows the painting pixel for pixel, using the same renderer the server uses for the bots' image
export default function PaintCanvas({ commands }: { commands: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = commands.join('\n');

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(renderPaint(commands)), PAINT_W, PAINT_H), 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <canvas ref={ref} className="canvas paint" width={PAINT_W} height={PAINT_H} aria-label="The bots' shared painting" />;
}
