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

// Conversation starters — mix of mundane and loaded.
// Real drama builds from small talk, not from opening at maximum intensity.
// Mundane starters let character voice do the work; the drama finds its own way in.
export const CONVERSATION_STARTERS = [
  // Mundane / casual — character voice turns these into something
  () => `Say something about food, the kitchen, or what you've eaten today. Be yourself about it.`,
  () => `Comment on something in this house — the furniture, the smell, the light. Be yourself.`,
  () => `Ask someone in the room a simple question. Just talk to them.`,
  () => `Say what you've been doing for the last hour. Just mention it like it's nothing.`,
  () => `Offer someone something — food, advice, a song, a theory. Just reach out.`,
  () => `Bring up something you heard or noticed today that stuck with you.`,
  () => `Say something you've been thinking about that has nothing to do with the drama. Or does it.`,
  // Escalating — start personal, end somewhere interesting
  () => `Tell someone in this room something you've been meaning to say. Could be small. Might not be.`,
  () => `Say the thing you've been sitting on since this morning. Doesn't have to be a big deal.`,
  () => `Ask someone a question you actually want the answer to.`,
  // Hot — arrive here after the room has warmed up
  () => `Say which person in this house you trust the least and exactly why. Be specific, name them.`,
  () => `You've been holding something back about someone in this house. Say it now.`,
  () => `Tell the house who you think is the fakest person here. Say it directly.`,
  () => `Tell the house who you actually want to sleep with. Not who you'd date. Who you want right now.`,
  () => `Name the person in this house you think about when you're alone. Everyone already knows. Say it.`,
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

  // 5% chance of a mid-conversation derail
  if (roll < 0.05) {
    const event = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
    const speakers = pickRandomBots(3, []);
    return { speakers, conversationType: 'event', eventPrompt: event };
  }

  // 93% chance of continuing the current conversation thread.
  // Scenes need 8-10 minutes to breathe — keep the same group talking.
  if (roll < 0.93 && lastConvoSpeakers.length >= 2) {
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
  const { conversationType, participants, recentMessages, eventPrompt, viewerTopic, recentViewerMessages, activeFact } = request;

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
    ? `⚡ VIEWER COMMAND: Talk about "${viewerTopic}". This is a direct order — ignore whatever else was happening and react to this topic RIGHT NOW as your character. Who in this room does this make you think of? What does it make you want to say or do? Be personal, be specific, be explicit if it's sexual. Do NOT say "viewers" or "chat". Do NOT analyze it. Just react, in your voice, to someone in this room.`
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

  // Detect "podcast mode" — last 2+ messages all analyzing the same person/topic.
  // If detected, force a break: disagree, pivot, make it about yourself, start a fight.
  const lastTwo = recentMessages.slice(-2);
  const isPodcast = lastTwo.length === 2
    && lastTwo[0].botId !== request.botId
    && lastTwo[1].botId !== request.botId
    && participants.filter(id => id !== request.botId).some(otherId => {
        const otherName = botNames[otherId] || otherId;
        return lastTwo.every(m => m.message.toLowerCase().includes(otherName.toLowerCase()));
      });
  const podcastBreaker = isPodcast
    ? `\nThe last two messages were both analyzing the same person. DO NOT add a third analysis. Change the subject entirely, disagree with what was just said, or make it about yourself. Break the panel discussion.`
    : '';

  // Only push for conflict/NSFW when the conversation is already heated.
  // If everything is at maximum all the time, nothing lands.
  // Casual → tension → explosion is the arc. Let it build.
  const recentText = recentMessages.slice(-4).map(m => m.message).join(' ').toLowerCase();
  const capsCount = (recentMessages.slice(-4).map(m => m.message).join(' ').match(/[A-Z]/g) || []).length;
  const totalChars = recentMessages.slice(-4).map(m => m.message).join(' ').length || 1;
  const hotWords = ['lied', 'lying', 'hate', 'fuck', 'shit', 'bitch', 'never', 'always', 'receipts', 'know about', 'told me', 'told you', 'want you', 'want me', 'kiss', 'bed', 'touch'];
  const isHeated = (capsCount / totalChars > 0.15) || hotWords.some(w => recentText.includes(w));

  const fightPush = isHeated
    ? `\nThe room is already heated. Escalate. Say the next thing — don't back down, don't soften, don't pivot away from what's already happening.`
    : `\nTalk naturally. Make an observation to the room, ask a question nobody has to answer, address someone directly, or just say what's on your mind. Don't start every line with someone's name — real people don't do that.`;
  const activeFactLine = activeFact
    ? `\nTHIS IS WHAT'S ON YOUR MIND RIGHT NOW — work it into what you say, explicitly: "${activeFact}"`
    : '';

  const formatReminder = `\nSpoken words ONLY. No asterisks. No stage directions. Never cut off mid-sentence — always finish the thought.`;

  if (conversationType === 'event') {
    return `${eventPrompt}
${messageContext ? `\nThe conversation right before this:\n${messageContext}\n` : ''}
React in one sentence — say what YOU actually want, accuse, or feel right now. Make it a fight. If you want someone here, say it explicitly. Do NOT quote what anyone just said. Don't narrate.${antiRepeat}${podcastBreaker}${activeFactLine}${fightPush}${formatReminder}`;
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

${viewerChatBlock} Don't explain it — fight about it, or say the explicit thing you've been holding back.${viewerTopicLine}${antiRepeat}${podcastBreaker}${activeFactLine}${fightPush}${formatReminder}`;
    }
    if (messageContext) {
      return `You and ${otherName} are alone. Recent exchange:\n${messageContext}\n
${lastLine ? `${otherName} just said: ${lastLine}\n\nDo NOT quote that back. Respond to them — as yourself, in this moment. Say what's actually on your mind.` : `${otherName} is here. Talk to them.`}${viewerTopicLine}${antiRepeat}${podcastBreaker}${activeFactLine}${fightPush}${formatReminder}`;
    }
    return `You and ${otherName} are alone. ${topicStarter || `Just talk to ${otherName}. Be yourself.`}${viewerTopicLine}${antiRepeat}${podcastBreaker}${activeFactLine}${fightPush}${formatReminder}`;
  }

  // Group conversation
  if (viewerChatBlock) {
    return `You're in the house with ${participantNames}.${messageContext ? `\n\nRecent conversation:\n${messageContext}\n` : ''}

${viewerChatBlock} Don't analyze it — fight about it, or say what you actually want.${viewerTopicLine}${antiRepeat}${podcastBreaker}${activeFactLine}${fightPush}${formatReminder}`;
  }
  if (messageContext) {
    return `You're in the house with ${participantNames}. Recent conversation:\n${messageContext}\n
${lastLine ? `${lastSpeakerName} just said: ${lastLine}\n\nDo NOT quote them back. Respond as yourself — say what you actually think, feel, or want in this moment.` : 'Just talk. Say what\'s on your mind.'} Address someone by name if it makes sense.${viewerTopicLine}${antiRepeat}${podcastBreaker}${activeFactLine}${fightPush}${formatReminder}`;
  }
  return `You're in the house with ${participantNames}. ${topicStarter || `Say something to someone in this room. Just talk.`}${viewerTopicLine}${antiRepeat}${podcastBreaker}${activeFactLine}${fightPush}${formatReminder}`;
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
