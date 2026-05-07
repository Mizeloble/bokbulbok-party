'use client';

import { ko } from '@/lib/i18n';
import clsx from 'clsx';
import { useGyro, type GyroState } from './useGyro';

/**
 * Lobby-side button that lets a participant grant device-orientation permission
 * BEFORE the race starts. iOS Safari requires the call to come from a user
 * gesture, so doing it during gameplay is too late — by then the renderer is
 * trying to read tilt without a grant. On Android the same button just flips
 * to granted with no modal.
 *
 * Hosts don't tilt anything (they're on a desktop most of the time) so the gate
 * suppresses itself for `isHost`.
 */
export function TiltPermissionGate({ isHost }: { isHost: boolean }) {
  // The hook is mounted here only to drive permission state — we don't actually
  // emit tilt from the lobby (active=false). The renderer mounts its own hook
  // when the race starts. iOS preserves the permission grant for the page's
  // lifetime, so the second mount inherits the grant.
  const { state, requestPermission } = useGyro({ active: false, onTilt: () => {} });

  if (isHost) {
    return (
      <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 px-4 py-3 text-xs text-zinc-400">
        {ko.marbleTilt.hostNotice}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold text-zinc-100">{ko.marbleTilt.hint}</div>
          <StatusLine state={state} />
        </div>
        <ActionButton state={state} onTap={requestPermission} />
      </div>
    </div>
  );
}

function StatusLine({ state }: { state: GyroState }) {
  if (state === 'granted') {
    return <div className="mt-0.5 text-[11px] text-emerald-300">{ko.marbleTilt.permReady}</div>;
  }
  if (state === 'denied') {
    return <div className="mt-0.5 text-[11px] text-rose-300">{ko.marbleTilt.permDenied}</div>;
  }
  if (state === 'unsupported') {
    return <div className="mt-0.5 text-[11px] text-zinc-500">{ko.marbleTilt.permUnsupported}</div>;
  }
  return null;
}

function ActionButton({ state, onTap }: { state: GyroState; onTap: () => void }) {
  if (state === 'granted') return null;
  if (state === 'unsupported') return null;
  const label =
    state === 'requesting'
      ? ko.marbleTilt.permRequesting
      : state === 'denied'
        ? ko.marbleTilt.permRetry
        : ko.marbleTilt.permEnable;
  return (
    <button
      type="button"
      disabled={state === 'requesting'}
      onClick={onTap}
      className={clsx(
        'whitespace-nowrap rounded-xl px-3.5 py-2.5 text-[13px] font-bold border-[1.5px] active:scale-[0.98]',
        state === 'denied'
          ? 'border-zinc-700 bg-zinc-800 text-zinc-100'
          : 'border-amber-600 bg-amber-600/15 text-amber-200',
        state === 'requesting' && 'opacity-60',
      )}
    >
      {label}
    </button>
  );
}
