import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../prisma';

const router = Router();

const createMeetingSchema = z.object({
  channelId: z.string().uuid().optional(),
  title: z.string().max(200).optional(),
  meetingType: z.enum(['DIRECT', 'GROUP', 'CHANNEL']).default('GROUP'),
  participantIds: z.array(z.string().uuid()).optional(),
});

const meetingParamsSchema = z.object({
  id: z.string().uuid('Invalid meeting ID'),
});

const listQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
  status: z.enum(['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

// POST /api/meetings - Create meeting
router.post('/', authenticateToken, validateBody(createMeetingSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { channelId, title, meetingType, participantIds } = req.body;
  const userId = req.user!.userId;
  const organizationId = req.user!.organizationId;

  // Validate based on meeting type
  if (meetingType === 'CHANNEL' && !channelId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'channelId required for CHANNEL meetings');
  }

  if (meetingType === 'CHANNEL' && channelId) {
    // Verify channel membership
    const membership = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });

    if (!membership) {
      const channel = await prisma.channel.findUnique({ where: { id: channelId } });
      if (!channel || channel.isPrivate) {
        throw new AppError(403, 'FORBIDDEN', 'Not a member of this channel');
      }
    }
  }

  if (meetingType === 'DIRECT' || meetingType === 'GROUP') {
    if (!participantIds || participantIds.length < 1) {
      throw new AppError(400, 'VALIDATION_ERROR', 'participantIds required for DIRECT/GROUP meetings');
    }

    // Verify all participants exist and are in same org
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
  }

  const meeting = await prisma.meeting.create({
    data: {
      channelId,
      title,
      meetingType,
      startedById: userId,
      organizationId,
      status: 'SCHEDULED',
      participants: {
        create: (participantIds || []).map(id => ({
          userId: id,
          role: id === userId ? 'HOST' : 'PARTICIPANT',
        })),
      },
    },
    include: {
      participants: {
        include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } } },
      },
      channel: { select: { id: true, name: true } },
    },
  });

  res.status(201).json({ data: meeting });
}));

// GET /api/meetings
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { channelId, status, page, limit } = req.query as any;
  const skip = (page - 1) * limit;
  const organizationId = req.user!.organizationId;
  const userId = req.user!.userId;

  const where: any = { organizationId };

  if (channelId) where.channelId = channelId;
  if (status) where.status = status;

  // For non-channel meetings, only show where user is participant
  if (!channelId) {
    where.OR = [
      { meetingType: 'CHANNEL' },
      {
        meetingType: { in: ['DIRECT', 'GROUP'] },
        participants: { some: { userId, leftAt: null } },
      },
    ];
  }

  const [meetings, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      skip,
      take: limit,
      orderBy: { startedAt: 'desc' },
      include: {
        participants: {
          where: { leftAt: null },
          include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } } },
        },
        channel: { select: { id: true, name: true } },
      },
    }),
    prisma.meeting.count({ where }),
  ]);

  res.json({
    data: meetings,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/meetings/:id
router.get('/:id', authenticateToken, validateParams(meetingParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const organizationId = req.user!.organizationId;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      participants: {
        include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } } },
      },
      channel: { select: { id: true, name: true } },
    },
  });

  if (!meeting) throw new AppError(404, 'NOT_FOUND', 'Meeting not found');
  if (meeting.organizationId !== organizationId) throw new AppError(403, 'FORBIDDEN', 'Access denied');

  res.json({ data: meeting });
}));

// POST /api/meetings/:id/join - Join meeting (get credentials)
router.post('/:id/join', authenticateToken, validateParams(meetingParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id }: { id: string } = req.params;
  const userId = req.user!.userId;
  const organizationId = req.user!.organizationId;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { participants: true, channel: true },
  });

  if (!meeting) throw new AppError(404, 'NOT_FOUND', 'Meeting not found');
  if (meeting.organizationId !== organizationId) throw new AppError(403, 'FORBIDDEN', 'Access denied');

  // Check access based on meeting type
  if (meeting.meetingType === 'CHANNEL' && meeting.channelId) {
    const membership = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: meeting.channelId, userId } },
    });
    if (!membership) throw new AppError(403, 'FORBIDDEN', 'Not a member of this channel');
  } else {
    const isParticipant = meeting.participants.some(p => p.userId === userId);
    if (!isParticipant) throw new AppError(403, 'FORBIDDEN', 'Not a participant in this meeting');
  }

  // Add/update participant
  await prisma.meetingParticipant.upsert({
    where: { meetingId_userId: { meetingId: id, userId } },
    update: { leftAt: null, joinedAt: new Date() },
    create: { meetingId: id, userId, role: 'PARTICIPANT' },
  });

  // Update meeting status
  if (meeting.status === 'SCHEDULED') {
    await prisma.meeting.update({
      where: { id },
      data: { status: 'ACTIVE', startedAt: new Date() },
    });
  }

  // Get all participants
  const participants = await prisma.meetingParticipant.findMany({
    where: { meetingId: id, leftAt: null },
    include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true } } },
  });

  // Generate meeting credentials
  const credentials = {
    meetingId: id,
    token: `meeting_${id}_${userId}_${Date.now()}`,
    turnServers: [
      { urls: ['turn:turn.example.com:3478'], username: 'user', credential: 'pass', credentialType: 'password' as const },
    ],
    sfuUrl: process.env.MEETING_SFU_URL || 'wss://sfu.example.com',
  };

  res.json({ data: { meeting, participants, credentials } });
}));

// POST /api/meetings/:id/leave
router.post('/:id/leave', authenticateToken, validateParams(meetingParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id }: { id: string } = req.params;
  const userId = req.user!.userId;

  await prisma.meetingParticipant.updateMany({
    where: { meetingId: id, userId, leftAt: null },
    data: { leftAt: new Date() },
  });

  res.json({ success: true });
}));

// POST /api/meetings/:id/end
router.post('/:id/end', authenticateToken, validateParams(meetingParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id }: { id: string } = req.params;
  const userId = req.user!.userId;
  const userRole = req.user!.role;

  const meeting = await prisma.meeting.findUnique({ where: { id } });

  if (!meeting) throw new AppError(404, 'NOT_FOUND', 'Meeting not found');
  if (meeting.organizationId !== req.user!.organizationId) throw new AppError(403, 'FORBIDDEN', 'Access denied');

  // Only host, co-host, or admin can end
  const isHost = meeting.startedById === userId;
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole);

  if (!isHost && !isAdmin) {
    throw new AppError(403, 'FORBIDDEN', 'Only host or admin can end meeting');
  }

  await prisma.meeting.update({
    where: { id },
    data: { status: 'ENDED', endedAt: new Date() },
  });

  // Mark all participants as left
  await prisma.meetingParticipant.updateMany({
    where: { meetingId: id, leftAt: null },
    data: { leftAt: new Date() },
  });

  res.json({ success: true });
}));

export default router;