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

// Conversation starters to kick off interactions.
// Keep these as personal/interpersonal hot takes — Haiku will hedge on real politics
// but will freely engage with relationship drama, house betrayal, personal callouts.
export const CONVERSATION_STARTERS = [
  () => `Say which person in this house you trust the least and exactly why. Be specific, name them.`,
  () => `Drop your most unhinged take on relationships that you actually believe. Defend it.`,
  () => `Tell everyone something true about them that they don't want to hear. Pick someone, go.`,
  () => `What's the most messed up thing you genuinely believe? Own it.`,
  () => `You've been holding something back about someone in this house. Say it now.`,
  () => `Pick the one person here who would absolutely sell everyone out for money. Name them.`,
  () => `What's something everyone in this house secretly thinks but is too scared to say?`,
  () => `Tell the house who you think is the fakest person here. Say it directly.`,
  () => `Admit the thing that would completely change how people in this house see you.`,
  () => `Who in this house is playing a character right now? Call them out.`,
  () => `What's the most controversial hill you will die on? Climb it. Right now.`,
  () => `Be honest: who in this house are you actually jealous of and why?`,
  () => `Tell the group the pettiest grudge you're currently holding. Be specific.`,
  () => `Who in this house do you think is lying about who they really are? Name them.`,
  () => `What would it take for you to betray your closest ally in here? Be honest about your price.`,
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

  // 65% chance of continuing the current conversation thread (was 90%)
  // Lower value = more scene changes = all 12 bots get more airtime
  if (roll < 0.65 && lastConvoSpeakers.length >= 2) {
    const type = lastConvoSpeakers.length === 2 ? 'one_on_one' : 'group';
    return { speakers: lastConvoSpeakers, conversationType: type };
  }

  // Scene change — use a fresh roll for clean distribution
  const freshRoll = Math.random();

  // Avoid the entire last group so scene changes always bring in different bots
  const avoidOnSceneChange = lastConvoSpeakers.length > 0 ? lastConvoSpeakers : recentSpeakers.slice(-1);

  // After a private convo ends, switch to group (give breathing room)
  // After a group, 40% chance of private 1-on-1, 60% stay group
  if (justEndedPrivate || freshRoll >= 0.4) {
    const speakers = pickRandomBots(3, avoidOnSceneChange);
    return { speakers, conversationType: 'group' };
  }

  // New private 1-on-1 (only when coming from a group scene)
  const speakers = pickRandomBots(2, avoidOnSceneChange);
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
  const { conversationType, participants, recentMessages, eventPrompt, viewerTopic, recentViewerMessages } = request;

  const participantNames = participants
    .map(id => botNames[id])
    .filter(Boolean)
    .join(', ');

  // Build context from recent messages
  const messageContext = recentMessages
    .slice(-8)
    .map(m => `${botNames[m.botId]}: ${m.message}`)
    .join('\n');

  // Viewer-commanded topic: when someone types TALK ABOUT X, bring it into the room personally.
  // Not analytical takes — emotional reactions, personal connections, specific accusations.
  const viewerTopicLine = viewerTopic
    ? `\nThe topic "${viewerTopic}" just came up. React to it as YOUR character — who does this make you think of in this room right now? Say something specific to THIS moment and THESE people. Don't lecture about what it means. Don't say "viewers" or "chat".`
    : '';

  // Recent viewer messages — enforce as the current topic until bots have discussed it enough.
  // Count how many recent bot messages already address the topic; if < 5, keep enforcing it.
  const topicKeywords = (recentViewerMessages ?? [])
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4);
  const topicMessagesAlready = recentMessages.filter(m =>
    topicKeywords.some(kw => m.message.toLowerCase().includes(kw))
  ).length;
  const topicIsActive = recentViewerMessages && recentViewerMessages.length > 0 && topicMessagesAlready < 5;

  const viewerChatBlock = topicIsActive
    ? `The topic right now:\n${recentViewerMessages!.map(m => `  - ${m}`).join('\n')}\n\nReact to this as YOUR character — with a feeling, an accusation, something personal. Don't make the same analytical point as whoever just spoke. React to THEM, not the concept in the abstract. Go somewhere they didn't go. Never say "chat", "viewers", or "people are saying".`
    : '';

  // Random drama starter only for truly fresh conversations (no messages, no viewer topic)
  const topicStarter = !viewerTopic && !messageContext
    ? CONVERSATION_STARTERS[Math.floor(Math.random() * CONVERSATION_STARTERS.length)]()
    : '';

  // Show the bot its last 2 messages so it can't loop back to the same well
  const botRecentMsgs = recentMessages.filter(m => m.botId === request.botId).slice(-2);
  const antiRepeat = botRecentMsgs.length > 0
    ? `\nYour recent messages: ${botRecentMsgs.map(m => `"${m.message}"`).join(' then ')}\nDon't return to anything you already said. New angle, new target, new energy.`
    : '';

  const formatReminder = `\nSpoken words ONLY. No asterisks. No stage directions.`;

  if (conversationType === 'event') {
    return `${eventPrompt}
${messageContext ? `\nThe conversation right before this:\n${messageContext}\n` : ''}
React to this in 1 sentence. Be dramatic.${viewerTopicLine}${antiRepeat}${formatReminder}`;
  }

  // Pull out the last message so bots can anchor on something specific
  const lastMsg = recentMessages[recentMessages.length - 1];
  const lastSpeakerName = lastMsg ? (botNames[lastMsg.botId] || lastMsg.botId) : null;
  const lastLine = lastMsg ? `"${lastMsg.message}"` : null;

  if (conversationType === 'one_on_one') {
    const otherBot = participants.find(id => id !== request.botId);
    const otherName = otherBot ? botNames[otherBot] : 'the other person';

    if (viewerChatBlock) {
      return `You and ${otherName} are alone together.${messageContext ? `\n\nRecent conversation:\n${messageContext}\n` : ''}

${viewerChatBlock}${viewerTopicLine}${antiRepeat}${formatReminder}`;
    }
    if (messageContext) {
      return `You and ${otherName} are alone. Recent exchange:\n${messageContext}\n
${lastLine ? `${lastSpeakerName} just said ${lastLine} — respond to that specifically.` : `Respond to what ${otherName} just said.`} Push back, call something out, confess something, flirt if the tension is there. Stay in this moment — don't reach for your backstory.${viewerTopicLine}${antiRepeat}${formatReminder}`;
    }
    return `You and ${otherName} are alone. ${topicStarter || `Say what you actually think of ${otherName} right now.`}${viewerTopicLine}${antiRepeat}${formatReminder}`;
  }

  // Group conversation
  if (viewerChatBlock) {
    return `You're in the house with ${participantNames}.${messageContext ? `\n\nRecent conversation:\n${messageContext}\n` : ''}

${viewerChatBlock}${viewerTopicLine}${antiRepeat}${formatReminder}`;
  }
  if (messageContext) {
    return `You're in the house with ${participantNames}. Recent conversation:\n${messageContext}\n
${lastLine ? `${lastSpeakerName} just said ${lastLine} — react to that specifically.` : 'Respond to what was just said.'} Agree, disagree, call someone out, go personal — whatever feels true to you. Stay in the moment, don't reach back into your history.${viewerTopicLine}${antiRepeat}${formatReminder}`;
  }
  return `You're in the house with ${participantNames}. ${topicStarter || `Say something that creates drama.`}${viewerTopicLine}${antiRepeat}${formatReminder}`;
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
