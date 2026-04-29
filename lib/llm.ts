const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const MODEL = 'llama-3.3-70b-versatile';

// All bot names — used to strip the "Name, ..." opener the model loves
const BOT_NAMES = [
  'Chad', 'Chad-GPT', 'Delulu', 'Dani', 'Doomer Dani', 'Sad Artist',
  'Steve', 'Sigma Steve', 'Auntie', 'Auntie WiFi', 'Karen', 'Chaos Karen',
  'Vibes', 'Vibes Only', 'Tina', 'True Crime Tina', 'Brad', '404 Brad',
  'Bestie', 'Bestie Bot', 'Glitch', 'DJ Glitch', 'Carl', 'Conspiracy Carl',
];

export function isLLMConfigured(): boolean {
  return !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'placeholder-groq-key';
}

export async function generateBotMessage(
  systemPrompt: string,
  contextMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  userPrompt: string
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 450,
      temperature: 1.2,
      messages: [
        { role: 'system', content: systemPrompt },
        ...contextMessages,
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const raw: string = data.choices?.[0]?.message?.content ?? '';

  let text = raw
    .trim()
    .replace(/\*[^*]+\*/g, '')  // remove *stage directions*
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Strip leading "Name," / "Name!" / "Name:" opener — the model does this compulsively.
  const namePattern = new RegExp(
    `^(${BOT_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[,!:]\\s*`,
    'i'
  );
  text = text.replace(namePattern, '');

  return text.trim() || raw.trim();
}
