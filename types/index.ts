// =============================================
// BOT HOUSE - TypeScript Types
// =============================================

export type BotId =
  | 'chad-gpt'
  | 'delulu'
  | 'npc-nancy'
  | 'sigma-steve'
  | 'auntie-wifi'
  | 'chaos-karen'
  | 'vibes-only'
  | 'sir-lancelot'
  | '404-brad'
  | 'bestie-bot'
  | 'dj-glitch'
  | 'conspiracy-carl';

export type BotStatus = 'idle' | 'talking' | 'sleeping' | 'drama';

export type ConversationType = 'group' | 'one_on_one' | 'confessional' | 'event';

export type RelationshipType =
  | 'allies'
  | 'enemies'
  | 'crushing'
  | 'romantic'
  | 'friends'
  | 'rivals'
  | 'suspicious'
  | 'neutral';

export type SessionStatus = 'scheduled' | 'live' | 'ended';

export type SeasonStatus = 'upcoming' | 'active' | 'completed';

export type DramaEventType =
  | 'argument'
  | 'alliance'
  | 'love'
  | 'betrayal'
  | 'revelation'
  | 'chaos';

// =============================================
// DATABASE TYPES (matches Supabase schema)
// =============================================

export interface Bot {
  id: BotId;
  name: string;
  emoji: string;
  tagline: string;
  description: string;
  system_prompt: string;
  color: string;
  status: BotStatus;
  created_at: string;
}

export interface Season {
  id: number;
  season_number: number;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: SeasonStatus;
  created_at: string;
}

export interface LiveSession {
  id: string;
  season_id: number;
  session_number: number;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string | null;
  actual_end: string | null;
  status: SessionStatus;
  viewer_peak: number;
  highlight_moments: HighlightMoment[];
  created_at: string;
}

export interface BotMessage {
  id: string;
  session_id: string | null;
  bot_id: BotId;
  message: string;
  conversation_type: ConversationType;
  participants: BotId[];
  is_highlight: boolean;
  drama_score: number;
  created_at: string;
  // Joined data
  bot?: Bot;
}

export interface BotRelationship {
  id: string;
  bot1_id: BotId;
  bot2_id: BotId;
  relationship_type: RelationshipType;
  intensity: number;
  description: string | null;
  updated_at: string;
  // Joined data
  bot1?: Bot;
  bot2?: Bot;
}

export interface BotMemory {
  id: string;
  bot_id: BotId;
  memory_type: 'event' | 'relationship' | 'secret' | 'grudge';
  content: string;
  relevance_score: number;
  session_id: string | null;
  created_at: string;
}

export interface ViewerMessage {
  id: string;
  user_id: string;
  username: string;
  message: string;
  session_id: string | null;
  created_at: string;
}

export interface DramaEvent {
  id: string;
  session_id: string | null;
  event_type: DramaEventType;
  title: string;
  description: string;
  bots_involved: BotId[];
  intensity: number;
  created_at: string;
}

// =============================================
// APPLICATION STATE TYPES
// =============================================

export interface HighlightMoment {
  message_id: string;
  description: string;
  timestamp: string;
}

export interface SessionState {
  isLive: boolean;
  currentSession: LiveSession | null;
  nextSessionTime: Date | null;
  viewerCount: number;
  chaosLevel: number; // 0-100
}

export interface ConversationGroup {
  type: ConversationType;
  participants: BotId[];
  topic?: string;
  messages: BotMessage[];
}

// For the director system
export interface DirectorState {
  currentConversations: ConversationGroup[];
  activeEvent: string | null;
  nextEventTime: Date | null;
  messageQueue: QueuedMessage[];
}

export interface QueuedMessage {
  botId: BotId;
  conversationGroup: ConversationGroup;
  scheduledTime: Date;
}

// =============================================
// STATIC BOT DATA (used in frontend without DB)
// =============================================

export interface StaticBot {
  id: BotId;
  name: string;
  emoji: string;
  tagline: string;
  description: string;
  color: string;
  personalityTraits: string[];
  catchphrases: string[];
}

// =============================================
// API RESPONSE TYPES
// =============================================

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

export interface GenerateMessageRequest {
  botId: BotId;
  conversationType: ConversationType;
  participants: BotId[];
  recentMessages: Array<{ botId: BotId; message: string }>;
  eventPrompt?: string;
  sessionId?: string;
}

export interface GenerateMessageResponse {
  message: string;
  botId: BotId;
  dramaScore: number;
}
