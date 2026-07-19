// 트래픽 카운터 — DB 없음 원칙과 로그 보관 한계(fly logs는 최근 ~100줄)를 함께
// 푸는 장치. 프로세스 메모리에 카운터만 누적하고 /metrics(Prometheus 텍스트
// 포맷)로 노출하면, fly.toml [metrics] 설정으로 Fly가 주기 스크레이프해 관리형
// Prometheus에 수개월 보관한다. 영속 저장이 아니라 재시작 시 0부터 시작하는 게
// 정상이고(suspend 재개 시엔 유지됨), 리셋은 PromQL increase()가 흡수한다.
// 월간 집계 쿼리는 docs/launch-checklist.md §E 참고.
//
// 라벨 카디널리티 주의: 라벨 값은 게임 id처럼 유한 집합만. roomId처럼 무한한
// 값을 라벨로 넣으면 Prometheus 시계열이 폭발한다.

// rooms.ts의 rooms Map과 같은 이유로 globalThis에 핀: Next 라우트 번들(.next)과
// 서버 번들(dist)이 이 모듈의 사본을 각각 들고 있어, 평범한 모듈 상수면
// API 라우트의 증가분과 /metrics가 읽는 저장소가 갈라진다.
const METRICS_KEY = '__bokbulbokMetrics';
type GlobalWithMetrics = typeof globalThis & { [METRICS_KEY]?: Map<string, number> };
const g = globalThis as GlobalWithMetrics;
const counters: Map<string, number> = g[METRICS_KEY] ?? new Map<string, number>();
g[METRICS_KEY] = counters;

/** 카운터 1 증가. `labels`는 유한 집합 값만 (게임 id 등). */
export function incCounter(name: string, labels?: Record<string, string>) {
  const key = labels
    ? `${name}{${Object.entries(labels)
        .map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '')}"`)
        .join(',')}}`
    : name;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

/** Prometheus 텍스트 포맷 렌더 (/metrics 응답 본문). */
export function renderMetrics(): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const [key, value] of counters) {
    const name = key.includes('{') ? key.slice(0, key.indexOf('{')) : key;
    if (!seen.has(name)) {
      seen.add(name);
      lines.push(`# TYPE ${name} counter`);
    }
    lines.push(`${key} ${value}`);
  }
  return lines.join('\n') + '\n';
}

/** 테스트 전용 — 카운터 초기화. */
export function resetMetricsForTest() {
  counters.clear();
}
