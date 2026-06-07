// 경량 고정 윈도우 레이트리밋 (인메모리, 단일 인스턴스 전제 — 방 저장소와 같은 가정).
// 공개 엔드포인트(POST /api/rooms) 남용/스팸 방지용. 키는 보통 클라이언트 IP.
// DB·외부 캐시 없이 프로세스 메모리 Map만 사용. 다중 인스턴스로 확장 시 교체 필요.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { ok: boolean; retryAfterSec: number };

/** key에 대해 windowMs 안에서 max회까지 허용. 초과 시 ok=false + 남은 대기(초). */
export function checkRateLimit(
  key: string,
  windowMs: number,
  max: number,
  now: number,
): RateLimitResult {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.count < max) {
    b.count += 1;
    return { ok: true, retryAfterSec: 0 };
  }
  return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

/** 만료된 버킷 청소(메모리 누수 방지). 주기 호출용. */
export function sweepRateLimit(now: number): void {
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}

// 안 돌아오는 IP의 만료 버킷이 쌓이지 않게 주기적으로 청소. unref로 이 타이머가
// 프로세스 종료를 막지 않게 함.
const SWEEP_MS = 5 * 60_000;
setInterval(() => sweepRateLimit(Date.now()), SWEEP_MS).unref?.();
