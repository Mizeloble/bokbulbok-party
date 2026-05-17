'use client';

import { useState } from 'react';
import { ko } from '@/lib/i18n';
import { useRoomStore } from '@/store/room-store';
import { GamePicker } from './GamePicker';
import { GameIntro } from './GameIntro';
import { HistorySection } from './HistorySection';
import { InviteSheet } from './InviteSheet';
import { TiltPermissionGate } from '@/games/marble-tilt/TiltPermissionGate';
import { getSocket } from '@/lib/socket-client';
import type { GameId } from '@/games/types';
import clsx from 'clsx';

export function Lobby({ inviteUrl, onChangeNickname }: { inviteUrl: string; onChangeNickname: () => void }) {
  const state = useRoomStore((s) => s.state);
  const isHost = useRoomStore((s) => s.isHost);
  const myToken = useRoomStore((s) => s.myToken);
  const [showInvite, setShowInvite] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  if (!state) return null;

  const me = state.players.find((p) => p.playerToken === myToken);
  const connectedCount = state.players.filter((p) => p.connected).length;
  const someOffline = state.players.some((p) => !p.connected);
  const canStart = isHost && connectedCount >= 2;
  const canManageRoster = isHost && (state.status === 'lobby' || state.status === 'result');

  function setLoserCount(c: number) {
    getSocket().emit('setLoserCount', { count: c });
  }
  function setGameId(id: GameId) {
    getSocket().emit('setGameId', { gameId: id });
  }
  function start() {
    getSocket().emit('start');
  }

  function submitManualAdd() {
    const trimmed = manualValue.trim();
    if (trimmed.length < 1 || trimmed.length > 10) {
      setManualError(ko.lobby.addManualErrors.badNick);
      return;
    }
    setManualBusy(true);
    setManualError(null);
    type AddAck = { ok: true; playerToken: string } | { ok: false; code: string; message: string };
    getSocket().emit('host:addPlayer', { nickname: trimmed }, (res: AddAck) => {
      setManualBusy(false);
      if (res.ok) {
        setManualValue('');
        setShowManual(false);
        return;
      }
      const errs = ko.lobby.addManualErrors;
      const msg =
        res.code === 'DUP_NICK' ? errs.duplicate
        : res.code === 'FULL' ? errs.full
        : res.code === 'BAD_NICK' ? errs.badNick
        : res.code === 'BAD_STATE' ? errs.badState
        : errs.generic;
      setManualError(msg);
    });
  }

  function removeManual(playerToken: string) {
    getSocket().emit('host:removePlayer', { playerToken });
  }

  return (
    <main className="min-h-dvh flex flex-col">
      {/* top bar — pill-shaped invite button on the right */}
      <header className="px-4 pt-4 pb-2 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-bold text-base truncate -tracking-wide">{ko.app.title}</div>
          <div className="text-zinc-500 text-xs mt-0.5 flex items-center gap-1.5">
            <span>{ko.lobby.roomBadge(state.id, isHost)}</span>
            <span aria-hidden>·</span>
            <a
              href={ko.credit.authorUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline-offset-2 hover:underline hover:text-zinc-300"
            >
              {ko.app.madeBy}
            </a>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-100 px-3.5 py-2 text-[13px] font-semibold flex-shrink-0 whitespace-nowrap active:scale-[0.98]"
        >
          <svg width={14} height={14} viewBox="0 0 20 20" aria-hidden>
            <rect x={2} y={2} width={6} height={6} fill="currentColor" />
            <rect x={12} y={2} width={6} height={6} fill="currentColor" />
            <rect x={2} y={12} width={6} height={6} fill="currentColor" />
            <rect x={11} y={11} width={3} height={3} fill="currentColor" />
            <rect x={15} y={15} width={3} height={3} fill="currentColor" />
          </svg>
          {ko.lobby.inviteShort}
        </button>
      </header>

      {/* nickname badge */}
      {me && (
        <div className="px-4 pt-1 text-xs text-zinc-400 flex items-center gap-1.5">
          <span>{ko.lobby.nicknameBadge(me.nickname)}</span>
          <button
            type="button"
            onClick={onChangeNickname}
            className="text-amber-200 underline-offset-2 underline decoration-amber-200/40 hover:decoration-amber-200"
          >
            {ko.lobby.changeNickname}
          </button>
        </div>
      )}

      <section className="px-4 mt-5 space-y-5 flex-1 overflow-auto pb-32">
        {/* host controls first */}
        {isHost ? (
          <>
            <div className="space-y-2">
              <Eyebrow>{ko.lobby.chooseGame}</Eyebrow>
              <GamePicker selected={state.gameId} onSelect={setGameId} />
              <GameIntro gameId={state.gameId} />
              {state.gameId === 'marble-tilt' && <TiltPermissionGate isHost />}
            </div>

            <div>
              <Eyebrow>{ko.lobby.loserCount}</Eyebrow>
              <div className="flex gap-2">
                {[1, 2, 3].map((n) => {
                  const isSelected = state.loserCount === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setLoserCount(n)}
                      className={clsx(
                        'flex-1 py-3.5 rounded-xl font-bold text-[15px] border-[1.5px]',
                        isSelected
                          ? 'border-amber-600 bg-amber-600/10 text-amber-200'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-100',
                      )}
                    >
                      {ko.lobby.loserCountUnit(n)}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm text-zinc-300">
              {ko.lobby.waitingHostPicking}
            </div>
            <GameIntro gameId={state.gameId} />
            {state.gameId === 'marble-tilt' && <TiltPermissionGate isHost={false} />}
          </div>
        )}

        {/* participants */}
        <div>
          <div className="text-xs text-zinc-400 mb-2 font-bold uppercase tracking-[0.05em] flex justify-between items-center">
            <span>{ko.lobby.rosterCount(connectedCount)}</span>
            {someOffline && (
              <span className="text-zinc-600 normal-case tracking-normal font-normal">
                {ko.lobby.rosterSomeOffline}
              </span>
            )}
          </div>

          <ul className="grid grid-cols-2 gap-2">
            {state.players.map((p) => {
              const showRemove = canManageRoster && p.manual && p.playerToken !== myToken;
              const isMe = p.playerToken === myToken;
              return (
                <li
                  key={p.playerToken}
                  className={clsx(
                    'rounded-xl px-3 py-2.5 text-sm flex items-center gap-2 border list-none',
                    p.connected
                      ? 'bg-zinc-900 border-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                      : 'bg-zinc-900/40 border-zinc-800/50 opacity-55',
                  )}
                >
                  <span
                    aria-hidden
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: p.color, boxShadow: `0 0 0 2px ${p.color}33` }}
                  />
                  <span className="truncate flex-1 min-w-0">{p.nickname}</span>
                  {isMe && (
                    <span className="text-[11px] font-bold text-amber-200 bg-amber-200/10 px-1.5 py-0.5 rounded">
                      {ko.lobby.meBadge}
                    </span>
                  )}
                  {showRemove && (
                    <button
                      type="button"
                      onClick={() => removeManual(p.playerToken)}
                      aria-label={ko.lobby.removeManualAria(p.nickname)}
                      className="-mr-1 w-7 h-7 rounded-full text-zinc-400 hover:text-rose-300 active:text-rose-400 active:scale-95 flex items-center justify-center text-base leading-none"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}

            {/* dashed inline "+ 직접 추가" — host-only */}
            {canManageRoster && !showManual && (
              <li className="list-none">
                <button
                  type="button"
                  onClick={() => setShowManual(true)}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] text-zinc-400 border border-dashed border-zinc-700 flex items-center justify-center gap-1.5 hover:text-zinc-200 hover:border-zinc-600 active:scale-[0.98]"
                >
                  + {ko.lobby.addManualTitle}
                </button>
              </li>
            )}

            {state.players.length === 0 && !canManageRoster && (
              <li className="col-span-2 text-zinc-500 text-sm">{ko.lobby.waiting}…</li>
            )}
          </ul>

          {/* manual-add input (host) — expanded form */}
          {canManageRoster && showManual && (
            <div className="mt-3">
              <div className="flex gap-2">
                <input
                  autoFocus
                  inputMode="text"
                  maxLength={10}
                  value={manualValue}
                  onChange={(e) => {
                    setManualValue(e.target.value);
                    if (manualError) setManualError(null);
                  }}
                  placeholder={ko.lobby.addManualPlaceholder}
                  aria-label={ko.lobby.addManualTitle}
                  className="flex-1 min-w-0 px-3 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-sm focus:outline-none focus:border-amber-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !manualBusy) submitManualAdd();
                    if (e.key === 'Escape') {
                      setShowManual(false);
                      setManualValue('');
                      setManualError(null);
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={manualBusy || manualValue.trim().length === 0}
                  onClick={submitManualAdd}
                  className="px-4 py-3 rounded-xl bg-zinc-700 text-zinc-100 text-sm font-bold disabled:opacity-50 active:scale-[0.98]"
                >
                  {ko.lobby.addManualSubmit}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowManual(false);
                    setManualValue('');
                    setManualError(null);
                  }}
                  className="px-3 py-3 rounded-xl bg-transparent text-zinc-400 text-sm"
                  aria-label={ko.lobby.cancel}
                >
                  ×
                </button>
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">{ko.lobby.addManualHint}</p>
              {manualError && <p className="mt-1 text-xs text-rose-400">{manualError}</p>}
            </div>
          )}
        </div>

        <HistorySection canReset={isHost} refreshKey={state.id} />
      </section>

      {/* sticky bottom CTA (host only) */}
      {isHost && (
        <div className="fixed bottom-0 left-0 right-0 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 bg-gradient-to-t from-[#0b0b10] via-[#0b0b10]/95 to-transparent">
          <button
            type="button"
            disabled={!canStart}
            onClick={start}
            className="w-full py-4 rounded-2xl bg-amber-400 text-zinc-900 font-extrabold text-lg disabled:opacity-50 active:scale-[0.98] shadow-[0_8px_24px_rgba(251,191,36,0.25)]"
          >
            {canStart ? ko.lobby.start : ko.lobby.needMorePlayers}
          </button>
        </div>
      )}

      {showInvite && <InviteSheet url={inviteUrl} onClose={() => setShowInvite(false)} />}
    </main>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-zinc-400 mb-2 font-bold uppercase tracking-[0.05em]">
      {children}
    </div>
  );
}
