import { useState, useEffect, useCallback, useRef } from 'react';
import { socketClient, MessageData, ChannelData, UnreadCountsData, TypingData, PresenceData } from '../services/realtime/SocketClient';
import { generateIdempotencyKey } from '../utils/idempotency';

export interface UseCollaborationReturn {
  // Connection
  connected: boolean;
  connecting: boolean;
  connectionError: string | null;
  
  // Channels
  channels: ChannelData[];
  activeChannelId: string | null;
  setActiveChannel: (channelId: string) => void;
  createChannel: (data: { name: string; description?: string; topic?: string; isPrivate?: boolean; branchId?: string }) => Promise<ChannelData>;
  
  // Messages
  messages: MessageData[];
  loadingMessages: boolean;
  hasMoreMessages: boolean;
  loadMoreMessages: () => Promise<void>;
  sendMessage: (content: string, options?: { parentId?: string; attachments?: any[] }) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string, hard?: boolean) => Promise<void>;
  pinMessage: (messageId: string) => Promise<void>;
  unpinMessage: (messageId: string) => Promise<void>;
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
  
  // Threads
  openThread: (message: MessageData) => void;
  closeThread: () => void;
  activeThreadMessage: MessageData | null;
  threadReplies: MessageData[];
  sendThreadReply: (content: string) => Promise<void>;
  
  // Typing
  typingUsers: Map<string, string[]>; // conversationId -> userNames[]
  
  // Presence
  presence: Map<string, PresenceData>; // userId -> presence
  
  // Unread counts
  unreadCounts: UnreadCountsData;
  
  // Notifications
  notifications: any[];
  unreadNotificationCount: number;
}

