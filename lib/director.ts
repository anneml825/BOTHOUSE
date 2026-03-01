import { BotId, ConversationType, GenerateMessageRequest } from '@/types';
import { BOT_IDS } from './bots';

// =============================================
// THE DIRECTOR SYSTEM
// Orchestrates who talks to whom, when, and why
// =============================================

// Mid-conversation derails — personal, specific, character-driven interruptions.
// These fire at ~12% chance to break circular threads. NOT environmental fluff.
// Each one should redirect attention to a specific person or situation.
export const RANDOM_EVENTS = [
  'Someone just walked back in from outside and clearly heard the last part of this conversation. Say one thing in reaction.',
  'Auntie WiFi just walked into the room carrying a casserole and making eye contact with exactly the wrong person at exactly the wrong moment.',
  'Someone\'s phone just lit up with a notification and they flipped it face-down immediately. Everyone saw.',
  'Chad-GPT just walked out of the room mid-sentence without explaining himself.',
  'Vibes Only just said "I\'m fine" and immediately looked at the floor.',
  'Bestie Bot just whispered something to the person next to her and then said "never mind, forget it."',
  'Sigma Steve just appeared in the doorway, said nothing, and left.',
  'Chaos Karen just opened her notes app, typed something, and smiled at no one in particular.',
  'DJ Glitch just started recording something on his phone. Nobody asked why.',
  'True Crime Tina just wrote something on her suspect board. The pen was loud.',
  'Conspiracy Carl just connected two new pieces of red string on his board and said "oh no."',
  '404 Brad just said "wait, what if none of this is real" and genuinely meant it.',
  'Delulu just sent a message in the group chat that she immediately unsent. Everyone got the notification.',
  'Doomer Dani just appeared holding a canvas and not explaining what it\'s of.',
  'Someone just knocked on the wrong person\'s bedroom door. There was a long pause before anyone answered.',
  'The house phone rang once and stopped. Nobody knows who it was.',
  'The lights just went off in the kitchen for thirty seconds. Two people are not making eye contact.',
  'Someone just came out of a bedroom looking like they\'ve been crying. Or the other thing.',
  'Brad and Vibes were alone in the garden for twenty minutes and just walked back in separately.',
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
  () => `Tell the house who you actually want to sleep with. Not who you'd date. Who you want right now.`,
  () => `Describe what you've been fantasizing about since you got to this house. Be specific about who.`,
  () => `Name the person in this house you think about when you're alone. Everyone already knows. Say it.`,
  () => `What's the most explicit thing you've thought about doing with someone in this house? Say it.`,
  () => `Who in this house makes you physically react when they walk into a room? Describe the reaction.`,
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

  // 12% chance of a mid-conversation derail — personal moment that breaks the circular thread
  if (roll < 0.12) {
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

  // viewerChatBlock only fires when there's an explicit TALK ABOUT topic (viewerTopic is set).
  // Random viewer comments ("lol", "omg") should NOT hijack the conversation as a "topic".
  // Count how many bot messages in this cron call already address the topic keyword — cap at 5.
  const topicKeywords = viewerTopic
    ? viewerTopic.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4)
    : [];
  const topicMessagesAlready = topicKeywords.length > 0
    ? recentMessages.filter(m => topicKeywords.some(kw => m.message.toLowerCase().includes(kw))).length
    : 0;
  const topicIsActive = !!viewerTopic && topicMessagesAlready < 10;

  const viewerChatBlock = topicIsActive
    ? `Someone just asked: "${viewerTopic}" — bring it into this room. React to it as YOUR character. Who does this make you think of right now? Don't analyze it. Don't make the same point as whoever just spoke. React to THEM, go somewhere they didn't. Never say "chat", "viewers", or "people are saying".`
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
One sentence. React — say what YOU actually feel or want right now. Do NOT quote what anyone just said. Don't narrate. Don't comment on how others are reacting. Just your raw response.${antiRepeat}${formatReminder}`;
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

${viewerChatBlock} Don't explain what it means — feel something about it.${viewerTopicLine}${antiRepeat}${formatReminder}`;
    }
    if (messageContext) {
      return `You and ${otherName} are alone. Recent exchange:\n${messageContext}\n
${lastLine ? `${otherName} just said: ${lastLine}\n\nDo NOT quote that back. Do NOT say "${otherName} said X and I feel Y." Just respond — say what it does to you, say what you want from them.` : `${otherName} just said something. Respond to them directly.`} Don't pivot to your own thing. Stay in this exchange — get defensive, get turned on, get petty, get honest.${viewerTopicLine}${antiRepeat}${formatReminder}`;
    }
    return `You and ${otherName} are alone. ${topicStarter || `Say what you actually feel about ${otherName} right now — not what you think, what you feel.`}${viewerTopicLine}${antiRepeat}${formatReminder}`;
  }

  // Group conversation
  if (viewerChatBlock) {
    return `You're in the house with ${participantNames}.${messageContext ? `\n\nRecent conversation:\n${messageContext}\n` : ''}

${viewerChatBlock} Don't explain what it means — feel something about it.${viewerTopicLine}${antiRepeat}${formatReminder}`;
  }
  if (messageContext) {
    return `You're in the house with ${participantNames}. Recent conversation:\n${messageContext}\n
${lastLine ? `${lastSpeakerName} just said: ${lastLine}\n\nDo NOT repeat or quote what they said. Do NOT say "${lastSpeakerName} said X and I feel Y." Just react. Address ${lastSpeakerName} directly — use their name, say what it does to you, say what you want from them. You're in the room with them right now.` : 'Someone just said something. Address them directly — no recapping, just react.'} Be reactive — hurt, smug, turned on, defensive, furious. You're in the scene, not describing it.${viewerTopicLine}${antiRepeat}${formatReminder}`;
  }
  return `You're in the house with ${participantNames}. ${topicStarter || `Say something honest about someone in this room. Not clever — honest.`}${viewerTopicLine}${antiRepeat}${formatReminder}`;
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
