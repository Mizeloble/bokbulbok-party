'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ko } from '@/lib/i18n';
import { getSocket, disposeSocket } from '@/lib/socket-client';
import { useWakeLock } from '@/lib/useWakeLock';
import { loadIdentity, saveIdentity } from '@/lib/nickname-store';
import { useRoomStore, type GameStartPayload, type PublicRoomState, type ResultPayload } from '@/store/room-store';
import { Lobby } from '@/components/Lobby';
import { Logo } from '@/components/Logo';
import { JoinModal } from '@/components/JoinModal';
import { Countdown } from '@/components/Countdown';
import { ChargePhase } from '@/components/ChargePhase';
import { ResultScreen } from '@/components/ResultScreen';
import { MarbleRenderer } from '@/games/marble/Renderer';
import type { SimulationResult } from '@/games/marble/sim';
import { MarbleTiltRenderer, type MarbleTiltIntroData } from '@/games/marble-tilt/Renderer';
import { ReactionRenderer } from '@/games/reaction/Renderer';
import type { ReactionReplayData } from '@/games/reaction/server';
import { TriviaRenderer } from '@/games/trivia/Renderer';
import type { TriviaReplayData } from '@/games/trivia/server';
import { gameCategory, skipsResultGate } from '@/games/types';
import { ROOM, UI } from '@/lib/constants';
import type { JoinAck } from '@/lib/protocol';

