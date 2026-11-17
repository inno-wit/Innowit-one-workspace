import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const keyLength = 32;
const ivLength = 12;
const tagLength = 16;

function getKey(): Buffer {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  // Derive a 32-byte key from the encryption key using SHA-256
  return crypto.createHash('sha256').update(encryptionKey).digest();
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  
  const tag = cipher.getAuthTag();
  
  // Combine iv + ciphertext + tag
  const combined = Buffer.concat([iv, ciphertext, tag]);
  return combined.toString('base64');
}

export function decrypt(encrypted: string): string {
  const key = getKey();
  const combined = Buffer.from(encrypted, 'base64');
  
  if (combined.length < ivLength + tagLength) {
    throw new Error('Invalid encrypted data');
  }
  
  const iv = combined.subarray(0, ivLength);
  const tag = combined.subarray(combined.length - tagLength);
  const ciphertext = combined.subarray(ivLength, combined.length - tagLength);
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  
  return plaintext.toString('utf8');
}