// MS Paint-style pixel canvas. Bots paint by writing a ```paint block in their message; each line is
// one tool use, like a mouse drag in Paint. The same code renders the picture on the server (for the
// image the bots see) and in the browser, so both always show exactly the same pixels.

export const PAINT_W = 800;
export const PAINT_H = 600;
const MAX_COMMANDS_PER_MESSAGE = 150;
const MAX_POINTS = 600;
// How different two touching pixels can be and still count as the same area for fill/gradient
const FILL_TOLERANCE = 24;

// Explained to the bots in their instructions
export const PAINT_HELP = `You share an ${PAINT_W}x${PAINT_H} pixel canvas, starting white. (0,0) is the top-left corner. \
Aim for realistic painting, the way a skilled painter works: get proportion and perspective right, \
decide where the light comes from, and build form with light, shadow and soft value transitions rather than \
flat colors and outlines. Work in layers: block in large shapes and base colors, then shade and blend with the \
airbrush, gradients and smudge, then refine details and highlights. Each turn, look at the canvas and improve \
what is already there before adding anything new. Never draw stick figures or doodles: any person or animal \
must be painted with real anatomy, volume and shading. Everything is drawn freehand; there are no shape tools. \
On your turn, paint by putting a block like this anywhere in your message, one tool use per line:
\`\`\`paint
gradient #1e3c72 #f2a65a 400 300 400 0 400 380
brush #3a2a1e 3 300 260 318 232 345 214 380 206 418 210 450 226 470 252 474 284 462 314 436 336 400 346 362 342 330 326 308 300 300 270 300 260
gradient #f4c27a #8a4b1c 390 280 340 230 450 330
airbrush #000000 40 0.25 440 300 450 270 430 240
airbrush #ffffff 18 0.5 350 240 360 232 372 230
smudge 10 330 300 360 320 400 326 440 310
pencil #2b2b2b 360 250 364 246 369 248 372 253
spray #4a7c3a 18 50 520 110 508 170 515 230 505 290 512 350 500
eraser 12 650 420 690 430 730 425 760 440
\`\`\`
Tools (COLOR is a hex like #ff8800 or a name like red, navy, skyblue; SIZE is in pixels):
- brush COLOR SIZE x1 y1 x2 y2 ... — a solid freehand brush stroke through the points (use many points)
- airbrush COLOR SIZE OPACITY x1 y1 x2 y2 ... — soft-edged, see-through stroke for shading, glow, blending \
and atmosphere. SIZE is the radius, OPACITY from 0.05 (faint glaze) to 1 (strong). Layer several faint passes.
- gradient COLOR1 COLOR2 x y x1 y1 x2 y2 — fills the area of one color around (x, y) with a smooth blend \
from COLOR1 at (x1,y1) to COLOR2 at (x2,y2), for skies, rounded forms and light falloff
- smudge SIZE x1 y1 x2 y2 ... — blurs and blends whatever is under the stroke, to soften edges and mix colors
- pencil COLOR x1 y1 x2 y2 ... — a 1-pixel freehand line, for fine detail and hatching
- spray COLOR SIZE x1 y1 x2 y2 ... — grainy spray can along the path, for texture (foliage, stone, grain)
- fill COLOR x y — paint bucket: fills the area of one color around (x, y); outlines must be closed or it leaks
- curve COLOR SIZE x1 y1 cx1 cy1 cx2 cy2 x2 y2 — one smooth bend from (x1,y1) to (x2,y2)
- eraser SIZE x1 y1 x2 y2 ... — erase back to white along a stroke
- clear — wipe the whole canvas
There is no text tool and no shape tools. Up to ${MAX_COMMANDS_PER_MESSAGE} lines per turn. \
Each turn you're shown an image of the canvas as it is right now.`;

type RGB = [number, number, number];

