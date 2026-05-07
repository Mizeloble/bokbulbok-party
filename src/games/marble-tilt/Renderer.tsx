'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ko } from '@/lib/i18n';
import { getSocket } from '@/lib/socket-client';
import { haptics } from '@/games/marble/haptics';
import type { SimulationResult, StaticEntity } from '@/games/marble/sim';
import { CAMERA_EASE_RATE, INSET_FADE_RATE, ZOOM_THRESHOLD } from '@/games/marble/render/constants';
import { computeZoom } from '@/games/marble/render/camera';
import { drawParticles, spawnFinishBurst } from '@/games/marble/render/particles';
import { drawScene } from '@/games/marble/render/scene';
import {
  drawLeaderboard,
  drawLoserBanner,
  drawPaneFrame,
  drawPersonalRankCard,
  formatLoserLabel,
} from '@/games/marble/render/overlay';
import { roundedClip } from '@/games/marble/render/canvas-utils';
import type { Pane } from '@/games/marble/render/types';
import { useGyro, type GyroState } from './useGyro';

export type MarbleTiltIntroData = {
  entities: StaticEntity[];
  playerOrder: string[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  goalY: number;
  zoomY: number;
  durationMsHint: number;
  initialPositions: number[];
};

export type MarbleTiltRendererProps = {
  startAt: number;
  intro: MarbleTiltIntroData;
  players: { playerToken: string; nickname: string; color: string }[];
  myPlayerToken: string | null;
};

type LiveTick = {
  t: number;
  positions: number[];
  finished?: number[];
  boosted?: number[];
  done?: boolean;
  recvAt: number;
};

const BOOST_BUDGET_MAX = 3;
const BOOST_COOLDOWN_MS = 800;

// Must match the server's TICK_HZ in liveSim.ts. The interpolator divides
// elapsed wall-time by `TICK_INTERVAL_MS`, and the scene draw uses
// `tickIdx / DISPLAY_FPS` as `elapsedSec` for rotor animation, so a mismatch
// causes both stretchy interpolation AND wrong rotor speed.
const DISPLAY_FPS = 60;
const TICK_INTERVAL_MS = 1000 / DISPLAY_FPS;

export function MarbleTiltRenderer({ startAt, intro, players, myPlayerToken }: MarbleTiltRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Tick stream state (refs so the rAF loop reads the latest without re-binding).
  const prevTickRef = useRef<LiveTick | null>(null);
  const latestTickRef = useRef<LiveTick | null>(null);
  const finishedTicksRef = useRef<number[]>(new Array(intro.playerOrder.length).fill(-1));
  const finishOrderTokensRef = useRef<string[]>([]);
  const totalTicksRef = useRef<number>(0);
  const doneAtRef = useRef<number | null>(null);
  // Boost flash effect: marble idx -> wall-clock when its boost was received.
  // The draw loop reads this to overlay a brief white halo + radial burst.
  const boostFlashRef = useRef<Map<number, number>>(new Map());

  // Local boost budget mirrors the server's budget; keeps UI responsive.
  // The server is authoritative — it'll silently reject extra boosts if our
  // count desyncs (e.g. from tick drops) but the local count is what drives
  // the button's enabled/disabled state.
  const [boostBudget, setBoostBudget] = useState(BOOST_BUDGET_MAX);
  const [boostCooldownAt, setBoostCooldownAt] = useState(0);
  // Reset budget on round restart (key changes via startAt).
  useEffect(() => {
    setBoostBudget(BOOST_BUDGET_MAX);
    setBoostCooldownAt(0);
  }, [startAt]);
  // Schedule a re-render exactly when the cooldown expires. Without this the
  // button's `disabled` derivation stays stale (Date.now() doesn't trigger
  // React updates) and the boost stays grayed out indefinitely.
  useEffect(() => {
    if (boostCooldownAt === 0) return;
    const remaining = boostCooldownAt - Date.now();
    if (remaining <= 0) {
      setBoostCooldownAt(0);
      return;
    }
    const t = setTimeout(() => setBoostCooldownAt(0), remaining);
    return () => clearTimeout(t);
  }, [boostCooldownAt]);

  // Tilt input. Hook lives at the top of the component so it persists across the
  // race; it will start emitting once `active` flips true. Permission is captured
  // earlier in the lobby gate. On iOS, the grant persists for the page's lifetime
  // but each new `useGyro` mount needs to re-call `requestPermission()` to attach
  // its listener (the call returns `granted` instantly with no modal).
  const tiltActiveRef = useRef(false);
  // Latest tilt value (-1..1), updated by the gyro callback. Read by the draw
  // loop to render the tilt feedback bar so the user can see *what they're
  // doing* — the marble itself can be hard to read in tight clusters.
  const currentTiltRef = useRef(0);
  const { state: gyroState, requestPermission, tare } = useGyro({
    active: true,
    onTilt: (x) => {
      currentTiltRef.current = x;
      if (!tiltActiveRef.current) return;
      const socket = getSocket();
      socket.emit('marble:tilt', { x });
    },
  });
  useEffect(() => {
    if (gyroState === 'idle') {
      // Safe to auto-call: on iOS, returns the cached grant decision without
      // showing the modal (modal only triggers on the very first request, which
      // already happened in the lobby). On Android, `requestPermission` is not
      // a function and the hook synthesizes `granted` directly.
      requestPermission();
    }
  }, [gyroState, requestPermission]);

  // Re-tare 200ms before the race goes live. The renderer mounts during the
  // countdown — if we'd kept the mount-time tare, any grip adjustment the user
  // makes during the 3-second countdown would bake into the zero point and
  // bias the marble to one side once the race starts.
  useEffect(() => {
    const delay = Math.max(0, startAt - Date.now() - 200);
    const t = setTimeout(() => tare(), delay);
    return () => clearTimeout(t);
  }, [startAt, tare]);

  const triggerBoost = useCallback(() => {
    if (!tiltActiveRef.current) return; // pre-race / post-finish guard
    if (boostBudget <= 0) return;
    const now = Date.now();
    if (now < boostCooldownAt) return;
    setBoostBudget((b) => b - 1);
    setBoostCooldownAt(now + BOOST_COOLDOWN_MS);
    getSocket().emit('marble:boost');
    haptics.myFinish(); // reuse existing strong haptic for tactile boost feedback
  }, [boostBudget, boostCooldownAt]);

  // Subscribe to live ticks. Bound once for the renderer's lifetime.
  useEffect(() => {
    const socket = getSocket();
    const onTick = (payload: {
      t: number;
      positions: number[];
      finished?: number[];
      boosted?: number[];
      done?: boolean;
    }) => {
      const recvAt = performance.now();
      prevTickRef.current = latestTickRef.current;
      latestTickRef.current = { ...payload, recvAt };
      totalTicksRef.current = Math.max(totalTicksRef.current, payload.t + 1);
      if (payload.finished && payload.finished.length > 0) {
        for (const idx of payload.finished) {
          if (finishedTicksRef.current[idx] < 0) {
            finishedTicksRef.current[idx] = payload.t;
            const tok = intro.playerOrder[idx];
            if (tok && !finishOrderTokensRef.current.includes(tok)) {
              finishOrderTokensRef.current.push(tok);
            }
          }
        }
      }
      if (payload.boosted && payload.boosted.length > 0) {
        for (const idx of payload.boosted) {
          boostFlashRef.current.set(idx, recvAt);
        }
      }
      if (payload.done) {
        doneAtRef.current = recvAt;
      }
    };
    socket.on('marble:tick', onTick);
    return () => {
      socket.off('marble:tick', onTick);
    };
  }, [intro.playerOrder]);

  // Draw loop — adapted from MarbleRenderer with live tick interpolation in
  // place of pre-computed frames lookup.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    function resize() {
      if (!canvas || !wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper);

    const playerByToken = new Map(players.map((p) => [p.playerToken, p]));
    const myIdx = myPlayerToken ? intro.playerOrder.indexOf(myPlayerToken) : -1;
    const totalPlayers = intro.playerOrder.length;

    // Pre-sort entities for per-frame culling, mirroring the marble renderer.
    const polylineEntities: StaticEntity[] = [];
    const sortedEntities: StaticEntity[] = [];
    for (const e of intro.entities) {
      if (e.shape.type === 'polyline') polylineEntities.push(e);
      else sortedEntities.push(e);
    }
    sortedEntities.sort((a, b) => a.y - b.y);
    const sortedYs = sortedEntities.map((e) => e.y);

    let zMinX = Infinity, zMaxX = -Infinity;
    for (const e of polylineEntities) {
      if (e.shape.type !== 'polyline') continue;
      for (const [px, py] of e.shape.points) {
        if (Math.abs(e.y + py - intro.zoomY) > ZOOM_THRESHOLD) continue;
        const ax = e.x + px;
        if (ax < zMinX) zMinX = ax;
        if (ax > zMaxX) zMaxX = ax;
      }
    }
    const zoomCenterX = Number.isFinite(zMinX)
      ? (zMinX + zMaxX) / 2
      : (intro.bounds.minX + intro.bounds.maxX) / 2;

    ctx.font = `bold ${14 * dpr}px sans-serif`;
    const labelWidths = new Map<string, number>();
    for (const p of players) labelWidths.set(p.playerToken, ctx.measureText(p.nickname).width);

    const mainPane: Pane = { px: 0, py: 0, pw: 0, ph: 0, label: '', particles: [], bursts: [], pulse: 0, shake: 0, alpha: 1 };
    const insetPane: Pane = { px: 0, py: 0, pw: 0, ph: 0, label: ko.marble.paneLoserView, particles: [], bursts: [], pulse: 0, shake: 0, alpha: 0 };

    let camY = 0, camZoom = 1;
    let insetCamY = 0, insetCamZoom = 1;
    let camInit = false;
    let firedMyFinishHaptic = false;
    let firedLoserHaptic = false;
    let lastProcessedTick = -1;

    let raf = 0;
    let lastT = performance.now();

    // Synthetic SimulationResult so we can reuse drawScene/drawLeaderboard.
    // `frames`/`finishFrames` are mutated each draw to reflect the live state.
    const fauxReplay = {
      fps: DISPLAY_FPS,
      durationMs: intro.durationMsHint,
      frames: [] as number[][], // empty → trail loop in scene.ts no-ops
      playerOrder: intro.playerOrder,
      finishOrder: [] as string[],
      finishFrames: new Array<number>(totalPlayers).fill(-1),
      entities: intro.entities,
      goalY: intro.goalY,
      zoomY: intro.zoomY,
      bounds: intro.bounds,
      frameDurations: [],
    } as unknown as SimulationResult;

    const draw = (now: number) => {
      const dtSec = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
      lastT = now;

      // Activate tilt emission only when we're actually in playing-after-startAt.
      // Renderer mounts during countdown — emitting tilt before sim.start() on
      // the server is harmless but pointless.
      const hasStarted = Date.now() >= startAt;
      tiltActiveRef.current = hasStarted && !doneAtRef.current && myIdx >= 0;

      // Wait for first tick before drawing live positions.
      const latest = latestTickRef.current;
      const prev = prevTickRef.current;
      const W = canvas.width;
      const H = canvas.height;
      ctx.fillStyle = '#0b0b10';
      ctx.fillRect(0, 0, W, H);

      if (!latest) {
        // Pre-first-tick: marbles haven't been stepped yet on the server, so use
        // the spawn-position snapshot from intro to draw them in their resting
        // grid. Center the camera on my marble (or on the pack centroid for
        // spectators / host).
        const spawn = intro.initialPositions;
        const initialY = myIdx >= 0 ? spawn[myIdx * 2 + 1] : avgY(spawn);
        if (!camInit) {
          camY = initialY;
          camZoom = 1;
          camInit = true;
        }
        mainPane.px = 0; mainPane.py = 0; mainPane.pw = W; mainPane.ph = H;
        mainPane.label = ko.marbleTilt.hint;
        drawScene(
          ctx, mainPane, camY, camZoom, dpr, fauxReplay,
          spawn, spawn, 0, 0, playerByToken, myPlayerToken,
          polylineEntities, sortedEntities, sortedYs, labelWidths, 0, zoomCenterX,
        );
        drawPaneFrame(ctx, mainPane, dpr, true);
        raf = requestAnimationFrame(draw);
        return;
      }

      // Update live finish state on the faux replay.
      for (let i = 0; i < totalPlayers; i++) {
        fauxReplay.finishFrames[i] = finishedTicksRef.current[i];
      }
      fauxReplay.finishOrder = finishOrderTokensRef.current;

      // Interpolation factor between prev and latest tick, capped at 1.
      const sincePrev = prev ? (now - latest.recvAt) / TICK_INTERVAL_MS : 0;
      const tFrac = prev ? Math.min(1, Math.max(0, sincePrev)) : 0;
      const cur = prev ? prev.positions : latest.positions;
      const next = latest.positions;
      const tickIdx = latest.t;

      // Live 꼴등 후보 lookup.
      let liveLoserY = Infinity;
      let liveLoserIdx = -1;
      for (let i = 0; i < totalPlayers; i++) {
        if (finishedTicksRef.current[i] >= 0) continue;
        const yv = next[i * 2 + 1];
        if (yv < liveLoserY) {
          liveLoserY = yv;
          liveLoserIdx = i;
        }
      }
      // After everyone finishes, fall back to the last-recorded loser candidate
      // (the actual round loser). If the round finished without anyone, leave -1.
      if (liveLoserIdx < 0 && finishOrderTokensRef.current.length > 0) {
        const lastTok = finishOrderTokensRef.current[finishOrderTokensRef.current.length - 1];
        liveLoserIdx = intro.playerOrder.indexOf(lastTok);
        if (liveLoserIdx >= 0) liveLoserY = next[liveLoserIdx * 2 + 1];
      }

      const finishHoldFrames = Math.ceil(DISPLAY_FPS * 0.17);
      const myFinishTick = myIdx >= 0 ? finishedTicksRef.current[myIdx] : -1;
      const iAmFinished = myFinishTick >= 0 && tickIdx >= myFinishTick + finishHoldFrames;
      const iAmLoserCandidate = myIdx === liveLoserIdx && !iAmFinished;
      const myYNow = myIdx >= 0 ? next[myIdx * 2 + 1] : liveLoserY;

      // Fanfare on second-to-last finisher (loser-decided moment).
      const expectedFinishers = totalPlayers - 1;
      const stlReached = finishOrderTokensRef.current.length >= expectedFinishers;
      const stlToken = stlReached ? finishOrderTokensRef.current[expectedFinishers - 1] : null;
      const stlIdx = stlToken ? intro.playerOrder.indexOf(stlToken) : -1;
      const loserDecidedTick = stlIdx >= 0 ? finishedTicksRef.current[stlIdx] : -1;
      const loserToken = stlReached
        ? intro.playerOrder.find((t) => !finishOrderTokensRef.current.includes(t)) ?? null
        : null;
      const loserIdx = loserToken ? intro.playerOrder.indexOf(loserToken) : -1;

      // Spawn fanfare bursts once per crossing tick, mirroring the marble renderer.
      if (loserDecidedTick >= 0 && loserIdx >= 0) {
        const burstFrame1 = loserDecidedTick;
        const burstFrame2 = loserDecidedTick + Math.floor(DISPLAY_FPS * 0.25);
        const burstFrame3 = loserDecidedTick + Math.floor(DISPLAY_FPS * 0.55);
        for (let f = lastProcessedTick + 1; f <= tickIdx; f++) {
          const isB1 = f === burstFrame1;
          const isB2 = f === burstFrame2;
          const isB3 = f === burstFrame3;
          if (!isB1 && !isB2 && !isB3) continue;
          const wx = next[loserIdx * 2];
          const wy = next[loserIdx * 2 + 1];
          const color = playerByToken.get(intro.playerOrder[loserIdx])?.color ?? '#fbbf24';
          const intensity = isB1 ? 1.0 : isB2 ? 0.75 : 0.55;
          spawnFinishBurst(mainPane.particles, wx, wy, color, intensity);
          spawnFinishBurst(insetPane.particles, wx, wy, color, intensity);
          if (isB1) {
            mainPane.bursts.push({ x: wx, y: wy, age: 0, color, rankLabel: formatLoserLabel() });
            insetPane.bursts.push({ x: wx, y: wy, age: 0, color, rankLabel: formatLoserLabel() });
          }
          mainPane.pulse = Math.max(mainPane.pulse, isB1 ? 2.5 : 1.4);
          insetPane.pulse = Math.max(insetPane.pulse, isB1 ? 2.5 : 1.4);
          mainPane.shake = Math.max(mainPane.shake, isB1 ? 1.8 : 0.9);
          insetPane.shake = Math.max(insetPane.shake, isB1 ? 1.8 : 0.9);
        }
      }
      lastProcessedTick = tickIdx;

      if (!firedMyFinishHaptic && myFinishTick >= 0 && tickIdx >= myFinishTick) {
        firedMyFinishHaptic = true;
        haptics.myFinish();
      }
      if (!firedLoserHaptic && loserDecidedTick >= 0 && tickIdx >= loserDecidedTick && myIdx === loserIdx) {
        firedLoserHaptic = true;
        haptics.loserConfirmed();
      }

      mainPane.px = 0;
      mainPane.py = 0;
      mainPane.pw = W;
      mainPane.ph = H;
      const insetW = Math.floor(W * 0.36);
      const insetH = Math.floor(H * 0.32);
      const insetMargin = 8 * dpr;
      insetPane.px = W - insetW - insetMargin;
      insetPane.py = insetMargin;
      insetPane.pw = insetW;
      insetPane.ph = insetH;

      const targetMainY = iAmFinished ? liveLoserY : myYNow;
      const targetInsetY = liveLoserY;
      const targetMainZoom = computeZoom(targetMainY, intro.zoomY);
      const targetInsetZoom = computeZoom(targetInsetY, intro.zoomY);
      if (!camInit) {
        camY = targetMainY; camZoom = targetMainZoom;
        insetCamY = targetInsetY; insetCamZoom = targetInsetZoom;
        camInit = true;
      } else {
        const k = 1 - Math.exp(-dtSec * CAMERA_EASE_RATE);
        camY += (targetMainY - camY) * k;
        camZoom += (targetMainZoom - camZoom) * k;
        insetCamY += (targetInsetY - insetCamY) * k;
        insetCamZoom += (targetInsetZoom - insetCamZoom) * k;
      }

      mainPane.label = iAmFinished
        ? ko.marble.paneFinishedLoserView
        : iAmLoserCandidate
          ? ko.marble.paneRiskCandidate
          : ko.marble.paneMyView;

      const mainShakeX = mainPane.shake > 0 ? (Math.random() - 0.5) * mainPane.shake * 8 * dpr : 0;
      const mainShakeY = mainPane.shake > 0 ? (Math.random() - 0.5) * mainPane.shake * 8 * dpr : 0;
      ctx.save();
      if (mainShakeX || mainShakeY) ctx.translate(mainShakeX, mainShakeY);
      drawScene(
        ctx, mainPane, camY, camZoom, dpr, fauxReplay,
        cur, next, tFrac, /*elapsedSec*/ tickIdx / DISPLAY_FPS,
        playerByToken, myPlayerToken,
        polylineEntities, sortedEntities, sortedYs, labelWidths, tickIdx, zoomCenterX,
      );
      drawParticles(ctx, mainPane, dtSec, dpr, camY, camZoom, intro.bounds, zoomCenterX);
      ctx.restore();
      drawPaneFrame(ctx, mainPane, dpr, true);

      const showInset = !iAmFinished && myIdx !== liveLoserIdx && liveLoserIdx >= 0;
      const targetInsetAlpha = showInset ? 1 : 0;
      const fadeK = 1 - Math.exp(-dtSec * INSET_FADE_RATE);
      insetPane.alpha += (targetInsetAlpha - insetPane.alpha) * fadeK;
      if (insetPane.alpha > 0.01) {
        ctx.save();
        ctx.globalAlpha *= insetPane.alpha;
        roundedClip(ctx, insetPane.px, insetPane.py, insetPane.pw, insetPane.ph, 10 * dpr);
        ctx.fillStyle = '#0b0b10';
        ctx.fillRect(insetPane.px, insetPane.py, insetPane.pw, insetPane.ph);
        drawScene(
          ctx, insetPane, insetCamY, insetCamZoom, dpr, fauxReplay,
          cur, next, tFrac, tickIdx / DISPLAY_FPS,
          playerByToken, myPlayerToken,
          polylineEntities, sortedEntities, sortedYs, labelWidths, tickIdx, zoomCenterX,
        );
        drawParticles(ctx, insetPane, dtSec, dpr, insetCamY, insetCamZoom, intro.bounds, zoomCenterX);
        ctx.restore();
        drawPaneFrame(ctx, insetPane, dpr, false);
      } else if (insetPane.particles.length > 0) {
        insetPane.particles.length = 0;
      }

      drawLeaderboard(ctx, dpr, W, H, fauxReplay, next, tickIdx, playerByToken, myPlayerToken);

      if (loserDecidedTick >= 0 && tickIdx >= loserDecidedTick && loserIdx >= 0) {
        const loserNick = playerByToken.get(intro.playerOrder[loserIdx])?.nickname ?? '';
        const loserColor = playerByToken.get(intro.playerOrder[loserIdx])?.color ?? '#fbbf24';
        drawLoserBanner(ctx, dpr, W, H, loserNick, loserColor, tickIdx - loserDecidedTick, DISPLAY_FPS, now);
      }

      // Personal rank card: locked when MY marble crosses, or when the loser is
      // decided (if I'm the loser, since I never cross).
      const myFinishLockedTick =
        myIdx < 0 ? -1 : myIdx === loserIdx ? loserDecidedTick : myFinishTick;
      const myRank = myPlayerToken
        ? finishOrderTokensRef.current.indexOf(myPlayerToken) + 1
        : 0;
      if (myFinishLockedTick >= 0 && tickIdx >= myFinishLockedTick && myRank > 0) {
        drawPersonalRankCard(
          ctx, dpr, W, H, myRank, totalPlayers, tickIdx - myFinishLockedTick, DISPLAY_FPS, now,
        );
      }

      mainPane.pulse = Math.max(0, mainPane.pulse - dtSec * 1.2);
      insetPane.pulse = Math.max(0, insetPane.pulse - dtSec * 1.2);
      mainPane.shake = Math.max(0, mainPane.shake - dtSec * 3);
      insetPane.shake = Math.max(0, insetPane.shake - dtSec * 3);

      // Boost flash overlay — when a marble boosts, we draw a brief radial
      // flash + outward burst around its current position. Lives ~400 ms,
      // intensity decays linearly. Spawn-based scene particles handle the
      // confetti rain at finish; this is just the kick-off effect.
      const flashes = boostFlashRef.current;
      if (flashes.size > 0) {
        const FLASH_LIFE_MS = 400;
        for (const [idx, recvAt] of flashes.entries()) {
          const age = now - recvAt;
          if (age > FLASH_LIFE_MS) {
            flashes.delete(idx);
            continue;
          }
          const t = age / FLASH_LIFE_MS;
          // Position from latest tick (no need to interpolate for a 400ms effect).
          const wx = next[idx * 2];
          const wy = next[idx * 2 + 1];
          drawBoostFlash(
            ctx, dpr, W, H, wx, wy, t,
            mainPane, camY, camZoom, intro.bounds, zoomCenterX,
          );
        }
      }

      // Tilt feedback bar — renders the user's current tilt input as a slider
      // pip on a horizontal track at the bottom of the viewport. Only shown
      // while my marble is still racing (no point during the post-finish hold)
      // and only if I have a marble to control (host doesn't tilt).
      if (myIdx >= 0 && !iAmFinished && tiltActiveRef.current) {
        drawTiltBar(ctx, dpr, W, H, currentTiltRef.current);
      }

      // Stop the rAF loop a bit after `done`, matching the marble renderer's
      // post-finish hold so animations have time to land.
      if (doneAtRef.current && now - doneAtRef.current > 1500) {
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      tiltActiveRef.current = false;
    };
  }, [intro, players, myPlayerToken, startAt]);

  const myIdxState = myPlayerToken ? intro.playerOrder.indexOf(myPlayerToken) : -1;
  const showBoostButton = myIdxState >= 0;
  const boostDisabled = boostBudget <= 0 || Date.now() < boostCooldownAt;

  return (
    <div ref={wrapperRef} className="absolute inset-0 bg-zinc-950">
      <canvas ref={canvasRef} />
      {/* Render the floating tilt status pip in the corner so the user can confirm
          permission state without leaving the race screen. */}
      <PermissionPip />

      {showBoostButton && (
        <button
          type="button"
          onClick={triggerBoost}
          disabled={boostDisabled}
          aria-label={ko.marbleTilt.boostLabel}
          className="absolute right-4 bottom-20 select-none rounded-full border-2 border-amber-200/80 bg-amber-400 text-zinc-950 font-extrabold shadow-2xl shadow-amber-500/40 active:scale-95 transition-transform disabled:opacity-35 disabled:scale-95"
          style={{ width: 92, height: 92 }}
        >
          <div className="flex flex-col items-center justify-center leading-tight">
            <span className="text-[28px]">⚡</span>
            <span className="text-[12px] tracking-wider">{ko.marbleTilt.boostLabel}</span>
            <span className="text-[11px] mt-0.5">× {boostBudget}</span>
          </div>
        </button>
      )}
    </div>
  );
}

