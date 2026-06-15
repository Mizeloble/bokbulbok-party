import type { ReplayPayload } from '../../server/rooms';
import type { ComputeResultInput, GameServerModule } from '../types';
import { computeQuizResult } from '../trivia/server';
import { NONSENSE_POOL_SORTED } from './questions';

// 넌센스 퀴즈는 trivia와 동일한 4지선다 퀴즈 엔진을 쓴다. 차이는 문제 풀뿐이라
// trivia/server.ts의 순수 함수(computeQuizResult)에 넌센스 풀만 넘겨 재사용한다.
// (marble-cheer가 marble의 sim/Renderer를 재사용하는 패턴과 동일)
//
// 클라 재생도 trivia의 Renderer를 그대로 쓴다(replay 모양이 동일). 소켓 진행 플로우는
// src/server/rounds/quiz.ts의 공용 퀴즈 러너(runQuizRound)가 gameId로 풀을 골라 처리한다.
export const nonsenseServer: GameServerModule = {
  computeResult(input: ComputeResultInput): ReplayPayload {
    return computeQuizResult(input, NONSENSE_POOL_SORTED);
  },
};
