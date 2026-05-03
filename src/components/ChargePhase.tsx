'use client';

import { useEffect, useRef, useState } from 'react';
import { ko } from '@/lib/i18n';
import { GAME } from '@/lib/constants';
import { getSocket } from '@/lib/socket-client';
import { haptics } from '@/games/marble/haptics';
import { useRoomStore } from '@/store/room-store';

const TICK_THROTTLE_MS = 200;

/**
 * Pre-game tap-charging UI for games with `needsPreCharge` (marble-cheer).
 * Listens for `charge:start` (server-authoritative endsAt) and `charge:state`
 * (per-player totals) and sends `charge:tick` with the local cumulative count
 * (idempotent — server keeps the max). Renders a big tap target, a 5..0
 * countdown, and two gauges (mine + group average).
 */
export function ChargePhase() {
  const myToken = useRoomStore((s) => s.myToken);
  const players = useRoomStore((s) => s.state?.players ?? []);

  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [myCount, setMyCount] = useState(0);
  const [serverTotals, setServerTotals] = useState<Record<string, number>>({});
  const [cap, setCap] = useState<number>(GAME.CHARGE_TAP_CAP);
  const [pulseKey, setPulseKey] = useState(0);

  const myCountRef = useRef(0);
  const lastSentRef = useRef(0);
  const lastSentValRef = useRef(-1);

  // Listen for server charge events
  useEffect(() => {
    const socket = getSocket();
    const onStart = (p: { endsAt: number }) => {
      setEndsAt(p.endsAt);
      setMyCount(0);
      myCountRef.current = 0;
      lastSentRef.current = 0;
      lastSentValRef.current = -1;
      setServerTotals({});
    };
    const onState = (p: { totals: Record<string, number>; cap: number }) => {
      setServerTotals(p.totals);
      setCap(p.cap);
    };
    socket.on('charge:start', onStart);
    socket.on('charge:state', onState);
    return () => {
      socket.off('charge:start', onStart);
      socket.off('charge:state', onState);
    };
  }, []);

  // RAF loop for `now` (drives the countdown number)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function handleTap() {
    if (!endsAt || Date.now() > endsAt) return;
    if (myCountRef.current >= cap) return;
    const next = myCountRef.current + 1;
    myCountRef.current = next;
    setMyCount(next);
    setPulseKey((k) => k + 1);
    haptics.chargeTap();

    // Throttle outgoing ticks; cumulative value is idempotent so dropped intermediate
    // packets don't matter as long as the latest gets through.
    const t = Date.now();
    if (t - lastSentRef.current >= TICK_THROTTLE_MS && next !== lastSentValRef.current) {
      lastSentRef.current = t;
      lastSentValRef.current = next;
      getSocket().emit('charge:tick', { count: next });
    }
  }

  // Flush final count when the phase ends (so cap-hit or last few taps reach the server).
  useEffect(() => {
    if (!endsAt) return;
    const remain = endsAt - now;
    if (remain > 0) return;
    if (myCountRef.current !== lastSentValRef.current) {
      lastSentValRef.current = myCountRef.current;
      getSocket().emit('charge:tick', { count: myCountRef.current });
    }
  }, [endsAt, now]);

  if (!endsAt) {
    return (
      <main className="min-h-dvh flex items-center justify-center text-zinc-500 text-sm">
        …
      </main>
    );
  }

  const remain = Math.max(0, endsAt - now);
  const secondsLeft = Math.ceil(remain / 1000);
  const ended = remain <= 0;

  // My ratio (use local count for snappy gauge — server already has the cap)
  const myRatio = Math.min(1, myCount / cap);

  // Group average ratio from server totals (excluding manual / 0-touched, fall back to mine)
  const ratios = Object.values(serverTotals).map((c) => Math.min(1, c / cap));
  const avgRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : myRatio;

  const me = myToken ? players.find((p) => p.playerToken === myToken) : null;
  const myColor = me?.color ?? '#fbbf24';

  return (
    <main
      className="fixed inset-0 z-30 flex flex-col bg-zinc-950 select-none touch-none"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
    >
      {/* Header */}
      <div className="px-6 pt-6 text-center">
        <div className="text-xs uppercase tracking-[0.18em] text-amber-400 font-bold">
          {ko.charge.title}
        </div>
        <div className="mt-1 text-sm text-zinc-300">{ko.charge.subtitle}</div>
      </div>

      {/* Countdown */}
      <div className="mt-3 text-center">
        <div
          className="font-black text-amber-400 leading-none"
          style={{
            fontSize: 88,
            letterSpacing: '-0.06em',
            textShadow: '0 0 60px rgba(251,191,36,0.45)',
          }}
        >
          {ended ? 0 : secondsLeft}
        </div>
      </div>

      {/* Big tap zone */}
      <button
        type="button"
        onPointerDown={handleTap}
        disabled={ended}
        className="flex-1 mx-6 my-4 rounded-3xl flex flex-col items-center justify-center relative overflow-hidden disabled:opacity-50 active:scale-[0.99] transition-transform"
        style={{
          background: `radial-gradient(closest-side, ${myColor}33, ${myColor}11 70%, transparent 100%)`,
          border: `2px solid ${myColor}66`,
        }}
        aria-label={ko.charge.tapHint}
      >
        <span
          key={pulseKey}
          aria-hidden
          className="absolute inset-0 rounded-3xl pointer-events-none animate-[charge-pulse_180ms_ease-out]"
          style={{ background: `radial-gradient(closest-side, ${myColor}44, transparent 70%)` }}
        />
        <div className="text-7xl mb-2">📣</div>
        <div className="text-2xl font-black text-zinc-100">{ended ? ko.charge.starting : ko.charge.tapHint}</div>
        <div className="mt-2 text-3xl font-black tabular-nums" style={{ color: myColor }}>
          {myCount}
          <span className="text-zinc-500 text-base font-bold">/{cap}</span>
        </div>
      </button>

      {/* Gauges */}
      <div className="px-6 pb-4 space-y-3">
        <Gauge label={ko.charge.myGauge} ratio={myRatio} color={myColor} />
        <Gauge label={ko.charge.avgGauge} ratio={avgRatio} color="#a1a1aa" />
        <p className="text-xs text-zinc-600 text-center">{ko.charge.manualNote}</p>
      </div>

      <style jsx>{`
        @keyframes charge-pulse {
          0% { opacity: 0.9; transform: scale(0.98); }
          100% { opacity: 0; transform: scale(1.04); }
        }
      `}</style>
    </main>
  );
}

function Gauge({ label, ratio, color }: { label: string; ratio: number; color: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-500 mb-1">
        <span>{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full transition-[width] duration-150"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
