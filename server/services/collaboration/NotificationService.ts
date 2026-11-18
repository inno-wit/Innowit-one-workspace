import { prisma } from '../../prisma';
import { AppError } from '../../middleware/errorHandler';

export interface CreateNotificationInput {
  userId: string;
  organizationId: string;
  type: 'MENTION' | 'DIRECT_MESSAGE' | 'THREAD_REPLY' | 'REACTION' | 'CHANNEL_INVITE' | 'MESSAGE_PINNED' | 'HUDDLE_STARTED' | 'FILE_SHARED' | 'SYSTEM';
  title: string;
  body?: string;
  data?: Record<string, any>;
}

export interface NotificationPreferences {
  desktopEnabled: boolean;
  previewEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  mutedChannels: string[];
  mutedUsers: string[];
}

export class NotificationService {
  async createNotification(data: CreateNotificationInput) {
    // Check user preferences for muting
    const prefs = await this.getPreferences(data.userId);

    if (data.type === 'DIRECT_MESSAGE' && prefs.mutedUsers.includes(data.data?.senderId || '')) {
      return null; // Don't create notification for muted user
    }

    if (data.type === 'MENTION' && data.data?.channelId && prefs.mutedChannels.includes(data.data.channelId)) {
      return null; // Don't create notification for muted channel
    }

    const notification = await prisma.notification.create({
      data: {
        ...data,
        dataJson: data.data ? JSON.stringify(data.data) : null,
      },
    });

    return notification;
  }

  async createBulkNotifications(notifications: CreateNotificationInput[]) {
    const results = await Promise.all(
      notifications.map((n) => this.createNotification(n))
    );
    return results.filter((n) => n !== null);
  }

