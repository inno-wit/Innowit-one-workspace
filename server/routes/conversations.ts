import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../prisma';
import { collaborationService } from '../services/collaboration/CollaborationService';
import { notificationService } from '../services/collaboration/NotificationService';

const router = Router();

const createConversationSchema = z.object({
  recipientId: z.string().uuid('Invalid recipient ID'),
});

const conversationParamsSchema = z.object({
  id: z.string().uuid('Invalid conversation ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// GET /api/conversations - List DM conversations
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit } = req.query as any;
  const skip = (page - 1) * limit;

  const userId = req.user!.userId;
  const organizationId = req.user!.organizationId;

  // Get conversations where user is a participant
  const conversations = await prisma.conversation.findMany({
    where: {
      organizationId,
      participants: {
        some: { userId, leftAt: null },
      },
    },
    skip,
    take: limit,
    orderBy: { updatedAt: 'desc' },
    include: {
      participants: {
        where: { leftAt: null },
        include: {
          user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } },
        },
      },
      _count: { select: { messages: true } },
    },
  });

  // For each conversation, get last message and unread count
  const conversationsWithDetails = await Promise.all(conversations.map(async (conv) => {
    const otherParticipant = conv.participants.find(p => p.userId !== userId);
    const lastMessage = await prisma.message.findFirst({
      where: {
        OR: [
          { conversationId: conv.id },
          {
            AND: [
              { senderId: userId },
              { recipientId: otherParticipant?.userId },
            ],
          },
          {
            AND: [
              { senderId: otherParticipant?.userId },
              { recipientId: userId },
            ],
          },
        ],
        organizationId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, content: true, senderId: true, createdAt: true },
    });

    // Get read cursor for this conversation
    const cursor = await prisma.readCursor.findUnique({
      where: { userId_recipientId: { userId, recipientId: conv.id } },
    });

    // Calculate unread count: messages chronologically after the last read message
    // Only count messages FROM the other participant (exclude own messages)
    const otherUserId = otherParticipant?.userId;
    const baseWhere: any = {
      organizationId,
      deletedAt: null,
      NOT: { senderId: userId }, // Exclude own messages
      OR: otherUserId
        ? [
            { conversationId: conv.id },
            { senderId: otherUserId, recipientId: userId },
          ]
        : [{ conversationId: conv.id }],
    };

    let unreadCount: number;
    if (cursor?.lastReadMessageId) {
      const cursorMessage = await prisma.message.findUnique({
        where: { id: cursor.lastReadMessageId },
        select: { createdAt: true, id: true },
      });
      if (cursorMessage) {
        unreadCount = await prisma.message.count({
          where: {
            ...baseWhere,
            OR: [
              { createdAt: { gt: cursorMessage.createdAt } },
              { createdAt: cursorMessage.createdAt, id: { gt: cursorMessage.id } },
            ],
          },
        });
      } else {
        // Cursor message not found (deleted?) - count all as unread
        unreadCount = await prisma.message.count({ where: baseWhere });
      }
    } else {
      // No cursor - all messages from other participant are unread
      unreadCount = await prisma.message.count({ where: baseWhere });
    }

    return {
      id: conv.id,
      type: conv.type,
      participants: conv.participants.map(p => ({
        id: p.user.id,
        fullName: p.user.fullName,
        avatarUrl: p.user.avatarUrl,
        role: p.user.role,
        presence: 'ONLINE', // Would come from presence service
      })),
      lastMessage,
      unreadCount,
      updatedAt: conv.updatedAt,
    };
  }));

  const total = await prisma.conversation.count({
    where: {
      organizationId,
      participants: { some: { userId, leftAt: null } },
    },
  });

  res.json({
    data: conversationsWithDetails,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/conversations/:id
router.get('/:id', authenticateToken, validateParams(conversationParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.userId;
  const organizationId = req.user!.organizationId;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      participants: {
        where: { leftAt: null },
        include: {
          user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } },
        },
      },
    },
  });

  if (!conversation) throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
  if (conversation.organizationId !== organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const isParticipant = conversation.participants.some(p => p.userId === userId);
  if (!isParticipant) throw new AppError(403, 'FORBIDDEN', 'Not a participant in this conversation');

  res.json({ data: conversation });
}));

