'use client';

import { ko } from '@/lib/i18n';
import { QRCode } from './QRCode';
import { useInviteActions } from './useInviteActions';
import { useModalA11y } from './useModalA11y';

export function InviteSheet({ url, onClose }: { url: string; onClose: () => void }) {
  const { copied, copy, share, shareSupported } = useInviteActions(url);
  const panelRef = useModalA11y(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-zinc-900 border-t border-zinc-800 sm:border rounded-t-3xl sm:rounded-3xl px-6 pt-3 pb-[max(env(safe-area-inset-bottom),24px)] sm:pb-6 space-y-4 shadow-[0_-8px_32px_rgba(0,0,0,0.4)] focus:outline-none"
      >
        <div className="w-9 h-1 rounded-full bg-white/20 mx-auto" aria-hidden />
        <div className="flex items-center justify-between">
          <h2 id="invite-sheet-title" className="text-xl font-extrabold -tracking-wide">{ko.lobby.invite}</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 px-2 py-1 text-sm">
            {ko.invite.close}
          </button>
        </div>
        <div className="flex flex-col items-center gap-3">
          <QRCode value={url} size={240} />
          <p className="text-xs text-zinc-400 text-center">{ko.lobby.inviteScan}</p>
          <code className="text-xs text-zinc-500 break-all px-2 text-center">{url}</code>
        </div>
        <div className={shareSupported ? 'grid grid-cols-2 gap-3 pt-1' : 'pt-1'}>
          <button
            type="button"
            onClick={copy}
            className="w-full py-3 rounded-xl bg-zinc-800 font-medium active:scale-[0.98]"
          >
            {copied ? ko.invite.copied : ko.lobby.copyLink}
          </button>
          {/* Hide Share entirely where Web Share is unsupported (desktop) rather than
              showing a dead, disabled control next to the working copy button. */}
          {shareSupported && (
            <button
              type="button"
              onClick={share}
              className="py-3 rounded-xl bg-amber-400 text-zinc-900 font-bold active:scale-[0.98]"
            >
              {ko.lobby.share}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