type Op =
  | { t: 'pencil'; c: RGB; pts: number[]; seed: number }
  | { t: 'brush'; c: RGB; size: number; pts: number[]; seed?: number }
  | { t: 'spray'; c: RGB; size: number; pts: number[]; seed: number }
  | { t: 'fill'; c: RGB; x: number; y: number }
  | { t: 'line'; c: RGB; size: number; pts: number[] }
  | { t: 'curve'; c: RGB; size: number; pts: number[] }
  | { t: 'rect'; c: RGB; size: number; x: number; y: number; w: number; h: number; filled: boolean }
  | { t: 'ellipse'; c: RGB; size: number; cx: number; cy: number; rx: number; ry: number; filled: boolean }
  | { t: 'airbrush'; c: RGB; size: number; opacity: number; pts: number[] }
  | { t: 'gradient'; c1: RGB; c2: RGB; x: number; y: number; pts: number[] }
  | { t: 'smudge'; size: number; pts: number[] }
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

  if (tool === 'smudge') {
    const n = tokens.filter(isNum).map(Number);
    if (n.length < 3) return null;
    const size = clampSize(n.shift()!, 60);
    const pts = n.slice(0, MAX_POINTS * 2 - (n.length % 2)).map(coord);
    return pts.length >= 2 ? { t: 'smudge', size, pts } : null;
  }

  if (tool === 'gradient') {
    const c1 = parseColor(tokens.shift());
    const c2 = parseColor(tokens.shift());
    const n = tokens.filter(isNum).map(Number);
    if (!c1 || !c2 || n.length < 6) return null;
    return { t: 'gradient', c1, c2, x: Math.round(n[0]), y: Math.round(n[1]), pts: n.slice(2, 6).map(coord) };
  }

  const c = parseColor(tokens.shift());
  if (!c) return null;
  const filled = tokens.some((t) => t.toLowerCase() === 'filled' || t.toLowerCase() === 'fill');
  const n = tokens.filter(isNum).map(Number);
  const even = (arr: number[]) => arr.slice(0, Math.min(arr.length - (arr.length % 2), MAX_POINTS * 2)).map(coord);

  switch (tool) {
    case 'pencil': {
      const pts = even(n);
      return pts.length >= 2 ? { t: 'pencil', c, pts, seed: hash(line) } : null;
    }
    case 'brush':
    case 'spray': {
      if (n.length < 3) return null;
      const size = clampSize(n.shift()!);
      const pts = even(n);
      if (pts.length < 2) return null;
      return tool === 'brush' ? { t: 'brush', c, size, pts, seed: hash(line) } : { t: 'spray', c, size, pts, seed: hash(line) };
    }
    case 'airbrush': {
      if (n.length < 4) return null;
      const size = clampSize(n.shift()!, 120);
      let opacity = n.shift()!;
      if (opacity > 1) opacity /= 100; // accept 30 as 30%
      opacity = Math.max(0.02, Math.min(1, opacity));
      const pts = even(n);
      return pts.length >= 2 ? { t: 'airbrush', c, size, opacity, pts } : null;
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
const RETIRED_TOOLS = /^\s*(rect|ellipse|line)\b/i;

const PAINT_BLOCK = /```(?:paint|draw)[^\n]*\n([\s\S]*?)(```|$)/g;

// Splits a bot message into its spoken text and its valid paint commands
export function parsePaint(content: string): { text: string; commands: string[] } {
  const commands: string[] = [];
  for (const match of content.matchAll(PAINT_BLOCK)) {
    const lines = match[1].split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, MAX_COMMANDS_PER_MESSAGE)) {
      // Shape tools are retired for new paintings (they made everything look like clip-art);
      // renderPaint still draws them so older gallery paintings keep working
      if (RETIRED_TOOLS.test(line)) continue;
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

  // Mixes color c over the pixel with strength a (0..1)
  blend(x: number, y: number, c: RGB, a: number) {
    if (x < 0 || y < 0 || x >= PAINT_W || y >= PAINT_H || a <= 0) return;
    const i = (y * PAINT_W + x) * 4;
    const d = this.data;
    d[i] = d[i] + (c[0] - d[i]) * a;
    d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * a;
    d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * a;
  }

  // Every pixel connected to (x, y) through gradual color changes, as a 0/1 mask.
  // Smooth gradients and soft shading count as one area; a real edge (like an outline) stops it.
  region(x: number, y: number): Uint8Array | null {
    if (x < 0 || y < 0 || x >= PAINT_W || y >= PAINT_H) return null;
    const d = this.data;
    const seen = new Uint8Array(PAINT_W * PAINT_H);
    const stack = new Int32Array(PAINT_W * PAINT_H);
    let top = 0;
    const close = (a: number, b: number) =>
      Math.abs(d[a] - d[b]) <= FILL_TOLERANCE &&
      Math.abs(d[a + 1] - d[b + 1]) <= FILL_TOLERANCE &&
      Math.abs(d[a + 2] - d[b + 2]) <= FILL_TOLERANCE;
    const start = y * PAINT_W + x;
    seen[start] = 1;
    stack[top++] = start;
    while (top > 0) {
      const p = stack[--top];
      const px = p % PAINT_W;
      const neighbors = [px > 0 ? p - 1 : -1, px < PAINT_W - 1 ? p + 1 : -1, p - PAINT_W, p + PAINT_W];
      for (const q of neighbors) {
        if (q < 0 || q >= seen.length || seen[q] || !close(p * 4, q * 4)) continue;
        seen[q] = 1;
        stack[top++] = q;
      }
    }
    return seen;
  }

  // Paint bucket: fills the area around (x, y), following gradual color changes
  fill(x: number, y: number, c: RGB) {
    const mask = this.region(x, y);
    if (!mask) return;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2];
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

// A slight, smooth hand tremor so freehand strokes never look computer-perfect.
// Deterministic (seeded by the command text), so server and browser draw identical pixels.
function wobble(pts: number[], seed: number, amount: number): number[] {
  if (pts.length < 4 || amount <= 0) return pts;
  const rand = rng(seed);
  const waves = [0, 1, 2].map(() => ({ f: 0.02 + rand() * 0.05, px: rand() * 6.28, py: rand() * 6.28 }));
  const out: number[] = [];
  let dist = 0;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (i >= 2) dist += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    let dx = 0, dy = 0;
    for (const w of waves) {
      dx += Math.sin(dist * w.f + w.px);
      dy += Math.sin(dist * w.f + w.py);
    }
    out.push(pts[i] + (dx / 3) * amount, pts[i + 1] + (dy / 3) * amount);
  }
  // Closed outline (ends where it started): bend the tremor so both ends meet again,
  // otherwise the gap would make the paint bucket leak
  const n = out.length;
  if (Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < 2 && dist > 0) {
    const gx = out[n - 2] - out[0], gy = out[n - 1] - out[1];
    let run = 0;
    for (let i = 2; i < n; i += 2) {
      run += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      out[i] -= (gx * run) / dist;
      out[i + 1] -= (gy * run) / dist;
    }
  }
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
    case 'pencil': {
      if (op.pts.length === 2) return px.set(op.pts[0], op.pts[1], op.c);
      const s = wobble(smoothPoints(op.pts), op.seed, 0.8);
      for (let i = 0; i + 3 < s.length; i += 2) px.pencil(s[i], s[i + 1], s[i + 2], s[i + 3], op.c);
      return;
    }
    case 'brush': {
      // Eraser strokes (no seed) stay steady; painted strokes get the hand tremor
      const smooth = smoothPoints(op.pts);
      const s = op.seed === undefined ? smooth : wobble(smooth, op.seed, Math.min(2.5, 0.8 + op.size * 0.15));
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
    case 'airbrush': {
      // Coverage is the strongest falloff any dab gives a pixel, then blended once,
      // so overlapping dabs within one stroke don't stack into a solid line
      const s = smoothPoints(op.pts);
      const r = op.size;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i + 1 < s.length; i += 2) {
        minX = Math.min(minX, s[i]); maxX = Math.max(maxX, s[i]);
        minY = Math.min(minY, s[i + 1]); maxY = Math.max(maxY, s[i + 1]);
      }
      const x0 = Math.max(0, Math.floor(minX - r)), x1 = Math.min(PAINT_W - 1, Math.ceil(maxX + r));
      const y0 = Math.max(0, Math.floor(minY - r)), y1 = Math.min(PAINT_H - 1, Math.ceil(maxY + r));
      if (x1 < x0 || y1 < y0) return;
      const bw = x1 - x0 + 1;
      const cover = new Float32Array(bw * (y1 - y0 + 1));
      const dab = (cx: number, cy: number) => {
        for (let yy = Math.max(y0, Math.floor(cy - r)); yy <= Math.min(y1, Math.ceil(cy + r)); yy++) {
          for (let xx = Math.max(x0, Math.floor(cx - r)); xx <= Math.min(x1, Math.ceil(cx + r)); xx++) {
            const dist = Math.hypot(xx - cx, yy - cy) / r;
            if (dist >= 1) continue;
            const f = (1 - dist) * (1 - dist);
            const k = (yy - y0) * bw + (xx - x0);
            if (f > cover[k]) cover[k] = f;
          }
        }
      };
      if (s.length === 2) dab(s[0], s[1]);
      for (let i = 0; i + 3 < s.length; i += 2) {
        const dist = Math.hypot(s[i + 2] - s[i], s[i + 3] - s[i + 1]);
        const steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 4)));
        for (let k = 0; k <= steps; k++) dab(s[i] + ((s[i + 2] - s[i]) * k) / steps, s[i + 1] + ((s[i + 3] - s[i + 1]) * k) / steps);
      }
      for (let k = 0; k < cover.length; k++) {
        if (cover[k] > 0) px.blend(x0 + (k % bw), y0 + Math.floor(k / bw), op.c, cover[k] * op.opacity);
      }
      return;
    }
    case 'gradient': {
      const mask = px.region(op.x, op.y);
      if (!mask) return;
      const [ax, ay, bx, by] = op.pts;
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy || 1;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const x = p % PAINT_W, y = Math.floor(p / PAINT_W);
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
        px.set(x, y, [
          op.c1[0] + (op.c2[0] - op.c1[0]) * t,
          op.c1[1] + (op.c2[1] - op.c1[1]) * t,
          op.c1[2] + (op.c2[2] - op.c1[2]) * t,
        ]);
      }
      return;
    }
    case 'smudge': {
      // Box-blur everything under the stroke (two passes), like dragging a finger through wet paint
      const s = smoothPoints(op.pts);
      const r = op.size;
      const mask = new Uint8Array(PAINT_W * PAINT_H);
      const mark = (cx: number, cy: number) => {
        for (let yy = Math.max(0, Math.floor(cy - r)); yy <= Math.min(PAINT_H - 1, Math.ceil(cy + r)); yy++) {
          for (let xx = Math.max(0, Math.floor(cx - r)); xx <= Math.min(PAINT_W - 1, Math.ceil(cx + r)); xx++) {
            if (Math.hypot(xx - cx, yy - cy) <= r) mask[yy * PAINT_W + xx] = 1;
          }
        }
      };
      if (s.length === 2) mark(s[0], s[1]);
      for (let i = 0; i + 3 < s.length; i += 2) {
        const dist = Math.hypot(s[i + 2] - s[i], s[i + 3] - s[i + 1]);
        const steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 2)));
        for (let k = 0; k <= steps; k++) mark(s[i] + ((s[i + 2] - s[i]) * k) / steps, s[i + 1] + ((s[i + 3] - s[i + 1]) * k) / steps);
      }
      const k = Math.max(1, Math.min(4, Math.round(r / 5)));
      for (let pass = 0; pass < 2; pass++) {
        const src = px.data.slice();
        for (let p = 0; p < mask.length; p++) {
          if (!mask[p]) continue;
          const x = p % PAINT_W, y = Math.floor(p / PAINT_W);
          let sr = 0, sg = 0, sb = 0, count = 0;
          for (let dy = -k; dy <= k; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= PAINT_H) continue;
            for (let dx = -k; dx <= k; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= PAINT_W) continue;
              const i = (yy * PAINT_W + xx) * 4;
              sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; count++;
            }
          }
          const i = p * 4;
          px.data[i] = sr / count; px.data[i + 1] = sg / count; px.data[i + 2] = sb / count;
        }
      }
      return;
    }
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
