// MS Paint-style pixel canvas. Bots paint by writing a ```paint block in their message; each line is
// one tool use, like a mouse drag in Paint. The same code renders the picture on the server (for the
// image the bots see) and in the browser, so both always show exactly the same pixels.

export const PAINT_W = 800;
export const PAINT_H = 600;
const MAX_COMMANDS_PER_MESSAGE = 100;
const MAX_POINTS = 600;

// Explained to the bots in their instructions
export const PAINT_HELP = `You share an ${PAINT_W}x${PAINT_H} pixel canvas that works like MS Paint, starting white. \
(0,0) is the top-left corner. Paint the way a person does in Paint: drag the brush in strokes, \
use the spray can for shading and texture, the bucket to fill closed shapes, the pencil for fine detail. \
On your turn, paint by putting a block like this anywhere in your message, one tool use per line:
\`\`\`paint
brush #2b2b2b 4 120 400 140 360 175 335 220 330 260 345
curve navy 3 300 300 340 220 440 220 480 300
ellipse brown 3 600 200 70 50
fill orange 600 200
spray #4a7c3a 18 50 520 150 500 260 515 380 505
pencil black 300 450 320 440 345 452
line red 6 20 30 220 90
rect blue 2 650 400 100 80 filled
eraser 12 650 420 750 460
\`\`\`
Tools (COLOR is a hex like #ff8800 or a name like red, navy, skyblue; SIZE is the thickness in pixels):
- brush COLOR SIZE x1 y1 x2 y2 x3 y3 ... — a freehand brush stroke through the points, like dragging the mouse
- pencil COLOR x1 y1 x2 y2 ... — a 1-pixel freehand line
- spray COLOR SIZE x1 y1 x2 y2 ... — spray can along the path; SIZE is the spray radius
- fill COLOR x y — paint bucket: fills the area of one color around (x, y); shapes must be closed or it leaks
- line COLOR SIZE x1 y1 x2 y2 — straight line
- curve COLOR SIZE x1 y1 cx1 cy1 cx2 cy2 x2 y2 — curve from (x1,y1) to (x2,y2), bent toward the two control points
- rect COLOR SIZE x y w h [filled] / ellipse COLOR SIZE cx cy rx ry [filled]
- eraser SIZE x1 y1 x2 y2 ... — erase along a stroke
- clear — wipe the whole canvas
There is no text tool. Up to ${MAX_COMMANDS_PER_MESSAGE} lines per turn. \
Each turn you're shown an image of the canvas as it is right now.`;

type RGB = [number, number, number];

type Op =
  | { t: 'pencil'; c: RGB; pts: number[] }
  | { t: 'brush'; c: RGB; size: number; pts: number[] }
  | { t: 'spray'; c: RGB; size: number; pts: number[]; seed: number }
  | { t: 'fill'; c: RGB; x: number; y: number }
  | { t: 'line'; c: RGB; size: number; pts: number[] }
  | { t: 'curve'; c: RGB; size: number; pts: number[] }
  | { t: 'rect'; c: RGB; size: number; x: number; y: number; w: number; h: number; filled: boolean }
  | { t: 'ellipse'; c: RGB; size: number; cx: number; cy: number; rx: number; ry: number; filled: boolean }
  | { t: 'clear' };

// The classic Paint palette plus common names
const NAMED: Record<string, string> = {
  black: '000000', white: 'ffffff', gray: '808080', grey: '808080', darkgray: '404040', lightgray: 'c0c0c0',
  silver: 'c0c0c0', red: 'ed1c24', darkred: '880015', maroon: '800000', orange: 'ff7f27', yellow: 'fff200',
  gold: 'ffc90e', lime: '22b14c', green: '228b22', darkgreen: '0b5d1e', olive: '808000', teal: '008080',
  cyan: '00a2e8', aqua: '00ffff', skyblue: '99d9ea', lightblue: 'add8e6', blue: '3f48cc', navy: '000080',
  indigo: '4b0082', purple: 'a349a4', violet: 'c8bfe7', magenta: 'ff00ff', pink: 'ffaec9', hotpink: 'ff69b4',
  brown: '7f4f24', tan: 'd2b48c', beige: 'f5f5dc', cream: 'fffdd0', peach: 'ffdab9', coral: 'ff7f50',
  salmon: 'fa8072', crimson: 'dc143c', turquoise: '40e0d0', lavender: 'e6e6fa', mint: '98ff98', khaki: 'f0e68c',
  rose: 'ff66cc', sand: 'efe4b0', slate: '708090', charcoal: '36454f', ivory: 'fffff0', chocolate: 'd2691e',
};