// POST /api/conversations - Create or open DM (create-or-open semantics)
// Uses database-enforced directKey for concurrency-safe deterministic identity
router.post('/', authenticateToken, validateBody(createConversationSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { recipientId } = req.body;
  const userId = req.user!.userId;
  const organizationId = req.user!.organizationId;

  if (recipientId === userId) {
    throw new AppError(400, 'INVALID_REQUEST', 'Cannot create conversation with yourself');
  }

  // Verify recipient exists and is in same organization
  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { id: true, organizationId: true, fullName: true, email: true, avatarUrl: true, role: true },
  });

  if (!recipient || recipient.organizationId !== organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Recipient not found');
  }

  // Normalize participant pair for deterministic directKey
  const [userA, userB] = [userId, recipientId].sort();
  const directKey = `${organizationId}:${userA}:${userB}`;

  // Try to find existing conversation by directKey (fast path)
  let conversation = await prisma.conversation.findUnique({
    where: { directKey },
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } } },
      },
    },
  });

  if (conversation) {
    return res.json({ data: conversation });
  }

  // Create new conversation with directKey (database enforces uniqueness)
  try {
    conversation = await prisma.conversation.create({
      data: {
        type: 'DIRECT',
        organizationId,
        createdById: userId,
        directKey,
        participants: {
          create: [
            { userId, role: 'MEMBER' },
            { userId: recipientId, role: 'MEMBER' },
          ],
        },
      },
      include: {
        participants: {
          include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } } },
        },
      },
    });
    return res.status(201).json({ data: conversation });
  } catch (error: any) {
    // Handle unique constraint race: another request created it concurrently
    if (error.code === 'P2002' && error.meta?.target?.includes('directKey')) {
      // Re-read the canonical conversation
      conversation = await prisma.conversation.findUnique({
        where: { directKey },
        include: {
          participants: {
            where: { leftAt: null },
            include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } } },
          },
        },
      });
      if (conversation) {
        return res.json({ data: conversation });
      }
    }
    throw error;
  }
}));

// POST /api/conversations/group - Create group DM
router.post('/group', authenticateToken, validateBody(z.object({
  name: z.string().min(1).max(100),
  participantIds: z.array(z.string().uuid()).min(2).max(50),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { name, participantIds } = req.body;
  const userId = req.user!.userId;
  const organizationId = req.user!.organizationId;

  // Verify all participants exist and are in same organization
  const participants = await prisma.user.findMany({
    where: { id: { in: participantIds }, organizationId },
    select: { id: true },
  });

  if (participants.length !== participantIds.length) {
    throw new AppError(404, 'NOT_FOUND', 'One or more participants not found');
  }

  // Ensure current user is included
  if (!participantIds.includes(userId)) {
    participantIds.push(userId);
  }

  const conversation = await prisma.conversation.create({
    data: {
      type: 'GROUP',
      title: name,
      organizationId,
      createdById: userId,
      participants: {
        create: participantIds.map(id => ({
          userId: id,
          role: id === userId ? 'ADMIN' : 'MEMBER',
        })),
      },
    },
    include: {
      participants: {
        include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } } },
      },
    },
  });

  res.status(201).json({ data: conversation });
}));

// POST /api/conversations/:id/read - Mark conversation as read
// Cursor only advances forward monotonically (never backwards)
router.post('/:id/read', authenticateToken, validateParams(conversationParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id }: { id: string } = req.params;
  const { messageId } = req.body;
  const userId = req.user!.userId;
  const organizationId = req.user!.organizationId;

  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: id, userId } },
  });

  if (!participant) throw new AppError(403, 'FORBIDDEN', 'Not a participant in this conversation');

  // Get existing cursor to enforce monotonic advancement
  const existingCursor = await prisma.readCursor.findUnique({
    where: { userId_recipientId: { userId, recipientId: id } },
    select: { lastReadMessageId: true },
  });

  let shouldUpdate = true;
  if (existingCursor?.lastReadMessageId && existingCursor.lastReadMessageId !== messageId) {
    // Compare timestamps to ensure monotonic advancement
    const [currentMsg, newMsg] = await Promise.all([
      prisma.message.findUnique({ where: { id: existingCursor.lastReadMessageId }, select: { createdAt: true, id: true } }),
      prisma.message.findUnique({ where: { id: messageId }, select: { createdAt: true, id: true } }),
    ]);

    if (currentMsg && newMsg) {
      // Only advance if new message is chronologically after current cursor
      const isAfter = newMsg.createdAt > currentMsg.createdAt ||
        (newMsg.createdAt.getTime() === currentMsg.createdAt.getTime() && newMsg.id > currentMsg.id);
      shouldUpdate = isAfter;
    }
  }

  if (shouldUpdate) {
    await prisma.readCursor.upsert({
      where: { userId_recipientId: { userId, recipientId: id } },
      update: { lastReadMessageId: messageId, lastReadAt: new Date() },
      create: { userId, recipientId: id, organizationId, lastReadMessageId: messageId },
    });
  }

  res.json({ success: true });
}));

export default router;