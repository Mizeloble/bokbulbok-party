// 일회성 데모 GIF 캡처용. README 데모 자산 갱신 시에만 사용.
// 사용: 로컬 dev 서버 기동 후 `node scripts/capture-demo.mjs`
//       → /tmp/bbb-frames/*.png 생성 (이후 ffmpeg로 docs/demo.gif 합성)
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const URL = process.env.DEMO_URL || 'http://localhost:3000';
const OUT = '/tmp/bbb-frames';
const CAPTURE_MS = 40_000;
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

// 로비: 참가자 직접 추가 토글
await page.getByRole('button', { name: /직접 추가/ }).click();

const countText = async () =>
  parseInt((await page.getByText(/참가자 \d+명/).textContent())?.match(/\d+/)?.[0] ?? '1', 10);

const names = ['민수', '지은', '현우', '서연', '태호'];
for (const n of names) {
  if ((await countText()) >= 6) break;
  const input = page.getByPlaceholder('닉네임 입력');
  await input.fill(n);
  await page.getByRole('button', { name: '추가' }).click();
  await page.waitForTimeout(150);
}

// 마블 레이스 (기본 선택) → 시작과 동시에 프레임 캡처
const startAt = Date.now();
await page.getByRole('button', { name: '시작' }).click();

let i = 0;
while (Date.now() - startAt < CAPTURE_MS) {
  const tick = Date.now();
  await page
    .screenshot({ path: `${OUT}/f${String(i).padStart(4, '0')}.png` })
    .catch(() => {});
  i++;
  const spent = Date.now() - tick;
  if (spent < INTERVAL_MS) await page.waitForTimeout(INTERVAL_MS - spent);
}

console.log(`captured ${i} frames -> ${OUT}`);
await browser.close();
