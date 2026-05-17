'use client';

import { useEffect, useRef } from 'react';
import { ko } from '@/lib/i18n';
import { haptics } from './haptics';
import type { SimulationResult } from './sim';
import { CAMERA_EASE_RATE, INSET_FADE_RATE, ZOOM_THRESHOLD } from './render/constants';
import { computeZoom } from './render/camera';
import { elapsedToFrameF } from './render/replay';
import { drawParticles, spawnFinishBurst } from './render/particles';
import { drawScene } from './render/scene';
import {
  drawLeaderboard,
  drawLoserBanner,
  drawPaneFrame,
  drawPersonalRankCard,
  formatLoserLabel,
} from './render/overlay';
import { roundedClip } from './render/canvas-utils';
import type { Pane } from './render/types';

export type MarbleRendererProps = {
  startAt: number;
  durationMs: number;
  replay: SimulationResult;
  players: { playerToken: string; nickname: string; color: string }[];
  myPlayerToken: string | null;
};

export function MarbleRenderer({ startAt, durationMs, replay, players, myPlayerToken }: MarbleRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Cap DPR at 1.5: the marble pegs are too small for the extra pixels to be visible,
    // and full DPR=2 doubles the fill cost on already-busy phones.
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
    const fps = replay.fps;
    const totalFrames = replay.frames.length;
    const myIdx = myPlayerToken ? replay.playerOrder.indexOf(myPlayerToken) : -1;

    // Pre-sort non-polyline entities by Y so we can binary-search the visible band each frame.
    // Polylines span huge Y ranges (e.g. -300..111), so they can't be sorted — keep them separate
    // and iterate all 22.
    const polylineEntities: typeof replay.entities = [];
    const sortedEntities: typeof replay.entities = [];
    for (const e of replay.entities) {
      if (e.shape.type === 'polyline') polylineEntities.push(e);
      else sortedEntities.push(e);
    }
    sortedEntities.sort((a, b) => a.y - b.y);
    const sortedYs = sortedEntities.map((e) => e.y);

    // Horizontal focal point for the zoom-in: the goal funnel often sits off-center
    // relative to the bounding box (e.g. lazygyu Wheel of fortune funnels to x≈15.55
    // while bounds center is x≈12.6). We sample polyline points within the zoom band
    // around `zoomY` and average their X extents — drawScene then eases between
    // bounds-center (no zoom) and this point (full zoom) so the goal stays centered.
    let zMinX = Infinity, zMaxX = -Infinity;
    for (const e of polylineEntities) {
      if (e.shape.type !== 'polyline') continue;
      for (const [px, py] of e.shape.points) {
        if (Math.abs(e.y + py - replay.zoomY) > ZOOM_THRESHOLD) continue;
        const ax = e.x + px;
        if (ax < zMinX) zMinX = ax;
        if (ax > zMaxX) zMaxX = ax;
      }
    }
    const zoomCenterX = Number.isFinite(zMinX)
      ? (zMinX + zMaxX) / 2
      : (replay.bounds.minX + replay.bounds.maxX) / 2;

    // Pre-measure nickname widths once instead of measureText-per-marble-per-frame.
    ctx.font = `bold ${14 * dpr}px sans-serif`;
    const labelWidths = new Map<string, number>();
    for (const p of players) labelWidths.set(p.playerToken, ctx.measureText(p.nickname).width);

    // Track which finish frames have been "consumed" for fanfare so we spawn each only once.
    let lastProcessedFrame = -1;
    // Single-fire haptic flags
    let firedMyFinishHaptic = false;
    let firedLoserHaptic = false;

    // Loser = the very last entry in finishOrder. That's the player who gets the penalty.
    const loserToken = replay.finishOrder[replay.finishOrder.length - 1];
    const loserIdx = loserToken ? replay.playerOrder.indexOf(loserToken) : -1;
    // Second-to-last finisher: their crossing locks in the loser. That's the climactic
    // moment — the loser's own crossing is anticlimactic since the result is already known.
    const stlToken = replay.finishOrder[replay.finishOrder.length - 2];
    const stlIdx = stlToken ? replay.playerOrder.indexOf(stlToken) : -1;
    const loserDecidedFrame = stlIdx >= 0 ? replay.finishFrames[stlIdx] : -1;

    // Personal rank: locked when MY marble crosses, or when the loser is decided
    // (if I'm the loser, since I never cross).
    const myRank = myPlayerToken ? replay.finishOrder.indexOf(myPlayerToken) + 1 : 0;
    const totalPlayers = replay.playerOrder.length;
    const myFinishLockedFrame =
      myIdx < 0
        ? -1
        : myIdx === loserIdx
          ? loserDecidedFrame
          : replay.finishFrames[myIdx];

    // Two panes: main (my marble) and inset (꼴등 후보). Both share the same draw routine.
    const mainPane: Pane = { px: 0, py: 0, pw: 0, ph: 0, label: '', particles: [], bursts: [], pulse: 0, shake: 0, alpha: 1 };
    const insetPane: Pane = { px: 0, py: 0, pw: 0, ph: 0, label: ko.marble.paneLoserView, particles: [], bursts: [], pulse: 0, shake: 0, alpha: 0 };

    // Cumulative playback time at the START of each frame (cumMs[i] = sum of frameDurations[0..i-1]).
    // Used to map wall-clock elapsed → frameF via binary search.
    const frameDurations = replay.frameDurations;
    const cumMs = new Float64Array(frameDurations.length + 1);
    for (let i = 0; i < frameDurations.length; i++) cumMs[i + 1] = cumMs[i] + frameDurations[i];

    // Stateful smooth camera (lazygyu-style): position and zoom ease toward target each frame
    // instead of snapping. Re-initialized to target on the very first draw.
    let camY = 0, camZoom = 1;
    let insetCamY = 0, insetCamZoom = 1;
    let camInit = false;

    let raf = 0;
    let lastT = performance.now();
    const draw = (now: number) => {
      // Clamp to [0, 0.05]: RAF's `now` can be slightly behind `lastT` on the first frame
      // (different time origins), which would yield a negative dt and feed negative ages
      // into burst/particle math (radii go negative → canvas throws).
      const dtSec = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
      lastT = now;

      const elapsed = Math.max(0, Date.now() - startAt);
      const frameF = elapsedToFrameF(elapsed, cumMs, frameDurations, totalFrames);
      const idx = Math.min(totalFrames - 1, Math.max(0, Math.floor(frameF)));
      const tFrac = Math.min(1, Math.max(0, frameF - idx));
      const cur = replay.frames[idx];
      const next = replay.frames[Math.min(totalFrames - 1, idx + 1)];

      // For animations that depend on real wall-clock (like rotor angles), use the in-sim seconds
      // rather than wall-clock — keeps rotors in sync with marbles during slow-mo.
      const elapsedSec = frameF / fps;

      const W = canvas.width;
      const H = canvas.height;

      // Live 꼴등 후보: the slowest unfinished marble (lowest y). Once everyone finishes,
      // fall back to the precomputed loserIdx so the camera stays parked on them.
      let liveLoserY = Infinity;
      let liveLoserIdx = -1;
      for (let i = 0; i < replay.playerOrder.length; i++) {
        const ff = replay.finishFrames[i];
        if (ff >= 0 && idx >= ff) continue; // already finished
        const yv = cur[i * 2 + 1];
        if (yv < liveLoserY) {
          liveLoserY = yv;
          liveLoserIdx = i;
        }
      }
      if (liveLoserIdx < 0 && loserIdx >= 0) {
        liveLoserIdx = loserIdx;
        liveLoserY = cur[loserIdx * 2 + 1];
      }

      // My marble's current position (or 꼴등 view if I'm finished early)
      // Switch camera to the loser-candidate ~170ms after my marble crosses the goal.
      const finishHoldFrames = Math.ceil(fps * 0.17);
      const iAmFinished = myIdx >= 0 && replay.finishFrames[myIdx] >= 0 && idx >= replay.finishFrames[myIdx] + finishHoldFrames;
      const iAmLoserCandidate = myIdx === liveLoserIdx && !iAmFinished;
      const myYNow = myIdx >= 0 ? cur[myIdx * 2 + 1] : liveLoserY;

      // Fanfare fires when the SECOND-TO-LAST finisher crosses — that's the moment
      // the loser is mathematically locked in. Three staggered bursts (0s, 0.25s, 0.55s
      // after) layered with confetti + emoji rain, pointing the camera/eye straight at
      // "you got the penalty".
      const burstFrame1 = loserDecidedFrame;
      const burstFrame2 = loserDecidedFrame + Math.floor(fps * 0.25);
      const burstFrame3 = loserDecidedFrame + Math.floor(fps * 0.55);
      for (let f = lastProcessedFrame + 1; f <= idx; f++) {
        if (loserIdx < 0) continue;
        const isB1 = f === burstFrame1;
        const isB2 = f === burstFrame2;
        const isB3 = f === burstFrame3;
        if (!isB1 && !isB2 && !isB3) continue;
        const wx = replay.frames[Math.min(f, replay.frames.length - 1)][loserIdx * 2];
        const wy = replay.frames[Math.min(f, replay.frames.length - 1)][loserIdx * 2 + 1];
        const color = playerByToken.get(replay.playerOrder[loserIdx])?.color ?? '#fbbf24';
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
      lastProcessedFrame = idx;

      // Haptic triggers — fire once each.
      if (!firedMyFinishHaptic && myIdx >= 0 && replay.finishFrames[myIdx] >= 0 && idx >= replay.finishFrames[myIdx]) {
        firedMyFinishHaptic = true;
        haptics.myFinish();
      }
      if (!firedLoserHaptic && loserDecidedFrame >= 0 && idx >= loserDecidedFrame && myIdx === loserIdx) {
        firedLoserHaptic = true;
        haptics.loserConfirmed();
      }

      // Layout: main fills full canvas; inset is top-right ~32% wide × 28% tall
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

      // Camera target: when I'm done, follow the live 꼴등 candidate. Otherwise follow myself.
      // The actual cam values ease toward these targets so the view glides instead of snapping
      // (lazygyu's `cur + (target - cur) * factor` per frame, made framerate-independent here).
      const targetMainY = iAmFinished ? liveLoserY : myYNow;
      const targetInsetY = liveLoserY;
      const targetMainZoom = computeZoom(targetMainY, replay.zoomY);
      const targetInsetZoom = computeZoom(targetInsetY, replay.zoomY);
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

      // Background
      ctx.fillStyle = '#0b0b10';
      ctx.fillRect(0, 0, W, H);

      // --- Draw main pane (with screen shake) ---
      mainPane.label = iAmFinished
        ? ko.marble.paneFinishedLoserView
        : iAmLoserCandidate
          ? ko.marble.paneRiskCandidate
          : ko.marble.paneMyView;
      const mainShakeX = mainPane.shake > 0 ? (Math.random() - 0.5) * mainPane.shake * 8 * dpr : 0;
      const mainShakeY = mainPane.shake > 0 ? (Math.random() - 0.5) * mainPane.shake * 8 * dpr : 0;
      ctx.save();
      if (mainShakeX || mainShakeY) ctx.translate(mainShakeX, mainShakeY);
      drawScene(ctx, mainPane, camY, camZoom, dpr, replay, cur, next, tFrac, elapsedSec, playerByToken, myPlayerToken, polylineEntities, sortedEntities, sortedYs, labelWidths, idx, zoomCenterX);
      drawParticles(ctx, mainPane, dtSec, dpr, camY, camZoom, replay.bounds, zoomCenterX);
      ctx.restore();
      drawPaneFrame(ctx, mainPane, dpr, true);

      // --- Draw inset pane (eased show/hide so its border doesn't pop in/out) ---
      const showInset = !iAmFinished && myIdx !== liveLoserIdx;
      const targetInsetAlpha = showInset ? 1 : 0;
      const fadeK = 1 - Math.exp(-dtSec * INSET_FADE_RATE);
      insetPane.alpha += (targetInsetAlpha - insetPane.alpha) * fadeK;
      if (insetPane.alpha > 0.01) {
        // Clip to the inset rect
        ctx.save();
        ctx.globalAlpha *= insetPane.alpha;
        roundedClip(ctx, insetPane.px, insetPane.py, insetPane.pw, insetPane.ph, 10 * dpr);
        ctx.fillStyle = '#0b0b10';
        ctx.fillRect(insetPane.px, insetPane.py, insetPane.pw, insetPane.ph);
        drawScene(ctx, insetPane, insetCamY, insetCamZoom, dpr, replay, cur, next, tFrac, elapsedSec, playerByToken, myPlayerToken, polylineEntities, sortedEntities, sortedYs, labelWidths, idx, zoomCenterX);
        drawParticles(ctx, insetPane, dtSec, dpr, insetCamY, insetCamZoom, replay.bounds, zoomCenterX);
        ctx.restore();
        drawPaneFrame(ctx, insetPane, dpr, false);
      } else if (insetPane.particles.length > 0) {
        // Drain particle pool only after the fade has fully completed.
        insetPane.particles.length = 0;
      }

      // --- Live leaderboard (left side) ---
      drawLeaderboard(ctx, dpr, W, H, replay, cur, idx, playerByToken, myPlayerToken);

      // --- Loser-name reveal banner (everyone sees it, swoops in at decision moment) ---
      if (loserDecidedFrame >= 0 && idx >= loserDecidedFrame && loserIdx >= 0) {
        const loserNick = playerByToken.get(replay.playerOrder[loserIdx])?.nickname ?? '';
        const loserColor = playerByToken.get(replay.playerOrder[loserIdx])?.color ?? '#fbbf24';
        drawLoserBanner(ctx, dpr, W, H, loserNick, loserColor, idx - loserDecidedFrame, fps, now);
      }

      // --- Personal rank card (centered top, bouncy entry once my rank is locked) ---
      if (myFinishLockedFrame >= 0 && idx >= myFinishLockedFrame && myRank > 0) {
        drawPersonalRankCard(ctx, dpr, W, H, myRank, totalPlayers, idx - myFinishLockedFrame, fps, now);
      }

      // pulse + shake decay (slower decay so the loser fanfare lingers)
      mainPane.pulse = Math.max(0, mainPane.pulse - dtSec * 1.2);
      insetPane.pulse = Math.max(0, insetPane.pulse - dtSec * 1.2);
      mainPane.shake = Math.max(0, mainPane.shake - dtSec * 3);
      insetPane.shake = Math.max(0, insetPane.shake - dtSec * 3);

      if (elapsed < durationMs + 1500) {
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [startAt, durationMs, replay, players, myPlayerToken]);

  return (
    <div ref={wrapperRef} className="absolute inset-0 bg-zinc-950">
      <canvas ref={canvasRef} />
    </div>
  );
}
