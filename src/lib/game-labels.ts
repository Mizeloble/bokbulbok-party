import { GAME_META, type GameId } from '@/games/types';
import { ko } from '@/lib/i18n';

// 게임 카드/칩의 한 줄 부제(소요시간 + 조작/성격). 로비 GamePicker와 랜딩 라인업이
// 같은 라벨을 쓰도록 한 곳에 모은다 — 분기 로직이 두 군데로 갈라지지 않게.
export function gameSubLabel(id: GameId): string {
  const m = GAME_META[id];
  const s = m.estimatedSeconds;
  if (id === 'trivia') return ko.games.triviaEstimate(s);
  if (id === 'nonsense') return ko.games.nonsenseEstimate(s);
  if (id === 'marble-tilt') return ko.games.tiltEstimate(s);
  if (m.needsClientInput) return ko.games.reactionEstimate(s);
  if (m.needsPreCharge) return ko.games.cheerEstimate(s);
  return ko.games.physicsEstimate(s);
}
