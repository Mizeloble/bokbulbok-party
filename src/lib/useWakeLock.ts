'use client';

import { useEffect } from 'react';

/**
 * Hold a Screen Wake Lock while `active` is true so the phone doesn't dim/lock
 * mid-round (a marble race or reaction round the player would otherwise miss).
 * The lock is released automatically when the tab is hidden, so we re-acquire it
 * on `visibilitychange` when the user returns. No-op on browsers without the API
 * (older iOS Safari) — the game still plays, the screen just isn't held awake.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // Denied (low battery, permissions) — non-fatal, nothing to do.
      }
    };

    const onVisibility = () => {
      if (!cancelled && document.visibilityState === 'visible' && sentinel === null) {
        void request();
      }
    };

    void request();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      // release() rejects if already released; ignore.
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
