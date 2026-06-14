'use client';

import { useState } from 'react';
import { ko } from '@/lib/i18n';
import { useModalA11y } from './useModalA11y';

export function JoinModal({
  defaultNickname,
  errorMessage,
  busy,
  onSubmit,
}: {
  defaultNickname?: string;
  errorMessage?: string | null;
  busy?: boolean;
  onSubmit: (nickname: string) => void;
}) {
  const [value, setValue] = useState(defaultNickname ?? '');
  const trimmed = value.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 10;
  // No onClose: joining is a required gate, not dismissible (no Escape close).
  const panelRef = useModalA11y();

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-modal-title"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full sm:max-w-sm bg-zinc-900 rounded-t-3xl sm:rounded-3xl p-6 space-y-4 focus:outline-none"
      >
        <h2 id="join-modal-title" className="text-xl font-bold">{ko.join.title}</h2>
        <input
          autoFocus
          inputMode="text"
          maxLength={10}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={ko.join.placeholder}
          className="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-base focus:outline-none focus:border-amber-400"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !busy) onSubmit(trimmed);
          }}
        />
        <p className="text-xs text-zinc-500">{ko.join.rules}</p>
        {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => onSubmit(trimmed)}
          className="w-full py-3 rounded-xl bg-amber-400 text-zinc-900 font-bold disabled:opacity-50 active:scale-[0.98]"
        >
          {busy ? ko.join.submitting : ko.join.submit}
        </button>
      </div>
    </div>
  );
}
