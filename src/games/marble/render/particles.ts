import type { Particle, Pane } from './types';
import { VIEW_HEIGHT_METERS, ZOOM_MAX } from './constants';

export function spawnFinishBurst(pool: Particle[], x: number, y: number, color: string, intensity: number) {
  const palette = [color, '#fbbf24', '#ffffff', '#f472b6', '#a3e635', '#22d3ee', '#fb923c'];
  // Confetti — much denser than the v1 fanfare (was 80) so the 꼴찌 reveal feels physical.
  const confettiCount = Math.floor(180 * intensity);
  for (let i = 0; i < confettiCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 5 + Math.random() * 14;
    const life = 1.4 + Math.random() * 1.4;
    pool.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 4,
      life,
      totalLife: life,
      color: palette[Math.floor(Math.random() * palette.length)],
      size: 0.18 + Math.random() * 0.30,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 14,
    });
  }
  // Emoji rain — coffee, money flying, laughing emojis. Sparse but big.
  const emojis = ['☕', '💸', '😂', '🎉', '✨', '☕', '☕'];
  const emojiCount = Math.floor(28 * intensity);
  for (let i = 0; i < emojiCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 8;
    const life = 1.8 + Math.random() * 1.6;
    pool.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 5,
      life,
      totalLife: life,
      color: '#ffffff',
      size: 0.55 + Math.random() * 0.45,
      rot: 0,
      vrot: (Math.random() - 0.5) * 4,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
    });
  }
}

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  pane: Pane,
  dtSec: number,
  dpr: number,
  camY: number,
  zoom: number,
  bounds: { minX: number; maxX: number },
  zoomCenterX: number,
) {
  const { px, py, pw, ph, particles, bursts } = pane;
  // Mirror drawScene's horizontal margin so particles use the same world→pixel mapping.
  const horizontalMargin = 12 * dpr;
  const fitWidth = Math.max(1, pw - horizontalMargin * 2);
  const trackXSpan = Math.max(bounds.maxX - bounds.minX, 16);
  const baseScale = Math.min(fitWidth / trackXSpan, ph / VIEW_HEIGHT_METERS);
  const scale = baseScale * zoom;
  const trackCenterX = (bounds.minX + bounds.maxX) / 2;
  // Match drawScene's zoom-aware horizontal centering so particles stay locked to the scene.
  const zoomFrac = Math.max(0, Math.min(1, (zoom - 1) / Math.max(1e-6, ZOOM_MAX - 1)));
  const camX = trackCenterX + (zoomCenterX - trackCenterX) * zoomFrac;
  const offsetX = px + pw / 2 - camX * scale;
  const offsetY = py + ph * 0.55 - camY * scale;
  const toPx = (wx: number, wy: number) => [wx * scale + offsetX, wy * scale + offsetY] as const;

  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();

  // --- Bursts: flash + expanding ring + rank badge floating up ---
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.age += dtSec;
    const t = b.age;
    if (t > 1.6) {
      bursts.splice(i, 1);
      continue;
    }
    const [bxp, byp] = toPx(b.x, b.y);
    if (bxp < px - 200 || bxp > px + pw + 200 || byp < py - 200 || byp > py + ph + 200) continue;
    // Flash (very brief)
    if (t < 0.18) {
      const flashAlpha = (1 - t / 0.18) * 0.7;
      const grad = ctx.createRadialGradient(bxp, byp, 0, bxp, byp, scale * 6);
      grad.addColorStop(0, `rgba(255,255,255,${flashAlpha})`);
      grad.addColorStop(0.6, `rgba(255,255,200,${flashAlpha * 0.3})`);
      grad.addColorStop(1, 'rgba(255,255,200,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(px, py, pw, ph);
    }
    // Expanding ring (sonar) — clamp ringT to [0,1] in case t briefly goes negative due to timer skew.
    const ringT = Math.max(0, Math.min(1, t / 0.7));
    const ringR = ringT * scale * 5;
    const ringAlpha = (1 - ringT) * 0.9;
    ctx.strokeStyle = `rgba(255,255,255,${ringAlpha})`;
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.arc(bxp, byp, ringR, 0, Math.PI * 2);
    ctx.stroke();
    // Inner colored ring
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = ringAlpha;
    ctx.lineWidth = 5 * dpr;
    ctx.beginPath();
    ctx.arc(bxp, byp, ringR * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Sun rays (for top ranks only — implied by big burst)
    // Rank badge floats up
    const badgeY = byp - scale * 1.5 - t * 60 * dpr;
    const badgeAlpha = Math.max(0, 1 - Math.max(0, t - 0.3) / 1.3);
    ctx.globalAlpha = badgeAlpha;
    ctx.font = `bold ${22 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = '#0b0b10';
    ctx.strokeText(b.rankLabel, bxp, badgeY);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(b.rankLabel, bxp, badgeY);
    ctx.globalAlpha = 1;
  }

  // --- Confetti particles ---
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dtSec;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += 12 * dtSec; // gravity m/s²
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.rot += p.vrot * dtSec;
    const [sxp, syp] = toPx(p.x, p.y);
    if (syp < py - 30 || syp > py + ph + 30) continue;
    const alpha = Math.max(0, p.life / p.totalLife);
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(sxp, syp);
    ctx.rotate(p.rot);
    if (p.emoji) {
      // Emoji particle: render as text. Size ~doubled vs confetti for readability.
      const fontPx = Math.max(18 * dpr, p.size * scale * 1.6);
      ctx.font = `${fontPx}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji, 0, 0);
    } else {
      ctx.fillStyle = p.color;
      const sz = Math.max(3 * dpr, p.size * scale);
      ctx.fillRect(-sz / 2, -sz / 4, sz, sz / 2);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
