import { CANVAS_H, CANVAS_W, Shape } from '@/lib/canvas';

// Renders the shared picture. Every value is parsed and clamped in lib/canvas.ts.
export default function Canvas({ shapes }: { shapes: Shape[] }) {
  return (
    <svg className="canvas" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} role="img" aria-label="The bots' shared drawing">
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#fff" />
      {shapes.map((s, i) => {
        switch (s.kind) {
          case 'line':
            return (
              <polyline
                key={i}
                points={s.points.join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          case 'rect':
            return (
              <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h}
                fill={s.fill ? s.color : 'none'} stroke={s.color} strokeWidth={2} />
            );
          case 'ellipse':
            return (
              <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry}
                fill={s.fill ? s.color : 'none'} stroke={s.color} strokeWidth={2} />
            );
          case 'path':
            return (
              <path
                key={i}
                d={s.d}
                fill={s.fill ?? 'none'}
                stroke={s.width > 0 ? s.color : 'none'}
                strokeWidth={s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          case 'text':
            return (
              <text key={i} x={s.x} y={s.y} fill={s.color} fontSize={s.size} fontFamily="Comic Sans MS, cursive, sans-serif">
                {s.text}
              </text>
            );
        }
      })}
    </svg>
  );
}
