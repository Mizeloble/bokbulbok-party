// 광고 합성용 텍스트 카드(PNG) 렌더. 이 ffmpeg 빌드엔 drawtext(freetype)가 없어
// 자막을 ffmpeg로 못 굽는다 → 브라우저(Pretendard 로드됨)에서 그려 PNG로 뽑고
// ffmpeg overlay로 합성. 보너스: 컬러 이모지도 렌더됨.
//   node scripts/render-promo-cards.mjs   → /tmp/promo-work/cards/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.DEMO_URL || 'http://localhost:3000';
const OUT = '/tmp/promo-work/cards';
mkdirSync(OUT, { recursive: true });

const FF = `Pretendard, system-ui, -apple-system, sans-serif`;

// 풀스크린 카드(불투명) — 인트로/아웃트로
const intro = `
<div style="position:fixed;inset:0;background:radial-gradient(120% 80% at 50% 0%,#16161f,#0b0b10 60%);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;
  font-family:${FF};color:#fafafa;text-align:center">
  <div style="font-size:48px;color:#a1a1aa;font-weight:700">모이면 늘 생기는 고민</div>
  <div style="font-size:108px;font-weight:800;letter-spacing:-0.04em;line-height:1.1">누가 벌칙<br>받지? 🎯</div>
  <div style="margin-top:20px;font-size:42px;font-weight:800;color:#fbbf24">복불복</div>
</div>`;

const outro = `
<div style="position:fixed;inset:0;background:radial-gradient(120% 80% at 50% 0%,#16161f,#0b0b10 60%);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;
  font-family:${FF};color:#fafafa;text-align:center">
  <div style="font-size:140px;font-weight:800;color:#fbbf24;letter-spacing:-0.04em">복불복</div>
  <div style="font-size:60px;font-weight:800">QR 찍고 다 같이 시작</div>
  <div style="font-size:42px;color:#a1a1aa;font-weight:600">무료 · 회원가입 없음 · 앱 설치 없음</div>
  <div style="margin-top:8px;font-size:40px;color:#71717a">bokbulbok-party.fly.dev</div>
</div>`;

// 투명 오버레이 — 상단 라벨칩 + 하단 브랜드 워터마크
const overlay = (label) => `
<div style="position:fixed;inset:0;font-family:${FF}">
  <div style="position:absolute;top:118px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,0.55);color:#fff;font-size:50px;font-weight:800;
    padding:18px 42px;border-radius:999px;white-space:nowrap;
    border:1px solid rgba(255,255,255,0.14)">${label}</div>
  <div style="position:absolute;bottom:92px;left:50%;transform:translateX(-50%);
    color:#fbbf24;font-size:40px;font-weight:800;letter-spacing:-0.02em">복불복</div>
</div>`;

const CARDS = [
  { name: 'intro', html: intro, transparent: false },
  { name: 'outro', html: outro, transparent: false },
  { name: 'cap_marble', html: overlay('🏁 마블 레이스'), transparent: true },
  { name: 'cap_reaction', html: overlay('⚡ 반응속도'), transparent: true },
  { name: 'cap_trivia', html: overlay('🧠 상식·넌센스 퀴즈'), transparent: true },
  { name: 'cap_payoff', html: overlay('🎯 꼴찌 결정!'), transparent: true },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
// 앱을 먼저 로드해 Pretendard 웹폰트를 활성화(빈 페이지엔 폰트가 없음)
await page.goto(URL, { waitUntil: 'networkidle' });
try { await page.evaluate(() => document.fonts.ready); } catch {}

for (const c of CARDS) {
  await page.evaluate((html) => {
    document.documentElement.style.background = 'transparent';
    document.body.style.cssText = 'margin:0;background:transparent';
    document.body.innerHTML = html;
  }, c.html);
  try { await page.evaluate(() => document.fonts.ready); } catch {}
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/${c.name}.png`, omitBackground: c.transparent });
  console.log(`[card] ${c.name}.png`);
}

await browser.close();
