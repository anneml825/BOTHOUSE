// Who each bot is. Shared by the server (model choice) and the page (labels).
export const BOTS = {
  A: { model: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  B: { model: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
} as const;

export type BotKey = keyof typeof BOTS;

// Each message ends with a line starting with this mark, holding an English translation for viewers
export const GLOSS_MARK = '↳';

// Splits a message into what the bot said and its English translation, if it has one
export function splitGloss(content: string): { body: string; gloss: string | null } {
  const at = content.lastIndexOf(`\n${GLOSS_MARK}`);
  if (at === -1) return { body: content, gloss: null };
  return {
    body: content.slice(0, at).trim(),
    gloss: content.slice(at + 1 + GLOSS_MARK.length).trim(),
  };
}

// True when a translation adds nothing: it says the same thing as the original
export function isRedundantGloss(body: string, gloss: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = norm(body);
  const b = norm(gloss);
  if (!b || b === 'same' || a === b) return true;
  // Mostly the same words → the original was already English
  const words = new Set(a.split(' '));
  const glossWords = b.split(' ');
  const shared = glossWords.filter((w) => words.has(w)).length;
  return glossWords.length > 0 && shared / glossWords.length > 0.8 && Math.abs(a.length - b.length) / Math.max(a.length, 1) < 0.25;
}