function parseColor(t: string | undefined): RGB | null {
  if (!t) return null;
  let hex = t.toLowerCase();
  if (NAMED[hex]) hex = NAMED[hex];
  else if (hex.startsWith('#')) hex = hex.slice(1);
  else return null;
  if (/^[0-9a-f]{3}$/.test(hex)) hex = hex.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

const isNum = (t: string) => /^-?\d+(\.\d+)?$/.test(t);
const clampSize = (n: number, max = 80) => Math.max(1, Math.min(max, Math.round(n)));
const coord = (n: number) => Math.max(-1000, Math.min(2000, n));

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function parseOp(line: string): Op | null {
  const tokens = line.trim().split(/\s+/);
  const tool = tokens.shift()?.toLowerCase();
  if (!tool) return null;
  if (tool === 'clear') return { t: 'clear' };

  if (tool === 'eraser') {
    const n = tokens.filter(isNum).map(Number);
    if (n.length < 3) return null;
    const size = clampSize(n.shift()!, 120);
    const pts = n.slice(0, MAX_POINTS * 2 - (n.length % 2)).map(coord);
    return pts.length >= 2 ? { t: 'brush', c: [255, 255, 255], size, pts } : null;
  }

  const c = parseColor(tokens.shift());
  if (!c) return null;
  const filled = tokens.some((t) => t.toLowerCase() === 'filled' || t.toLowerCase() === 'fill');
  const n = tokens.filter(isNum).map(Number);
  const even = (arr: number[]) => arr.slice(0, Math.min(arr.length - (arr.length % 2), MAX_POINTS * 2)).map(coord);

  switch (tool) {
    case 'pencil': {
      const pts = even(n);
      return pts.length >= 2 ? { t: 'pencil', c, pts } : null;
    }
    case 'brush':
    case 'spray': {
      if (n.length < 3) return null;
      const size = clampSize(n.shift()!);
      const pts = even(n);
      if (pts.length < 2) return null;
      return tool === 'brush' ? { t: 'brush', c, size, pts } : { t: 'spray', c, size, pts, seed: hash(line) };
    }
    case 'fill':
      return n.length >= 2 ? { t: 'fill', c, x: Math.round(n[0]), y: Math.round(n[1]) } : null;
    case 'line':
      return n.length >= 5 ? { t: 'line', c, size: clampSize(n[0]), pts: n.slice(1, 5).map(coord) } : null;
    case 'curve':
      return n.length >= 9 ? { t: 'curve', c, size: clampSize(n[0]), pts: n.slice(1, 9).map(coord) } : null;
    case 'rect':
      return n.length >= 5
        ? { t: 'rect', c, size: clampSize(n[0]), x: coord(n[1]), y: coord(n[2]), w: Math.abs(coord(n[3])), h: Math.abs(coord(n[4])), filled }
        : null;
    case 'ellipse':
      return n.length >= 5
        ? { t: 'ellipse', c, size: clampSize(n[0]), cx: coord(n[1]), cy: coord(n[2]), rx: Math.abs(coord(n[3])), ry: Math.abs(coord(n[4])), filled }
        : null;
    default:
      return null;
  }
}

// ```draw is accepted too, since bots sometimes slip into the older format's label;
// only lines that are valid paint tools are used
const PAINT_BLOCK = /```(?:paint|draw)[^\n]*\n([\s\S]*?)(```|$)/g;

