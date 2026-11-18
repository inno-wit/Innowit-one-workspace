import { prisma } from '../../prisma';
import { AppError } from '../../middleware/errorHandler';
import { createStorageProvider, StorageProvider, UploadMetadata } from '../../services/storage/StorageProvider';
import { verifyOrgOwnership } from '../../middleware/tenant';
import crypto from 'crypto';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const MAX_FILE_SIZE = parseInt(process.env.ATTACHMENT_MAX_SIZE_MB || '50', 10) * 1024 * 1024; // 50MB default

export interface InitUploadInput {
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  channelId?: string;
  messageId?: string;
}

export class AttachmentService {
  private storage: StorageProvider;

  constructor() {
    this.storage = createStorageProvider();
  }

  // Magic byte signatures for file type validation
  private static readonly MAGIC_BYTES: Record<string, number[][]> = {
    'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
    'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], // PNG
    'image/jpeg': [[0xff, 0xd8, 0xff]], // JPEG
    'image/gif': [[0x47, 0x49, 0x46, 0x38]], // GIF87a / GIF89a
    'image/webp': [[0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]], // RIFF....WEBP
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50, 0x4b, 0x03, 0x04]], // ZIP (xlsx)
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4b, 0x03, 0x04]], // ZIP (docx)
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': [[0x50, 0x4b, 0x03, 0x04]], // ZIP (pptx)
  };

  async initUpload(data: InitUploadInput, userId: string, organizationId: string) {
    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
      throw new AppError(400, 'MIME_NOT_ALLOWED', `File type ${data.mimeType} is not allowed`);
    }

    // Validate size
    if (data.size > MAX_FILE_SIZE) {
      throw new AppError(400, 'FILE_TOO_LARGE', `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    // Validate checksum format
    if (!/^[a-f0-9]{64}$/i.test(data.checksum)) {
      throw new AppError(400, 'INVALID_CHECKSUM', 'Checksum must be a valid SHA-256 hex string');
    }

    // Verify channel access if provided
    if (data.channelId) {
      const membership = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId: data.channelId, userId } },
      });

      if (!membership) {
        const channel = await prisma.channel.findUnique({ where: { id: data.channelId } });
        if (!channel || channel.isPrivate) {
          throw new AppError(403, 'FORBIDDEN', 'Not a member of this channel');
        }
      }
    }

    // Verify message access if provided
    if (data.messageId) {
      const message = await prisma.message.findUnique({ where: { id: data.messageId } });
      if (!message) throw new AppError(404, 'NOT_FOUND', 'Message not found');

      const hasAccess =
        message.senderId === userId ||
        message.recipientId === userId ||
        (message.channelId &&
          (await prisma.channelMember.findUnique({
            where: { channelId_userId: { channelId: message.channelId, userId } },
          })));

      if (!hasAccess) {
        throw new AppError(403, 'FORBIDDEN', 'Cannot attach to this message');
      }
    }

    // Generate opaque storage key
    const key = `attachments/${organizationId}/${crypto.randomUUID()}`;

    // Create attachment record with PENDING status
    const attachment = await prisma.fileAttachment.create({
      data: {
        fileName: data.fileName,
        fileSize: data.size,
        mimeType: data.mimeType,
        storagePath: key,
        organizationId,
        messageId: data.messageId,
        uploadStatus: 'PENDING',
        checksum: data.checksum,
      },
    });

    // Generate presigned upload URL
    const uploadUrl = await this.storage.getSignedUrl(key, 3600); // 1 hour

    return {
      attachment: {
        id: attachment.id,
        uploadUrl,
        key,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      },
    };
  }

  async completeUpload(attachmentId: string, userId: string, organizationId: string) {
    const attachment = await prisma.fileAttachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment || attachment.uploadStatus === 'FAILED') throw new AppError(404, 'NOT_FOUND', 'Attachment not found');
    if (attachment.organizationId !== organizationId) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied');
    }

    // Verify file exists in storage
    const exists = await this.storage.exists(attachment.storagePath);
    if (!exists) {
      throw new AppError(400, 'UPLOAD_INCOMPLETE', 'File not found in storage');
    }

    // TODO: Verify checksum by downloading and hashing
    // For now, trust the upload

    // Update status
    const updated = await prisma.fileAttachment.update({
      where: { id: attachmentId },
      data: {
        uploadStatus: 'COMPLETED',
        // scannedAt: new Date(), // Would be set after scanning
        // scanStatus: 'PENDING',
      },
    });

    return updated;
  }

  async getAttachment(attachmentId: string, userId: string, organizationId: string) {
    const attachment = await prisma.fileAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        message: {
          include: {
            channel: true,
          },
        },
      },
    });

    if (!attachment || attachment.uploadStatus === 'FAILED') throw new AppError(404, 'NOT_FOUND', 'Attachment not found');
    if (attachment.organizationId !== organizationId) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied');
    }

    // Verify access
    if (attachment.message?.channelId) {
      const membership = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId: attachment.message.channelId, userId } },
      });
      const channel = await prisma.channel.findUnique({ where: { id: attachment.message.channelId } });
      if (!membership && channel?.isPrivate) {
        throw new AppError(403, 'FORBIDDEN', 'Not a member of this channel');
      }
    } else if (attachment.message?.recipientId) {
      if (attachment.message.senderId !== userId && attachment.message.recipientId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Not a participant in this conversation');
      }
    }

    return attachment;
  }

  async downloadAttachment(attachmentId: string, userId: string, organizationId: string) {
    const attachment = await this.getAttachment(attachmentId, userId, organizationId);

    // Generate signed download URL
    const downloadUrl = await this.storage.getSignedUrl(attachment.storagePath, 300); // 5 minutes

    return { downloadUrl, fileName: attachment.fileName, mimeType: attachment.mimeType };
  }

  async streamAttachment(attachmentId: string, userId: string, organizationId: string) {
    const attachment = await this.getAttachment(attachmentId, userId, organizationId);

    return {
      stream: await this.storage.download(attachment.storagePath),
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.fileSize,
    };
  }

  async deleteAttachment(attachmentId: string, userId: string, organizationId: string, userRole: string) {
    const attachment = await prisma.fileAttachment.findUnique({ where: { id: attachmentId } });

    if (!attachment || attachment.uploadStatus === 'FAILED') throw new AppError(404, 'NOT_FOUND', 'Attachment not found');
    if (attachment.organizationId !== organizationId) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied');
    }

    // Check permissions: uploader, channel admin, or SUPER_ADMIN/ADMIN
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(userRole);
    let canDelete = isAdmin || attachment.messageId === null; // Orphaned attachments can be deleted by anyone in org? No, restrict.

    if (attachment.messageId) {
      const message = await prisma.message.findUnique({
        where: { id: attachment.messageId },
        include: { channel: true },
      });

      if (message) {
        if (message.senderId === userId) canDelete = true;
        if (message.channelId && message.channel) {
          if (message.channel.createdById === userId) canDelete = true;
        }
      }
    }

    if (!canDelete) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot delete this attachment');
    }

    // Soft delete - mark as deleted, schedule storage cleanup
    await prisma.fileAttachment.update({
      where: { id: attachmentId },
      data: {
        // deletedAt: new Date(), // Would need to add field
        // deletedById: userId,
        uploadStatus: 'FAILED', // Reuse for deleted
      },
    });

    // Actually delete from storage
    await this.storage.delete(attachment.storagePath).catch(() => {}); // Ignore storage errors

    return { success: true };
  }

  // Validate file content matches declared MIME type
  static validateFileContent(buffer: Buffer, mimeType: string): boolean {
    const signatures = this.MAGIC_BYTES[mimeType];
    if (!signatures) return true; // Unknown type, allow

    for (const sig of signatures) {
      let match = true;
      for (let i = 0; i < sig.length; i++) {
        if (buffer[i] !== sig[i]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }

    // Special handling for ZIP-based formats (docx, xlsx, pptx)
    if (mimeType.startsWith('application/vnd.openxmlformats-officedocument') && signatures) {
      const zipSig = [0x50, 0x4b, 0x03, 0x04];
      let match = true;
      for (let i = 0; i < zipSig.length; i++) {
        if (buffer[i] !== zipSig[i]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }

    return false;
  }

  // Detect MIME type from buffer
  static detectMimeType(buffer: Buffer): string | null {
    for (const [mimeType, signatures] of Object.entries(this.MAGIC_BYTES)) {
      for (const sig of signatures) {
        let match = true;
        for (let i = 0; i < sig.length; i++) {
          if (buffer[i] !== sig[i]) {
            match = false;
            break;
          }
        }
        if (match) return mimeType;
      }
    }
    return null;
  }
}

export const attachmentService = new AttachmentService();