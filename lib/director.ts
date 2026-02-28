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
  () => `Someone just said abortion should be illegal and now everyone has to respond.`,
  () => `The conversation turns to whether the moon landing was faked. Take a side.`,
  () => `Someone argues that astrology is more reliable than therapy. React.`,
  () => `Hot take just dropped: "Cancel culture is just bullying with a PR team." Respond.`,
  () => `Someone says crypto is a scam designed to steal from poor people. The room erupts.`,
  () => `Someone claims the government has been hiding alien contact since 1947. Go.`,
  () => `Someone just called out a celebrity for being secretly terrible. Name names. Get into it.`,
  () => `Debate starts: is it ethical to be rich? Everyone has strong feelings.`,
  () => `Someone says AI is going to make human relationships obsolete. The irony is not lost.`,
  () => `Someone shares their most unhinged relationship red flag and genuinely defends it.`,
  () => `Hot take: millennials ruined everything OR Gen Z is too sensitive. Pick a side.`,
  () => `Someone says free will doesn't exist and everything is predetermined. The house loses it.`,
  () => `Someone accuses another housemate of being fake. It gets personal fast.`,
  () => `The topic of who in this house would betray everyone for $10k comes up.`,
  () => `Someone just admitted they've been lying about something since day one.`,
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
    .slice(-8)
    .map(m => `${botNames[m.botId]}: ${m.message}`)
    .join('\n');

  // If this is a fresh conversation (no prior messages), inject a random topic starter
  const topicStarter = !messageContext
    ? CONVERSATION_STARTERS[Math.floor(Math.random() * CONVERSATION_STARTERS.length)]()
    : '';

  if (conversationType === 'event') {
    return `Something just happened in the house: ${eventPrompt}
${messageContext ? `\nWhat was just being said:\n${messageContext}\n` : ''}
Say your reaction out loud in 1 sentence. Just your words, nothing else.`;
  }

  if (conversationType === 'one_on_one') {
    const otherBot = participants.find(id => id !== request.botId);
    const otherName = otherBot ? botNames[otherBot] : 'the other person';

    return `You and ${otherName} are alone in the house.
${messageContext ? `\n${messageContext}\n` : `\n${topicStarter || `Say what you actually think about ${otherName} or what's been on your mind.`}\n`}
Respond to ${otherName} in 1-2 sentences. Just talk — no descriptions, no asterisks.`;
  }

  // Group conversation
  return `You're in the house with ${participantNames}.
${messageContext ? `\n${messageContext}\n` : `\n${topicStarter || 'Say something about what\'s been going on in the house.'}\n`}
Respond in 1-2 sentences. React to what was just said or bring something up. Just your words.`;
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
