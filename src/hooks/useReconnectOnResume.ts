/**
 * src/hooks/useReconnectOnResume.ts
 *
 * Phase 2.7 — Reconnect Socket.IO after desktop sleep/resume or server restart.
 *
 * Strategy:
 * 1. Listen for window `focus` and `visibilitychange` events (cover sleep/resume
 *    on Windows/macOS and tab switching on web).
 * 2. On resume, probe the backend via the Rust connectivity command (or fetch).
 * 3. If the backend is reachable and the socket is disconnected, call socket.connect().
 * 4. Emit a 'missed-messages' request so the server can replay events since the
 *    last-seen cursor, achieving reconnect history synchronization per Phase 2.3.
 */

import { useEffect, useRef } from 'react';
import { probeServerConnectivity } from '../services/notifications/NativeNotificationBridge';

interface UseReconnectOnResumeOptions {
  /** The Socket.IO socket instance (or null if not yet initialized). */
  socket: { connected: boolean; connect(): void; emit(event: string, ...args: unknown[]): void } | null;
  /** ISO timestamp of the last message the client received; sent to server for history sync. */
  lastSeenAt: string | null;
  /** Called when the probe determines the server is unreachable. */
  onOffline?: () => void;
  /** Called when connectivity is restored and socket reconnect is triggered. */
  onReconnecting?: () => void;
}

export function useReconnectOnResume({
  socket,
  lastSeenAt,
  onOffline,
  onReconnecting,
}: UseReconnectOnResumeOptions): void {
  const probing = useRef(false);

  useEffect(() => {
    async function handleResume() {
      if (!socket || probing.current) return;
      probing.current = true;

      try {
        const status = await probeServerConnectivity();

        if (status === 0 || status >= 500) {
          onOffline?.();
          return;
        }

        if (!socket.connected) {
          onReconnecting?.();
          socket.connect();

          // After connect, request missed messages since the last seen cursor.
          // The server's RealtimeGateway handles 'sync.history' and replays events.
          if (lastSeenAt) {
            socket.emit('sync.history', { since: lastSeenAt });
          }
        }
      } finally {
        probing.current = false;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void handleResume();
      }
    }

    function onFocus() {
      void handleResume();
    }

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [socket, lastSeenAt, onOffline, onReconnecting]);
}
