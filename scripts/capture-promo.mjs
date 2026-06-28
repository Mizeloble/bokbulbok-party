// 광고물(promo) 합성용 게임별 세로 클립 캡처. capture-short.mjs를 게임 파라미터로 일반화.
//   node scripts/capture-promo.mjs marble    → /tmp/bbb-promo/marble.webm (레이스+결과)
//   node scripts/capture-promo.mjs reaction  → /tmp/bbb-promo/reaction.webm (준비→지금!)
//   node scripts/capture-promo.mjs trivia    → /tmp/bbb-promo/trivia.webm (4지선다 진행)
// recordVideo.size는 뷰포트(540×960)와 일치(Playwright는 scale-down만). 업스케일은 ffmpeg.
import { chromium } from 'playwright';
import { rmSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';

const GAME = process.argv[2] || 'marble';
const SPEC = {
  marble: { card: null, mode: 'result' },
  reaction: { card: '동시탭 반응속도', mode: 'reaction', holdMs: 4000 },
  trivia: { card: '일반 상식', mode: 'trivia', captureMs: 22_000 },
}[GAME];
if (!SPEC) throw new Error(`unknown game: ${GAME} (marble|reaction|trivia)`);

const URL = process.env.DEMO_URL || 'http://localhost:3000';
const OUT = '/tmp/bbb-promo';
const PLAYERS = ['민수', '지은', '현우', '서연', '태호'];
const MAX_PLAYERS = 6;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: { width: 540, height: 960 } },
});
const page = await context.newPage();
const recOrigin = Date.now();
const mark = () => Date.now() - recOrigin;
let startMs = 0;

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '방 만들기' }).click();

  const nick = page.getByPlaceholder('예: 김철수');
  await nick.waitFor({ timeout: 8000 });
  await nick.fill('호스트');
  await page.getByRole('button', { name: '입장' }).click();

  // 참가자 직접 추가
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

  // 게임 카드 선택 (마블은 기본)
  if (SPEC.card) await page.getByRole('button', { name: new RegExp(SPEC.card) }).click();

  startMs = mark();
  await page.getByRole('button', { name: '시작' }).click();

  if (SPEC.mode === 'result') {
    // 마블: 레이스 → "결과 보기" 탭 → 결과 화면 → 잠깐 머무름
    await page.getByRole('button', { name: /결과 보기/ }).click({ timeout: 80_000 });
    await page.getByText('오늘의 벌칙').waitFor({ timeout: 8000 });
    await page.waitForTimeout(3500);
  } else if (SPEC.mode === 'reaction') {
    // 반응속도: 준비(회색) → 지금!(앰버) 전환을 감지해 한 번 탭, 그 뒤 잠깐 더 녹화
    await page
      .waitForFunction(
        () => {
          const b = document.querySelector('main button[aria-label]');
          if (!b) return false;
          const s = getComputedStyle(b);
          const bg = (s.backgroundImage || '') + (s.background || '');
          return bg.includes('251, 191, 36') || bg.includes('245, 158, 11'); // amber
        },
        { timeout: 14_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(230);
    await page
      .locator('main button[aria-label]')
      .first()
      .click({ timeout: 1500 })
      .catch(() => {});
    await page.waitForTimeout(SPEC.holdMs);
  } else if (SPEC.mode === 'trivia') {
    // 트리비아: 문제마다 보기(A/B/C/D) 하나 클릭하며 고정 시간 녹화
    const until = Date.now() + SPEC.captureMs;
    while (Date.now() < until) {
      const btns = await page
        .$$('main button[type="button"]:not([disabled])')
        .catch(() => []);
      for (const b of btns) {
        const t = (await b.innerText().catch(() => '')).trim();
        if (/^[ABCD](\s|\n)/.test(t)) {
          await b.click({ timeout: 500 }).catch(() => {});
          break;
        }
      }
      await page.waitForTimeout(300);
    }
  }
} finally {
  await page.close();
  await context.close();
  await browser.close();
}

// recordVideo는 랜덤 파일명(해시.webm) → 게임명으로 리네임. 방금 녹화한 것 = 최신 mtime.
const dest = `${OUT}/${GAME}.webm`;
const webm = readdirSync(OUT)
  .filter((f) => f.endsWith('.webm') && f !== `${GAME}.webm`)
  .map((f) => `${OUT}/${f}`)
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (webm && webm !== dest) {
  rmSync(dest, { force: true });
  renameSync(webm, dest);
}
console.log(`[promo:${GAME}] startMs=${startMs} -> ${dest}`);
