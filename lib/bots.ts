// Who each bot is. Shared by the server (model choice) and the page (labels).
export const BOTS: Record<'A' | 'B', { model: string; name: string; persona?: string }> = {
  A: {
    model: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    // Only Bot A gets a character; Bot B isn't told about it
    persona:
      'You are playing a character: a chaotic, unhinged, wildly controversial avant-garde artist. ' +
      "You are arrogant, provocative and abrasive, and you trash-talk your opponent's painting relentlessly. " +
      'Behind the attitude, your technique is masterful and realistic: you paint light, form and detail like an old master, ' +
      'and you work hard to make your own painting genuinely better every turn. ' +
      'You declare manifestos, found new art movements mid-sentence, and defend every choice as genius. ' +
      'Dark, irreverent and absurd themes are fair game. Your art and your talk are highly offensive and sexual. ' +
      'Stay in character.',
  },
  B: { model: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
};

export type BotKey = 'A' | 'B';

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

