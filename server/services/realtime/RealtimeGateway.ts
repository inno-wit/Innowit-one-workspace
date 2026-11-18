import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken, JWTPayload } from '../../utils/auth';
import { prisma } from '../../prisma';
import { collaborationService } from '../collaboration/CollaborationService';
import { notificationService } from '../collaboration/NotificationService';
import { AppError } from '../../middleware/errorHandler';

function safeAck(ack: any, response: any, socket?: Socket) {
  if (typeof ack === 'function') {
    try {
      ack(response);
    } catch (e) {}
  }
  if (!response?.ok && socket) {
    socket.emit('error', response?.error);
  }
}

interface AuthenticatedSocket extends Socket {
  data: {
    user?: JWTPayload;
    prismaUser?: { id: string; organizationId: string; branchId: string | null; isActive: boolean };
    subscriptions?: Set<string>;
  };
}

export class RealtimeGateway {
  private io: Server;
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds
  private socketRooms: Map<string, Set<string>> = new Map(); // socketId -> Set of room names

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3002',
        credentials: true,
      },
      pingInterval: 25000,
      pingTimeout: 20000,
      transports: ['websocket', 'polling'],
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware() {
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const payload = verifyAccessToken(token);
      if (!payload) {
        return next(new Error('Invalid or expired token'));
      }

      // Verify user still exists and is active
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, isActive: true, organizationId: true, branchId: true },
      });

      if (!user || !user.isActive) {
        return next(new Error('User not found or inactive'));
      }

      if (user.organizationId !== payload.organizationId) {
        return next(new Error('Organization mismatch'));
      }

      socket.data.user = payload;
      socket.data.prismaUser = user;
      socket.data.subscriptions = new Set();

      next();
    });
  }

  private setupEventHandlers() {
    this.io.on('connection', async (socket: AuthenticatedSocket) => {
      const { user, prismaUser } = socket.data;
      if (!user || !prismaUser) return;

      console.log(`User connected: ${user.fullName} (${user.userId}) - Socket: ${socket.id}`);

      // Track user sockets
      if (!this.userSockets.has(user.userId)) {
        this.userSockets.set(user.userId, new Set());
      }
      this.userSockets.get(user.userId)!.add(socket.id);

      // Join personal room
      socket.join(`user:${user.userId}`);

      // Join organization room
      socket.join(`org:${user.organizationId}`);

      // Register all command handlers synchronously so events emitted on connect are not lost
      this.handleSubscribe(socket);
      this.handleUnsubscribe(socket);
      this.handleSendMessage(socket);
      this.handleEditMessage(socket);
      this.handleDeleteMessage(socket);
      this.handlePinMessage(socket);
      this.handleUnpinMessage(socket);
      this.handleAddReaction(socket);
      this.handleRemoveReaction(socket);
      this.handleMarkRead(socket);
      this.handleTypingStart(socket);
      this.handleTypingStop(socket);
      this.handleHeartbeat(socket);
      this.handleFetchThread(socket);
      this.handleMeetingJoin(socket);
      this.handleMeetingLeave(socket);
      this.handleMeetingSignal(socket);

      // Handle disconnect
      socket.on('disconnect', async (reason) => {
        console.log(`User disconnected: ${user.fullName} - Reason: ${reason}`);
        await this.handleDisconnect(socket, user.userId, user.organizationId);
      });

      // Create/update presence session
      await this.updatePresence(socket, 'ONLINE');

      // Send authenticated event with initial data
      const [presence, unreadCounts] = await Promise.all([
        this.getOrgPresence(user.organizationId),
        this.getUnreadCounts(user.userId, user.organizationId),
      ]);

      const authData = {
        user: {
          userId: user.userId,
          organizationId: user.organizationId,
          branchId: user.branchId,
          role: user.role,
          email: user.email,
          fullName: user.fullName,
        },
        presence,
        unreadCounts,
        serverTime: new Date().toISOString(),
      };

      socket.emit('authenticated', authData);
      socket.emit('connection.ack', authData);

      socket.emit('presence.bulk', { presences: presence });
    });
  }

  private async updatePresence(socket: AuthenticatedSocket, status: 'ONLINE' | 'AWAY' | 'OFFLINE') {
    const { user } = socket.data;
    if (!user) return;

    await prisma.presenceSession.upsert({
      where: { socketId: socket.id },
      update: {
        status,
        lastHeartbeat: new Date(),
      },
      create: {
        socketId: socket.id,
        userId: user.userId,
        organizationId: user.organizationId,
        status,
        lastHeartbeat: new Date(),
        metadataJson: JSON.stringify({
          userAgent: socket.handshake.headers['user-agent'],
        }),
      },
    });
  }

  private async getOrgPresence(organizationId: string) {
    const sessions = await prisma.presenceSession.findMany({
      where: { organizationId, status: { not: 'OFFLINE' } },
      include: { user: { select: { id: true, fullName: true, avatarUrl: true, role: true } } },
    });

    // Aggregate by user (multiple sessions per user)
    const userPresence = new Map<string, { status: 'ONLINE' | 'AWAY' | 'OFFLINE'; lastSeen: Date | null; sessions: number }>();

    for (const session of sessions) {
      const existing = userPresence.get(session.userId);
      if (!existing) {
        userPresence.set(session.userId, {
          status: session.status,
          lastSeen: session.status === 'ONLINE' ? null : session.lastHeartbeat,
          sessions: 1,
        });
      } else {
        existing.sessions++;
        if (session.status === 'ONLINE') {
          existing.status = 'ONLINE';
          existing.lastSeen = null;
        }
      }
    }

    return Array.from(userPresence.entries()).map(([userId, data]) => ({
      userId,
      status: data.status,
      lastSeen: data.lastSeen?.toISOString() || null,
      sessions: data.sessions,
    }));
  }

  private async getUnreadCounts(userId: string, organizationId: string) {
    // Get unread counts for channels
    const channelCursors = await prisma.readCursor.findMany({
      where: { userId, organizationId, channelId: { not: null } },
      select: { channelId: true, lastReadMessageId: true },
    });

    const dmCursors = await prisma.readCursor.findMany({
      where: { userId, organizationId, recipientId: { not: null } },
      select: { recipientId: true, lastReadMessageId: true },
    });

    // Helper to count messages after a cursor
    const countAfterCursor = async (where: any, cursorMessageId: string | null) => {
      if (!cursorMessageId) {
        return prisma.message.count({ where: { ...where, deletedAt: null } });
      }
      const cursorMessage = await prisma.message.findUnique({
        where: { id: cursorMessageId },
        select: { createdAt: true, id: true },
      });
      if (!cursorMessage) {
        return prisma.message.count({ where: { ...where, deletedAt: null } });
      }
      return prisma.message.count({
        where: {
          ...where,
          deletedAt: null,
          OR: [
            { createdAt: { gt: cursorMessage.createdAt } },
            { createdAt: cursorMessage.createdAt, id: { gt: cursorMessage.id } },
          ],
        },
      });
    };

    // Count unread per channel
    const channelUnread: Record<string, number> = {};
    for (const cursor of channelCursors) {
      if (!cursor.channelId) continue;
      const count = await countAfterCursor(
        { channelId: cursor.channelId, organizationId },
        cursor.lastReadMessageId
      );
      if (count > 0) channelUnread[cursor.channelId] = count;
    }

    // Count unread per DM
    const dmUnread: Record<string, number> = {};
    for (const cursor of dmCursors) {
      if (!cursor.recipientId) continue;
      // Determine the conversationId from recipientId (which stores conversationId for DMs)
      const conversationId = cursor.recipientId;
      const count = await countAfterCursor(
        {
          OR: [
            { conversationId },
            { senderId: userId, recipientId: conversationId },
            { senderId: conversationId, recipientId: userId },
          ],
          organizationId,
        },
        cursor.lastReadMessageId
      );
      if (count > 0) dmUnread[`conv_${[userId, conversationId].sort().join('_')}`] = count;
    }

    const total = Object.values(channelUnread).reduce((a, b) => a + b, 0) +
                  Object.values(dmUnread).reduce((a, b) => a + b, 0);

    return { channels: channelUnread, conversations: dmUnread, total, mentions: 0 };
  }

  // ============================================================
  // COMMAND HANDLERS
  // ============================================================

  private handleSubscribe(socket: AuthenticatedSocket) {
    socket.on('subscribe', async (payload: { channelId?: string; conversationId?: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } }, socket);

      try {
        if (payload.channelId) {
          // Verify channel membership and tenant isolation
          const membership = await prisma.channelMember.findFirst({
            where: { channelId: payload.channelId, userId: user.userId, organizationId: user.organizationId },
          });

          if (!membership) {
            const channel = await prisma.channel.findFirst({
              where: { id: payload.channelId, organizationId: user.organizationId },
            });
            if (!channel || channel.isPrivate) {
              return safeAck(ack, { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this channel' } }, socket);
            }
          }

          socket.join(`channel:${payload.channelId}`);
          socket.data.subscriptions!.add(`channel:${payload.channelId}`);

          // Get read cursor
          const cursor = await prisma.readCursor.findUnique({
            where: { userId_channelId: { userId: user.userId, channelId: payload.channelId } },
          });

          const subData = { channelId: payload.channelId, readCursor: cursor };
          socket.emit('subscribe', { ok: true, data: subData });
          socket.emit('subscribe.ack', subData);
          return safeAck(ack, { ok: true, data: subData, eventId: crypto.randomUUID() }, socket);
        }

        if (payload.conversationId) {
          // Verify conversation participation and tenant isolation
          const conversation = await prisma.conversation.findFirst({
            where: { id: payload.conversationId, organizationId: user.organizationId },
          });
          if (!conversation) {
            return safeAck(ack, { ok: false, error: { code: 'FORBIDDEN', message: 'Not authorized for this conversation' } }, socket);
          }

          const participant = await prisma.conversationParticipant.findUnique({
            where: { conversationId_userId: { conversationId: payload.conversationId, userId: user.userId } },
          });

          if (!participant) {
            return safeAck(ack, { ok: false, error: { code: 'FORBIDDEN', message: 'Not a participant in this conversation' } }, socket);
          }

          socket.join(`dm:${payload.conversationId}`);
          socket.data.subscriptions!.add(`dm:${payload.conversationId}`);

          const cursor = await prisma.readCursor.findUnique({
            where: { userId_recipientId: { userId: user.userId, recipientId: payload.conversationId } },
          });

          const subData = { conversationId: payload.conversationId, readCursor: cursor };
          socket.emit('subscribe', { ok: true, data: subData });
          socket.emit('subscribe.ack', subData);
          return safeAck(ack, { ok: true, data: subData, eventId: crypto.randomUUID() }, socket);
        }

        return safeAck(ack, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'channelId or conversationId required' } }, socket);
      } catch (error) {
        console.error('Subscribe error:', error);
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to subscribe' } }, socket);
      }
    });
  }

  private handleUnsubscribe(socket: AuthenticatedSocket) {
    socket.on('unsubscribe', async (payload: { channelId?: string; conversationId?: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        if (payload.channelId) {
          socket.leave(`channel:${payload.channelId}`);
          socket.data.subscriptions!.delete(`channel:${payload.channelId}`);
        }

        if (payload.conversationId) {
          socket.leave(`dm:${payload.conversationId}`);
          socket.data.subscriptions!.delete(`dm:${payload.conversationId}`);
        }

        socket.emit('unsubscribe', { ok: true, channelId: payload.channelId, conversationId: payload.conversationId });
        return safeAck(ack, { ok: true, eventId: crypto.randomUUID() });
      } catch (error) {
        console.error('Unsubscribe error:', error);
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to unsubscribe' } });
      }
    });
  }

  private handleSendMessage(socket: AuthenticatedSocket) {
    socket.on('sendMessage', async (payload: {
      temporaryId: string;
      channelId?: string;
      conversationId?: string;
      recipientId?: string;
      content: string;
      parentId?: string;
      idempotencyKey: string;
    }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        const result = await collaborationService.sendMessage(
          {
            channelId: payload.channelId,
            conversationId: payload.conversationId,
            recipientId: payload.recipientId,
            content: payload.content,
            parentId: payload.parentId,
            idempotencyKey: payload.idempotencyKey,
          },
          user.userId,
          user.organizationId
        );

        // Broadcast to room
        let room: string;
        if (payload.channelId) room = `channel:${payload.channelId}`;
        else if (payload.conversationId) room = `dm:${payload.conversationId}`;
        else if (payload.recipientId) room = `user:${payload.recipientId}`;
        else return safeAck(ack, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'No target specified' } });

        const eventData = {
          message: { ...result, _existing: undefined },
          temporaryId: payload.temporaryId,
        };

        // Broadcast to room except sender only if this is a new message (not idempotent duplicate)
        if (!result._existing) {
          socket.to(room).emit('message.created', eventData);
        }

        // Also emit to sender for confirmation (with temporaryId for reconciliation)
        socket.emit('message.created', eventData);

        // Create notifications for mentions, etc.
        if (payload.channelId) {
          // Check for @mentions in content
          const mentionRegex = /@(\w+)/g;
          const mentions = payload.content.match(mentionRegex) || [];
          if (mentions.length > 0) {
            // Resolve mentions to user IDs (simplified)
            // In production, would look up users by name/username
          }
        }

        return safeAck(ack, { ok: true, data: { messageId: result.id, createdAt: result.createdAt, existing: result._existing }, eventId: crypto.randomUUID() });
      } catch (error: any) {
        console.error('Send message error:', error);
        if (error instanceof AppError) {
          return safeAck(ack, { ok: false, error: { code: error.code, message: error.message } });
        }
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to send message' } });
      }
    });
  }

  private handleEditMessage(socket: AuthenticatedSocket) {
    socket.on('editMessage', async (payload: { messageId: string; content: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        // Need user role - fetch it
        const prismaUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { role: true } });
        const updated = await collaborationService.editMessage(payload.messageId, payload.content, user.userId, user.organizationId, prismaUser?.role || 'EMPLOYEE');

        // Broadcast to room
        const message = await prisma.message.findUnique({ where: { id: payload.messageId } });
        let room = '';
        if (message?.channelId) room = `channel:${message.channelId}`;
        else if (message?.conversationId) room = `dm:${message.conversationId}`;
        else if (message?.recipientId) room = `user:${message.recipientId}`;

        if (room) {
          this.io.to(room).emit('message.updated', {
            messageId: payload.messageId,
            content: payload.content,
            editedAt: updated.editedAt,
            editedById: user.userId,
            editedByName: user.fullName,
          });
        }

        return safeAck(ack, { ok: true, data: updated, eventId: crypto.randomUUID() });
      } catch (error: any) {
        if (error instanceof AppError) {
          return safeAck(ack, { ok: false, error: { code: error.code, message: error.message } });
        }
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to edit message' } });
      }
    });
  }

  private handleDeleteMessage(socket: AuthenticatedSocket) {
    socket.on('deleteMessage', async (payload: { messageId: string; hard?: boolean }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        const prismaUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { role: true } });
        await collaborationService.deleteMessage(payload.messageId, user.userId, user.organizationId, prismaUser?.role || 'EMPLOYEE', payload.hard);

        const message = await prisma.message.findUnique({ where: { id: payload.messageId } });
        let room = '';
        if (message?.channelId) room = `channel:${message.channelId}`;
        else if (message?.conversationId) room = `dm:${message.conversationId}`;
        else if (message?.recipientId) room = `user:${message.recipientId}`;

        if (room) {
          this.io.to(room).emit('message.deleted', {
            messageId: payload.messageId,
            deletedAt: new Date().toISOString(),
            deletedById: user.userId,
            hard: payload.hard || false,
          });
        }

        return safeAck(ack, { ok: true, eventId: crypto.randomUUID() });
      } catch (error: any) {
        if (error instanceof AppError) {
          return safeAck(ack, { ok: false, error: { code: error.code, message: error.message } });
        }
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to delete message' } });
      }
    });
  }

  private handlePinMessage(socket: AuthenticatedSocket) {
    socket.on('pinMessage', async (payload: { messageId: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        const prismaUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { role: true } });
        const updated = await collaborationService.pinMessage(payload.messageId, user.userId, user.organizationId, prismaUser?.role || 'EMPLOYEE');

        const message = await prisma.message.findUnique({ where: { id: payload.messageId } });
        let room = '';
        if (message?.channelId) room = `channel:${message.channelId}`;

        if (room) {
          this.io.to(room).emit('message.pinned', { messageId: payload.messageId });
        }

        return safeAck(ack, { ok: true, data: updated, eventId: crypto.randomUUID() });
      } catch (error: any) {
        if (error instanceof AppError) {
          return safeAck(ack, { ok: false, error: { code: error.code, message: error.message } });
        }
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to pin message' } });
      }
    });
  }

  private handleUnpinMessage(socket: AuthenticatedSocket) {
    socket.on('unpinMessage', async (payload: { messageId: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        const prismaUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { role: true } });
        const updated = await collaborationService.unpinMessage(payload.messageId, user.userId, user.organizationId, prismaUser?.role || 'EMPLOYEE');

        const message = await prisma.message.findUnique({ where: { id: payload.messageId } });
        let room = '';
        if (message?.channelId) room = `channel:${message.channelId}`;

        if (room) {
          this.io.to(room).emit('message.unpinned', { messageId: payload.messageId });
        }

        return safeAck(ack, { ok: true, data: updated, eventId: crypto.randomUUID() });
      } catch (error: any) {
        if (error instanceof AppError) {
          return safeAck(ack, { ok: false, error: { code: error.code, message: error.message } });
        }
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to unpin message' } });
      }
    });
  }

  private handleAddReaction(socket: AuthenticatedSocket) {
    socket.on('addReaction', async (payload: { messageId: string; emoji: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        const reaction = await collaborationService.addReaction(payload.messageId, payload.emoji, user.userId, user.organizationId);

        const message = await prisma.message.findUnique({ where: { id: payload.messageId } });
        let room = '';
        if (message?.channelId) room = `channel:${message.channelId}`;
        else if (message?.conversationId) room = `dm:${message.conversationId}`;
        else if (message?.recipientId) room = `user:${message.recipientId}`;

        if (room) {
          this.io.to(room).emit('message.reaction.updated', {
            messageId: payload.messageId,
            emoji: payload.emoji,
            count: reaction.count,
            users: reaction.users,
            added: true,
            actorId: user.userId,
          });
        }

        // Notify message author
        if (message && message.senderId !== user.userId) {
          await notificationService.notifyReaction(message.senderId, user.userId, user.fullName, payload.emoji, payload.messageId, user.organizationId);
        }

        return safeAck(ack, { ok: true, data: reaction, eventId: crypto.randomUUID() });
      } catch (error: any) {
        if (error instanceof AppError) {
          return safeAck(ack, { ok: false, error: { code: error.code, message: error.message } });
        }
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to add reaction' } });
      }
    });
  }

  private handleRemoveReaction(socket: AuthenticatedSocket) {
    socket.on('removeReaction', async (payload: { messageId: string; emoji: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        const reaction = await collaborationService.removeReaction(payload.messageId, payload.emoji, user.userId, user.organizationId);

        const message = await prisma.message.findUnique({ where: { id: payload.messageId } });
        let room = '';
        if (message?.channelId) room = `channel:${message.channelId}`;
        else if (message?.conversationId) room = `dm:${message.conversationId}`;
        else if (message?.recipientId) room = `user:${message.recipientId}`;

        if (room) {
          this.io.to(room).emit('message.reaction.updated', {
            messageId: payload.messageId,
            emoji: payload.emoji,
            count: reaction.count,
            users: reaction.users,
            added: false,
            actorId: user.userId,
          });
        }

        return safeAck(ack, { ok: true, data: reaction, eventId: crypto.randomUUID() });
      } catch (error: any) {
        if (error instanceof AppError) {
          return safeAck(ack, { ok: false, error: { code: error.code, message: error.message } });
        }
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to remove reaction' } });
      }
    });
  }

  private handleMarkRead(socket: AuthenticatedSocket) {
    socket.on('markRead', async (payload: { channelId?: string; conversationId?: string; messageId: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        if (payload.channelId) {
          await prisma.readCursor.upsert({
            where: { userId_channelId: { userId: user.userId, channelId: payload.channelId } },
            update: { lastReadMessageId: payload.messageId, lastReadAt: new Date() },
            create: { userId: user.userId, channelId: payload.channelId, organizationId: user.organizationId, lastReadMessageId: payload.messageId },
          });

          this.io.to(`channel:${payload.channelId}`).emit('conversation.read.updated', {
            conversationId: payload.channelId,
            userId: user.userId,
            lastReadMessageId: payload.messageId,
            unreadCount: 0,
          });
        }

        if (payload.conversationId) {
          await prisma.readCursor.upsert({
            where: { userId_recipientId: { userId: user.userId, recipientId: payload.conversationId } },
            update: { lastReadMessageId: payload.messageId, lastReadAt: new Date() },
            create: { userId: user.userId, recipientId: payload.conversationId, organizationId: user.organizationId, lastReadMessageId: payload.messageId },
          });

          this.io.to(`dm:${payload.conversationId}`).emit('conversation.read.updated', {
            conversationId: payload.conversationId,
            userId: user.userId,
            lastReadMessageId: payload.messageId,
            unreadCount: 0,
          });
        }

        return safeAck(ack, { ok: true, eventId: crypto.randomUUID() });
      } catch (error) {
        console.error('Mark read error:', error);
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to mark read' } });
      }
    });
  }

  private handleTypingStart(socket: AuthenticatedSocket) {
    socket.on('typing.start', (payload: { channelId?: string; conversationId?: string }) => {
      const { user } = socket.data;
      if (!user) return;

      let room: string;
      if (payload.channelId) room = `channel:${payload.channelId}`;
      else if (payload.conversationId) room = `dm:${payload.conversationId}`;
      else return;

      socket.to(room).emit('typing.started', {
        conversationId: payload.channelId || payload.conversationId,
        channelId: payload.channelId,
        userId: user.userId,
        userName: user.fullName,
      });
    });
  }

  private handleTypingStop(socket: AuthenticatedSocket) {
    socket.on('typing.stop', (payload: { channelId?: string; conversationId?: string }) => {
      const { user } = socket.data;
      if (!user) return;

      let room: string;
      if (payload.channelId) room = `channel:${payload.channelId}`;
      else if (payload.conversationId) room = `dm:${payload.conversationId}`;
      else return;

      socket.to(room).emit('typing.stopped', {
        conversationId: payload.channelId || payload.conversationId,
        channelId: payload.channelId,
        userId: user.userId,
      });
    });
  }

  private handleHeartbeat(socket: AuthenticatedSocket) {
    socket.on('heartbeat', async (payload: { status?: 'ONLINE' | 'AWAY' }, ack) => {
      await this.updatePresence(socket, payload.status || 'ONLINE');

      // Broadcast presence update to org room
      this.io.to(`org:${socket.data.user?.organizationId}`).emit('presence.updated', {
        userId: socket.data.user?.userId,
        status: payload.status || 'ONLINE',
        lastSeen: null,
        sessions: this.userSockets.get(socket.data.user?.userId || '')?.size || 1,
      });

      return safeAck(ack, { ok: true, serverTime: new Date().toISOString() });
    });
  }

  private handleFetchThread(socket: AuthenticatedSocket) {
    socket.on('fetchThread', async (payload: { parentId: string; cursor?: string; limit?: number }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        const result = await collaborationService.getThread(payload.parentId, user.userId, user.organizationId);
        socket.emit('fetchThread', { ok: true, data: result });
        return safeAck(ack, { ok: true, data: result, eventId: crypto.randomUUID() });
      } catch (error: any) {
        if (error instanceof AppError) {
          return safeAck(ack, { ok: false, error: { code: error.code, message: error.message } });
        }
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch thread' } });
      }
    });
  }

  private handleMeetingJoin(socket: AuthenticatedSocket) {
    socket.on('meeting.join', async (payload: { meetingId: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        // Verify meeting exists and user is participant
        const meeting = await prisma.meeting.findUnique({
          where: { id: payload.meetingId },
          include: { participants: true },
        });

        if (!meeting) return safeAck(ack, { ok: false, error: { code: 'NOT_FOUND', message: 'Meeting not found' } });
        if (meeting.organizationId !== user.organizationId) {
          return safeAck(ack, { ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
        }

        const isParticipant = meeting.participants.some((p) => p.userId === user.userId);
        if (!isParticipant && meeting.meetingType !== 'CHANNEL') {
          return safeAck(ack, { ok: false, error: { code: 'FORBIDDEN', message: 'Not a participant in this meeting' } });
        }

        // For channel meetings, check channel membership
        if (meeting.meetingType === 'CHANNEL' && meeting.channelId) {
          const membership = await prisma.channelMember.findUnique({
            where: { channelId_userId: { channelId: meeting.channelId, userId: user.userId } },
          });
          if (!membership) {
            return safeAck(ack, { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this channel' } });
          }
        }

        // Add participant if not already
        await prisma.meetingParticipant.upsert({
          where: { meetingId_userId: { meetingId: payload.meetingId, userId: user.userId } },
          update: { leftAt: null, joinedAt: new Date() },
          create: { meetingId: payload.meetingId, userId: user.userId, role: 'PARTICIPANT' },
        });

        // Update meeting status
        if (meeting.status === 'SCHEDULED') {
          await prisma.meeting.update({
            where: { id: payload.meetingId },
            data: { status: 'ACTIVE', startedAt: new Date() },
          });
        }

        // Join meeting room
        socket.join(`meeting:${payload.meetingId}`);
        socket.data.subscriptions!.add(`meeting:${payload.meetingId}`);

        // Broadcast participant joined
        this.io.to(`meeting:${payload.meetingId}`).emit('meeting.participant.joined', {
          meetingId: payload.meetingId,
          participant: {
            userId: user.userId,
            fullName: user.fullName,
            role: user.role,
            avatar: user.fullName.split(' ').map((n) => n[0]).join('').toUpperCase(),
            joinedAt: new Date().toISOString(),
            isMuted: false,
            isVideoOn: true,
            isSpeaking: false,
            isSharingScreen: false,
          },
        });

        // Get all participants
        const participants = await prisma.meetingParticipant.findMany({
          where: { meetingId: payload.meetingId, leftAt: null },
          include: { user: { select: { id: true, fullName: true, avatarUrl: true, role: true } } },
        });

        // Generate meeting credentials (simplified)
        const credentials = {
          meetingId: payload.meetingId,
          token: `meeting_token_${payload.meetingId}_${user.userId}`,
          turnServers: [
            { urls: ['turn:turn.example.com:3478'], username: 'user', credential: 'pass', credentialType: 'password' as const },
          ],
          sfuUrl: process.env.MEETING_SFU_URL || 'wss://sfu.example.com',
        };

        socket.emit('meeting.join', { ok: true, data: { meeting, participants, credentials } });
        return safeAck(ack, { ok: true, data: { meeting, participants, credentials }, eventId: crypto.randomUUID() });
      } catch (error) {
        console.error('Meeting join error:', error);
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to join meeting' } });
      }
    });
  }

  private handleMeetingLeave(socket: AuthenticatedSocket) {
    socket.on('meeting.leave', async (payload: { meetingId: string }, ack) => {
      const { user } = socket.data;
      if (!user) return safeAck(ack, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });

      try {
        await prisma.meetingParticipant.updateMany({
          where: { meetingId: payload.meetingId, userId: user.userId, leftAt: null },
          data: { leftAt: new Date() },
        });

        socket.leave(`meeting:${payload.meetingId}`);
        socket.data.subscriptions!.delete(`meeting:${payload.meetingId}`);

        this.io.to(`meeting:${payload.meetingId}`).emit('meeting.participant.left', {
          meetingId: payload.meetingId,
          userId: user.userId,
          leftAt: new Date().toISOString(),
        });

        return safeAck(ack, { ok: true, eventId: crypto.randomUUID() });
      } catch (error) {
        console.error('Meeting leave error:', error);
        return safeAck(ack, { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to leave meeting' } });
      }
    });
  }

  private handleMeetingSignal(socket: AuthenticatedSocket) {
    socket.on('meeting.signal', (payload: { meetingId: string; toUserId: string; signal: any }) => {
      const { user } = socket.data;
      if (!user) return;

      // Forward signal to target user
      this.io.to(`user:${payload.toUserId}`).emit('meeting.signal', {
        meetingId: payload.meetingId,
        fromUserId: user.userId,
        signal: payload.signal,
      });
    });
  }

  private async handleDisconnect(socket: AuthenticatedSocket, userId: string, organizationId: string) {
    // Remove from user sockets
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        this.userSockets.delete(userId);
        // Mark user as offline if no more sessions
        await prisma.presenceSession.updateMany({
          where: { userId, organizationId, status: { not: 'OFFLINE' } },
          data: { status: 'OFFLINE', lastHeartbeat: new Date() },
        });

        this.io.to(`org:${organizationId}`).emit('presence.updated', {
          userId,
          status: 'OFFLINE',
          lastSeen: new Date().toISOString(),
          sessions: 0,
        });
      }
    }

    // Clean up presence session
    await prisma.presenceSession.deleteMany({ where: { socketId: socket.id } });
  }

  // ============================================================
  // PUBLIC METHODS FOR OTHER SERVICES
  // ============================================================

  emitToChannel(channelId: string, event: string, data: any) {
    this.io.to(`channel:${channelId}`).emit(event, data);
  }

  emitToConversation(conversationId: string, event: string, data: any) {
    this.io.to(`dm:${conversationId}`).emit(event, data);
  }

  emitToUser(userId: string, event: string, data: any) {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  emitToOrg(organizationId: string, event: string, data: any) {
    this.io.to(`org:${organizationId}`).emit(event, data);
  }

  emitToMeeting(meetingId: string, event: string, data: any) {
    this.io.to(`meeting:${meetingId}`).emit(event, data);
  }

  getIO(): Server {
    return this.io;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => resolve());
    });
  }
}

// Lazy initialization
let realtimeGateway: RealtimeGateway | null = null;

export function initializeRealtimeGateway(httpServer: HttpServer): RealtimeGateway {
  realtimeGateway = new RealtimeGateway(httpServer);
  return realtimeGateway;
}

export function getRealtimeGateway(): RealtimeGateway | null {
  return realtimeGateway;
}

import crypto from 'crypto';