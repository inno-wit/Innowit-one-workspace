import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { notificationService } from '../services/collaboration/NotificationService';

const router = Router();

const notificationParamsSchema = z.object({
  id: z.string().uuid('Invalid notification ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
});

const preferencesSchema = z.object({
  desktopEnabled: z.boolean().optional(),
  previewEnabled: z.boolean().optional(),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
  mutedChannels: z.array(z.string().uuid()).optional(),
  mutedUsers: z.array(z.string().uuid()).optional(),
});

// GET /api/notifications
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, unreadOnly } = req.query as any;
  const result = await notificationService.getNotifications(
    req.user!.userId,
    req.user!.organizationId,
    { page, limit, unreadOnly }
  );
  res.json(result);
}));

// GET /api/notifications/unread-count
router.get('/unread-count', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const count = await notificationService.getUnreadCount(req.user!.userId, req.user!.organizationId);
  res.json({ data: { count } });
}));

// POST /api/notifications/:id/read
router.post('/:id/read', authenticateToken, validateParams(notificationParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const notification = await notificationService.markAsRead(id, req.user!.userId);
  res.json({ data: notification });
}));

// POST /api/notifications/read-all
router.post('/read-all', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  await notificationService.markAllAsRead(req.user!.userId, req.user!.organizationId);
  res.json({ success: true });
}));

// GET /api/notifications/preferences
router.get('/preferences', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const prefs = await notificationService.getPreferences(req.user!.userId, req.user!.organizationId);
  res.json({ data: prefs });
}));

// PUT /api/notifications/preferences
router.put('/preferences', authenticateToken, validateBody(preferencesSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const prefs = await notificationService.updatePreferences(req.user!.userId, req.user!.organizationId, req.body);
  res.json({ data: prefs });
}));

export default router;