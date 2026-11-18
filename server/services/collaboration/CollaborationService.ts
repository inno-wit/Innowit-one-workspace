import { prisma } from '../../prisma';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../middleware/auth';
import { orgWhereClause, sanitizeCreateInput, verifyOrgOwnership } from '../../middleware/tenant';

export interface CreateChannelInput {
  name: string;
  description?: string;
  topic?: string;
  isPrivate?: boolean;
  branchId?: string;
}

export interface UpdateChannelInput {
  name?: string;
  description?: string;
  topic?: string;
  isPrivate?: boolean;
  branchId?: string;
}

export interface ListChannelsOptions {
  page?: number;
  limit?: number;
  search?: string;
  archived?: boolean;
  branchId?: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface SendMessageInput {
  channelId?: string;
  conversationId?: string;
  recipientId?: string;
  content: string;
  parentId?: string;
  idempotencyKey: string;
}

export interface EditMessageInput {
  content: string;
}

export interface SearchMessagesOptions {
  channelId?: string;
  conversationId?: string;
  limit?: number;
}

export class CollaborationService {
  // ============================================================
  // CHANNELS
  // ============================================================

  async createChannel(data: CreateChannelInput, userId: string, organizationId: string) {
    const channel = await prisma.$transaction(async (tx) => {
      const newChannel = await tx.channel.create({
        data: {
          ...data,
          createdById: userId,
          organizationId,
          isPrivate: data.isPrivate ?? false,
        },
      });

      // Add creator as member
      await tx.channelMember.create({
        data: {
          channelId: newChannel.id,
          userId,
          organizationId,
        },
      });

      // Create read cursor for creator
      await tx.readCursor.create({
        data: {
          userId,
          channelId: newChannel.id,
          organizationId,
          lastReadAt: new Date(),
        },
      }).catch(() => {}); // Ignore if exists

      return newChannel;
    });

    return channel;
  }