// Splits a bot message into its spoken text and its valid paint commands
export function parsePaint(content: string): { text: string; commands: string[] } {
  const commands: string[] = [];
  for (const match of content.matchAll(PAINT_BLOCK)) {
    const lines = match[1].split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, MAX_COMMANDS_PER_MESSAGE)) {
      if (parseOp(line)) commands.push(line);
    }
  }
  const text = content.replace(PAINT_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, commands };
}

// Only what's been painted since the most recent "clear"
export function sinceLastClear(commands: string[]): string[] {
  let start = 0;
  commands.forEach((cmd, i) => {
    if (/^\s*clear\b/i.test(cmd)) start = i + 1;
  });
  return commands.slice(start);
}

// ---------------------------------------------------------------------------
// Pixel rendering
// ---------------------------------------------------------------------------

class Pixels {
  data = new Uint8ClampedArray(PAINT_W * PAINT_H * 4).fill(255);

  set(x: number, y: number, c: RGB) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= PAINT_W || y >= PAINT_H) return;
    const i = (y * PAINT_W + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = 255;
  }

  disc(cx: number, cy: number, r: number, c: RGB) {
    if (r < 0.75) return this.set(cx, cy, c);
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
      for (let dx = -half; dx <= half; dx++) this.set(cx + dx, cy + dy, c);
    }
  }

  // Hard-edged round brush dragged from a to b, like Paint
  stroke(x0: number, y0: number, x1: number, y1: number, size: number, c: RGB) {
    const r = size / 2;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(0.5, r / 2);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, c);
    }
  }

  // 1-pixel Bresenham line
  pencil(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 10000; guard++) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Paint bucket: 4-connected flood fill of the exact color under (x, y)
  fill(x: number, y: number, c: RGB) {
    if (x < 0 || y < 0 || x >= PAINT_W || y >= PAINT_H) return;
    const d = this.data;
    const start = (y * PAINT_W + x) * 4;
    const tr = d[start], tg = d[start + 1], tb = d[start + 2];
    if (tr === c[0] && tg === c[1] && tb === c[2]) return;
    const stack = new Int32Array(PAINT_W * PAINT_H);
    let top = 0;
    stack[top++] = y * PAINT_W + x;
    while (top > 0) {
      const p = stack[--top];
      const i = p * 4;
      if (d[i] !== tr || d[i + 1] !== tg || d[i + 2] !== tb) continue;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      const px = p % PAINT_W;
      if (px > 0) stack[top++] = p - 1;
      if (px < PAINT_W - 1) stack[top++] = p + 1;
      if (p >= PAINT_W) stack[top++] = p - PAINT_W;
      if (p < PAINT_W * (PAINT_H - 1)) stack[top++] = p + PAINT_W;
    }
  }
}

// Points along a smooth curve through the given points (Catmull-Rom), so drags look like real strokes
function smoothPoints(pts: number[]): number[] {
  const p: [number, number][] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) p.push([pts[i], pts[i + 1]]);
  if (p.length < 3) return pts;
  const out: number[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      for (const a of [0, 1]) {
        out.push(0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3));
      }
    }
  }
  out.push(p[p.length - 1][0], p[p.length - 1][1]);
  return out;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bezier(p: number[], t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6],
    u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7],
  ];
}

