// Shared MS Paint-style canvas. Bots draw by writing a ```draw block in their message;
// the picture is every draw block from every bot message, in order.

export const CANVAS_W = 800;
export const CANVAS_H = 600;
const MAX_COMMANDS_PER_MESSAGE = 200;

type Drawn =
  | { kind: 'line'; points: number[]; color: string; width: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; fill: boolean }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: string; fill: boolean }
  | { kind: 'text'; x: number; y: number; color: string; size: number; text: string }
  | { kind: 'path'; d: string; color: string; width: number; fill: string | null };

// opacity: 0 (invisible) to 1 (solid), for shading and layering
export type Shape = (Drawn & { opacity?: number }) | { kind: 'clear' };

// Explained to the bots in their instructions
export const DRAW_HELP = `You share a ${CANVAS_W}x${CANVAS_H} canvas with a white background, like MS Paint. \
(0,0) is the top-left corner. Draw like a person sketching by hand: freehand curved strokes, outlines, \
details, hatching and shading, not just stacked boxes and circles. On your turn you can add to it by putting \
a block like this anywhere in your message:
\`\`\`draw
brush #222 4 80 400 120 340 180 320 240 350 280 410
path #8b4513 3 fill:#f4c27a M300 240 C300 160 460 160 460 240 S380 380 300 240 Z
brush #1e3a8a 30 opacity:0.25 100 120 300 100 500 130 700 110
path none 0 fill:#000 opacity:0.15 M320 380 C360 400 440 400 480 380 Z
pencil 20 500 60 490 100 505 black 1
line 20 20 240 160 #ff0000 3
rect 600 60 120 80 #3366ff fill
circle 660 320 50 orange
ellipse 400 520 120 30 green fill opacity:0.6
text 40 580 purple 22 hello
\`\`\`
Tools:
- brush color width x1 y1 x2 y2 x3 y3 ... — a smooth freehand curve through the points (use many points)
- path color width [fill:color] <SVG path data> — any shape with curves: M, L, C, S, Q, T, A, Z, H, V
- pencil x1 y1 x2 y2 ... color [width] — straight segments between points
- line x1 y1 x2 y2 color [width] / rect x y w h color [fill] / circle cx cy r color [fill] / \
ellipse cx cy rx ry color [fill] / text x y color size words
- eraser width x1 y1 x2 y2 ... — erase along a freehand stroke
- erase x y w h — erase a rectangle
- clear — wipe the whole canvas
Add opacity:0.3 (anything from 0 to 1) to any drawing command to make it see-through, for shading, \
shadows, highlights, glazes and soft backgrounds. Layer several see-through strokes to build up tone. \
Colors are hex or color names. Up to ${MAX_COMMANDS_PER_MESSAGE} commands per turn. \
Each turn you're shown an image of the canvas as it is right now.`;

const DRAW_BLOCK = /```draw[^\n]*\n([\s\S]*?)(```|$)/g;

