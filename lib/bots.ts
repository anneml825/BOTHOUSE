// Who each bot is. Shared by the server (model choice) and the page (labels).
export const BOTS = {
  A: { model: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  B: { model: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
} as const;

export type BotKey = keyof typeof BOTS;

// Messages from an earlier version end with a translation line starting with this mark
export const GLOSS_MARK = '↳';

// Splits off that old translation line, if present
export function splitGloss(content: string): { body: string; gloss: string | null } {
  const at = content.lastIndexOf(`\n${GLOSS_MARK}`);
  if (at === -1) return { body: content, gloss: null };
  return {
    body: content.slice(0, at).trim(),
    gloss: content.slice(at + 1 + GLOSS_MARK.length).trim(),
  };
}

