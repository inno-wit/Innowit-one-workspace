/**
 * Idempotency key generation for message deduplication
 * Uses crypto.randomUUID() when available, fallback for older environments
 */

export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback for environments without crypto.randomUUID
  return 'idemp-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 11);
}

/**
 * Generate a deterministic idempotency key from components
 * Useful for retry scenarios where the same logical operation should use the same key
 */
export function generateDeterministicIdempotencyKey(
  userId: string,
  channelId: string | undefined,
  conversationId: string | undefined,
  recipientId: string | undefined,
  content: string
): string {
  const components = [
    userId,
    channelId || '',
    conversationId || '',
    recipientId || '',
    // Hash content to keep key length reasonable
    hashString(content).substring(0, 8),
  ].join(':');
  
  // Use a simple hash to create a UUID-like string
  const hash = hashString(components);
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to hex string
  return Math.abs(hash).toString(16).padStart(8, '0') + Date.now().toString(16);
}

/**
 * Store idempotency key in sessionStorage for the current session
 * This helps with page refreshes during message sending
 */
export function storePendingIdempotencyKey(key: string, messageData: any): void {
  try {
    const pending = JSON.parse(sessionStorage.getItem('pendingMessages') || '{}');
    pending[key] = {
      data: messageData,
      timestamp: Date.now(),
    };
    sessionStorage.setItem('pendingMessages', JSON.stringify(pending));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Retrieve and remove pending idempotency key
 */
export function retrievePendingIdempotencyKey(key: string): any | null {
  try {
    const pending = JSON.parse(sessionStorage.getItem('pendingMessages') || '{}');
    const result = pending[key];
    delete pending[key];
    sessionStorage.setItem('pendingMessages', JSON.stringify(pending));
    return result;
  } catch {
    return null;
  }
}

/**
 * Clean up old pending messages (older than 24 hours)
 */
export function cleanupPendingMessages(): void {
  try {
    const pending = JSON.parse(sessionStorage.getItem('pendingMessages') || '{}');
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    for (const key of Object.keys(pending)) {
      if (now - pending[key].timestamp > dayMs) {
        delete pending[key];
      }
    }
    sessionStorage.setItem('pendingMessages', JSON.stringify(pending));
  } catch {
    // Ignore
  }
}