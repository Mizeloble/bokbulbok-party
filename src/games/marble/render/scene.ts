import type { SimulationResult } from '../sim';
import type { Pane, PlayerInfo } from './types';
import { MARBLE_RADIUS, VIEW_HEIGHT_METERS, ZOOM_MAX } from './constants';
import { lerp, lowerBound, roundRect, upperBound } from './canvas-utils';

/**
 * Draw one pane (track + entities + marbles + my-marble effects). Stateless except
 * for incidental writes to the passed canvas context — pulse/shake decay and the
 * pane.label remain the caller's responsibility.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  pane: Pane,
  camY: number,
  zoom: number,
  dpr: number,
  replay: SimulationResult,
  cur: number[],
  next: number[],
  tFrac: number,
  elapsedSec: number,
  playerByToken: Map<string, PlayerInfo>,
  myPlayerToken: string | null,
  polylineEntities: SimulationResult['entities'],
  sortedEntities: SimulationResult['entities'],
  sortedYs: number[],
  labelWidths: Map<string, number>,
  frameIdx: number,
  zoomCenterX: number,
) {
  const { px, py, pw, ph } = pane;
  // Coordinate system: fit width with zoom. Shrink the available width by a small
  // horizontal margin so the outermost track walls aren't drawn flush with the canvas
  // edge — half their stroke would otherwise fall outside the canvas, making the
  // outer perimeter appear to flicker/disappear as the wall zigzags inward and back.
  const horizontalMargin = 12 * dpr;
  const fitWidth = Math.max(1, pw - horizontalMargin * 2);
  const trackXSpan = Math.max(replay.bounds.maxX - replay.bounds.minX, 16);
  const baseScale = Math.min(fitWidth / trackXSpan, ph / VIEW_HEIGHT_METERS);
  const scale = baseScale * zoom;
  const trackCenterX = (replay.bounds.minX + replay.bounds.maxX) / 2;
  // The goal funnel often sits off-center relative to the bounds box (e.g. lazygyu's
  // "Wheel of fortune" funnels to x≈15.55 while bounds center is x≈12.6). Without this
  // shift, the final zoom-in puts the goal noticeably right of screen center.
  const zoomFrac = Math.max(0, Math.min(1, (zoom - 1) / Math.max(1e-6, ZOOM_MAX - 1)));
  const camX = trackCenterX + (zoomCenterX - trackCenterX) * zoomFrac;
  const offsetX = px + pw / 2 - camX * scale;
  const offsetY = py + ph * 0.55 - camY * scale; // camera centered at 55% from top

  const toPx = (wx: number, wy: number) => [wx * scale + offsetX, wy * scale + offsetY] as const;

  // Set clip to pane to keep drawing inside
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();

  // Polylines: long static walls; iterate all (only ~22).
  ctx.strokeStyle = '#e4e4e7';
  ctx.lineWidth = Math.max(2, scale * 0.12);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const cullPad = 50;
  const offScreen = (sxp: number, syp: number) =>
    syp < py - cullPad || syp > py + ph + cullPad || sxp < px - cullPad || sxp > px + pw + cullPad;
  // Cohen–Sutherland outcode: a segment is definitely outside the viewport iff both
  // endpoints share an outside half-plane (outcode AND ≠ 0). Point-based culling is
  // not enough — a long wall segment (e.g. spawn walls spanning y −300→30) crosses
  // the zoomed-in viewport with both endpoints off-screen and would vanish entirely.
  const outcode = (sxp: number, syp: number) =>
    (sxp < px - cullPad ? 1 : 0) |
    (sxp > px + pw + cullPad ? 2 : 0) |
    (syp < py - cullPad ? 4 : 0) |
    (syp > py + ph + cullPad ? 8 : 0);
  for (const e of polylineEntities) {
    if (e.shape.type !== 'polyline') continue;
    const ex = e.x;
    const ey = e.y;
    const points = e.shape.points;
    ctx.beginPath();
    let started = false;
    let prevSx = 0;
    let prevSy = 0;
    let prevOc = 0;
    for (let i = 0; i < points.length; i++) {
      const [px2, py2] = points[i];
      const sxp = (ex + px2) * scale + offsetX;
      const syp = (ey + py2) * scale + offsetY;
      const oc = outcode(sxp, syp);
      if (i > 0) {
        if ((oc & prevOc) !== 0) {
          // Segment fully outside one edge — break the path here.
          if (started) {
            ctx.stroke();
            ctx.beginPath();
            started = false;
          }
        } else {
          if (!started) {
            ctx.moveTo(prevSx, prevSy);
            started = true;
          }
          ctx.lineTo(sxp, syp);
        }
      }
      prevSx = sxp;
      prevSy = syp;
      prevOc = oc;
    }
    if (started) ctx.stroke();
  }

  // Boxes + circles: binary-search the visible Y window so we skip ~80% of pegs every frame.
  // Margin of 50px in pixel space converts to a small Y margin in world space.
  const halfWorldH = ph / scale / 2 + 50 / scale;
  const yMin = camY - halfWorldH;
  const yMax = camY + halfWorldH;
  const startIdx = lowerBound(sortedYs, yMin);
  const endIdx = upperBound(sortedYs, yMax);

  // Cache linear gradients for box pegs by pixel width — there are only ~6 unique widths,
  // so we go from 172 createLinearGradient calls per frame down to ~6.
  const boxGradCache = new Map<number, CanvasGradient>();
  for (let k = startIdx; k < endIdx; k++) {
    const e = sortedEntities[k];
    const ex = e.x;
    const ey = e.y;
    if (e.shape.type === 'box') {
      const angle = e.angularVelocity * elapsedSec + e.shape.rotation;
      const sxp = ex * scale + offsetX;
      const syp = ey * scale + offsetY;
      const w = e.shape.width * scale * 2;
      const h = e.shape.height * scale * 2;
      let grad = boxGradCache.get(w);
      if (!grad) {
        grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        grad.addColorStop(0, '#0ea5b8');
        grad.addColorStop(0.5, '#22d3ee');
        grad.addColorStop(1, '#0ea5b8');
        boxGradCache.set(w, grad);
      }
      ctx.save();
      ctx.translate(sxp, syp);
      ctx.rotate(angle);
      ctx.fillStyle = grad;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    } else if (e.shape.type === 'circle') {
      const sxp = ex * scale + offsetX;
      const syp = ey * scale + offsetY;
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(sxp, syp, e.shape.radius * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Goal line
  const [, goalPy] = toPx(0, replay.goalY);
  if (goalPy >= py - 10 && goalPy <= py + ph + 10) {
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(px, goalPy - 2 * dpr, pw, 4 * dpr);
    ctx.font = `bold ${12 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('FINISH', px + pw / 2, goalPy - 8 * dpr);
  }

  // Marbles
  const baseR = MARBLE_RADIUS * scale;
  ctx.font = `bold ${14 * dpr}px sans-serif`;
  ctx.textAlign = 'center';
  // Pulse phase shared across the frame's my-marble effects.
  const pulseT = (Math.sin(elapsedSec * 5) + 1) / 2; // 0..1
  for (let i = 0; i < replay.playerOrder.length; i++) {
    const token = replay.playerOrder[i];
    const player = playerByToken.get(token);
    const xA = cur[i * 2];
    const yA = cur[i * 2 + 1];
    const xB = next[i * 2];
    const yB = next[i * 2 + 1];
    const x = lerp(xA, xB, tFrac);
    const y = lerp(yA, yB, tFrac);
    const sxp = x * scale + offsetX;
    const syp = y * scale + offsetY;
    const isMe = token === myPlayerToken;
    // Cheered marbles look smaller too (matches the -18% physics radius), so the
    // "small + glowing + ahead" silhouette reads instantly. ratio is 0 for plain `marble`.
    const ratio = replay.chargeRatios?.[i] ?? 0;
    const r = baseR * (1 - 0.18 * ratio);
    const offTop = syp < py - 30;
    const offBottom = syp > py + ph + 30;
    if (offTop || offBottom) {
      // Off-screen marbles are skipped entirely except for "my marble" — give the user
      // a chevron pinned to the closer pane edge so they always know which direction
      // their marble is.
      if (isMe) {
        const arrowX = Math.max(px + 18 * dpr, Math.min(px + pw - 18 * dpr, sxp));
        const arrowY = offTop ? py + 22 * dpr : py + ph - 22 * dpr;
        ctx.save();
        ctx.translate(arrowX, arrowY);
        if (offBottom) ctx.rotate(Math.PI);
        ctx.fillStyle = '#fbbf24';
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(0, -10 * dpr);
        ctx.lineTo(9 * dpr, 7 * dpr);
        ctx.lineTo(-9 * dpr, 7 * dpr);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      continue;
    }

    // Trail (my marble only) — sparse fading dots from prior integer frames.
    if (isMe) {
      for (let k = 1; k <= 6; k++) {
        const fIdx = frameIdx - k * 3;
        if (fIdx < 0) break;
        const trailFrame = replay.frames[fIdx];
        if (!trailFrame) break;
        const tx = trailFrame[i * 2];
        const ty = trailFrame[i * 2 + 1];
        const txp = tx * scale + offsetX;
        const typ = ty * scale + offsetY;
        if (offScreen(txp, typ)) continue;
        const a = 0.28 * (1 - k / 7);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.arc(txp, typ, r * (1 - k * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(sxp + 1.5 * dpr, syp + 2 * dpr, r, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.fillStyle = player?.color ?? '#aaa';
    ctx.beginPath();
    ctx.arc(sxp, syp, r, 0, Math.PI * 2);
    ctx.fill();

    if (isMe) {
      // Pulsing halo — far more visible than the previous static 2px ring.
      const haloR = r + (4 + pulseT * 2) * dpr;
      const haloAlpha = 0.45 + 0.4 * pulseT;
      ctx.strokeStyle = `rgba(255,255,255,${haloAlpha})`;
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.arc(sxp, syp, haloR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // label above marble — width pre-measured at mount, no per-frame measureText
    const label = player?.nickname ?? '';
    const labelW = (labelWidths.get(token) ?? 0) + 10 * dpr;
    const labelH = 19 * dpr;
    const labelY = syp - r - labelH - 3 * dpr;
    ctx.fillStyle = isMe ? '#fbbf24' : 'rgba(0,0,0,0.7)';
    roundRect(ctx, sxp - labelW / 2, labelY, labelW, labelH, 5 * dpr);
    ctx.fill();
    ctx.fillStyle = isMe ? '#0b0b10' : '#ffffff';
    ctx.fillText(label, sxp, labelY + 14 * dpr);
  }

  ctx.restore();
}
