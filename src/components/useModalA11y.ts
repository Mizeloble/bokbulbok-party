'use client';

import { useEffect, useRef } from 'react';

/**
 * Shared modal accessibility wiring for our bottom-sheet/dialog components:
 * - focuses the first focusable element on open,
 * - traps Tab/Shift+Tab inside the panel,
 * - restores focus to the previously-focused element on close,
 * - closes on Escape when an `onClose` is provided (omit for blocking dialogs
 *   like the required join gate, which can't be dismissed).
 *
 * Returns a ref to attach to the dialog panel element (give it `tabIndex={-1}`
 * so it can hold focus when it has no focusable children).
 */
export function useModalA11y(onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const prevFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    (focusables()[0] ?? panel).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      prevFocused?.focus?.();
    };
  }, [onClose]);

  return ref;
}