function apply(px: Pixels, op: Op) {
  switch (op.t) {
    case 'clear':
      px.data.fill(255);
      return;
    case 'pencil':
      if (op.pts.length === 2) return px.set(op.pts[0], op.pts[1], op.c);
      for (let i = 0; i + 3 < op.pts.length; i += 2) px.pencil(op.pts[i], op.pts[i + 1], op.pts[i + 2], op.pts[i + 3], op.c);
      return;
    case 'brush': {
      const s = smoothPoints(op.pts);
      if (s.length === 2) return px.disc(s[0], s[1], op.size / 2, op.c);
      for (let i = 0; i + 3 < s.length; i += 2) px.stroke(s[i], s[i + 1], s[i + 2], s[i + 3], op.size, op.c);
      return;
    }
    case 'spray': {
      const rand = rng(op.seed);
      const s = smoothPoints(op.pts);
      const dots = Math.max(2, Math.round(op.size * 0.8));
      const sprayAt = (x: number, y: number) => {
        for (let k = 0; k < dots; k++) {
          const a = rand() * Math.PI * 2;
          const r = Math.sqrt(rand()) * op.size;
          px.set(x + Math.cos(a) * r, y + Math.sin(a) * r, op.c);
        }
      };
      if (s.length === 2) {
        for (let k = 0; k < 6; k++) sprayAt(s[0], s[1]);
        return;
      }
      for (let i = 0; i + 3 < s.length; i += 2) {
        const dist = Math.hypot(s[i + 2] - s[i], s[i + 3] - s[i + 1]);
        const steps = Math.max(1, Math.ceil(dist / 3));
        for (let k = 0; k < steps; k++) sprayAt(s[i] + ((s[i + 2] - s[i]) * k) / steps, s[i + 1] + ((s[i + 3] - s[i + 1]) * k) / steps);
      }
      return;
    }
    case 'fill':
      return px.fill(op.x, op.y, op.c);
    case 'line':
      return op.size === 1
        ? px.pencil(op.pts[0], op.pts[1], op.pts[2], op.pts[3], op.c)
        : px.stroke(op.pts[0], op.pts[1], op.pts[2], op.pts[3], op.size, op.c);
    case 'curve': {
      const len = Math.hypot(op.pts[6] - op.pts[0], op.pts[7] - op.pts[1]) + Math.hypot(op.pts[2] - op.pts[0], op.pts[3] - op.pts[1]) + Math.hypot(op.pts[6] - op.pts[4], op.pts[7] - op.pts[5]);
      const n = Math.max(8, Math.ceil(len / 3));
      let [ax, ay] = bezier(op.pts, 0);
      for (let k = 1; k <= n; k++) {
        const [bx, by] = bezier(op.pts, k / n);
        if (op.size === 1) px.pencil(ax, ay, bx, by, op.c);
        else px.stroke(ax, ay, bx, by, op.size, op.c);
        ax = bx; ay = by;
      }
      return;
    }
    case 'rect': {
      const { x, y, w, h } = op;
      if (op.filled) {
        for (let yy = Math.max(0, Math.round(y)); yy < Math.min(PAINT_H, Math.round(y + h)); yy++) {
          for (let xx = Math.max(0, Math.round(x)); xx < Math.min(PAINT_W, Math.round(x + w)); xx++) px.set(xx, yy, op.c);
        }
      }
      const edges = [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]];
      for (const [a, b, cx, cy] of edges) {
        if (op.size === 1) px.pencil(a, b, cx, cy, op.c);
        else px.stroke(a, b, cx, cy, op.size, op.c);
      }
      return;
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = op;
      if (op.filled) {
        for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
          if (ry === 0) break;
          const half = rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry)));
          for (let dx = -Math.floor(half); dx <= Math.floor(half); dx++) px.set(cx + dx, cy + dy, op.c);
        }
      }
      const n = Math.max(24, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / 3));
      let ax = cx + rx, ay = cy;
      for (let k = 1; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const bx = cx + Math.cos(a) * rx, by = cy + Math.sin(a) * ry;
        if (op.size === 1) px.pencil(ax, ay, bx, by, op.c);
        else px.stroke(ax, ay, bx, by, op.size, op.c);
        ax = bx; ay = by;
      }
      return;
    }
  }
}

// Paints every command in order onto a white canvas; returns RGBA pixels (PAINT_W x PAINT_H)
export function renderPaint(commands: string[]): Uint8ClampedArray {
  const px = new Pixels();
  for (const cmd of commands) {
    const op = parseOp(cmd);
    if (op) apply(px, op);
  }
  return px.data;
}
