'use client';

import { GAME_META, type GameId } from '@/games/types';
import clsx from 'clsx';
import { ko } from '@/lib/i18n';

export function GamePicker({
  selected,
  onSelect,
  disabled,
}: {
  selected: GameId;
  onSelect: (id: GameId) => void;
  disabled?: boolean;
}) {
  const ids = Object.keys(GAME_META) as GameId[];
  const enabledIds = ids.filter((id) => GAME_META[id].enabled);
  const disabledIds = ids.filter((id) => !GAME_META[id].enabled);

  return (
    <div className="space-y-2">
      {enabledIds.map((id) => {
        const m = GAME_META[id];
        const isSelected = selected === id;
        const tappable = !disabled;
        return (
          <button
            key={id}
            type="button"
            disabled={!tappable}
            onClick={() => tappable && onSelect(id)}
            className={clsx(
              'w-full relative rounded-2xl px-3 py-3 text-left border-[1.5px] transition-all',
              isSelected
                ? 'border-amber-500/70 bg-amber-500/10 text-amber-200 shadow-[0_0_0_1px_rgba(251,191,36,0.15),0_8px_24px_-12px_rgba(251,191,36,0.5)]'
                : 'border-white/10 bg-white/[0.04] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
            )}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5">{m.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={clsx('font-bold text-[15px]', isSelected && 'text-amber-200')}>
                    {ko.games[id]}
                  </span>
                  <span
                    className={clsx(
                      'shrink-0 text-[11px] tabular-nums',
                      isSelected ? 'text-amber-200/70' : 'text-zinc-500',
                    )}
                  >
                    {ko.games.secEstimate(m.estimatedSeconds)}
                  </span>
                </div>
                <p
                  className={clsx(
                    'mt-0.5 text-xs leading-snug',
                    isSelected ? 'text-amber-200/80' : 'text-zinc-400',
                  )}
                >
                  {ko.gameDesc[id]}
                </p>
              </div>
            </div>
          </button>
        );
      })}

      {disabledIds.length > 0 && (
        <div className="rounded-xl px-3 py-2.5 border border-dashed border-zinc-700 flex items-center gap-2.5 text-xs text-zinc-500">
          <span className="text-sm whitespace-nowrap">
            {disabledIds.map((id) => GAME_META[id].emoji).join(' ')}
          </span>
          <span>{ko.lobby.moreGamesComingSoon}</span>
        </div>
      )}
    </div>
  );
}