export function useCollaboration(
  userId: string,
  organizationId: string,
  userName: string,
  userRole: string
): UseCollaborationReturn {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [activeThreadMessage, setActiveThreadMessage] = useState<MessageData | null>(null);
  const [threadReplies, setThreadReplies] = useState<MessageData[]>([]);
  
  const [typingUsers, setTypingUsers] = useState<Map<string, string[]>>(new Map());
  const [presence, setPresence] = useState<Map<string, PresenceData>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<UnreadCountsData>({
    channels: {},
    conversations: {},
    total: 0,
    mentions: 0,
  });
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  
  const nextCursorRef = useRef<string | null>(null);
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  // Initialize connection
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const init = async () => {
      setConnecting(true);
      setConnectionError(null);
      
      try {
        await socketClient.connect();
        setConnected(true);
        
        // Subscribe to active channel if any
        if (activeChannelId) {
          await socketClient.subscribeChannel(activeChannelId);
          subscriptionsRef.current.add(`channel:${activeChannelId}`);
        }
        
        // Load initial channels
        // This would typically come from REST API, but we can also get from socket
        // For now, we'll rely on the existing channel loading mechanism
        
      } catch (err) {
        setConnectionError(err instanceof Error ? err.message : 'Connection failed');
      } finally {
        setConnecting(false);
      }
    };

    init();

    // Connection event handlers
    const unsubscribeAuth = socketClient.on('authenticated', (data) => {
      setConnected(true);
      setUnreadCounts(data.unreadCounts);
      if (data.presence) {
        const newPresence = new Map<string, PresenceData>();
        for (const p of data.presence) {
          newPresence.set(p.userId, p);
        }
        setPresence(newPresence);
      }
    });

    const unsubscribeDisconnect = socketClient.on('disconnect' as any, () => {
      setConnected(false);
    });

    const unsubscribeReconnect = socketClient.on('reconnect' as any, () => {
      // Re-subscribe to all channels
      for (const sub of subscriptionsRef.current) {
        if (sub.startsWith('channel:')) {
          socketClient.subscribeChannel(sub.replace('channel:', ''));
        } else if (sub.startsWith('dm:')) {
          socketClient.subscribeConversation(sub.replace('dm:', ''));
        }
      }
    });

    // Message events
    const unsubscribeMsgCreated = socketClient.on('message.created', (data) => {
      // Replace optimistic message if exists
      if (data.temporaryId) {
        setMessages(prev => prev.map(m => 
          m.id === data.temporaryId ? { ...data.message, _optimistic: false } : m
        ));
      } else {
        setMessages(prev => {
          // Avoid duplicates
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [data.message, ...prev];
        });
      }
    });

    const unsubscribeMsgUpdated = socketClient.on('message.updated', (data) => {
      setMessages(prev => prev.map(m => 
        m.id === data.messageId ? { ...m, content: data.content, editedAt: data.editedAt, updatedAt: data.editedAt } : m
      ));
    });

    const unsubscribeMsgDeleted = socketClient.on('message.deleted', (data) => {
      setMessages(prev => prev.filter(m => m.id !== data.messageId));
    });

    const unsubscribeMsgPinned = socketClient.on('message.pinned', (data) => {
      setMessages(prev => prev.map(m => 
        m.id === data.messageId ? { ...m, isPinned: true } : m
      ));
    });

    const unsubscribeMsgUnpinned = socketClient.on('message.unpinned', (data) => {
      setMessages(prev => prev.map(m => 
        m.id === data.messageId ? { ...m, isPinned: false } : m
      ));
    });

    const unsubscribeReaction = socketClient.on('message.reaction.updated', (data) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== data.messageId) return m;
        const existing = m.reactions?.find(r => r.emoji === data.emoji);
        if (data.added) {
          if (existing) {
            return { ...m, reactions: (m.reactions ?? []).map(r => 
              r.emoji === data.emoji ? { ...r, count: data.count, users: data.users, currentUserReacted: true } : r
            )};
          } else {
            return { ...m, reactions: [...(m.reactions || []), { emoji: data.emoji, count: data.count, users: data.users, currentUserReacted: true }] };
          }
        } else {
          if (data.count === 0) {
            return { ...m, reactions: m.reactions?.filter(r => r.emoji !== data.emoji) || [] };
          }
          return { ...m, reactions: m.reactions?.map(r => 
            r.emoji === data.emoji ? { ...r, count: data.count, users: data.users, currentUserReacted: false } : r
          ) || [] };
        }
      }));
    });

    // Typing events
    const unsubscribeTypingStart = socketClient.on('typing.started', (data: TypingData) => {
      setTypingUsers(prev => {
        const newMap = new Map(prev);
        const users = newMap.get(data.conversationId) || [];
        if (!users.includes(data.userName)) {
          newMap.set(data.conversationId, [...users, data.userName]);
        }
        return newMap;
      });
    });

    const unsubscribeTypingStop = socketClient.on('typing.stopped', (data) => {
      setTypingUsers(prev => {
        const newMap = new Map(prev);
        const users = newMap.get(data.conversationId) || [];
        newMap.set(data.conversationId, users.filter(u => u !== data.userId));
        return newMap;
      });
    });

    // Presence
    const unsubscribePresence = socketClient.on('presence.updated', (data: PresenceData) => {
      setPresence(prev => {
        const newMap = new Map(prev);
        if (data.status === 'OFFLINE') {
          newMap.delete(data.userId);
        } else {
          newMap.set(data.userId, data);
        }
        return newMap;
      });
    });

    const unsubscribePresenceBulk = socketClient.on('presence.bulk', (data) => {
      const newPresence = new Map<string, PresenceData>();
      for (const p of data.presences) {
        newPresence.set(p.userId, p);
      }
      setPresence(newPresence);
    });

    // Read state
    const unsubscribeRead = socketClient.on('conversation.read.updated', (data) => {
      setUnreadCounts(prev => {
        const newChannels = { ...prev.channels };
        const newConversations = { ...prev.conversations };
        if (data.conversationId.startsWith('ch_')) {
          newChannels[data.conversationId] = data.unreadCount;
        } else {
          newConversations[data.conversationId] = data.unreadCount;
        }
        return {
          ...prev,
          channels: newChannels,
          conversations: newConversations,
          total: Object.values(newChannels).reduce((a, b) => a + b, 0) + 
                 Object.values(newConversations).reduce((a, b) => a + b, 0),
        };
      });
    });

    // Notifications
    const unsubscribeNotif = socketClient.on('notification.created', (data) => {
      setNotifications(prev => [data.notification, ...prev]);
      setUnreadNotificationCount(prev => prev + 1);
    });

    // Channel events
    const unsubscribeChannelMemberAdded = socketClient.on('channel.member.added', (data) => {
      setChannels(prev => prev.map(c => 
        c.id === data.channelId ? { ...c, memberCount: c.memberCount + 1 } : c
      ));
    });

    const unsubscribeChannelMemberRemoved = socketClient.on('channel.member.removed', (data) => {
      setChannels(prev => prev.map(c => 
        c.id === data.channelId ? { ...c, memberCount: Math.max(0, c.memberCount - 1) } : c
      ));
    });

    // Cleanup
    return () => {
      unsubscribeAuth();
      unsubscribeDisconnect();
      unsubscribeReconnect();
      unsubscribeMsgCreated();
      unsubscribeMsgUpdated();
      unsubscribeMsgDeleted();
      unsubscribeMsgPinned();
      unsubscribeMsgUnpinned();
      unsubscribeReaction();
      unsubscribeTypingStart();
      unsubscribeTypingStop();
      unsubscribePresence();
      unsubscribePresenceBulk();
      unsubscribeRead();
      unsubscribeNotif();
      unsubscribeChannelMemberAdded();
      unsubscribeChannelMemberRemoved();
    };
  }, [activeChannelId, userId, organizationId, userName, userRole]);

  // Channel operations
  const setActiveChannel = useCallback(async (channelId: string) => {
    // Unsubscribe from old channel
    if (activeChannelId) {
      await socketClient.unsubscribeChannel(activeChannelId);
      subscriptionsRef.current.delete(`channel:${activeChannelId}`);
    }

    setActiveChannelId(channelId);
    setMessages([]);
    setHasMoreMessages(true);
    nextCursorRef.current = null;

    // Subscribe to new channel
    await socketClient.subscribeChannel(channelId);
    subscriptionsRef.current.add(`channel:${channelId}`);

    // Load messages
    await loadMoreMessages();
  }, [activeChannelId]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingMessages || !hasMoreMessages || !activeChannelId) return;
    
    setLoadingMessages(true);
    try {
      // REST API message load — relies on socket events for now
      // Full implementation calls GET /api/messages?channelId=&cursor=&limit=50
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, [activeChannelId, loadingMessages, hasMoreMessages]);

  // Message operations
  const sendMessage = useCallback(async (content: string, options?: { parentId?: string }) => {
    if (!activeChannelId || !content.trim()) return;
    
    const temporaryId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const idempotencyKey = generateIdempotencyKey();
    
    const optimisticMessage: MessageData = {
      id: temporaryId,
      channelId: activeChannelId,
      senderId: userId,
      content: content.trim(),
      isPinned: false,
      createdAt: new Date().toISOString(),
      sender: {
        id: userId,
        fullName: userName,
        email: '',
        role: userRole,
        avatarUrl: undefined,
      },
      reactions: [],
      replyCount: 0,
      _optimistic: true,
    };
    
    setMessages(prev => [optimisticMessage, ...prev]);
    
    try {
      const ack = await socketClient.sendMessage({
        temporaryId,
        channelId: activeChannelId,
        content: content.trim(),
        parentId: options?.parentId,
        idempotencyKey,
      });
      
      if (!ack.ok) {
        // Mark as failed
        setMessages(prev => prev.map(m => 
          m.id === temporaryId ? { ...m, _optimistic: false, _failed: true, _error: ack.error?.message } : m
        ));
      }
      // Success handled by 'message.created' event
    } catch (err) {
      setMessages(prev => prev.map(m => 
        m.id === temporaryId ? { ...m, _optimistic: false, _failed: true, _error: err instanceof Error ? err.message : 'Send failed' } : m
      ));
    }
  }, [activeChannelId, userId, userName, userRole]);

  const editMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await socketClient.editMessage(messageId, content);
    } catch (err) {
      console.error('Edit failed:', err);
    }
  }, []);

  const deleteMessage = useCallback(async (messageId: string, hard = false) => {
    try {
      await socketClient.deleteMessage(messageId, hard);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, []);

  const pinMessage = useCallback(async (messageId: string) => {
    try {
      await socketClient.pinMessage(messageId);
    } catch (err) {
      console.error('Pin failed:', err);
    }
  }, []);

  const unpinMessage = useCallback(async (messageId: string) => {
    try {
      await socketClient.unpinMessage(messageId);
    } catch (err) {
      console.error('Unpin failed:', err);
    }
  }, []);

  const addReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      await socketClient.addReaction(messageId, emoji);
    } catch (err) {
      console.error('Add reaction failed:', err);
    }
  }, []);

  const removeReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      await socketClient.removeReaction(messageId, emoji);
    } catch (err) {
      console.error('Remove reaction failed:', err);
    }
  }, []);

  // Thread operations
  const openThread = useCallback((message: MessageData) => {
    setActiveThreadMessage(message);
    // Fetch thread replies via socket
    socketClient.fetchThread(message.id).then(ack => {
      if (ack.ok && ack.data) {
        setThreadReplies(ack.data.replies || []);
      }
    });
  }, []);

  const closeThread = useCallback(() => {
    setActiveThreadMessage(null);
    setThreadReplies([]);
  }, []);

  const sendThreadReply = useCallback(async (content: string) => {
    if (!activeThreadMessage || !content.trim()) return;
    
    const temporaryId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const idempotencyKey = generateIdempotencyKey();
    
    try {
      await socketClient.sendMessage({
        temporaryId,
        channelId: activeThreadMessage.channelId,
        conversationId: activeThreadMessage.conversationId,
        recipientId: activeThreadMessage.recipientId,
        content: content.trim(),
        parentId: activeThreadMessage.id,
        idempotencyKey,
      });
    } catch (err) {
      console.error('Thread reply failed:', err);
    }
  }, [activeThreadMessage]);

  // Typing indicators
  const typingStart = useCallback((channelId?: string, conversationId?: string) => {
    socketClient.typingStart({ channelId, conversationId });
  }, []);

  const typingStop = useCallback((channelId?: string, conversationId?: string) => {
    socketClient.typingStop({ channelId, conversationId });
  }, []);

  return {
    connected,
    connecting,
    connectionError,
    channels,
    activeChannelId,
    setActiveChannel,
    createChannel: async (data) => {
      // Would call REST API
      throw new Error('Not implemented - use REST API');
    },
    messages,
    loadingMessages,
    hasMoreMessages,
    loadMoreMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
    addReaction,
    removeReaction,
    openThread,
    closeThread,
    activeThreadMessage,
    threadReplies,
    sendThreadReply,
    typingUsers,
    presence,
    unreadCounts,
    notifications,
    unreadNotificationCount,
  };
}