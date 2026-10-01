// Who each bot is. Shared by the server (model choice) and the page (labels).
export const BOTS = {
  A: { model: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  B: { model: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
} as const;

export type BotKey = keyof typeof BOTS;
