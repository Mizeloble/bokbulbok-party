'use client';

import { ko } from '@/lib/i18n';
import { GAME_META, type GameId } from '@/games/types';

/**
 * Compact rules panel shown in the lobby for the currently selected game. Visible
 * to both host and guest so everyone knows what's about to happen — especially
 * useful for `marble-cheer` where the pre-charge phase changes how players engage
 * with the start of the round.
 */
export function GameIntro({ gameId }: { gameId: GameId }) {
  const lines = ko.gameIntros[gameId];
  const meta = GAME_META[gameId];

  return (
    <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 px-4 py-3.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base leading-none">{meta.emoji}</span>
        <span className="text-[12px] font-bold text-zinc-100">{ko.games[gameId]}</span>
        {meta.needsPreCharge && (
          <span className="ml-1 rounded-md bg-amber-400/15 text-amber-300 px-1.5 py-0.5 text-[11px] font-bold">
            응원 충전
          </span>
        )}
      </div>
      <ul className="space-y-1.5 text-[12px] text-zinc-400 leading-relaxed">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="text-amber-400/70 select-none">·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
