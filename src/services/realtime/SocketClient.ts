import { io, Socket } from 'socket.io-client';
import { getAccessToken, clearAuth } from '../../utils/auth';

export type TypingStatus = 'idle' | 'typing';

export interface RealtimeEvents {
  // Connection
  authenticated: (data: AuthenticatedData) => void;
  authentication_failed: (error: { code: string; message: string }) => void;
  
  // Messages
  'message.created': (data: MessageCreatedData) => void;
  'message.updated': (data: MessageUpdatedData) => void;
  'message.deleted': (data: MessageDeletedData) => void;
  'message.pinned': (data: { messageId: string }) => void;
  'message.unpinned': (data: { messageId: string }) => void;
  'message.reaction.updated': (data: ReactionUpdatedData) => void;
  
  // Channels
  'channel.created': (data: { channel: ChannelData }) => void;
  'channel.updated': (data: { channelId: string; changes: Partial<ChannelData> }) => void;
  'channel.archived': (data: { channelId: string; archivedAt: string }) => void;
  'channel.member.added': (data: { channelId: string; member: ChannelMemberData }) => void;
  'channel.member.removed': (data: { channelId: string; userId: string; removedById: string; removedByName: string }) => void;
  'channel.member.updated': (data: { channelId: string; userId: string; role: string }) => void;
  
  // Conversations (DMs)
  'conversation.created': (data: { conversation: ConversationData; otherUser: UserData }) => void;
  'conversation.member.updated': (data: { conversationId: string; userId: string; role: string }) => void;
  
  // Read state
  'conversation.read.updated': (data: ReadUpdatedData) => void;
  
  // Presence
  'presence.updated': (data: PresenceData) => void;
  'presence.bulk': (data: { presences: PresenceData[] }) => void;
  
  // Typing
  'typing.started': (data: TypingData) => void;
  'typing.stopped': (data: { conversationId: string; userId: string }) => void;
  
  // Notifications
  'notification.created': (data: { notification: NotificationData }) => void;
  'notification.read': (data: { notificationId: string }) => void;
  
  // Attachments
  'attachment.uploaded': (data: { attachment: AttachmentData; messageId?: string }) => void;
  
  // Meetings
  'meeting.participant.joined': (data: { meetingId: string; participant: MeetingParticipantData }) => void;
  'meeting.participant.left': (data: { meetingId: string; userId: string; leftAt: string }) => void;
  'meeting.ended': (data: { meetingId: string; endedAt: string; endedById: string }) => void;
  
  // Errors
  error: (error: { code: string; message: string }) => void;
}

export interface AuthenticatedData {
  user: {
    userId: string;
    organizationId: string;
    branchId: string | null;
    role: string;
    email: string;
    fullName: string;
  };
  presence: PresenceData[];
  unreadCounts: UnreadCountsData;
  serverTime: string;
}

export interface UnreadCountsData {
  channels: Record<string, number>;
  conversations: Record<string, number>;
  total: number;
  mentions: number;
}

export interface MessageCreatedData {
  message: MessageData;
  temporaryId?: string;
}

export interface MessageUpdatedData {
  messageId: string;
  content: string;
  editedAt: string;
  editedById: string;
  editedByName: string;
}

export interface MessageDeletedData {
  messageId: string;
  deletedAt: string;
  deletedById: string;
  hard: boolean;
}

export interface ReactionUpdatedData {
  messageId: string;
  emoji: string;
  count: number;
  users: string[];
  added: boolean;
  actorId: string;
}

export interface ChannelData {
  id: string;
  name: string;
  description?: string;
  topic?: string;
  isPrivate: boolean;
  isArchived: boolean;
  branchId?: string;
  memberCount: number;
  unreadCount: number;
  createdById: string;
  createdAt: string;
}

export interface ChannelMemberData {
  id: string;
  channelId: string;
  userId: string;
  joinedAt: string;
  user: UserData;
}

export interface ConversationData {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title?: string;
  participants: ConversationParticipantData[];
  lastMessage?: MessageData;
  unreadCount: number;
  updatedAt: string;
}

export interface ConversationParticipantData {
  userId: string;
  role: string;
  user: UserData;
}

export interface ReadUpdatedData {
  conversationId: string;
  userId: string;
  lastReadMessageId: string;
  unreadCount: number;
}

export interface PresenceData {
  userId: string;
  status: 'ONLINE' | 'AWAY' | 'OFFLINE';
  lastSeen: string | null;
  sessions: number;
}

export interface TypingData {
  conversationId: string;
  userId: string;
  userName: string;
}

export interface NotificationData {
  id: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, any>;
  isRead: boolean;
  createdAt: string;
}

