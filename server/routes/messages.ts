import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createMessageSchema = z.object({
  channelId: z.string().uuid().optional(),
  recipientId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  content: z.string().min(1, 'Content is required'),
}).refine(data => data.channelId || data.recipientId, {
  message: 'Either channelId or recipientId is required',
});

const updateMessageSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  isPinned: z.boolean().optional(),
});

const messageParamsSchema = z.object({
  id: z.string().uuid('Invalid message ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  channelId: z.string().uuid().optional(),
  recipientId: z.string().uuid().optional(),
});

// GET /api/messages
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, channelId, recipientId } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (channelId) {
    // Check if user is member of channel
    const membership = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: req.user!.userId } },
    });

    if (!membership) {
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
      });

      if (!channel || channel.isPrivate) {
        throw new AppError(403, 'FORBIDDEN', 'Not a member of this channel');
      }
    }

    where.channelId = channelId;
  } else if (recipientId) {
    // Direct messages - user is either sender or recipient
    where.OR = [
      { senderId: req.user!.userId, recipientId },
      { senderId: recipientId, recipientId: req.user!.userId },
    ];
    where.channelId = null;
  } else {
    // All messages user has access to
    where.OR = [
      { senderId: req.user!.userId },
      { recipientId: req.user!.userId },
      { channel: { members: { some: { userId: req.user!.userId } } } },
    ];
  }

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        channel: { select: { id: true, name: true } },
        parent: {
          select: { id: true, content: true, sender: { select: { id: true, fullName: true } } },
        },
        _count: { select: { replies: true, attachments: true } },
      },
    }),
    prisma.message.count({ where }),
  ]);

  res.json({
    data: messages,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/messages/:id
router.get('/:id', authenticateToken, validateParams(messageParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

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
      attachments: true,
    },
  });

  if (!message) {
    throw new AppError(404, 'NOT_FOUND', 'Message not found');
  }

  // Check access
  const hasAccess = 
    message.senderId === req.user!.userId ||
    message.recipientId === req.user!.userId ||
    (message.channelId && await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: message.channelId, userId: req.user!.userId } },
    }));

  if (!hasAccess) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: message });
}));

// POST /api/messages
router.post('/', authenticateToken, validateBody(createMessageSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify channel access if posting to channel
  if (data.channelId) {
    const membership = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: data.channelId, userId: req.user!.userId } },
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

    if (!recipient || recipient.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Recipient not found');
    }
  }

  // Verify parent message if replying
  if (data.parentId) {
    const parent = await prisma.message.findUnique({
      where: { id: data.parentId },
    });

    if (!parent) {
      throw new AppError(404, 'NOT_FOUND', 'Parent message not found');
    }

    // Check access to parent
    const hasAccess = 
      parent.senderId === req.user!.userId ||
      parent.recipientId === req.user!.userId ||
      (parent.channelId && await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId: parent.channelId, userId: req.user!.userId } },
      }));

    if (!hasAccess) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot reply to this message');
    }
  }

  const message = await prisma.message.create({
    data: {
      ...data,
      senderId: req.user!.userId,
    },
    include: {
      sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      channel: { select: { id: true, name: true } },
    },
  });

  res.status(201).json({ data: message });
}));

// PUT /api/messages/:id
router.put('/:id', authenticateToken, validateParams(messageParamsSchema), validateBody(updateMessageSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const message = await prisma.message.findUnique({
    where: { id },
  });

  if (!message) {
    throw new AppError(404, 'NOT_FOUND', 'Message not found');
  }

  // Only sender can edit
  if (message.senderId !== req.user!.userId && req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Can only edit own messages');
  }

  const updatedMessage = await prisma.message.update({
    where: { id },
    data: req.body,
    include: {
      sender: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      channel: { select: { id: true, name: true } },
    },
  });

  res.json({ data: updatedMessage });
}));

// DELETE /api/messages/:id
router.delete('/:id', authenticateToken, validateParams(messageParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const message = await prisma.message.findUnique({
    where: { id },
  });

  if (!message) {
    throw new AppError(404, 'NOT_FOUND', 'Message not found');
  }

  // Sender or admin can delete
  if (message.senderId !== req.user!.userId && req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Can only delete own messages');
  }

  await prisma.message.delete({ where: { id } });
  res.json({ message: 'Message deleted successfully' });
}));

export default router;