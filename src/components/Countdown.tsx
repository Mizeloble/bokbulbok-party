'use client';

import { useEffect, useRef, useState } from 'react';
import { ko } from '@/lib/i18n';
import { haptics } from '@/games/marble/haptics';
import { UI } from '@/lib/constants';

const { FLASH_MS, SPRING_MS } = UI;

export function Countdown({ startAt }: { startAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  const lastTickRef = useRef<number | null>(null);
  const goFiredRef = useRef(false);
  // Wall-clock when the current displayed integer first appeared (for spring)
  const tickEnteredAtRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [startAt]);

  useEffect(() => {
    lastTickRef.current = null;
    goFiredRef.current = false;
    tickEnteredAtRef.current = null;
  }, [startAt]);

  // Fire haptic on each whole-second transition during countdown, and once at GO.
  useEffect(() => {
    const diff = startAt - now;
    if (diff > 0) {
      const sec = Math.ceil(diff / 1000);
      if (lastTickRef.current !== sec) {
        lastTickRef.current = sec;
        tickEnteredAtRef.current = now;
        haptics.countdownTick();
      }
    } else if (!goFiredRef.current) {
      goFiredRef.current = true;
      tickEnteredAtRef.current = now;
      haptics.countdownGo();
    }
  }, [now, startAt]);

  const diff = startAt - now;

  if (diff > 0) {
    const sec = Math.ceil(diff / 1000);
    const enteredAt = tickEnteredAtRef.current ?? now;
    // Spring: 1.3 → 1.0 over SPRING_MS, ease-out.
    const t = Math.min(1, (now - enteredAt) / SPRING_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = 1.3 - 0.3 * eased;
    // Halo radius shrinks with the number, opacity fades.
    const haloR = 320 - 140 * eased;
    const haloAlpha = 0.45 - 0.2 * eased;
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 pointer-events-none overflow-hidden">
        {/* halo */}
        <div
          className="absolute rounded-full"
          style={{
            width: haloR,
            height: haloR,
            background: `radial-gradient(closest-side, rgba(251,191,36,${haloAlpha}), rgba(251,191,36,0) 70%)`,
          }}
        />
        {/* motion rings — first 60% of the spring */}
        {t < 0.6 && [0, 1, 2].map((i) => {
          const ringT = Math.min(1, t / 0.6);
          const ringSize = 200 + i * 80 + ringT * 80;
          const ringAlpha = (0.25 - i * 0.07) * (1 - ringT);
          return (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: ringSize,
                height: ringSize,
                border: `1.5px solid rgba(251,191,36,${ringAlpha})`,
              }}
            />
          );
        })}
        <div
          className="font-black text-amber-400"
          style={{
            fontSize: 168,
            lineHeight: 1,
            letterSpacing: '-0.06em',
            textShadow: '0 0 80px rgba(251,191,36,0.6)',
            transform: `scale(${scale})`,
            transition: 'none',
          }}
        >
          {sec}
        </div>
        <div className="absolute bottom-20 left-0 right-0 text-center text-xs text-zinc-500 uppercase tracking-[0.18em]">
          {ko.game.countdownPreSub}
        </div>
      </div>
    );
  }

  if (-diff < FLASH_MS) {
    const enteredAt = tickEnteredAtRef.current ?? now;
    const t = Math.min(1, (now - enteredAt) / SPRING_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = 1.45 - 0.3 * eased;
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 pointer-events-none overflow-hidden">
        <div
          className="absolute rounded-full"
          style={{
            width: 280,
            height: 280,
            background: 'radial-gradient(closest-side, rgba(251,191,36,0.45), rgba(251,191,36,0) 70%)',
          }}
        />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: 200 + i * 80,
              height: 200 + i * 80,
              border: `1.5px solid rgba(251,191,36,${0.25 - i * 0.07})`,
            }}
          />
        ))}
        <div
          className="font-black text-amber-400"
          style={{
            fontSize: 110,
            lineHeight: 1,
            letterSpacing: '-0.04em',
            textShadow: '0 0 80px rgba(251,191,36,0.6)',
            transform: `scale(${scale})`,
          }}
        >
          {ko.game.countdown}
        </div>
        <div className="absolute bottom-20 left-0 right-0 text-center text-xs text-zinc-500 uppercase tracking-[0.18em]">
          {ko.game.countdownGoSub}
        </div>
      </div>
    );
  }

  return null;
}