  async getNotifications(
    userId: string,
    organizationId: string,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {}
  ) {
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const skip = (page - 1) * limit;

    const where: any = { userId, organizationId };
    if (unreadOnly) where.isRead = false;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      data: notifications.map((n) => ({
        ...n,
        data: n.dataJson ? JSON.parse(n.dataJson) : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) throw new AppError(404, 'NOT_FOUND', 'Notification not found');
    if (notification.userId !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Not your notification');
    }

    if (notification.isRead) return notification;

    return prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string, organizationId: string) {
    await prisma.notification.updateMany({
      where: { userId, organizationId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return { success: true };
  }

  async getUnreadCount(userId: string, organizationId: string) {
    const count = await prisma.notification.count({
      where: { userId, organizationId, isRead: false },
    });

    return count;
  }

  async getPreferences(userId: string, organizationId?: string): Promise<NotificationPreferences> {
    let prefs = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    if (!prefs) {
      let orgId = organizationId;
      if (!orgId) {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
        orgId = user?.organizationId;
      }
      if (!orgId) {
        throw new AppError(400, 'User has no organization', 'VALIDATION_ERROR');
      }
      prefs = await prisma.notificationPreference.create({
        data: {
          userId,
          organizationId: orgId,
          desktopEnabled: true,
          previewEnabled: false,
        },
      });
    }

    return {
      desktopEnabled: prefs.desktopEnabled,
      previewEnabled: prefs.previewEnabled,
      quietHoursStart: prefs.quietHoursStart ?? undefined,
      quietHoursEnd: prefs.quietHoursEnd ?? undefined,
      mutedChannels: prefs.mutedChannels || [],
      mutedUsers: prefs.mutedUsers || [],
    };
  }

  async updatePreferences(userId: string, organizationId: string, updates: Partial<NotificationPreferences>) {
    return prisma.notificationPreference.upsert({
      where: { userId },
      update: updates,
      create: {
        userId,
        organizationId,
        desktopEnabled: updates.desktopEnabled ?? true,
        previewEnabled: updates.previewEnabled ?? false,
        quietHoursStart: updates.quietHoursStart,
        quietHoursEnd: updates.quietHoursEnd,
        mutedChannels: updates.mutedChannels || [],
        mutedUsers: updates.mutedUsers || [],
      },
    });
  }

  // ============================================================
  // NOTIFICATION TRIGGERS
  // ============================================================

  async notifyMention(
    mentionedUserIds: string[],
    actorId: string,
    actorName: string,
    channelId: string,
    channelName: string,
    messageId: string,
    messageContent: string,
    organizationId: string
  ) {
    const notifications = mentionedUserIds
      .filter((id) => id !== actorId) // Don't notify self
      .map((userId) => ({
        userId,
        organizationId,
        type: 'MENTION' as const,
        title: `${actorName} mentioned you in #${channelName}`,
        body: messageContent.length > 100 ? messageContent.substring(0, 100) + '...' : messageContent,
        data: { channelId, messageId, actorId },
      }));

    return this.createBulkNotifications(notifications);
  }

  async notifyDirectMessage(
    recipientId: string,
    senderId: string,
    senderName: string,
    conversationId: string,
    messageId: string,
    messageContent: string,
    organizationId: string
  ) {
    return this.createNotification({
      userId: recipientId,
      organizationId,
      type: 'DIRECT_MESSAGE',
      title: `New message from ${senderName}`,
      body: messageContent.length > 100 ? messageContent.substring(0, 100) + '...' : messageContent,
      data: { conversationId, messageId, senderId },
    });
  }

  async notifyThreadReply(
    participantIds: string[],
    actorId: string,
    actorName: string,
    parentMessageId: string,
    replyContent: string,
    organizationId: string
  ) {
    const notifications = participantIds
      .filter((id) => id !== actorId)
      .map((userId) => ({
        userId,
        organizationId,
        type: 'THREAD_REPLY' as const,
        title: `${actorName} replied to a thread`,
        body: replyContent.length > 100 ? replyContent.substring(0, 100) + '...' : replyContent,
        data: { parentMessageId, actorId },
      }));

    return this.createBulkNotifications(notifications);
  }

  async notifyReaction(
    messageAuthorId: string,
    reactorId: string,
    reactorName: string,
    emoji: string,
    messageId: string,
    organizationId: string
  ) {
    if (messageAuthorId === reactorId) return null; // Don't notify self

    return this.createNotification({
      userId: messageAuthorId,
      organizationId,
      type: 'REACTION',
      title: `${reactorName} reacted with ${emoji}`,
      data: { messageId, reactorId, emoji },
    });
  }

  async notifyChannelInvite(
    invitedUserId: string,
    inviterId: string,
    inviterName: string,
    channelId: string,
    channelName: string,
    organizationId: string
  ) {
    return this.createNotification({
      userId: invitedUserId,
      organizationId,
      type: 'CHANNEL_INVITE',
      title: `${inviterName} added you to #${channelName}`,
      data: { channelId, inviterId },
    });
  }

  async notifyMessagePinned(
    channelMemberIds: string[],
    actorId: string,
    actorName: string,
    channelId: string,
    channelName: string,
    messageId: string,
    organizationId: string
  ) {
    const notifications = channelMemberIds
      .filter((id) => id !== actorId)
      .map((userId) => ({
        userId,
        organizationId,
        type: 'MESSAGE_PINNED' as const,
        title: `${actorName} pinned a message in #${channelName}`,
        data: { channelId, messageId, actorId },
      }));

    return this.createBulkNotifications(notifications);
  }

  async notifyHuddleStarted(
    channelMemberIds: string[],
    actorId: string,
    actorName: string,
    channelId: string,
    channelName: string,
    meetingId: string,
    organizationId: string
  ) {
    const notifications = channelMemberIds
      .filter((id) => id !== actorId)
      .map((userId) => ({
        userId,
        organizationId,
        type: 'HUDDLE_STARTED' as const,
        title: `${actorName} started a huddle in #${channelName}`,
        data: { channelId, meetingId, actorId },
      }));

    return this.createBulkNotifications(notifications);
  }

  async notifyFileShared(
    channelMemberIds: string[],
    actorId: string,
    actorName: string,
    channelId: string,
    channelName: string,
    fileId: string,
    fileName: string,
    organizationId: string
  ) {
    const notifications = channelMemberIds
      .filter((id) => id !== actorId)
      .map((userId) => ({
        userId,
        organizationId,
        type: 'FILE_SHARED' as const,
        title: `${actorName} shared a file in #${channelName}`,
        body: fileName,
        data: { channelId, fileId, actorId },
      }));

    return this.createBulkNotifications(notifications);
  }
}

export const notificationService = new NotificationService();