export default function RoomClient({
  roomId,
  forceJoin,
  fresh,
}: {
  roomId: string;
  forceJoin: boolean;
  /** Bypass stored identity — useful for testing with multiple browser windows that share localStorage */
  fresh: boolean;
}) {
  const setMe = useRoomStore((s) => s.setMe);
  const setState = useRoomStore((s) => s.setState);
  const setGameStart = useRoomStore((s) => s.setGameStart);
  const setResult = useRoomStore((s) => s.setResult);
  const resetStore = useRoomStore((s) => s.reset);
  const state = useRoomStore((s) => s.state);
  const myToken = useRoomStore((s) => s.myToken);
  const gameStart = useRoomStore((s) => s.gameStart);

  const [phase, setPhase] = useState<'connecting' | 'need-nickname' | 'in-room' | 'error'>('connecting');
  // Transient connection-lost flag (mobile backgrounding / network blip) — drives a
  // non-blocking "reconnecting" banner so the screen doesn't silently freeze.
  const [connectionLost, setConnectionLost] = useState(false);
  // Server told us it's restarting (deploy) — show a distinct notice; the socket
  // will reconnect on its own once the new machine is up.
  const [restarting, setRestarting] = useState(false);
  // Device lost its network (airplane mode / dead zone) — distinct from a server
  // blip so the copy can tell the user to check their own connection.
  const [offline, setOffline] = useState(false);
  // A reconnect that drags on: surface a manual refresh escape hatch.
  const [slowReconnect, setSlowReconnect] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busyJoin, setBusyJoin] = useState(false);
  const [identityNickname, setIdentityNickname] = useState<string>('');
  // Tracks whether at least one explicit join has succeeded. Used to gate the
  // silent re-join on `connect` so the very first connect (the mount-time
  // attemptJoin handles it) doesn't double-emit.
  const joinedOnceRef = useRef(false);
  // Gate the transition from race → result screen behind a tap, so the loser
  // banner / rank card animations have time to land.
  const [resultAcked, setResultAcked] = useState(false);
  // Replay-the-same-race state: when set, the renderer re-mounts with this startAt
  // instead of the original gameStart.startAt. Cleared when the user dismisses to
  // the result screen.
  const [replayStartAt, setReplayStartAt] = useState<number | null>(null);

  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/r/${roomId}?join=1`;
  }, [roomId]);

  const attemptJoin = useCallback(
    (nickname: string, playerToken?: string) => {
      const socket = getSocket();
      const hostToken = readHostToken(roomId);
      setBusyJoin(true);
      setJoinError(null);
      socket.emit(
        'join',
        { roomId, nickname, playerToken, hostToken },
        (res: JoinAck) => {
          setBusyJoin(false);
          if (!res.ok) {
            setJoinError(res.message);
            if (res.code === 'DUP_NICK' || res.code === 'BAD_NICK') {
              setPhase('need-nickname');
            } else if (res.code === 'NO_ROOM') {
              setErrMsg(ko.errors.roomNotFound);
              setPhase('error');
            } else if (res.code === 'IN_PROGRESS') {
              setErrMsg(ko.errors.raceInProgress);
              setPhase('error');
            } else {
              setErrMsg(res.message);
              setPhase('error');
            }
            return;
          }
          setMe(res.playerToken, res.isHost);
          saveIdentity(nickname, res.playerToken);
          joinedOnceRef.current = true;
          setPhase('in-room');
        },
      );
    },
    [roomId, setMe],
  );

  // Initial wiring: connect socket, listen, attempt join
  useEffect(() => {
    const socket = getSocket();
    // Server room ids are uppercase (getRoom uppercases lookups); normalize once
    // so hand-typed lowercase URLs still match `state.id`.
    const normalizedRoomId = roomId.toUpperCase();

    // The store is a module singleton that survives route changes. If it still
    // holds another room (back to landing → created a new room), drop it so the
    // previous room's lobby/game/result don't flash in — or worse, render — here.
    const held = useRoomStore.getState().state;
    if (held && held.id !== normalizedRoomId) resetStore();

    const onState = (s: PublicRoomState) => {
      // A singleton socket can still receive the previous room's broadcasts for a
      // moment while switching rooms — drop anything not addressed to this room.
      if (s.id !== normalizedRoomId) return;
      setState(s);
      // Host authority can change under us: the host left and we were auto-promoted
      // (or the original host returned and reclaimed it). Derive from the
      // authoritative state rather than trusting only the one-time join ack, so
      // host controls appear/disappear on the normal state broadcast.
      const { myToken: mt, isHost: wasHost } = useRoomStore.getState();
      if (mt) {
        const amHost = s.hostPlayerToken === mt;
        if (amHost !== wasHost) setMe(mt, amHost);
      }
      // Restore a missed `game:result` (user was off the room route when the round
      // ended) — result-status states carry ranking/losers.
      if (s.status === 'result' && s.currentRound?.ranking && s.currentRound.losers) {
        setResult({ ranking: s.currentRound.ranking, losers: s.currentRound.losers });
      }
    };
    const onGameStart = (g: GameStartPayload) => setGameStart(g);
    const onResult = (r: ResultPayload) => setResult(r);
    const onErr = ({ message }: { code: string; message: string }) => {
      setErrMsg(message);
      setPhase('error');
    };

    socket.on('state', onState);
    socket.on('game:start', onGameStart);
    socket.on('game:result', onResult);
    socket.on('error', onErr);

    const identity = loadIdentity();
    setIdentityNickname(identity?.nickname ?? '');

    // After a transient disconnect (mobile backgrounding, network blip, server ping
    // timeout), Socket.IO reconnects with a NEW socket id. The previous player record
    // is held for RECONNECT_GRACE_MS, but the new socket sits outside the room — every
    // subsequent `state` broadcast is missed until the user manually refreshes. Re-emit
    // `join` silently with the stored identity so the new socket re-binds to the same
    // playerToken. `addPlayer` is idempotent for existing tokens.
    function rejoinSilently() {
      const id = loadIdentity();
      if (!id?.nickname || !id.playerToken) return;
      const ht = readHostToken(roomId);
      socket.emit(
        'join',
        { roomId, nickname: id.nickname, playerToken: id.playerToken, hostToken: ht },
        (res: JoinAck) => {
          if (res.ok) {
            setMe(res.playerToken, res.isHost);
          } else if (res.code === 'NO_ROOM') {
            setErrMsg(ko.errors.roomNotFound);
            setPhase('error');
          }
        },
      );
    }
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    function onConnect() {
      setConnectionLost(false);
      setRestarting(false);
      setSlowReconnect(false);
      if (slowTimer) {
        clearTimeout(slowTimer);
        slowTimer = null;
      }
      if (joinedOnceRef.current) rejoinSilently();
    }
    // Only surface the banner once we've joined — the first connect has its own
    // "connecting…" screen, and a pre-join drop shouldn't flash a scary banner.
    function onDisconnect() {
      if (!joinedOnceRef.current) return;
      setConnectionLost(true);
      // If it doesn't come back quickly, offer a manual refresh escape hatch.
      if (!slowTimer) slowTimer = setTimeout(() => setSlowReconnect(true), 6000);
    }
    function onServerShutdown() {
      setRestarting(true);
    }
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('server:shutdown', onServerShutdown);

    // Device-level connectivity, distinct from a server-side blip — lets the copy
    // point the user at their own network instead of implying our server is down.
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    if (typeof navigator !== 'undefined') setOffline(!navigator.onLine);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    if (fresh) {
      // Force a brand-new identity (testing with shared-localStorage incognito windows, or
      // a user who explicitly wants a different nickname for this room)
      setIdentityNickname('');
      setPhase('need-nickname');
    } else if (identity?.nickname) {
      // Stored identity → auto-join (whether normal load or QR scan with `forceJoin`).
      attemptJoin(identity.nickname, identity.playerToken);
    } else {
      setPhase('need-nickname');
    }

    return () => {
      socket.off('state', onState);
      socket.off('game:start', onGameStart);
      socket.off('game:result', onResult);
      socket.off('error', onErr);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('server:shutdown', onServerShutdown);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      if (slowTimer) clearTimeout(slowTimer);
    };
  }, [roomId, forceJoin, fresh, attemptJoin, setMe, setState, setGameStart, setResult, resetStore]);

  // Reset the tap-gate whenever a new game begins. Must run before any early
  // return so hook order stays stable across renders.
  useEffect(() => {
    setResultAcked(false);
    setReplayStartAt(null);
  }, [gameStart?.startAt]);

  // Idle guard: when the room enters 'result' and stays there for IDLE_REDIRECT_MS,
  // dispose the socket and bounce to landing. Triggered by status, not by which
  // sub-screen is showing, so participants stuck on the post-replay prompt are
  // covered too.
  const status = state?.status;
  // Hold the screen awake through any active phase so a phone doesn't dim/lock
  // mid-round and cost a player their input (reaction tap, tilt, charge taps).
  useWakeLock(status === 'charging' || status === 'countdown' || status === 'playing');
  const router = useRouter();
  useEffect(() => {
    if (status !== 'result') return;
    const t = setTimeout(() => {
      disposeSocket();
      router.push('/');
    }, ROOM.IDLE_REDIRECT_MS);
    return () => clearTimeout(t);
  }, [status, router]);

  if (phase === 'error') {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
        <div className="text-3xl mb-3">😵</div>
        <h1 className="text-lg font-bold">{errMsg ?? ko.errors.generic}</h1>
        <a href="/" className="mt-6 text-sm text-amber-400 underline-offset-2 hover:underline">
          {ko.errors.backToHome}
        </a>
      </main>
    );
  }

  if (phase === 'connecting' && !state) {
    // 콜드스타트(scale-to-zero)·QR 첫 진입 시 보이는 화면 — 빈 텍스트 대신 브랜드
    // 마크 + 펄스로 "살아있는 로딩" 느낌. 서버 깨어나는 잠깐을 덜 휑하게.
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center gap-4">
        <Logo size={48} className="animate-pulse" />
        <p className="text-sm text-zinc-400">{ko.errors.connecting}</p>
      </main>
    );
  }

  // In-room rendering
  const effectiveStartAt = replayStartAt ?? gameStart?.startAt ?? 0;
  const showCountdown = !!gameStart && Date.now() < effectiveStartAt + 200;
  const inCharging = state?.status === 'charging';
  const inResult = state?.status === 'result';
  const replayPlayed = !!gameStart;
  // Renderer choice is driven by the game's category (single source of truth in
  // games/types.ts), not by re-spelled gameId comparisons. 'marble' covers marble
  // + marble-cheer (same SimulationResult shape); 'quiz' covers trivia + nonsense.
  const category = gameStart ? gameCategory(gameStart.gameId) : null;
  const isMarbleLikeGame = category === 'marble';
  const isMarbleTiltGame = category === 'live-marble';
  const isReactionGame = category === 'reaction';
  const isQuizGame = category === 'quiz';
  // Reaction and quiz games have nothing to "watch" after the round ends — flip to
  // result immediately. Marble keeps the renderer visible past the flip so replay
  // frames finish, gated by a tap-to-continue prompt. Marble-tilt also keeps the
  // gate so the loser-decided fanfare has time to land.
  const skipResultGate = !!gameStart && skipsResultGate(gameStart.gameId);
  const showGame =
    replayPlayed &&
    state?.status !== 'lobby' &&
    state?.status !== 'charging' &&
    (!inResult || (!resultAcked && !skipResultGate));
  const showResult = inResult && (resultAcked || !replayPlayed || skipResultGate);
  const showResultPrompt = inResult && replayPlayed && !resultAcked && !skipResultGate;

  function handleReplay() {
    setReplayStartAt(Date.now() + UI.REPLAY_LEAD_MS);
    setResultAcked(false);
  }

  return (
    <>
      {(connectionLost || offline || restarting) && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pointer-events-none pt-[max(env(safe-area-inset-top),8px)]"
        >
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-rose-500/90 px-4 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-sm">
            <span>
              {offline
                ? ko.errors.offline
                : restarting
                  ? ko.errors.serverRestarting
                  : ko.errors.reconnecting}
            </span>
            {(slowReconnect || offline) && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full bg-white/20 px-2 py-0.5 font-bold active:scale-95"
              >
                {ko.errors.reconnectRetry}
              </button>
            )}
          </div>
        </div>
      )}

      {state && (state.status === 'lobby' || (!showGame && !showResult && !inCharging)) && (
        <Lobby inviteUrl={inviteUrl} onChangeNickname={() => setPhase('need-nickname')} />
      )}

      {inCharging && <ChargePhase />}

      {showGame && gameStart && isMarbleLikeGame && (
        <div className="fixed inset-0 z-20">
          <MarbleRenderer
            key={effectiveStartAt}
            startAt={effectiveStartAt}
            durationMs={gameStart.durationMs}
            replay={gameStart.replay as SimulationResult}
            players={gameStart.players}
            myPlayerToken={myToken}
          />
        </div>
      )}

      {showGame && gameStart && isMarbleTiltGame && (
        <div className="fixed inset-0 z-20">
          <MarbleTiltRenderer
            key={effectiveStartAt}
            startAt={effectiveStartAt}
            intro={gameStart.replay as MarbleTiltIntroData}
            players={gameStart.players}
            myPlayerToken={myToken}
          />
        </div>
      )}

      {showGame && gameStart && isReactionGame && (
        <div className="fixed inset-0 z-20">
          <ReactionRenderer
            key={effectiveStartAt}
            startAt={effectiveStartAt}
            goAt={(gameStart.replay as ReactionReplayData).goAt}
            deadlineAt={(gameStart.replay as ReactionReplayData).deadlineAt}
            durationMs={gameStart.durationMs}
            players={gameStart.players}
            myPlayerToken={myToken}
          />
        </div>
      )}

      {showGame && gameStart && isQuizGame && (
        <div className="fixed inset-0 z-20">
          <TriviaRenderer
            key={effectiveStartAt}
            startAt={effectiveStartAt}
            durationMs={gameStart.durationMs}
            replay={gameStart.replay as TriviaReplayData}
            players={gameStart.players}
            myPlayerToken={myToken}
          />
        </div>
      )}

      {showCountdown && gameStart && !isReactionGame && !isQuizGame && (
        <Countdown startAt={effectiveStartAt} />
      )}

      {showResult && (
        <ResultScreen
          onReplay={skipResultGate || isMarbleTiltGame ? undefined : handleReplay}
        />
      )}

      {showResultPrompt && (
        <button
          type="button"
          onClick={() => setResultAcked(true)}
          className="fixed inset-x-0 bottom-6 z-30 mx-auto flex w-fit items-center gap-2 rounded-2xl bg-amber-400 px-8 py-4 text-base font-bold text-zinc-950 shadow-2xl shadow-amber-500/40 ring-1 ring-amber-300/60 transition active:scale-95 animate-pulse"
        >
          {ko.result.tapToContinue} →
        </button>
      )}

      {phase === 'need-nickname' && (
        <JoinModal
          defaultNickname={identityNickname}
          errorMessage={joinError}
          busy={busyJoin}
          onSubmit={(nickname) => attemptJoin(nickname)}
        />
      )}
    </>
  );
}

function readHostToken(roomId: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage.getItem(`bbk:host:${roomId}`) ?? undefined;
  } catch {
    return undefined;
  }
}
