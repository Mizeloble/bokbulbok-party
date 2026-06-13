import { useEffect, type RefObject } from 'react';

/**
 * Result-screen confetti. Self-contained canvas animation: spawns a celebratory
 * burst on mount and re-bursts every 1.8s, with gravity + rotation physics drawn
 * at requestAnimationFrame rate. No dependency on round data — purely decorative —
 * so it lives apart from ResultScreen's result-rendering logic.
 *
 * The canvas element (sizing/positioning classes) stays in the caller's JSX; this
 * hook only drives the pixels. Cleans up its RAF, interval, and resize listener.
 */
export function useConfetti(canvasRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function size() {
      if (!canvas) return;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    }
    size();
    window.addEventListener('resize', size);

    type P = { x: number; y: number; vx: number; vy: number; size: number; color: string; rot: number; vrot: number };
    const palette = ['#fbbf24', '#ef4444', '#22c55e', '#3b82f6', '#ec4899', '#a855f7', '#06b6d4'];
    const particles: P[] = [];
    function spawnBurst() {
      if (!canvas) return;
      const cx = canvas.width / 2;
      for (let i = 0; i < 80; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 8;
        particles.push({
          x: cx,
          y: canvas.height * 0.2,
          vx: Math.cos(a) * speed * 30,
          vy: Math.sin(a) * speed * 30 - 100,
          size: (4 + Math.random() * 5) * dpr,
          color: palette[Math.floor(Math.random() * palette.length)],
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 8,
        });
      }
    }
    spawnBurst();
    const burstId = setInterval(spawnBurst, 1800);

    let raf = 0;
    let lastT = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += 600 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        if (p.y > canvas.height + 40) {
          particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(burstId);
      window.removeEventListener('resize', size);
    };
  }, [canvasRef]);
}
