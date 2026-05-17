// 일회성 데모 GIF 캡처용. README 데모 자산 갱신 시에만 사용.
// 사용: 로컬 dev 서버 기동 후
//   node scripts/capture-demo.mjs marble   → /tmp/bbb-frames-marble/*.png
//   node scripts/capture-demo.mjs trivia   → /tmp/bbb-frames-trivia/*.png
// 이후 ffmpeg로 docs/demo-<game>.gif 합성.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const GAME = process.argv[2] || 'marble';
const SPEC = {
  marble: { card: null, captureMs: 40_000 }, // 기본 선택 카드
  trivia: { card: '일반 상식', captureMs: 36_000 },
}[GAME];
if (!SPEC) throw new Error(`unknown game: ${GAME} (marble|trivia)`);

const URL = process.env.DEMO_URL || 'http://localhost:3000';
const OUT = `/tmp/bbb-frames-${GAME}`;
const INTERVAL_MS = 150;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '방 만들기' }).click();

// 닉네임 모달 (신규 브라우저 → localStorage 없음)
const nick = page.getByPlaceholder('예: 김철수');
await nick.waitFor({ timeout: 8000 });
await nick.fill('호스트');
await page.getByRole('button', { name: '입장' }).click();

// 로비: 참가자 직접 추가
await page.getByRole('button', { name: /직접 추가/ }).click();
const countText = async () =>
  parseInt(
    (await page.getByText(/참가자 \d+명/).textContent())?.match(/\d+/)?.[0] ?? '1',
    10,
  );
for (const n of ['민수', '지은', '현우', '서연', '태호']) {
  if ((await countText()) >= 6) break;
  await page.getByPlaceholder('닉네임 입력').fill(n);
  await page.getByRole('button', { name: '추가' }).click();
  await page.waitForTimeout(150);
}

// 게임 선택 (마블은 기본 선택이라 생략)
if (SPEC.card) await page.getByText(SPEC.card, { exact: true }).click();

const startAt = Date.now();
await page.getByRole('button', { name: '시작' }).click();

// 트리비아: 문제마다 보기 하나 클릭(호스트 본인 응답). 마블은 입력 불필요.
let answering = GAME === 'trivia';
const answerLoop = async () => {
  while (answering && Date.now() - startAt < SPEC.captureMs) {
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
    await page.waitForTimeout(250);
  }
};

let i = 0;
const captureLoop = async () => {
  while (Date.now() - startAt < SPEC.captureMs) {
    const tick = Date.now();
    await page
      .screenshot({ path: `${OUT}/f${String(i).padStart(4, '0')}.png` })
      .catch(() => {});
    i++;
    const spent = Date.now() - tick;
    if (spent < INTERVAL_MS) await page.waitForTimeout(INTERVAL_MS - spent);
  }
};

await Promise.all([captureLoop(), answerLoop()]);
answering = false;

console.log(`[${GAME}] captured ${i} frames -> ${OUT}`);
await browser.close();
