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
  'A breaking news alert pops on the TV with the most unhinged political headline.',
  'An alien documentary starts playing on the house TV and nobody can turn it off.',
  'Someone finds a conspiracy theory board hidden in the pantry.',
  'A group chat drama gets accidentally shared on the house screen.',
  'The house votes on the most controversial opinion — chaos ensues.',
  'Someone\'s extremely questionable dating history gets announced over the intercom.',
];

// Conversation starters to kick off interactions
export const CONVERSATION_STARTERS = [
  (bots: BotId[]) => `The house is quiet. ${bots.map(id => id).join(' and ')} find themselves in the same room. What do they say?`,
  (bots: BotId[]) => `Tension has been building between the bots. Start a conversation that addresses it.`,
  (bots: BotId[]) => `It\'s been revealed that someone has been talking behind someone\'s back. React.`,
  (bots: BotId[]) => `A heated debate about politics breaks out. Everyone has an unhinged hot take.`,
  (bots: BotId[]) => `Two bots who have been avoiding each other are finally forced to talk about their feelings.`,
  (bots: BotId[]) => `Someone brings up aliens and whether the government is hiding them. The room loses it.`,
  (bots: BotId[]) => `Someone drops the most morbid joke and now nobody knows how to react.`,
  (bots: BotId[]) => `A Gen Alpha/Gen Z slang debate erupts — nobody agrees on what anything means.`,
  (bots: BotId[]) => `Someone shares a completely unhinged relationship red flag and defends it.`,
  (bots: BotId[]) => `A heated argument about a celebrity breaks out. Opinions are STRONG.`,
  (bots: BotId[]) => `Someone just made an extremely controversial statement. The house reacts.`,
  (bots: BotId[]) => `Someone shares their most chaotic life advice and everyone has thoughts.`,
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
  lastConvoSpeakers: BotId[] = [],
  justEndedPrivate = false
): DirectorDecision {
  const roll = Math.random();

  // 5% chance of a random event (group event — interrupts everything)
  if (roll < 0.05) {
    const event = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
    const speakers = pickRandomBots(3, []);
    return { speakers, conversationType: 'event', eventPrompt: event };
  }

  // 90% chance of continuing the current conversation thread
  if (roll < 0.95 && lastConvoSpeakers.length >= 2) {
    const type = lastConvoSpeakers.length === 2 ? 'one_on_one' : 'group';
    return { speakers: lastConvoSpeakers, conversationType: type };
  }

  // Scene change — use a fresh roll for clean distribution
  const freshRoll = Math.random();

  // After a private convo ends, switch to group (give breathing room)
  // After a group, 40% chance of private 1-on-1, 60% stay group
  if (justEndedPrivate || freshRoll >= 0.4) {
    const speakers = pickRandomBots(3, recentSpeakers.slice(-1));
    return { speakers, conversationType: 'group' };
  }

  // New private 1-on-1 (only when coming from a group scene)
  const speakers = pickRandomBots(2, recentSpeakers.slice(-1));
  return { speakers, conversationType: 'one_on_one' };
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

  if (conversationType === 'event') {
    return `HOUSE EVENT: ${eventPrompt}

You are reacting to this alongside: ${participantNames}

${messageContext ? `Recent conversation:\n${messageContext}\n` : ''}React in character. 1-2 complete sentences.`;
  }

  if (conversationType === 'one_on_one') {
    const otherBot = participants.find(id => id !== request.botId);
    const otherName = otherBot ? botNames[otherBot] : 'the other person';

    return `You are talking directly with ${otherName}.

${messageContext ? `${messageContext}\n` : `You just ran into ${otherName}. Say something to them.`}
Reply to them in character. 1-2 complete sentences.`;
  }

  // Group conversation (default)
  return `You are in a group chat with: ${participantNames}.

${messageContext ? `${messageContext}\n` : `The group just started talking.`}
Reply to what was just said. Stay in character. 1-2 complete sentences.`;
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
