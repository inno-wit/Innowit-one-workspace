import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { collaborationService } from '../services/collaboration/CollaborationService';
import { notificationService } from '../services/collaboration/NotificationService';

const router = Router();

const createMessageSchema = z.object({
  channelId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  recipientId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  content: z.string().min(1, 'Content is required').max(10000),
  idempotencyKey: z.string().uuid('Invalid idempotency key'),
}).refine(data => data.channelId || data.conversationId || data.recipientId, {
  message: 'Either channelId, conversationId, or recipientId is required',
});

const updateMessageSchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000),
});

const messageParamsSchema = z.object({
  id: z.string().uuid('Invalid message ID'),
});

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  direction: z.enum(['before', 'after']).default('before'),
  channelId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  recipientId: z.string().uuid().optional(),
});

const reactionSchema = z.object({
  emoji: z.string().min(1).max(10),
});

const threadQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

const searchQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters'),
  channelId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

// GET /api/messages - List messages with cursor pagination
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { cursor, limit, direction, channelId, conversationId, recipientId } = req.query as any;

  const result = await collaborationService.listMessages(
    req.user!.userId,
    req.user!.organizationId,
    { channelId, conversationId, recipientId, cursor, limit, direction }
  );

  res.json({
    data: result.data,
    pagination: { cursor: result.nextCursor, limit, hasMore: result.hasMore },
  });
}));

// GET /api/messages/search
router.get('/search', authenticateToken, validateQuery(searchQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { q, channelId, conversationId, limit } = req.query as any;
  const messages = await collaborationService.searchMessages(q, req.user!.userId, req.user!.organizationId, { channelId, conversationId, limit });
  res.json({ data: messages });
}));

// GET /api/messages/:id
router.get('/:id', authenticateToken, validateParams(messageParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const message = await collaborationService.getMessage(id, req.user!.userId, req.user!.organizationId);
  res.json({ data: message });
}));

// POST /api/messages - Send message
router.post('/', authenticateToken, validateBody(createMessageSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  const result = await collaborationService.sendMessage(
    {
      channelId: data.channelId,
      conversationId: data.conversationId,
      recipientId: data.recipientId,
      content: data.content,
      parentId: data.parentId,
      idempotencyKey: data.idempotencyKey,
    },
    req.user!.userId,
    req.user!.organizationId
  );

  if (result._existing) {
    return res.status(200).json({ data: result, existing: true });
  }

  // Create notifications for mentions
  if (data.channelId) {
    const channel = await collaborationService.getChannel(data.channelId, req.user!.userId, req.user!.organizationId);
    if (channel) {
      const memberIds = channel.members?.map(m => m.userId) || [];
      const mentionRegex = /@(\w+)/g;
      const mentions = data.content.match(mentionRegex) || [];
      if (mentions.length > 0) {
        // Simplified: would resolve @name to userId in production
        // For now, skip detailed mention handling
      }
    }
  }

  res.status(201).json({ data: result, existing: false });
}));

// PUT /api/messages/:id - Edit message
router.put('/:id', authenticateToken, validateParams(messageParamsSchema), validateBody(updateMessageSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const updated = await collaborationService.editMessage(id, req.body.content, req.user!.userId, req.user!.organizationId, req.user!.role);
  res.json({ data: updated });
}));

// DELETE /api/messages/:id - Delete message (soft delete by default)
router.delete('/:id', authenticateToken, validateParams(messageParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const hard = req.query.hard === 'true';
  await collaborationService.deleteMessage(id, req.user!.userId, req.user!.organizationId, req.user!.role, hard);
  res.json({ message: 'Message deleted successfully' });
}));

// POST /api/messages/:id/pin - Pin message
router.post('/:id/pin', authenticateToken, validateParams(messageParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const updated = await collaborationService.pinMessage(id, req.user!.userId, req.user!.organizationId, req.user!.role);
  res.json({ data: updated });
}));

// DELETE /api/messages/:id/pin - Unpin message
router.delete('/:id/pin', authenticateToken, validateParams(messageParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const updated = await collaborationService.unpinMessage(id, req.user!.userId, req.user!.organizationId, req.user!.role);
  res.json({ data: updated });
}));

// Reactions
router.post('/:id/reactions', authenticateToken, validateParams(messageParamsSchema), validateBody(reactionSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { emoji } = req.body;
  const reaction = await collaborationService.addReaction(id, emoji, req.user!.userId, req.user!.organizationId);
  res.status(201).json({ data: reaction });
}));

router.delete('/:id/reactions/:emoji', authenticateToken, validateParams(z.object({
  id: z.string().uuid(),
  emoji: z.string(),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, emoji } = req.params;
  const reaction = await collaborationService.removeReaction(id, emoji, req.user!.userId, req.user!.organizationId);
  res.json({ data: reaction });
}));

router.get('/:id/reactions', authenticateToken, validateParams(messageParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const reactions = await collaborationService.getReactions(id, req.user!.userId, req.user!.organizationId);
  res.json({ data: reactions });
}));

// Threads
router.get('/:id/thread', authenticateToken, validateParams(messageParamsSchema), validateQuery(threadQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const result = await collaborationService.getThread(id, req.user!.userId, req.user!.organizationId);
  res.json({ data: result });
}));

export default router;