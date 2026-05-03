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
              'w-full relative rounded-2xl px-3 py-3.5 text-left border-[1.5px] transition-all',
              isSelected
                ? 'border-amber-600 bg-amber-600/10 text-amber-200'
                : 'border-zinc-700 bg-zinc-800 text-zinc-100',
            )}
          >
            <div className="text-2xl leading-none">{m.emoji}</div>
            <div className={clsx('font-bold mt-1.5 text-[15px]', isSelected && 'text-amber-200')}>
              {ko.games[id]}
            </div>
            <div className={clsx('text-xs mt-0.5', isSelected ? 'text-amber-200/80' : 'text-zinc-400')}>
              {id === 'trivia'
                ? ko.games.triviaEstimate(m.estimatedSeconds)
                : m.needsClientInput
                  ? ko.games.reactionEstimate(m.estimatedSeconds)
                  : m.needsPreCharge
                    ? ko.games.cheerEstimate(m.estimatedSeconds)
                    : ko.games.physicsEstimate(m.estimatedSeconds)}
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
