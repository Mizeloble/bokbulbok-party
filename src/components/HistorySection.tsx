'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ko } from '@/lib/i18n';
import clsx from 'clsx';

type Row = {
  nickname: string;
  losses: number;
  plays: number;
  lastSeenAt: number;
};

export function HistorySection({ canReset, refreshKey }: { canReset: boolean; refreshKey: unknown }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const ac = new AbortController();
    inFlight.current = ac;
    try {
      const res = await fetch('/api/history/leaderboard', {
        cache: 'no-store',
        signal: ac.signal,
      });
      if (!res.ok) throw new Error('load failed');
      const data = (await res.json()) as { rows: Row[] };
      setRows(data.rows);
      setError(null);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      setError(ko.history.loadFailed);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => inFlight.current?.abort();
  }, [load, refreshKey]);

  async function doReset() {
    setBusy(true);
    try {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      setRows([]);
      setConfirming(false);
    } catch {
      setError(ko.history.resetFailed);
    } finally {
      setBusy(false);
    }
  }

  const isEmpty = rows !== null && rows.length === 0;
  const preview = rows ? rows.slice(0, 3) : [];
  const full = rows ? rows : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="text-xs text-zinc-400 font-bold uppercase tracking-[0.05em] inline-flex items-center gap-1.5 active:scale-[0.98]"
        >
          <span>🎯 {ko.history.sectionTitle}</span>
          <span
            className={clsx(
              'text-zinc-600 transition-transform text-[10px]',
              open && 'rotate-180',
            )}
            aria-hidden
          >
            ▾
          </span>
        </button>
        {canReset && rows && rows.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-[11px] text-zinc-500 hover:text-rose-300 px-2 py-1 rounded-md font-semibold"
          >
            {ko.history.resetButton}
          </button>
        )}
      </div>

      {rows === null && !error && (
        <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 px-3 py-3 text-xs text-zinc-500">
          …
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2.5 text-xs text-rose-300">
          {error}
        </div>
      )}
      {isEmpty && !error && (
        <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 px-3 py-3 text-xs text-zinc-500">
          {ko.history.empty}
        </div>
      )}

      {/* Top-3 preview when collapsed */}
      {!open && rows && rows.length > 0 && (
        <ul className="space-y-1.5">
          {preview.map((r, i) => (
            <Row key={r.nickname} row={r} rank={i + 1} />
          ))}
        </ul>
      )}

      {/* Full list when expanded */}
      {open && rows && rows.length > 0 && (
        <ul className="space-y-1.5 max-h-72 overflow-auto pr-1">
          {full.map((r, i) => (
            <Row key={r.nickname} row={r} rank={i + 1} />
          ))}
        </ul>
      )}

      {confirming && (
        <ConfirmModal
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={doReset}
        />
      )}
    </div>
  );
}

function Row({ row, rank }: { row: Row; rank: number }) {
  return (
    <li
      className={clsx(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm border',
        rank === 1
          ? 'bg-amber-400/10 border-amber-400/30'
          : 'bg-zinc-900 border-zinc-800',
      )}
    >
      <span className="w-7 text-center text-base font-black tabular-nums">
        {ko.history.medal(rank)}
      </span>
      <span
        className={clsx(
          'flex-1 truncate font-bold',
          rank === 1 ? 'text-amber-100' : 'text-zinc-100',
        )}
      >
        {row.nickname}
      </span>
      <span
        className={clsx(
          'text-xs tabular-nums shrink-0 font-extrabold',
          rank === 1 ? 'text-amber-200' : 'text-zinc-300',
        )}
      >
        {ko.history.rowLosses(row.losses)}
      </span>
      <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">
        {ko.history.rowPlays(row.plays)}
      </span>
    </li>
  );
}

function ConfirmModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-zinc-900 border border-zinc-800 p-5 pb-[max(env(safe-area-inset-bottom),20px)]">
        <div className="text-base font-extrabold text-zinc-100 mb-1">
          {ko.history.resetConfirmTitle}
        </div>
        <div className="text-sm text-zinc-400 mb-5">
          {ko.history.resetConfirmBody}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-200 font-bold text-sm active:scale-[0.98] disabled:opacity-50"
          >
            {ko.history.resetConfirmNo}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-3 rounded-xl bg-rose-500 text-white font-extrabold text-sm active:scale-[0.98] disabled:opacity-50"
          >
            {ko.history.resetConfirmYes}
          </button>
        </div>
      </div>
    </div>
  );
}
