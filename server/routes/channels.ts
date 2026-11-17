import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createChannelSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
  isPrivate: z.boolean().default(false),
});

const updateChannelSchema = createChannelSchema.partial();

const channelParamsSchema = z.object({
  id: z.string().uuid('Invalid channel ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});

// GET /api/channels
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search } = req.query as any;
  const skip = (page - 1) * limit;

  // Get channels where user is a member, or public channels
  const userChannels = await prisma.channelMember.findMany({
    where: { userId: req.user!.userId },
    select: { channelId: true },
  });

  const userChannelIds = userChannels.map(c => c.channelId);

  const where: any = {
    OR: [
      { id: { in: userChannelIds } },
      { isPrivate: false },
    ],
  };

  if (search) {
    where.AND = [
      where.OR,
      {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      },
    ];
    delete where.OR;
  }

  const [channels, total] = await Promise.all([
    prisma.channel.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { members: true, messages: true } },
        members: {
          where: { userId: req.user!.userId },
          select: { id: true },
        },
      },
    }),
    prisma.channel.count({ where }),
  ]);

  const channelsWithMembership = channels.map(c => ({
    ...c,
    isMember: c.members.length > 0,
    members: undefined,
  }));

  res.json({
    data: channelsWithMembership,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/channels/:id
router.get('/:id', authenticateToken, validateParams(channelParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const channel = await prisma.channel.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        },
      },
      _count: { select: { messages: true } },
    },
  });

  if (!channel) {
    throw new AppError(404, 'NOT_FOUND', 'Channel not found');
  }

  // Check if user is member or channel is public
  const isMember = channel.members.some(m => m.userId === req.user!.userId);
  if (channel.isPrivate && !isMember) {
    throw new AppError(403, 'FORBIDDEN', 'Private channel - not a member');
  }

  res.json({ data: channel });
}));

// POST /api/channels
router.post('/', authenticateToken, validateBody(createChannelSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  const channel = await prisma.$transaction(async (tx) => {
    const newChannel = await tx.channel.create({
      data: {
        ...data,
        createdById: req.user!.userId,
      },
    });

    // Add creator as member
    await tx.channelMember.create({
      data: {
        channelId: newChannel.id,
        userId: req.user!.userId,
      },
    });

    return newChannel;
  });

  res.status(201).json({ data: channel });
}));

// PUT /api/channels/:id
router.put('/:id', authenticateToken, validateParams(channelParamsSchema), validateBody(updateChannelSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const channel = await prisma.channel.findUnique({
    where: { id },
  });

  if (!channel) {
    throw new AppError(404, 'NOT_FOUND', 'Channel not found');
  }

  // Only creator or admin can update
  if (channel.createdById !== req.user!.userId && req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only channel creator or admin can update');
  }

  const updatedChannel = await prisma.channel.update({
    where: { id },
    data: req.body,
  });

  res.json({ data: updatedChannel });
}));

// POST /api/channels/:id/members
router.post('/:id/members', authenticateToken, validateParams(channelParamsSchema), validateBody(z.object({
  userId: z.string().uuid('Invalid user ID'),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { userId } = req.body;

  const channel = await prisma.channel.findUnique({
    where: { id },
  });

  if (!channel) {
    throw new AppError(404, 'NOT_FOUND', 'Channel not found');
  }

  if (channel.isPrivate) {
    // Only creator or admin can add to private channels
    if (channel.createdById !== req.user!.userId && req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Only channel creator or admin can add members to private channel');
    }
  }

  // Verify user exists and is in same organization
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  // Check if already member
  const existing = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId: id, userId } },
  });

  if (existing) {
    throw new AppError(409, 'ALREADY_MEMBER', 'User is already a member');
  }

  const member = await prisma.channelMember.create({
    data: { channelId: id, userId },
    include: {
      user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
    },
  });

  res.status(201).json({ data: member });
}));

// DELETE /api/channels/:id/members/:userId
router.delete('/:id/members/:userId', authenticateToken, validateParams(z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, userId } = req.params;

  const channel = await prisma.channel.findUnique({
    where: { id },
  });

  if (!channel) {
    throw new AppError(404, 'NOT_FOUND', 'Channel not found');
  }

  // Can remove self, or creator/admin can remove others
  const isSelf = userId === req.user!.userId;
  const isCreatorOrAdmin = channel.createdById === req.user!.userId || req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'ADMIN';

  if (!isSelf && !isCreatorOrAdmin) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot remove other members');
  }

  await prisma.channelMember.delete({
    where: { channelId_userId: { channelId: id, userId } },
  });

  res.json({ message: 'Member removed successfully' });
}));

// DELETE /api/channels/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateParams(channelParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const channel = await prisma.channel.findUnique({
    where: { id },
  });

  if (!channel) {
    throw new AppError(404, 'NOT_FOUND', 'Channel not found');
  }

  await prisma.channel.delete({ where: { id } });
  res.json({ message: 'Channel deleted successfully' });
}));

export default router;