  async getChannel(id: string, userId: string, organizationId: string) {
    const channel = await prisma.channel.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } },
          },
        },
        _count: { select: { messages: true } },
      },
    });

    if (!channel) return null;

    await verifyOrgOwnership({ user: { organizationId } } as any, channel, 'Channel');

    // Check if user is member or channel is public
    const isMember = channel.members.some((m) => m.userId === userId);
    if (channel.isPrivate && !isMember) {
      throw new AppError(403, 'FORBIDDEN', 'Private channel - not a member');
    }

    return channel;
  }

  async listChannels(userId: string, organizationId: string, options: ListChannelsOptions = {}): Promise<Paginated<any>> {
    const { page = 1, limit = 20, search, archived = false, branchId } = options;
    const skip = (page - 1) * limit;

    const where = orgWhereClause({ organizationId } as any, {
      isArchived: archived,
      OR: [
        { members: { some: { userId } } },
        { isPrivate: false },
      ],
      ...(branchId ? { branchId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    });

    const [channels, total] = await Promise.all([
      prisma.channel.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { members: true, messages: true } },
          members: {
            where: { userId },
            select: { id: true },
          },
        },
      }),
      prisma.channel.count({ where }),
    ]);

    const channelsWithMembership = channels.map((c) => ({
      ...c,
      isMember: c.members.length > 0,
      members: undefined,
    }));

    return {
      data: channelsWithMembership,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async updateChannel(id: string, data: UpdateChannelInput, userId: string, organizationId: string, userRole: string) {
    const channel = await prisma.channel.findUnique({ where: { id } });

    if (!channel) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, channel, 'Channel');

    // Only creator or admin can update
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole);
    if (channel.createdById !== userId && !isAdmin) {
      throw new AppError(403, 'FORBIDDEN', 'Only channel creator or admin can update');
    }

    const updatedChannel = await prisma.channel.update({
      where: { id },
      data,
    });

    return updatedChannel;
  }

  async archiveChannel(id: string, userId: string, organizationId: string, userRole: string) {
    const channel = await prisma.channel.findUnique({ where: { id } });

    if (!channel) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, channel, 'Channel');

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole);
    if (channel.createdById !== userId && !isAdmin) {
      throw new AppError(403, 'FORBIDDEN', 'Only channel creator or admin can archive');
    }

    await prisma.channel.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
    });

    return { success: true };
  }

  async unarchiveChannel(id: string, userId: string, organizationId: string, userRole: string) {
    const channel = await prisma.channel.findUnique({ where: { id } });

    if (!channel) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, channel, 'Channel');

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole);
    if (channel.createdById !== userId && !isAdmin) {
      throw new AppError(403, 'FORBIDDEN', 'Only channel creator or admin can unarchive');
    }

    await prisma.channel.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    });

    return { success: true };
  }

  async deleteChannel(id: string, userId: string, organizationId: string, userRole: string) {
    const channel = await prisma.channel.findUnique({ where: { id } });

    if (!channel) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, channel, 'Channel');

    // Only SUPER_ADMIN or ADMIN can delete
    if (!['SUPER_ADMIN', 'ADMIN'].includes(userRole)) {
      throw new AppError(403, 'FORBIDDEN', 'Only SUPER_ADMIN or ADMIN can delete channels');
    }

    await prisma.channel.delete({ where: { id } });
    return { success: true };
  }

  // ============================================================
  // CHANNEL MEMBERSHIP
  // ============================================================

  async addMember(channelId: string, userId: string, actorId: string, organizationId: string, actorRole: string) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });

    if (!channel) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, channel, 'Channel');

    if (channel.isPrivate) {
      const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(actorRole);
      if (channel.createdById !== actorId && !isAdmin) {
        throw new AppError(403, 'FORBIDDEN', 'Only channel creator or admin can add members to private channel');
      }
    }

    // Verify user exists and is in same organization
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.organizationId !== organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }

    // Check if already member
    const existing = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });

    if (existing) {
      throw new AppError(409, 'ALREADY_MEMBER', 'User is already a member');
    }

    const member = await prisma.channelMember.create({
      data: { channelId, userId, organizationId },
      include: {
        user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } },
      },
    });

    // Create read cursor for new member
    await prisma.readCursor.create({
      data: {
        userId,
        channelId,
        organizationId,
        lastReadAt: new Date(),
      },
    }).catch(() => {}); // Ignore if exists

    return member;
  }

  async removeMember(channelId: string, userId: string, actorId: string, organizationId: string, actorRole: string) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });

    if (!channel) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, channel, 'Channel');

    // Can remove self, or creator/admin can remove others
    const isSelf = userId === actorId;
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(actorRole);
    const isCreator = channel.createdById === actorId;

    if (!isSelf && !isCreator && !isAdmin) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot remove other members');
    }

    await prisma.channelMember.delete({
      where: { channelId_userId: { channelId, userId } },
    });

    return { success: true };
  }

  async listMembers(channelId: string, userId: string, organizationId: string) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });

    if (!channel) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, channel, 'Channel');

    const isMember = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });

    if (channel.isPrivate && !isMember) {
      throw new AppError(403, 'FORBIDDEN', 'Not a member of this channel');
    }

    return prisma.channelMember.findMany({
      where: { channelId },
      include: {
        user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  // ============================================================
  // MESSAGES
  // ============================================================

  async sendMessage(data: SendMessageInput, userId: string, organizationId: string) {
    // Verify channel access if posting to channel
    if (data.channelId) {
      const membership = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId: data.channelId, userId } },
      });

      if (!membership) {
        const channel = await prisma.channel.findUnique({
          where: { id: data.channelId },
        });

        if (!channel || channel.isPrivate) {
          throw new AppError(403, 'FORBIDDEN', 'Not a member of this channel');
        }
      }
    }

    // Verify recipient if DM
    if (data.recipientId) {
      const recipient = await prisma.user.findUnique({
        where: { id: data.recipientId },
      });

      if (!recipient || recipient.organizationId !== organizationId) {
        throw new AppError(404, 'NOT_FOUND', 'Recipient not found');
      }
    }

    // Verify conversation if provided
    if (data.conversationId) {
      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: data.conversationId, userId } },
      });

      if (!participant) {
        throw new AppError(403, 'FORBIDDEN', 'Not a participant in this conversation');
      }
    }

    // Verify parent message if replying
    let threadRootId: string | undefined;
    if (data.parentId) {
      const parent = await prisma.message.findUnique({
        where: { id: data.parentId },
      });

      if (!parent) {
        throw new AppError(404, 'NOT_FOUND', 'Parent message not found');
      }

      // Check access to parent
      const hasAccess =
        parent.senderId === userId ||
        parent.recipientId === userId ||
        (parent.channelId &&
          (await prisma.channelMember.findUnique({
            where: { channelId_userId: { channelId: parent.channelId, userId } },
          })));

      if (!hasAccess) {
        throw new AppError(403, 'FORBIDDEN', 'Cannot reply to this message');
      }

      threadRootId = parent.threadRootId || parent.id;
    }

    // Check idempotency
    const existing = await prisma.message.findFirst({
      where: {
        idempotencyKey: data.idempotencyKey,
        senderId: userId,
        OR: [
          { channelId: data.channelId },
          { recipientId: data.recipientId },
          { conversationId: data.conversationId },
        ],
      },
    });

    if (existing) {
      return { ...existing, _existing: true };
    }

    const message = await prisma.message.create({
      data: {
        ...data,
        senderId: userId,
        organizationId,
        threadRootId,
      },
      include: {
        sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        channel: { select: { id: true, name: true } },
      },
    });

    // Update read cursor for sender
    if (data.channelId) {
      await prisma.readCursor.upsert({
        where: { userId_channelId: { userId, channelId: data.channelId } },
        update: { lastReadMessageId: message.id, lastReadAt: new Date() },
        create: { userId, channelId: data.channelId, organizationId, lastReadMessageId: message.id },
      });
    }

    return { ...message, _existing: false };
  }

  async getMessage(id: string, userId: string, organizationId: string) {
    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        channel: { select: { id: true, name: true } },
        parent: {
          select: { id: true, content: true, sender: { select: { id: true, fullName: true } } },
        },
        replies: {
          include: {
            sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        reactions: true,
        attachments: true,
      },
    });

    if (!message) throw new AppError(404, 'NOT_FOUND', 'Message not found');

    // Check access
    const hasAccess =
      message.senderId === userId ||
      message.recipientId === userId ||
      (message.channelId &&
        (await prisma.channelMember.findUnique({
          where: { channelId_userId: { channelId: message.channelId, userId } },
        }))) ||
      (message.conversationId &&
        (await prisma.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId: message.conversationId, userId } },
        })));

    if (!hasAccess) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied');
    }

    return message;
  }

  async listMessages(
    userId: string,
    organizationId: string,
    options: { channelId?: string; recipientId?: string; conversationId?: string; cursor?: string; limit?: number; direction?: 'before' | 'after' } = {}
  ) {
    const { channelId, recipientId, conversationId, cursor, limit = 50, direction = 'before' } = options;

    const where: any = { organizationId, deletedAt: null };

    if (channelId) {
      const membership = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId } },
      });

      if (!membership) {
        const channel = await prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel || channel.isPrivate) {
          throw new AppError(403, 'FORBIDDEN', 'Not a member of this channel');
        }
      }

      where.channelId = channelId;
    } else if (conversationId) {
      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });

      if (!participant) {
        throw new AppError(403, 'FORBIDDEN', 'Not a participant in this conversation');
      }

      where.conversationId = conversationId;
    } else if (recipientId) {
      where.OR = [
        { senderId: userId, recipientId },
        { senderId: recipientId, recipientId: userId },
      ];
      where.channelId = null;
      where.conversationId = null;
    } else {
      // All messages user has access to
      where.OR = [
        { senderId: userId },
        { recipientId: userId },
        { channel: { members: { some: { userId } } } },
        { conversation: { participants: { some: { userId } } } },
      ];
    }

    if (cursor) {
      const cursorMessage = await prisma.message.findUnique({ where: { id: cursor } });
      if (cursorMessage) {
        where.createdAt = direction === 'before' ? { lt: cursorMessage.createdAt } : { gt: cursorMessage.createdAt };
      }
    }

    const messages = await prisma.message.findMany({
      where,
      take: limit + 1, // Fetch one extra to check hasMore
      orderBy: { createdAt: direction === 'before' ? 'desc' : 'asc' },
      include: {
        sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        channel: { select: { id: true, name: true } },
        parent: {
          select: { id: true, content: true, sender: { select: { id: true, fullName: true } } },
        },
        _count: { select: { replies: true, attachments: true } },
        reactions: true,
      },
    });

    const hasMore = messages.length > limit;
    const data = hasMore ? messages.slice(0, -1) : messages;
    const nextCursor = data.length > 0 ? data[data.length - 1].id : null;

    return { data, hasMore, nextCursor };
  }

  async editMessage(id: string, content: string, userId: string, organizationId: string, userRole: string) {
    const message = await prisma.message.findUnique({ where: { id } });

    if (!message) throw new AppError(404, 'NOT_FOUND', 'Message not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, message, 'Message');

    // Only sender can edit (or admin)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole);
    if (message.senderId !== userId && !isAdmin) {
      throw new AppError(403, 'FORBIDDEN', 'Can only edit own messages');
    }

    const updatedMessage = await prisma.message.update({
      where: { id },
      data: {
        content,
        editedAt: new Date(),
        editedById: userId,
      },
      include: {
        sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        channel: { select: { id: true, name: true } },
      },
    });

    return updatedMessage;
  }

  async deleteMessage(id: string, userId: string, organizationId: string, userRole: string, hard = false) {
    const message = await prisma.message.findUnique({ where: { id } });

    if (!message) throw new AppError(404, 'NOT_FOUND', 'Message not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, message, 'Message');

    // Sender or admin can delete
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole);
    if (message.senderId !== userId && !isAdmin) {
      throw new AppError(403, 'FORBIDDEN', 'Can only delete own messages');
    }

    if (hard && isAdmin) {
      await prisma.message.delete({ where: { id } });
    } else {
      await prisma.message.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedById: userId,
          content: '[Deleted]',
        },
      });
    }

    return { success: true };
  }

  async pinMessage(id: string, userId: string, organizationId: string, userRole: string) {
    const message = await prisma.message.findUnique({ where: { id } });

    if (!message) throw new AppError(404, 'NOT_FOUND', 'Message not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, message, 'Message');

    // Channel member or admin can pin
    if (message.channelId) {
      const membership = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId: message.channelId, userId } },
      });
      const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole);
      if (!membership && !isAdmin) {
        throw new AppError(403, 'FORBIDDEN', 'Must be channel member to pin');
      }
    }

    const updatedMessage = await prisma.message.update({
      where: { id },
      data: { isPinned: true },
      include: {
        sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        channel: { select: { id: true, name: true } },
      },
    });

    return updatedMessage;
  }

  async unpinMessage(id: string, userId: string, organizationId: string, userRole: string) {
    const message = await prisma.message.findUnique({ where: { id } });

    if (!message) throw new AppError(404, 'NOT_FOUND', 'Message not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, message, 'Message');

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole);
    if (message.channelId) {
      const membership = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId: message.channelId, userId } },
      });
      if (!membership && !isAdmin) {
        throw new AppError(403, 'FORBIDDEN', 'Must be channel member to unpin');
      }
    }

    const updatedMessage = await prisma.message.update({
      where: { id },
      data: { isPinned: false },
      include: {
        sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        channel: { select: { id: true, name: true } },
      },
    });

    return updatedMessage;
  }

  // ============================================================
  // REACTIONS
  // ============================================================

  async addReaction(messageId: string, emoji: string, userId: string, organizationId: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });

    if (!message) throw new AppError(404, 'NOT_FOUND', 'Message not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, message, 'Message');

    // Check access
    const hasAccess =
      message.senderId === userId ||
      message.recipientId === userId ||
      (message.channelId &&
        (await prisma.channelMember.findUnique({
          where: { channelId_userId: { channelId: message.channelId, userId } },
        }))) ||
      (message.conversationId &&
        (await prisma.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId: message.conversationId, userId } },
        })));

    if (!hasAccess) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot react to this message');
    }

    const reaction = await prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
      update: {},
      create: { messageId, userId, emoji, organizationId },
    });

    // Get updated reaction with count
    const reactions = await prisma.reaction.groupBy({
      by: ['emoji'],
      where: { messageId },
      _count: { emoji: true },
    });

    const users = await prisma.reaction.findMany({
      where: { messageId, emoji },
      select: { userId: true },
    });

    return {
      messageId,
      emoji,
      count: reactions.find((r) => r.emoji === emoji)?._count.emoji || 1,
      users: users.map((u) => u.userId),
      currentUserReacted: true,
    };
  }

  async removeReaction(messageId: string, emoji: string, userId: string, organizationId: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });

    if (!message) throw new AppError(404, 'NOT_FOUND', 'Message not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, message, 'Message');

    await prisma.reaction.deleteMany({
      where: { messageId, userId, emoji },
    });

    const reactions = await prisma.reaction.groupBy({
      by: ['emoji'],
      where: { messageId },
      _count: { emoji: true },
    });

    const users = await prisma.reaction.findMany({
      where: { messageId, emoji },
      select: { userId: true },
    });

    return {
      messageId,
      emoji,
      count: reactions.find((r) => r.emoji === emoji)?._count.emoji || 0,
      users: users.map((u) => u.userId),
      currentUserReacted: false,
    };
  }

  async getReactions(messageId: string, userId: string, organizationId: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });

    if (!message) throw new AppError(404, 'NOT_FOUND', 'Message not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, message, 'Message');

    const reactions = await prisma.reaction.findMany({
      where: { messageId },
      include: { user: { select: { id: true, fullName: true } } },
    });

    // Group by emoji
    const grouped = reactions.reduce((acc, r) => {
      if (!acc[r.emoji]) {
        acc[r.emoji] = { emoji: r.emoji, count: 0, users: [], currentUserReacted: false };
      }
      acc[r.emoji].count++;
      acc[r.emoji].users.push(r.user.fullName);
      if (r.userId === userId) acc[r.emoji].currentUserReacted = true;
      return acc;
    }, {} as Record<string, any>);

    return Object.values(grouped);
  }

  // ============================================================
  // THREADS
  // ============================================================

  async getThread(parentId: string, userId: string, organizationId: string) {
    const parent = await prisma.message.findUnique({ where: { id: parentId } });

    if (!parent) throw new AppError(404, 'NOT_FOUND', 'Parent message not found');
    await verifyOrgOwnership({ user: { organizationId } } as any, parent, 'Message');

    // Check access to parent
    const hasAccess =
      parent.senderId === userId ||
      parent.recipientId === userId ||
      (parent.channelId &&
        (await prisma.channelMember.findUnique({
          where: { channelId_userId: { channelId: parent.channelId, userId } },
        }))) ||
      (parent.conversationId &&
        (await prisma.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId: parent.conversationId, userId } },
        })));

    if (!hasAccess) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot view this thread');
    }

    const replies = await prisma.message.findMany({
      where: { threadRootId: parent.threadRootId || parentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        reactions: true,
      },
    });

    return { parent, replies };
  }

  // ============================================================
  // SEARCH
  // ============================================================

  async searchMessages(query: string, userId: string, organizationId: string, options: SearchMessagesOptions = {}) {
    const { channelId, conversationId, limit = 20 } = options;

    if (query.length < 2) return [];

    const where: any = {
      organizationId,
      deletedAt: null,
      content: { contains: query, mode: 'insensitive' },
    };

    if (channelId) {
      where.channelId = channelId;
    } else if (conversationId) {
      where.conversationId = conversationId;
    } else {
      // Search across accessible channels and DMs
      where.OR = [
        { senderId: userId },
        { recipientId: userId },
        { channel: { members: { some: { userId } } } },
        { conversation: { participants: { some: { userId } } } },
      ];
    }

    return prisma.message.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        channel: { select: { id: true, name: true } },
        parent: {
          select: { id: true, content: true, sender: { select: { id: true, fullName: true } } },
        },
        reactions: true,
      },
    });
  }
}

export const collaborationService = new CollaborationService();