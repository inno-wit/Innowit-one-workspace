import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { collaborationService } from '../services/collaboration/CollaborationService';

const router = Router();

const createChannelSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
  topic: z.string().optional(),
  isPrivate: z.boolean().default(false),
  branchId: z.string().uuid().optional(),
});

const updateChannelSchema = createChannelSchema.partial();

const channelParamsSchema = z.object({
  id: z.string().uuid('Invalid channel ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  archived: z.coerce.boolean().default(false),
  branchId: z.string().uuid().optional(),
});

// GET /api/channels
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, archived, branchId } = req.query as any;
  const result = await collaborationService.listChannels(
    req.user!.userId,
    req.user!.organizationId,
    { page, limit, search, archived, branchId }
  );
  res.json(result);
}));

// GET /api/channels/:id
router.get('/:id', authenticateToken, validateParams(channelParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const channel = await collaborationService.getChannel(id, req.user!.userId, req.user!.organizationId);
  if (!channel) throw new AppError(404, 'NOT_FOUND', 'Channel not found');
  res.json({ data: channel });
}));

// POST /api/channels
router.post('/', authenticateToken, validateBody(createChannelSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;
  const channel = await collaborationService.createChannel(data, req.user!.userId, req.user!.organizationId);
  res.status(201).json({ data: channel });
}));

// PUT /api/channels/:id
router.put('/:id', authenticateToken, validateParams(channelParamsSchema), validateBody(updateChannelSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const updatedChannel = await collaborationService.updateChannel(
    id,
    req.body,
    req.user!.userId,
    req.user!.organizationId,
    req.user!.role
  );
  res.json({ data: updatedChannel });
}));

// POST /api/channels/:id/archive
router.post('/:id/archive', authenticateToken, validateParams(channelParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  await collaborationService.archiveChannel(id, req.user!.userId, req.user!.organizationId, req.user!.role);
  res.json({ success: true });
}));

// POST /api/channels/:id/unarchive
router.post('/:id/unarchive', authenticateToken, validateParams(channelParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  await collaborationService.unarchiveChannel(id, req.user!.userId, req.user!.organizationId, req.user!.role);
  res.json({ success: true });
}));

// POST /api/channels/:id/members
router.post('/:id/members', authenticateToken, validateParams(channelParamsSchema), validateBody(z.object({
  userId: z.string().uuid('Invalid user ID'),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { userId } = req.body;
  const member = await collaborationService.addMember(id, userId, req.user!.userId, req.user!.organizationId, req.user!.role);
  res.status(201).json({ data: member });
}));

// GET /api/channels/:id/members
router.get('/:id/members', authenticateToken, validateParams(channelParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const members = await collaborationService.listMembers(id, req.user!.userId, req.user!.organizationId);
  res.json({ data: members });
}));

// DELETE /api/channels/:id/members/:userId
router.delete('/:id/members/:userId', authenticateToken, validateParams(z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, userId } = req.params;
  await collaborationService.removeMember(id, userId, req.user!.userId, req.user!.organizationId, req.user!.role);
  res.json({ message: 'Member removed successfully' });
}));

// DELETE /api/channels/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateParams(channelParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  await collaborationService.deleteChannel(id, req.user!.userId, req.user!.organizationId, req.user!.role);
  res.json({ message: 'Channel deleted successfully' });
}));

export default router;