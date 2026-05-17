import { ko } from '@/lib/i18n';
import type { SimulationResult } from '../sim';
import type { Pane, PlayerInfo } from './types';
import { ellipsize, roundRect, roundRectPath } from './canvas-utils';

export function formatLoserLabel(): string {
  return ko.marble.loserExclamation;
}

export function drawLeaderboard(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  W: number,
  H: number,
  replay: SimulationResult,
  cur: number[],
  curFrame: number,
  playerByToken: Map<string, PlayerInfo>,
  myPlayerToken: string | null,
) {
  // Compose ranks: finished marbles by their finish frame ASC, then active by current y DESC
  type Row = { token: string; rank: number; finished: boolean };
  const rows: Row[] = [];
  const finishers: { token: string; finishFrame: number }[] = [];
  const active: { token: string; y: number }[] = [];
  for (let i = 0; i < replay.playerOrder.length; i++) {
    const f = replay.finishFrames[i];
    if (f >= 0 && f <= curFrame) {
      finishers.push({ token: replay.playerOrder[i], finishFrame: f });
    } else {
      active.push({ token: replay.playerOrder[i], y: cur[i * 2 + 1] });
    }
  }
  finishers.sort((a, b) => a.finishFrame - b.finishFrame);
  active.sort((a, b) => b.y - a.y);
  for (const f of finishers) rows.push({ token: f.token, rank: rows.length + 1, finished: true });
  for (const a of active) rows.push({ token: a.token, rank: rows.length + 1, finished: false });

  const rowH = 36 * dpr;
  const padding = 8 * dpr;
  const panelW = Math.min(170 * dpr, W * 0.4);
  const panelX = 8 * dpr;
  // Push below the top-left "내 공 시점" pane label so they don't overlap.
  const panelY = 56 * dpr;
  const panelH = padding * 2 + rowH * rows.length;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRectPath(ctx, panelX, panelY, panelW, panelH, 10 * dpr);
  ctx.fill();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const player = playerByToken.get(r.token);
    const ry = panelY + padding + i * rowH;
    const isMe = r.token === myPlayerToken;

    // Row background highlight for me
    if (isMe) {
      ctx.fillStyle = 'rgba(251,191,36,0.2)';
      ctx.fillRect(panelX + 2, ry + 1, panelW - 4, rowH - 2);
    }

    // Rank number
    ctx.font = `bold ${16 * dpr}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = r.rank === 1 ? '#fbbf24' : r.rank === 2 ? '#cbd5e1' : r.rank === 3 ? '#fb923c' : '#9ca3af';
    ctx.fillText(`${r.rank}`, panelX + 26 * dpr, ry + 24 * dpr);

    // Color dot
    ctx.fillStyle = player?.color ?? '#666';
    ctx.beginPath();
    ctx.arc(panelX + 40 * dpr, ry + rowH / 2, 7 * dpr, 0, Math.PI * 2);
    ctx.fill();

    // Nickname
    ctx.font = `${15 * dpr}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = isMe ? '#fbbf24' : r.finished ? 'rgba(255,255,255,0.55)' : '#ffffff';
    const nameMaxW = panelW - 68 * dpr - (r.finished ? 18 * dpr : 0);
    const name = ellipsize(ctx, player?.nickname ?? '', nameMaxW);
    ctx.fillText(name, panelX + 54 * dpr, ry + 24 * dpr);

    // Finished check mark
    if (r.finished) {
      ctx.font = `${14 * dpr}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#10b981';
      ctx.fillText('✓', panelX + panelW - 8 * dpr, ry + 24 * dpr);
    }
  }
}

export function drawPersonalRankCard(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  W: number,
  H: number,
  rank: number,
  total: number,
  framesSinceLocked: number,
  fps: number,
  nowMs: number,
) {
  // Animation: ease-out-back over 0.45s gives the bouncy "pop" entry. After that,
  // a tiny shimmer pulse keeps the card alive instead of going static.
  const animT = Math.min(1, Math.max(0, framesSinceLocked / Math.max(1, fps * 0.45)));
  if (animT <= 0) return;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const easedT = 1 + c3 * Math.pow(animT - 1, 3) + c1 * Math.pow(animT - 1, 2);
  const breathe = 1 + 0.025 * Math.sin(nowMs * 0.005);
  const scale = easedT * breathe;
  const alpha = Math.min(1, animT * 1.6);

  const isFirst = rank === 1;
  const isLast = rank === total;
  const isMid = !isFirst && !isLast;

  // Tier styling — flat solid color per tier (gradients removed).
  // Gold for 1st, red for loser (with pulsing halo), dark slate for the middle.
  let bgColor: string, borderColor: string, headlineColor: string, subColor: string, glowColor: string;
  if (isFirst) {
    bgColor = '#fbab03';
    borderColor = '#78350f';
    headlineColor = '#451a03';
    subColor = 'rgba(69,26,3,0.75)';
    glowColor = 'rgba(251,191,36,0.85)';
  } else if (isLast) {
    bgColor = '#f53d3d';
    borderColor = '#fff';
    headlineColor = '#fff';
    subColor = 'rgba(255,255,255,0.85)';
    glowColor = 'rgba(245,61,61,0.95)';
  } else {
    bgColor = '#1d2a3d';
    borderColor = '#fbbf24';
    headlineColor = '#fbbf24';
    subColor = 'rgba(255,255,255,0.75)';
    glowColor = 'rgba(251,191,36,0.55)';
  }

  const headline = isFirst ? ko.game.myRankFirst : isLast ? ko.game.myRankLast : ko.game.myRankMid(rank);
  const subtitle = isFirst
    ? ko.game.myRankSubFirst
    : isLast
      ? ko.game.myRankSubLast
      : ko.game.myRankSubMid(total);

  const cardW = 360 * dpr;
  const cardH = 140 * dpr;
  const cx = W / 2;
  const cy = H * 0.24;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  // Outer glow: stronger pulse for the loser
  const glowPulse = isLast ? 22 + 14 * Math.abs(Math.sin(nowMs * 0.008)) : 18;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = glowPulse * dpr;

  // Flat surface (gradient removed)
  ctx.fillStyle = bgColor;
  roundRect(ctx, cx - cardW / 2, cy - cardH / 2, cardW, cardH, 18 * dpr);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Border
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3 * dpr;
  roundRectPath(ctx, cx - cardW / 2, cy - cardH / 2, cardW, cardH, 18 * dpr);
  ctx.stroke();

  // Headline
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = headlineColor;
  ctx.font = `bold ${isMid ? 38 : 34}px sans-serif`;
  // Re-set with dpr-correct size
  ctx.font = `bold ${(isMid ? 38 : 34) * dpr}px sans-serif`;
  ctx.fillText(headline, cx, cy - 14 * dpr);

  // Subtitle
  ctx.font = `${15 * dpr}px sans-serif`;
  ctx.fillStyle = subColor;
  ctx.fillText(subtitle, cx, cy + 28 * dpr);

  ctx.restore();
}

export function drawLoserBanner(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  W: number,
  H: number,
  loserNick: string,
  loserColor: string,
  framesSinceDecided: number,
  fps: number,
  nowMs: number,
) {
  // Swoop down from above with a bouncy ease, then breathe with a soft pulse.
  const animT = Math.min(1, Math.max(0, framesSinceDecided / Math.max(1, fps * 0.55)));
  if (animT <= 0) return;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const eased = 1 + c3 * Math.pow(animT - 1, 3) + c1 * Math.pow(animT - 1, 2);
  const slideY = (1 - eased) * -140 * dpr;
  const alpha = Math.min(1, animT * 2);
  const breathe = 1 + 0.025 * Math.sin(nowMs * 0.005);

  // Width = measure nickname + penalty icon + comfortable padding, capped to viewport.
  const cx = W / 2;
  const cy = H * 0.6 + slideY;
  const bannerH = 138 * dpr;
  const cornerR = 20 * dpr;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(breathe, breathe);
  ctx.translate(-cx, -cy);

  // Compute width based on text content
  ctx.font = `bold ${44 * dpr}px sans-serif`;
  const nickW = ctx.measureText(`🎯 ${loserNick}`).width;
  const bannerW = Math.min(W * 0.92, Math.max(360 * dpr, nickW + 96 * dpr));
  const left = cx - bannerW / 2;
  const top = cy - bannerH / 2;

  // Strong pulsing red glow — this is the climactic loser reveal
  const glowAmt = 28 + 18 * Math.abs(Math.sin(nowMs * 0.008));
  ctx.shadowColor = 'rgba(245,61,61,0.95)';
  ctx.shadowBlur = glowAmt * dpr;

  // Flat red surface (gradient removed) — matches the loser rank card
  ctx.fillStyle = '#f53d3d';
  roundRect(ctx, left, top, bannerW, bannerH, cornerR);
  ctx.fill();
  ctx.shadowBlur = 0;

  // White outer border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3 * dpr;
  roundRectPath(ctx, left, top, bannerW, bannerH, cornerR);
  ctx.stroke();

  // Top "꼴찌 결정!" badge — uses the loser's marble color so they're visually tagged
  const badgeText = ko.game.loserRevealedBadge;
  ctx.font = `bold ${13 * dpr}px sans-serif`;
  const badgeTextW = ctx.measureText(badgeText).width;
  const badgePadX = 12 * dpr;
  const badgeW = badgeTextW + badgePadX * 2;
  const badgeH = 24 * dpr;
  const badgeX = cx - badgeW / 2;
  const badgeY = top - badgeH / 2 + 4 * dpr;
  ctx.fillStyle = loserColor;
  ctx.shadowColor = loserColor;
  ctx.shadowBlur = 12 * dpr;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5 * dpr;
  roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.stroke();
  ctx.fillStyle = '#0b0b10';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, cx, badgeY + badgeH / 2 + 1 * dpr);

  // Main line: 🎯 + nickname, big & bold with dark outline for punch
  ctx.font = `bold ${44 * dpr}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5 * dpr;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.strokeText(`🎯 ${loserNick}`, cx, cy - 4 * dpr);
  ctx.fillStyle = '#fff';
  ctx.fillText(`🎯 ${loserNick}`, cx, cy - 4 * dpr);

  // Subtitle
  ctx.font = `${16 * dpr}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(ko.game.loserRevealedSub, cx, cy + 38 * dpr);

  ctx.restore();
}

export function drawPaneFrame(ctx: CanvasRenderingContext2D, pane: Pane, dpr: number, isMain: boolean) {
  const { px, py, pw, ph, label, pulse, alpha } = pane;
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  // Border
  if (!isMain) {
    ctx.strokeStyle = pulse > 0.05 ? '#fbbf24' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = (pulse > 0.05 ? 3 : 1.5) * dpr;
    roundRectPath(ctx, px, py, pw, ph, 10 * dpr);
    ctx.stroke();
  }
  // Label badge top-left of pane
  if (label) {
    ctx.font = `bold ${11 * dpr}px sans-serif`;
    ctx.textAlign = 'left';
    const padding = 8 * dpr;
    const textW = ctx.measureText(label).width;
    const badgeW = textW + padding * 2;
    const badgeH = 22 * dpr;
    const bx = px + 8 * dpr;
    const by = py + 8 * dpr;
    ctx.fillStyle = pulse > 0.05 ? 'rgba(251,191,36,0.95)' : 'rgba(0,0,0,0.65)';
    roundRect(ctx, bx, by, badgeW, badgeH, 6 * dpr);
    ctx.fill();
    ctx.fillStyle = pulse > 0.05 ? '#0b0b10' : '#ffffff';
    ctx.fillText(label, bx + padding, by + badgeH * 0.7);
  }
  ctx.restore();
}