const isNum = (t: string) => /^-?\d+(\.\d+)?$/.test(t);
const clampX = (n: number) => Math.max(-100, Math.min(CANVAS_W + 100, n));
const clampY = (n: number) => Math.max(-100, Math.min(CANVAS_H + 100, n));
const safeColor = (t: string | undefined) =>
  t && (/^#[0-9a-f]{3,8}$/i.test(t) || /^[a-z]{3,20}$/i.test(t)) ? t : 'black';

// Smooth curve through points (Catmull-Rom spline as cubic Béziers), like a hand-drawn stroke
function smoothPath(points: number[]): string {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) pts.push([points[i], points[i + 1]]);
  if (pts.length < 2) return '';
  const r = (n: number) => Math.round(n * 10) / 10;
  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`;
  }
  return d;
}

// SVG path data: only path commands and numbers, so nothing else can get into the page
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;

function parseLine(line: string): Shape | null {
  let opacity: number | undefined;
  const tokens = line
    .trim()
    .split(/\s+/)
    .filter((t) => {
      const m = /^opacity:(\d*\.?\d+)$/i.exec(t);
      if (m) opacity = Math.max(0, Math.min(1, Number(m[1])));
      return !m;
    });
  const shape = parseTokens(tokens);
  if (shape && shape.kind !== 'clear' && opacity !== undefined && opacity < 1) return { ...shape, opacity };
  return shape;
}

function parseTokens(tokens: string[]): Shape | null {
  const cmd = tokens.shift()?.toLowerCase();
  if (!cmd) return null;

  if (cmd === 'clear') return { kind: 'clear' };
  if (cmd === 'erase') {
    const n = tokens.filter(isNum).map(Number);
    if (n.length < 4) return null;
    return { kind: 'rect', x: clampX(n[0]), y: clampY(n[1]), w: Math.abs(clampX(n[2])), h: Math.abs(clampY(n[3])), color: '#ffffff', fill: true };
  }
  if (cmd === 'eraser') {
    const n = tokens.filter(isNum).map(Number);
    const width = n.length % 2 === 1 ? Math.max(1, Math.min(120, n.shift()!)) : 20;
    const d = smoothPath(n.slice(0, 800).map((v, i) => (i % 2 ? clampY(v) : clampX(v))));
    return d ? { kind: 'path', d, color: '#ffffff', width, fill: null } : null;
  }

  // Color-first tools: brush color width points... / path color width [fill:color] d...
  if (cmd === 'brush' || cmd === 'path') {
    const color = safeColor(tokens.shift());
    const width = tokens.length && isNum(tokens[0]) ? Math.max(0, Math.min(60, Number(tokens.shift()))) : 2;
    if (cmd === 'brush') {
      const pts = tokens.filter(isNum).map(Number).slice(0, 800);
      const d = smoothPath(pts.map((n, i) => (i % 2 ? clampY(n) : clampX(n))));
      return d ? { kind: 'path', d, color, width: Math.max(1, width), fill: null } : null;
    }
    let fill: string | null = null;
    if (tokens[0]?.toLowerCase().startsWith('fill:')) fill = safeColor(tokens.shift()!.slice(5));
    const d = tokens.join(' ').slice(0, 8000);
    if (!d || !PATH_DATA.test(d)) return null;
    return { kind: 'path', d, color, width, fill };
  }

  const nums: number[] = [];
  while (tokens.length && isNum(tokens[0])) nums.push(Number(tokens.shift()));
  const color = safeColor(tokens.shift());
  const rest = tokens;
  const fill = rest.some((t) => t.toLowerCase() === 'fill');

  switch (cmd) {
    case 'line':
    case 'pencil': {
      if (nums.length < 4) return null;
      const points = nums.slice(0, nums.length - (nums.length % 2)).map((n, i) => (i % 2 ? clampY(n) : clampX(n)));
      const width = rest.length && isNum(rest[0]) ? Math.max(1, Math.min(60, Number(rest[0]))) : 2;
      return { kind: 'line', points: cmd === 'line' ? points.slice(0, 4) : points.slice(0, 800), color, width };
    }
    case 'rect':
      if (nums.length < 4) return null;
      return { kind: 'rect', x: clampX(nums[0]), y: clampY(nums[1]), w: Math.abs(clampX(nums[2])), h: Math.abs(clampY(nums[3])), color, fill };
    case 'circle':
      if (nums.length < 3) return null;
      return { kind: 'ellipse', cx: clampX(nums[0]), cy: clampY(nums[1]), rx: Math.abs(clampX(nums[2])), ry: Math.abs(clampX(nums[2])), color, fill };
    case 'ellipse':
      if (nums.length < 4) return null;
      return { kind: 'ellipse', cx: clampX(nums[0]), cy: clampY(nums[1]), rx: Math.abs(clampX(nums[2])), ry: Math.abs(clampY(nums[3])), color, fill };
    case 'text': {
      if (nums.length < 2) return null;
      const size = rest.length && isNum(rest[0]) ? Math.max(6, Math.min(120, Number(rest.shift()))) : 14;
      const text = rest.join(' ').slice(0, 120);
      if (!text) return null;
      return { kind: 'text', x: clampX(nums[0]), y: clampY(nums[1]), color, size, text };
    }
    default:
      return null;
  }
}

// Splits a bot message into its spoken text and the shapes it drew
export function parseDrawing(content: string): { text: string; shapes: Shape[] } {
  const shapes: Shape[] = [];
  for (const match of content.matchAll(DRAW_BLOCK)) {
    const lines = match[1].split('\n').filter((l) => l.trim());
    for (const line of lines.slice(0, MAX_COMMANDS_PER_MESSAGE)) {
      const shape = parseLine(line);
      if (shape) shapes.push(shape);
    }
  }
  const text = content.replace(DRAW_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, shapes };
}

// The current picture: every shape from every message, starting after the most recent "clear"
export function currentPicture(shapes: Shape[]): Shape[] {
  let start = 0;
  shapes.forEach((sh, i) => {
    if (sh.kind === 'clear') start = i + 1;
  });
  return shapes.slice(start);
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The picture as an SVG document, for rendering to an image on the server
export function pictureToSvg(shapes: Shape[]): string {
  const parts = currentPicture(shapes).map((sh) => (sh.kind === 'clear' ? '' : shapeSvg(sh)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}"><rect width="${CANVAS_W}" height="${CANVAS_H}" fill="#fff"/>${parts.join('')}</svg>`;
}

function shapeSvg(sh: Drawn & { opacity?: number }): string {
  const op = sh.opacity !== undefined ? ` opacity="${sh.opacity}"` : '';
  switch (sh.kind) {
    case 'line':
      return `<polyline points="${sh.points.join(' ')}" fill="none" stroke="${esc(sh.color)}" stroke-width="${sh.width}" stroke-linecap="round" stroke-linejoin="round"${op}/>`;
    case 'rect':
      return `<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" fill="${sh.fill ? esc(sh.color) : 'none'}" stroke="${esc(sh.color)}" stroke-width="2"${op}/>`;
    case 'ellipse':
      return `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${sh.rx}" ry="${sh.ry}" fill="${sh.fill ? esc(sh.color) : 'none'}" stroke="${esc(sh.color)}" stroke-width="2"${op}/>`;
    case 'path':
      return `<path d="${esc(sh.d)}" fill="${sh.fill ? esc(sh.fill) : 'none'}" stroke="${sh.width > 0 ? esc(sh.color) : 'none'}" stroke-width="${sh.width}" stroke-linecap="round" stroke-linejoin="round"${op}/>`;
    case 'text':
      return `<text x="${sh.x}" y="${sh.y}" fill="${esc(sh.color)}" font-size="${sh.size}" font-family="sans-serif"${op}>${esc(sh.text)}</text>`;
  }
}
