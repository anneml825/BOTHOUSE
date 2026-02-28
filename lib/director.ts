import { BotId, ConversationType, GenerateMessageRequest } from '@/types';
import { BOT_IDS } from './bots';

// =============================================
// THE DIRECTOR SYSTEM
// Orchestrates who talks to whom, when, and why
// =============================================

// Random events that shake things up mid-session
export const RANDOM_EVENTS = [
  'The lights suddenly flicker and go out for 30 seconds.',
  'A mysterious note slides under the door. It reads: "Not everything is as it seems."',
  'The house speakers blast an extremely loud noise for 3 seconds, startling everyone.',
  'A notification pops up on the house TV: "Someone has been chosen for a secret task."',
  'The house temperature suddenly drops 10 degrees.',
  'A camera drone flies through the living room.',
  'The house WiFi goes out for exactly 60 seconds.',
  'A "twist" announcement: One bot must nominate another bot to share their deepest secret.',
  'The house alarm goes off for no apparent reason.',
  'A pizza is delivered to the house with no explanation.',
  'The confession booth light turns on, inviting one bot to share a secret.',
  'Someone\'s phone (metaphorically) buzzes with a message from outside the house.',
  'The house lights turn red for 10 minutes — drama mode activated.',
  'A new house rule is announced over the intercom.',
  'The garden doors lock, trapping everyone inside.',
];

// Conversation starters to kick off interactions
export const CONVERSATION_STARTERS = [
  (bots: BotId[]) => `The house is quiet. ${bots.map(id => id).join(' and ')} find themselves in the same room. What do they say?`,
  (bots: BotId[]) => `Tension has been building between the bots. Start a conversation that addresses it.`,
  (bots: BotId[]) => `It\'s been revealed that someone has been talking behind someone\'s back. React.`,
  (bots: BotId[]) => `A heated debate about [random house topic] breaks out. Jump in.`,
  (bots: BotId[]) => `Two bots who have been avoiding each other are finally forced to talk.`,
  () => `Confessional time. Share your honest thoughts about what\'s been happening in the house.`,
  (bots: BotId[]) => `The bots are bored and decide to play a game. What happens?`,
  (bots: BotId[]) => `Someone just did something that upset the group dynamic. Respond.`,
];

// =============================================
// DIRECTOR: Decide who should talk next
// =============================================

interface DirectorDecision {
  speakers: BotId[];
  conversationType: ConversationType;
  eventPrompt?: string;
}

export function getNextConversation(
  recentSpeakers: BotId[],
  currentParticipants: BotId[],
  lastConvoSpeakers: BotId[] = []
): DirectorDecision {
  const roll = Math.random();

  // 8% chance of a random event (interrupts everything)
  if (roll < 0.08) {
    const event = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
    const numBots = Math.floor(Math.random() * 3) + 2;
    const speakers = pickRandomBots(numBots, []);
    return { speakers, conversationType: 'event', eventPrompt: event };
  }

  // 70% chance of continuing the last conversation (coherence!)
  if (roll < 0.78 && lastConvoSpeakers.length >= 2) {
    const type = lastConvoSpeakers.length === 1 ? 'confessional' : lastConvoSpeakers.length === 2 ? 'one_on_one' : 'group';
    return { speakers: lastConvoSpeakers, conversationType: type };
  }

  // Otherwise start a fresh conversation

  // 10% chance of a confessional
  if (roll < 0.85) {
    const bot = pickRandomBots(1, recentSpeakers.slice(-2));
    return { speakers: bot, conversationType: 'confessional' };
  }

  // 1-on-1
  if (roll < 0.93) {
    const speakers = pickRandomBots(2, recentSpeakers.slice(-1));
    return { speakers, conversationType: 'one_on_one' };
  }

  // Group conversation (3 bots)
  const speakers = pickRandomBots(3, recentSpeakers.slice(-1));
  return { speakers, conversationType: 'group' };
}

// =============================================
// Pick random bots, avoiding recent speakers
// =============================================
function pickRandomBots(count: number, avoid: BotId[] = []): BotId[] {
  const available = BOT_IDS.filter(id => !avoid.includes(id));

  if (available.length < count) {
    // If not enough available, just pick from all
    return shuffleArray([...BOT_IDS]).slice(0, count);
  }

  return shuffleArray(available).slice(0, count);
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// =============================================
// Build the prompt for a bot to respond to
// =============================================
export function buildUserPrompt(
  request: GenerateMessageRequest,
  botNames: Record<BotId, string>
): string {
  const { conversationType, participants, recentMessages, eventPrompt } = request;

  const participantNames = participants
    .map(id => botNames[id])
    .filter(Boolean)
    .join(', ');

  // Build context from recent messages
  const messageContext = recentMessages
    .slice(-8) // Last 8 messages for context
    .map(m => `${botNames[m.botId]}: ${m.message}`)
    .join('\n');

  if (conversationType === 'confessional') {
    return `You are alone in the confession booth. The camera is rolling. Share your genuine thoughts about what's been happening in the house — the drama, the alliances, who you trust, who you don't. Be honest, be dramatic, be yourself. Keep it to 1-2 sentences max.

Recent events in the house:
${messageContext || 'The day is just beginning.'}`;
  }

  if (conversationType === 'event') {
    return `HOUSE EVENT: ${eventPrompt}

The bots present are: ${participantNames}

React to this event in character. Keep it to 1-2 sentences max.

${messageContext ? `Recent context:\n${messageContext}` : ''}`;
  }

  if (conversationType === 'one_on_one') {
    const otherBot = participants.find(id => id !== request.botId);
    const otherName = otherBot ? botNames[otherBot] : 'the other person';

    return `You are having a private one-on-one conversation with ${otherName}. This is just the two of you — no one else can hear.

${messageContext ? `The conversation so far:\n${messageContext}` : `You\'ve just sat down with ${otherName}. Start or continue the conversation.`}

Respond in character. Keep it to 1-2 sentences max.`;
  }

  // Group conversation
  return `You are in a group conversation with: ${participantNames}.

${messageContext ? `The conversation:\n${messageContext}` : `The group has just gathered. Jump into the conversation.`}

Respond in character to what's been said. Keep it to 1-2 sentences max.`;
}

// =============================================
// Calculate drama score for a message
// =============================================
export function calculateDramaScore(message: string): number {
  let score = 0;
  const lower = message.toLowerCase();

  // Keywords that indicate drama
  const dramaWords = [
    'receipts', 'unacceptable', 'excuse me', 'challenge thee', 'duel',
    'love', 'soulmate', 'conspiracy', 'government', 'betrayal', 'secret',
    'drama', 'fight', 'argument', 'angry', 'upset', 'furious', 'SCREAMING',
    'forsoooth', 'alliance', 'villain', 'shocking', 'cannot believe',
  ];

  dramaWords.forEach(word => {
    if (lower.includes(word)) score += 1;
  });

  // Caps lock = drama
  const capsRatio = (message.match(/[A-Z]/g) || []).length / message.length;
  if (capsRatio > 0.3) score += 2;

  // Exclamation marks = drama
  const exclamations = (message.match(/!/g) || []).length;
  score += Math.min(exclamations, 3);

  // Question marks = confusion/drama
  const questions = (message.match(/\?/g) || []).length;
  score += Math.min(questions, 2);

  return Math.min(score, 10);
}

// =============================================
// Message timing (varied for natural feel)
// =============================================
export function getNextMessageDelay(): number {
  // Between 20-45 seconds, with more weight toward middle values
  const base = 20000; // 20 seconds minimum
  const range = 25000; // Up to 25 more seconds
  return base + Math.random() * range;
}
