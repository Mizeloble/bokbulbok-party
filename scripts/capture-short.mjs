// 숏폼(릴스·쇼츠·틱톡)용 세로 영상 캡처. README GIF용 capture-demo.mjs와 별개.
// 마블 한 판을 로비→카운트다운→레이스→꼴찌 결정(공유 카드 직전)까지 녹화.
//
// 사용: 로컬 dev 서버 기동 후
//   node scripts/capture-short.mjs           → /tmp/bbb-short/*.webm
//   그 뒤 ffmpeg로 1080×1920 mp4 변환(아래 README 주석 참고).
//
// viewport 540×960 = 정확히 9:16 + sm 브레이크포인트(640) 미만이라 모바일 레이아웃 유지.
// recordVideo.size는 뷰포트와 일치시켜야 함 — Playwright는 "scale DOWN to fit"만 하므로
// 더 크게 주면 위로 안 늘리고 회색 패딩을 채운다. 최종 1080×1920 업스케일은 ffmpeg에서.
import { chromium } from 'playwright';
import { rmSync, mkdirSync } from 'node:fs';

const URL = process.env.DEMO_URL || 'http://localhost:3000';
const OUT = '/tmp/bbb-short';
const PLAYERS = ['민수', '지은', '현우', '서연', '태호'];
const MAX_PLAYERS = 6;
const RESULT_HOLD_MS = 3500; // 꼴찌 결정 후 머무는 시간(공유 카드·컨페티 노출)
const SAFETY_MS = 90_000; // 전체 안전 타임아웃

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: { width: 540, height: 960 } },
});
const page = await context.newPage();
const recOrigin = Date.now(); // 영상 t0 근사 (페이지 생성 직후 = 녹화 시작 ~동기)
const mark = () => Date.now() - recOrigin;
let raceMs = 0;
let revealMs = 0;

const startedAt = Date.now();
try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '방 만들기' }).click();

  // 닉네임 모달 (신규 브라우저 → localStorage 비어 있음)
  const nick = page.getByPlaceholder('예: 김철수');
  await nick.waitFor({ timeout: 8000 });
  await nick.fill('호스트');
  await page.getByRole('button', { name: '입장' }).click();

  // 로비: 오프라인 참가자 직접 추가
  await page.getByRole('button', { name: /직접 추가/ }).click();
  const count = async () =>
    parseInt(
      (await page.getByText(/참가자 \d+명/).textContent())?.match(/\d+/)?.[0] ?? '1',
      10,
    );
  for (const n of PLAYERS) {
    if ((await count()) >= MAX_PLAYERS) break;
    await page.getByPlaceholder('닉네임 입력').fill(n);
    await page.getByRole('button', { name: '추가' }).click();
    await page.waitForTimeout(150);
  }

  // 마블은 기본 선택 카드 → 바로 시작. (이 시점부터가 클립의 핵심 구간)
  raceMs = mark();
  await page.getByRole('button', { name: '시작' }).click();

  // 레이스 끝나면 "결과 보기 →" 프롬프트가 뜸(마블은 결과 게이트 있음) → 탭해서
  // 결과 화면(🎯 오늘의 벌칙 + 큰 꼴찌 이름 + 컨페티)으로 진입.
  await page
    .getByRole('button', { name: /결과 보기/ })
    .click({ timeout: SAFETY_MS - RESULT_HOLD_MS });

  await page.getByText('오늘의 벌칙').waitFor({ timeout: 8000 });
  revealMs = mark();
  await page.waitForTimeout(RESULT_HOLD_MS);
} finally {
  // page/context close가 영상 파일을 확정(flush)한다.
  await page.close();
  await context.close();
  await browser.close();
}

// 마크 출력 — ffmpeg 트리밍에 사용(셋업 구간 잘라내기).
// raceMs: '시작' 클릭(클립 시작 후보), revealMs: 결과 화면 진입.
console.log(
  `[short] captured in ${((Date.now() - startedAt) / 1000).toFixed(1)}s -> ${OUT}/*.webm`,
);
console.log(`MARKS raceMs=${raceMs} revealMs=${revealMs}`);