function PermissionPip() {
  // Lightweight permission status badge. Mounted unconditionally; the hook
  // returns the same `state` regardless because grants persist for the page
  // lifetime. Hidden once granted (no need to keep nagging).
  const { state, requestPermission } = useGyro({ active: false, onTilt: () => {} });
  if (state === 'granted') return null;
  const tappable = state === 'idle' || state === 'denied';
  const Tag = tappable ? 'button' : 'div';
  return (
    <Tag
      type={tappable ? 'button' : undefined}
      onClick={tappable ? requestPermission : undefined}
      className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900/80 border border-zinc-700 px-3 py-1 text-[11px] text-zinc-300 active:scale-[0.98]"
    >
      <span>{labelFor(state)}</span>
    </Tag>
  );
}

function labelFor(s: GyroState): string {
  switch (s) {
    case 'idle':
      return ko.marbleTilt.permEnable;
    case 'requesting':
      return ko.marbleTilt.permRequesting;
    case 'denied':
      return ko.marbleTilt.permDenied;
    case 'unsupported':
      return ko.marbleTilt.permUnsupported;
    default:
      return '';
  }
}

function avgY(positions: number[]): number {
  if (positions.length < 2) return 4;
  let sum = 0;
  let n = 0;
  for (let i = 1; i < positions.length; i += 2) {
    sum += positions[i];
    n++;
  }
  return n > 0 ? sum / n : 4;
}

