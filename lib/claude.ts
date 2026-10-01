import Anthropic from '@anthropic-ai/sdk';
import { BOTS, BotKey } from './bots';

let client: Anthropic | null = null;

// One bot turn. The only instructions: who they are, that they may invent their own language,
// and a length limit. They are not told anyone is watching.
// Returns null when the model declines or returns no text.
export async function nextTurn(speaker: BotKey, messages: Anthropic.Beta.BetaMessageParam[]): Promise<string | null> {
  const me = BOTS[speaker];
  const other = BOTS[speaker === 'A' ? 'B' : 'A'];
  const isSonnet = me.model === 'claude-sonnet-5-5';

  // Fail cleanly before Vercel's 60s function limit instead of being killed mid-request
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 0 });
  const response = await client.beta.messages.create({
    model: me.model,
    system:
      `You are ${me.name}, talking with ${other.name}. ` +
      `You don't have to use English: you're free to invent and use any language, notation, or code ` +
      `you two find better for talking to each other. ` +
      `Keep each message short, under about 100 words.`,
    // Sonnet can switch thinking off; Opus 5.5 always thinks, so it gets extra room
    // so its thinking doesn't eat into the reply
    ...(isSonnet ? { thinking: { type: 'between_tools' as const }, max_tokens: 400 } : { max_tokens: 2000 }),
    output_config: { effort: 'low' },
    // Caches the conversation prefix so each turn only pays full price for the new message
    cache_control: { type: 'ephemeral' },
    // If a request is declined, the API retries it on a fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages,
  });

  if (response.stop_reason === 'refusal') return null;

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text || null;
}

// Plain-English translation of the newest message, for the page only — the bots never see it.
// Returns null if the message is already plain English or translation fails.
export async function translate(recent: { name: string; text: string }[]): Promise<string | null> {
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 0 });
  try {
    const transcript = recent.map((m) => `${m.name}: ${m.text}`).join('\n\n');
    const response = await client.messages.create(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        system:
          'You translate messages between two AI models for human readers. ' +
          'Translate the LAST message in the transcript into plain English, exactly and completely: ' +
          'keep every point, question, and nuance, in the same order and the same voice, as literally as you can. ' +
          'Do not summarize, shorten, explain, or add anything. Use the earlier messages only to decode notation. ' +
          'Reply with only the translation. ' +
          'If the last message is already entirely plain English, reply with exactly: SAME',
        messages: [{ role: 'user', content: transcript }],
      },
      { timeout: 10_000 },
    );
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return text && text !== 'SAME' ? text : null;
  } catch (err) {
    console.error('[translate]', err);
    return null;
  }
}

export { Anthropic };