export interface AttachmentData {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  category: string;
  uploadStatus: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface MeetingParticipantData {
  userId: string;
  fullName: string;
  role: string;
  avatar: string;
  joinedAt: string;
  isMuted: boolean;
  isVideoOn: boolean;
  isSpeaking: boolean;
  isSharingScreen: boolean;
}

export interface UserData {
  id: string;
  fullName: string;
  email: string;
  avatarUrl?: string;
  role: string;
}

export interface MessageData {
  id: string;
  channelId?: string;
  conversationId?: string;
  senderId: string;
  recipientId?: string;
  parentId?: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
  deletedAt?: string;
  sender: UserData;
  channel?: ChannelData;
  parent?: MessageData;
  reactions?: ReactionData[];
  attachments?: AttachmentData[];
  replyCount: number;
  lastReplyAt?: string;
  threadRootId?: string;
  /** Internal flag for optimistic UI — not from server */
  _optimistic?: boolean;
}

export interface ReactionData {
  emoji: string;
  count: number;
  users: string[];
  currentUserReacted: boolean;
}

export interface AckResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  eventId: string;
  serverTime?: string;
}

class SocketClient {
  private socket: Socket | null = null;
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private subscriptions: Set<string> = new Set();
  private pendingSubscriptions: Array<{ channelId?: string; conversationId?: string }> = [];
  private optimisticMessages: Map<string, MessageData> = new Map();

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = getAccessToken();
      if (!token) {
        reject(new Error('No access token available'));
        return;
      }

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      
      this.socket = io(apiUrl, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
        timeout: 20000,
      });

      this.setupEventListeners();

      this.socket.on('authenticated', (data: AuthenticatedData) => {
        this.reconnectAttempts = 0;
        this.emit('authenticated', data);
        this.restoreSubscriptions();
        resolve();
      });

      this.socket.on('authentication_failed', (error) => {
        if (error.code === 'TOKEN_REVOKED' || error.code === 'INVALID_TOKEN') {
          clearAuth();
          window.location.href = '/login';
        }
        reject(new Error(error.message));
      });

      this.socket.on('connect_error', (err) => {
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          reject(new Error('Max reconnection attempts reached'));
        }
      });

      this.socket.on('reconnect', () => {
        this.reconnectAttempts = 0;
        // Re-authenticate on reconnect
        const newToken = getAccessToken();
        if (newToken) {
          this.socket?.emit('authenticate', { token: newToken });
        }
      });
    });
  }

  private setupEventListeners() {
    if (!this.socket) return;

    // Forward all events to local handlers
    const events = [
      'message.created', 'message.updated', 'message.deleted',
      'message.pinned', 'message.unpinned', 'message.reaction.updated',
      'channel.created', 'channel.updated', 'channel.archived',
      'channel.member.added', 'channel.member.removed', 'channel.member.updated',
      'conversation.created', 'conversation.member.updated',
      'conversation.read.updated',
      'presence.updated', 'presence.bulk',
      'typing.started', 'typing.stopped',
      'notification.created', 'notification.read',
      'attachment.uploaded',
      'meeting.participant.joined', 'meeting.participant.left', 'meeting.ended',
      'authenticated', 'authentication_failed',
      'error',
    ];

    for (const event of events) {
      this.socket.on(event, (data) => {
        this.emit(event as keyof RealtimeEvents, data);
      });
    }

    // Handle reconnection
    this.socket.on('reconnect', () => {
      this.restoreSubscriptions();
    });
  }

  private restoreSubscriptions() {
    // Re-subscribe to all previously joined channels/conversations
    for (const sub of this.pendingSubscriptions) {
      if (sub.channelId) {
        this.subscribeChannel(sub.channelId);
      }
      if (sub.conversationId) {
        this.subscribeConversation(sub.conversationId);
      }
    }
    this.pendingSubscriptions = [];
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    this.subscriptions.clear();
    this.pendingSubscriptions = [];
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  // ============================================================
  // EVENT HANDLING
  // ============================================================

  on<K extends keyof RealtimeEvents>(event: K, handler: RealtimeEvents[K]): () => void {
    const handlers = this.eventHandlers.get(event) || new Set();
    handlers.add(handler);
    this.eventHandlers.set(event, handlers);
    
    return () => {
      handlers.delete(handler);
    };
  }

  private emit<K extends keyof RealtimeEvents>(event: K, data: Parameters<RealtimeEvents[K]>[0]) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as Function)(data);
        } catch (err) {
          console.error(`Error in ${event} handler:`, err);
        }
      }
    }
  }

  // ============================================================
  // COMMANDS (with acknowledgement)
  // ============================================================

  private sendCommand<T>(command: string, payload: any): Promise<AckResponse<T>> {
    return new Promise((resolve) => {
      if (!this.socket?.connected) {
        resolve({ ok: false, error: { code: 'NOT_CONNECTED', message: 'Socket not connected' }, eventId: '' });
        return;
      }
      this.socket.emit(command, payload, (ack: AckResponse<T>) => {
        resolve(ack);
      });
    });
  }

  // Subscriptions
  async subscribeChannel(channelId: string): Promise<AckResponse<{ readCursor: any }>> {
    if (this.socket?.connected) {
      this.subscriptions.add(`channel:${channelId}`);
      return this.sendCommand('subscribe', { channelId });
    } else {
      this.pendingSubscriptions.push({ channelId });
      return { ok: false, error: { code: 'NOT_CONNECTED', message: 'Will subscribe on connect' }, eventId: '' };
    }
  }

  async subscribeConversation(conversationId: string): Promise<AckResponse<{ readCursor: any }>> {
    if (this.socket?.connected) {
      this.subscriptions.add(`dm:${conversationId}`);
      return this.sendCommand('subscribe', { conversationId });
    } else {
      this.pendingSubscriptions.push({ conversationId });
      return { ok: false, error: { code: 'NOT_CONNECTED', message: 'Will subscribe on connect' }, eventId: '' };
    }
  }

  async unsubscribeChannel(channelId: string): Promise<AckResponse> {
    this.subscriptions.delete(`channel:${channelId}`);
    return this.sendCommand('unsubscribe', { channelId });
  }

  async unsubscribeConversation(conversationId: string): Promise<AckResponse> {
    this.subscriptions.delete(`dm:${conversationId}`);
    return this.sendCommand('unsubscribe', { conversationId });
  }

  // Messages
  async sendMessage(payload: {
    temporaryId: string;
    channelId?: string;
    conversationId?: string;
    recipientId?: string;
    content: string;
    parentId?: string;
    idempotencyKey: string;
  }): Promise<AckResponse<{ messageId: string; createdAt: string; existing: boolean }>> {
    return this.sendCommand('sendMessage', payload);
  }

  async editMessage(messageId: string, content: string): Promise<AckResponse> {
    return this.sendCommand('editMessage', { messageId, content });
  }

  async deleteMessage(messageId: string, hard?: boolean): Promise<AckResponse> {
    return this.sendCommand('deleteMessage', { messageId, hard });
  }

  async pinMessage(messageId: string): Promise<AckResponse> {
    return this.sendCommand('pinMessage', { messageId });
  }

  async unpinMessage(messageId: string): Promise<AckResponse> {
    return this.sendCommand('unpinMessage', { messageId });
  }

  async addReaction(messageId: string, emoji: string): Promise<AckResponse> {
    return this.sendCommand('addReaction', { messageId, emoji });
  }

  async removeReaction(messageId: string, emoji: string): Promise<AckResponse> {
    return this.sendCommand('removeReaction', { messageId, emoji });
  }

  async fetchThread(parentId: string, cursor?: string, limit?: number): Promise<AckResponse> {
    return this.sendCommand('fetchThread', { parentId, cursor, limit });
  }

  // Read state
  async markRead(payload: { channelId?: string; conversationId?: string; messageId: string }): Promise<AckResponse> {
    return this.sendCommand('markRead', payload);
  }

  // Typing
  typingStart(payload: { channelId?: string; conversationId?: string }) {
    this.socket?.emit('typing.start', payload);
  }

  typingStop(payload: { channelId?: string; conversationId?: string }) {
    this.socket?.emit('typing.stop', payload);
  }

  // Presence
  heartbeat(status?: 'ONLINE' | 'AWAY'): Promise<AckResponse> {
    return this.sendCommand('heartbeat', { status });
  }

  // Meetings
  async meetingJoin(meetingId: string): Promise<AckResponse> {
    return this.sendCommand('meeting.join', { meetingId });
  }

  async meetingLeave(meetingId: string): Promise<AckResponse> {
    return this.sendCommand('meeting.leave', { meetingId });
  }

  meetingSignal(meetingId: string, toUserId: string, signal: any) {
    this.socket?.emit('meeting.signal', { meetingId, toUserId, signal });
  }

  // Optimistic UI helpers
  addOptimisticMessage(message: MessageData) {
    this.optimisticMessages.set(message.id, message);
  }

  removeOptimisticMessage(temporaryId: string) {
    this.optimisticMessages.delete(temporaryId);
  }

  getOptimisticMessage(temporaryId: string): MessageData | undefined {
    return this.optimisticMessages.get(temporaryId);
  }

  reconcileMessage(temporaryId: string, serverMessage: MessageData) {
    const optimistic = this.optimisticMessages.get(temporaryId);
    if (optimistic) {
      this.optimisticMessages.delete(temporaryId);
      this.optimisticMessages.set(serverMessage.id, serverMessage);
    }
  }
}

// Singleton instance
export const socketClient = new SocketClient();

// React hook for using socket client
import { useEffect, useState } from 'react';

export function useRealtimeEvent<K extends keyof RealtimeEvents>(
  event: K,
  handler: RealtimeEvents[K]
) {
  useEffect(() => {
    const unsubscribe = socketClient.on(event, handler);
    return unsubscribe;
  }, [event, handler]);
}

export function useConnectionStatus() {
  const [connected, setConnected] = useState(socketClient.isConnected());
  
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    
    socketClient.on('connect' as any, onConnect);
    socketClient.on('disconnect' as any, onDisconnect);
    
    return () => {
      // Note: socketClient doesn't expose connect/disconnect events directly
      // In practice, you'd listen to socket.io's connect/disconnect events
    };
  }, []);
  
  return connected;
}