/**
 * Draw a horizontal tilt-input feedback bar at the bottom of the viewport so
 * the user can see at-a-glance which way they're tilting and how hard. The
 * bar fills from center outward in the tilt direction, with a small pip
 * marker for the exact value.
 */
function drawTiltBar(ctx: CanvasRenderingContext2D, dpr: number, W: number, H: number, x: number) {
  const value = Math.max(-1, Math.min(1, x));
  const barW = Math.min(W * 0.55, 280 * dpr);
  const barH = 10 * dpr;
  const cx = W / 2;
  const by = H - 36 * dpr;
  const left = cx - barW / 2;
  const top = by - barH / 2;

  // Track background
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRectFill(ctx, left, top, barW, barH, barH / 2);

  // Center notch
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(cx - 1 * dpr, top - 2 * dpr, 2 * dpr, barH + 4 * dpr);

  // Filled portion (from center toward tilt direction)
  const fillW = (barW / 2) * Math.abs(value);
  if (fillW > 0.5) {
    const fx = value >= 0 ? cx : cx - fillW;
    // Color shifts from amber at low tilt → red at full tilt to hint sensitivity.
    const intensity = Math.abs(value);
    const r = Math.round(251 + (245 - 251) * intensity);
    const g = Math.round(191 + (61 - 191) * intensity);
    const b = Math.round(36 + (61 - 36) * intensity);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    roundRectFill(ctx, fx, top, fillW, barH, barH / 2);
  }

  // Pip marker at the exact tilt position
  const pipX = cx + (barW / 2) * value;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(pipX, by, 7 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b0b10';
  ctx.beginPath();
  ctx.arc(pipX, by, 3 * dpr, 0, Math.PI * 2);
  ctx.fill();

  // Direction arrow icons on either side, dim until that side is being pushed
  ctx.font = `bold ${13 * dpr}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = value < -0.05 ? '#fbbf24' : 'rgba(255,255,255,0.4)';
  ctx.fillText('◀', left - 8 * dpr, by);
  ctx.textAlign = 'left';
  ctx.fillStyle = value > 0.05 ? '#fbbf24' : 'rgba(255,255,255,0.4)';
  ctx.fillText('▶', left + barW + 8 * dpr, by);
  ctx.restore();
}

/**
 * Draw a single boost flash: a bright expanding ring + radial burst lines
 * centered on a marble's world position, with intensity easing out over `t∈[0,1]`.
 * World→screen projection mirrors what `drawScene` does, so the flash sits
 * exactly on top of the marble in the main pane.
 */
function drawBoostFlash(
  ctx: CanvasRenderingContext2D, dpr: number, W: number, H: number,
  wx: number, wy: number, t: number,
  mainPane: Pane, camY: number, zoom: number,
  bounds: { minX: number; maxX: number },
  zoomCenterX: number,
) {
  const horizontalMargin = 12 * dpr;
  const fitWidth = Math.max(1, mainPane.pw - horizontalMargin * 2);
  const trackXSpan = Math.max(bounds.maxX - bounds.minX, 16);
  const baseScale = Math.min(fitWidth / trackXSpan, mainPane.ph / 22);
  const scale = baseScale * zoom;
  const trackCenterX = (bounds.minX + bounds.maxX) / 2;
  const zoomFrac = Math.max(0, Math.min(1, (zoom - 1) / Math.max(1e-6, 3 - 1)));
  const camX = trackCenterX + (zoomCenterX - trackCenterX) * zoomFrac;
  const offsetX = mainPane.px + mainPane.pw / 2 - camX * scale;
  const offsetY = mainPane.py + mainPane.ph * 0.55 - camY * scale;
  const sx = wx * scale + offsetX;
  const sy = wy * scale + offsetY;

  const alpha = 1 - t;
  const ringR = (8 + 60 * t) * dpr;

  ctx.save();
  // Expanding ring
  ctx.strokeStyle = `rgba(255, 245, 200, ${alpha})`;
  ctx.lineWidth = (5 - 4 * t) * dpr;
  ctx.beginPath();
  ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
  ctx.stroke();

  // Inner solid flash (only in first half)
  if (t < 0.5) {
    const innerAlpha = (1 - t * 2) * 0.85;
    ctx.fillStyle = `rgba(255, 250, 220, ${innerAlpha})`;
    ctx.beginPath();
    ctx.arc(sx, sy, (12 + 16 * t) * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Radial dashes — 8 spokes
  const spokeLen = (28 + 32 * t) * dpr;
  const spokeStart = (10 + 30 * t) * dpr;
  ctx.strokeStyle = `rgba(255, 230, 150, ${alpha * 0.85})`;
  ctx.lineWidth = 2.5 * dpr;
  ctx.lineCap = 'round';
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x1 = sx + Math.cos(a) * spokeStart;
    const y1 = sy + Math.sin(a) * spokeStart;
    const x2 = sx + Math.cos(a) * (spokeStart + spokeLen);
    const y2 = sy + Math.sin(a) * (spokeStart + spokeLen);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRectFill(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
  ctx.fill();
}
