/**
 * src/services/notifications/NativeNotificationBridge.ts
 *
 * Phase 2.7 — Tauri native notification bridge.
 *
 * Calls the Rust commands registered in lib.rs:
 *   - check_notification_permission  → "granted" | "default"
 *   - send_native_notification       → void
 *   - navigate_to_channel            → void  (deep navigation)
 *   - probe_server_connectivity      → number (HTTP status or 0)
 *
 * Falls back gracefully when running in a browser (non-Tauri) context.
 */

import { listen } from '@tauri-apps/api/event';

// Dynamic import so the module can be loaded in browser tests without crashing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
let tauriInvoke: InvokeFn | null = null;
let tauriOnce = false;

async function getInvoke(): Promise<InvokeFn | null> {
  if (tauriInvoke) return tauriInvoke;
  if (tauriOnce) return null;
  tauriOnce = true;
  try {
    const mod = await import('@tauri-apps/api/core');
    tauriInvoke = mod.invoke as unknown as InvokeFn;
    return tauriInvoke;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

/** Returns 'granted' | 'default' | 'unavailable' */
export async function checkNotificationPermission(): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke) return 'unavailable';
  try {
    return (await invoke('check_notification_permission')) as string;
  } catch {
    return 'unavailable';
  }
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface NativeNotificationOptions {
  title: string;
  body: string;
  /** Deep-link target: "channel/<id>" | "dm/<id>" | "notification/<id>" */
  target?: string;
  silent?: boolean;
}

/** Sends a native OS notification via the Rust bridge. No-ops in browser context. */
export async function sendNativeNotification(opts: NativeNotificationOptions): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) {
    // Browser fallback: use Web Notifications API if granted
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(opts.title, { body: opts.body, silent: opts.silent });
    }
    return;
  }
  try {
    await invoke('send_native_notification', { payload: opts } as Record<string, unknown>);
  } catch (e) {
    console.warn('[NativeNotificationBridge] send failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Deep navigation
// ---------------------------------------------------------------------------

/**
 * Brings the main window to front and emits a 'navigate' event that the
 * React router handles.  Also works for tray/dock click deep links.
 */
export async function navigateToChannel(target: string): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  try {
    await invoke('navigate_to_channel', { target } as Record<string, unknown>);
  } catch (e) {
    console.warn('[NativeNotificationBridge] navigate failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Connectivity probe (reconnect-after-sleep)
// ---------------------------------------------------------------------------

/**
 * Returns the HTTP status of the backend health endpoint (200 = up, 0 = unreachable).
 * Call on window focus/resume before attempting Socket.IO reconnect.
 */
export async function probeServerConnectivity(): Promise<number> {
  const invoke = await getInvoke();
  if (!invoke) {
    // Browser fallback: fetch directly
    try {
      const r = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(3000) });
      return r.status;
    } catch {
      return 0;
    }
  }
  try {
    return (await invoke('probe_server_connectivity')) as number;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Deep-link listener (emitted by navigate_to_channel Rust command)
// ---------------------------------------------------------------------------

type NavigateHandler = (target: string) => void;

let _unlistenNavigate: (() => void) | null = null;

/**
 * Register a handler for deep-navigation events emitted by the Rust side.
 * Call once at app startup.  Returns an unlisten function.
 */
export async function onNavigate(handler: NavigateHandler): Promise<() => void> {
  if (_unlistenNavigate) {
    _unlistenNavigate();
    _unlistenNavigate = null;
  }
  try {
    const unlisten = await listen<{ target: string }>('navigate', (event) => {
      handler(event.payload.target);
    });
    _unlistenNavigate = unlisten as unknown as () => void;
    return _unlistenNavigate;
  } catch {
    return () => {};
  }
}
