'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ko } from '@/lib/i18n';
import { getSocket, disposeSocket } from '@/lib/socket-client';
import { loadIdentity, saveIdentity } from '@/lib/nickname-store';
import { useRoomStore, type GameStartPayload, type PublicRoomState, type ResultPayload } from '@/store/room-store';
import { Lobby } from '@/components/Lobby';
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
import { isLiveGame } from '@/games/types';
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
    function onConnect() {
      setConnectionLost(false);
      if (joinedOnceRef.current) rejoinSilently();
    }
    // Only surface the banner once we've joined — the first connect has its own
    // "connecting…" screen, and a pre-join drop shouldn't flash a scary banner.
    function onDisconnect() {
      if (joinedOnceRef.current) setConnectionLost(true);
    }
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

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
    return (
      <main className="min-h-dvh flex items-center justify-center text-zinc-400">
        {ko.errors.connecting}
      </main>
    );
  }

  // In-room rendering
  const effectiveStartAt = replayStartAt ?? gameStart?.startAt ?? 0;
  const showCountdown = !!gameStart && Date.now() < effectiveStartAt + 200;
  const inCharging = state?.status === 'charging';
  const inResult = state?.status === 'result';
  const replayPlayed = !!gameStart;
  // marble and marble-cheer share the same renderer (same SimulationResult shape).
  const isMarbleLikeGame =
    !!gameStart && (gameStart.gameId === 'marble' || gameStart.gameId === 'marble-cheer');
  const isMarbleTiltGame = !!gameStart && isLiveGame(gameStart.gameId);
  const isReactionGame = !!gameStart && gameStart.gameId === 'reaction';
  // trivia and nonsense share the same renderer/replay shape (4-choice quiz engine).
  const isQuizGame =
    !!gameStart && (gameStart.gameId === 'trivia' || gameStart.gameId === 'nonsense');
  // Reaction and quiz games have nothing to "watch" after the round ends — flip to
  // result immediately. Marble keeps the renderer visible past the flip so replay
  // frames finish, gated by a tap-to-continue prompt. Marble-tilt also keeps the
  // gate so the loser-decided fanfare has time to land.
  const skipResultGate = isReactionGame || isQuizGame;
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
      {connectionLost && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[60] flex justify-center pointer-events-none pt-[max(env(safe-area-inset-top),8px)]"
        >
          <div className="rounded-full bg-rose-500/90 px-4 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-sm">
            {ko.errors.reconnecting}
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
