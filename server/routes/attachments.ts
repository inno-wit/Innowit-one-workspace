import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { attachmentService } from '../services/collaboration/AttachmentService';

const router = Router();

const initUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
  checksum: z.string().length(64, 'Checksum must be 64 character SHA-256 hex string'),
  channelId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
});

const attachmentParamsSchema = z.object({
  id: z.string().uuid('Invalid attachment ID'),
});

// POST /api/attachments/init - Initialize upload
router.post('/init', authenticateToken, validateBody(initUploadSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await attachmentService.initUpload(req.body, req.user!.userId, req.user!.organizationId);
  res.status(201).json({ data: result.attachment });
}));

// POST /api/attachments/:id/complete - Complete upload
router.post('/:id/complete', authenticateToken, validateParams(attachmentParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const attachment = await attachmentService.completeUpload(id, req.user!.userId, req.user!.organizationId);
  res.json({ data: attachment });
}));

// GET /api/attachments/:id - Get attachment metadata
router.get('/:id', authenticateToken, validateParams(attachmentParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const attachment = await attachmentService.getAttachment(id, req.user!.userId, req.user!.organizationId);
  res.json({ data: attachment });
}));

// GET /api/attachments/:id/download - Get download URL
router.get('/:id/download', authenticateToken, validateParams(attachmentParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const result = await attachmentService.downloadAttachment(id, req.user!.userId, req.user!.organizationId);
  res.json({ data: result });
}));

// GET /api/attachments/:id/stream - Stream attachment (for inline viewing)
router.get('/:id/stream', authenticateToken, validateParams(attachmentParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const result = await attachmentService.streamAttachment(id, req.user!.userId, req.user!.organizationId);
  
  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
  res.setHeader('Content-Length', result.size);
  
  result.stream.pipe(res);
}));

// DELETE /api/attachments/:id - Delete attachment
router.delete('/:id', authenticateToken, validateParams(attachmentParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  await attachmentService.deleteAttachment(id, req.user!.userId, req.user!.organizationId, req.user!.role);
  res.json({ success: true });
}));

export default router;