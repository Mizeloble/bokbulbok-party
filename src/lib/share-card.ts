import { ko } from './i18n';
import { MARBLE_COLORS } from './constants';

// 결과 공유 카드 — 클라이언트에서 캔버스로 즉석 렌더 → Blob.
//
// 서버 OG 라우트를 쓰지 않는다(의도적): 방 상태는 메모리 전용 + 유휴 GC라
// 공유 시점에 라우트가 결과를 못 읽고, OG는 소셜에 캐시된다. 결과 데이터는 이미
// 클라이언트 화면에 있으니 그걸로 그대로 그려 navigator.share(files)로 내보낸다.
// (docs/growth.md Tier 1-1 참조)

export interface ShareCardLoser {
  nickname: string;
  color: string;
}

export interface ShareCardData {
  losers: ShareCardLoser[];
  /** 카드 푸터·공유 URL의 기준. 보통 window.location.origin */
  origin: string;
}

/** 카카오톡·인스타에 잘 맞는 정사각 1080. */
const SIZE = 1080;
const FONT = `'Pretendard Variable', Pretendard, system-ui, -apple-system, sans-serif`;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  // 모던 브라우저는 ctx.roundRect 지원. 없으면 수동 폴백.
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 결과 카드를 그려 PNG Blob으로 반환. */
export async function renderResultCard(data: ShareCardData): Promise<Blob> {
  // Pretendard 웹폰트가 아직 로드 전이면 한글이 폴백 폰트로 그려질 수 있어 대기.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* 폰트 대기 실패해도 시스템 폰트로 진행 */
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  // 배경 — 결과 화면과 동일 톤의 다크 라디얼.
  const bg = ctx.createRadialGradient(SIZE / 2, -120, 0, SIZE / 2, -120, 1180);
  bg.addColorStop(0, '#16161f');
  bg.addColorStop(0.55, '#0d0d13');
  bg.addColorStop(1, '#0b0b10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 상단 마블 색 점 줄 — OG·랜딩과 같은 브랜드 정체성(은은하게).
  const dotCount = Math.min(7, MARBLE_COLORS.length);
  const dotR = 11;
  const dotGap = 34;
  const dotsW = (dotCount - 1) * dotGap;
  ctx.save();
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < dotCount; i++) {
    ctx.beginPath();
    ctx.arc(SIZE / 2 - dotsW / 2 + i * dotGap, 92, dotR, 0, Math.PI * 2);
    ctx.fillStyle = MARBLE_COLORS[i];
    ctx.fill();
  }
  ctx.restore();

  // 상단 칩 — 🎯 오늘의 벌칙
  const chipText = `🎯 ${ko.result.headerChip}`;
  ctx.font = `700 30px ${FONT}`;
  const chipW = ctx.measureText(chipText).width + 56;
  const chipH = 64;
  const chipX = (SIZE - chipW) / 2;
  const chipY = 150;
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  roundRect(ctx, chipX, chipY, chipW, chipH, 32);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, chipX, chipY, chipW, chipH, 32);
  ctx.stroke();
  ctx.fillStyle = '#d4d4d8';
  ctx.fillText(chipText, SIZE / 2, chipY + chipH / 2 + 2);

  // 꼴찌 이름 블록 — 화면 중앙. 인원수에 따라 크기 가변.
  const n = data.losers.length;
  const nameSize = n === 1 ? 150 : n === 2 ? 104 : 78;
  const gap = n === 1 ? 0 : 28;
  // 줄 간격은 균일(nameSize)로 두고, 폭을 넘는 긴 닉네임만 폰트를 줄여 맞춘다.
  // 닉네임 최대 10자(NICKNAME.MAX_LENGTH)라 1명 케이스(150px)는 넘칠 수 있음.
  const maxNameW = SIZE - 140;
  const blockH = n * nameSize + (n - 1) * gap;
  let y = SIZE / 2 - blockH / 2 + nameSize / 2 - 20;

  for (const p of data.losers) {
    // 폭에 맞춰 폰트 축소 (점·간격 0.46은 폰트에 비례하므로 함께 반영).
    let fs = nameSize;
    ctx.font = `800 ${fs}px ${FONT}`;
    const measured = ctx.measureText(p.nickname).width + fs * 0.46;
    if (measured > maxNameW) {
      fs = Math.floor(fs * (maxNameW / measured));
      ctx.font = `800 ${fs}px ${FONT}`;
    }
    const tw = ctx.measureText(p.nickname).width;
    const dot = fs * 0.16;
    const dgap = fs * 0.3;
    const total = dot + dgap + tw;
    const startX = (SIZE - total) / 2;

    // 색 점
    ctx.beginPath();
    ctx.arc(startX + dot / 2, y, dot / 2, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();

    // 이름 (색 글로우)
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 50;
    ctx.fillStyle = '#fafafa';
    ctx.textAlign = 'left';
    ctx.fillText(p.nickname, startX + dot + dgap, y);
    ctx.restore();
    ctx.textAlign = 'center';

    y += nameSize + gap;
  }

  // 서브라인 — 오늘 벌칙 당첨 🎯
  ctx.font = `700 42px ${FONT}`;
  ctx.fillStyle = '#fda4af';
  ctx.fillText(ko.share.cardSub, SIZE / 2, SIZE / 2 + blockH / 2 + 80);

  // 푸터 — 브랜드 + 도메인 (유입 훅)
  ctx.font = `800 40px ${FONT}`;
  ctx.fillStyle = '#fbbf24';
  ctx.fillText(ko.app.title, SIZE / 2, SIZE - 152);
  let host = data.origin;
  try {
    host = new URL(data.origin).host.replace(/^www\./, '');
  } catch {
    /* origin이 URL이 아니면 원문 그대로 */
  }
  ctx.font = `500 30px ${FONT}`;
  ctx.fillStyle = '#71717a';
  ctx.fillText(host, SIZE / 2, SIZE - 100);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas toBlob returned null'))),
      'image/png',
    );
  });
}

export type ShareResult = 'shared' | 'saved' | 'failed';

/**
 * 결과 카드를 렌더해 공유 시트로 내보낸다.
 *  - Web Share(files) 지원 → navigator.share (모바일)
 *  - 미지원(데스크탑) → PNG 다운로드 폴백
 *  - 사용자가 공유 취소(AbortError) → 'shared'로 취급(에러 아님)
 */
export async function shareResultCard(data: ShareCardData): Promise<ShareResult> {
  try {
    const blob = await renderResultCard(data);
    const file = new File([blob], 'bokbulbok-result.png', { type: 'image/png' });
    const nav = navigator as Navigator & {
      canShare?: (d: ShareData) => boolean;
      share?: (d: ShareData) => Promise<void>;
    };

    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({
        files: [file],
        title: ko.app.title,
        text: ko.share.shareText,
        url: data.origin,
      });
      return 'shared';
    }

    // 폴백: 이미지 다운로드
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = 'bokbulbok-result.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    return 'saved';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    return 'failed';
  }
}
