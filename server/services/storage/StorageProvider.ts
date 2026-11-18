import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface UploadMetadata {
  organizationId: string;
  channelId?: string;
  messageId?: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  checksum: string; // SHA-256 hex string
}

export interface UploadResult {
  key: string;
  url?: string;
  size: number;
  checksum: string;
}

export interface StorageProvider {
  upload(key: string, stream: Readable, metadata: UploadMetadata): Promise<UploadResult>;
  download(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, ttlSeconds: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}

export class LocalStorageProvider implements StorageProvider {
  private basePath: string;

  constructor(basePath: string = './uploads') {
    this.basePath = basePath;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getFullPath(key: string): string {
    return path.join(this.basePath, key);
  }

  async upload(key: string, stream: Readable, metadata: UploadMetadata): Promise<UploadResult> {
    const fullPath = this.getFullPath(key);
    const dir = path.dirname(fullPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const writeStream = fs.createWriteStream(fullPath);

      stream.on('data', (chunk: Buffer) => hash.update(chunk));
      stream.pipe(writeStream);

      writeStream.on('finish', () => {
        const checksum = hash.digest('hex');
        if (checksum !== metadata.checksum) {
          fs.unlinkSync(fullPath);
          reject(new Error('Checksum mismatch'));
          return;
        }

        resolve({
          key,
          size: metadata.size,
          checksum,
        });
      });

      writeStream.on('error', reject);
      stream.on('error', reject);
    });
  }

  async download(key: string): Promise<Readable> {
    const fullPath = this.getFullPath(key);

    if (!fs.existsSync(fullPath)) {
      throw new Error('File not found');
    }

    return fs.createReadStream(fullPath);
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    // For local storage, return a local URL that the server will proxy
    return `/api/attachments/${key}/download`;
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.getFullPath(key));
  }
}

export class S3StorageProvider implements StorageProvider {
  private bucket: string;
  private region: string;
  private endpoint?: string;
  private s3Client: any;
  private s3ClientPromise: Promise<any>;

  constructor(config: { bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string }) {
    this.bucket = config.bucket;
    this.region = config.region;
    this.endpoint = config.endpoint;

    this.s3ClientPromise = this.initS3Client(config);
  }

  private async initS3Client(config: { bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string }) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private async getS3Client() {
    if (!this.s3Client) {
      this.s3Client = await this.s3ClientPromise;
    }
    return this.s3Client;
  }

  async upload(key: string, stream: Readable, metadata: UploadMetadata): Promise<UploadResult> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getS3Client();

    const hash = crypto.createHash('sha256');
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
      hash.update(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const checksum = hash.digest('hex');

    if (checksum !== metadata.checksum) {
      throw new Error('Checksum mismatch');
    }

    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: metadata.mimeType,
        Metadata: {
          'original-filename': metadata.originalFilename,
          'organization-id': metadata.organizationId,
          checksum,
        },
      })
    );

    return { key, size: metadata.size, checksum };
  }

  async download(key: string): Promise<Readable> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getS3Client();

    const response = await client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    return response.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getS3Client();

    await client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const client = await this.getS3Client();

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(client, command, { expiresIn: ttlSeconds });
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getS3Client();

    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}

// Factory function
export function createStorageProvider(): StorageProvider {
  const provider = process.env.ATTACHMENT_STORAGE_PROVIDER || 'local';

  if (provider === 's3') {
    return new S3StorageProvider({
      bucket: process.env.ATTACHMENT_S3_BUCKET!,
      region: process.env.ATTACHMENT_S3_REGION!,
      endpoint: process.env.ATTACHMENT_S3_ENDPOINT,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    });
  }

  return new LocalStorageProvider(process.env.ATTACHMENT_LOCAL_PATH || './uploads');
}