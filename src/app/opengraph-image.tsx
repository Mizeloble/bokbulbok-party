import { ImageResponse } from 'next/og';
import { ko } from '@/lib/i18n';
import { MARBLE_COLORS } from '@/lib/constants';

// 카카오톡·SNS에 방 링크를 붙였을 때 보이는 1200×630 미리보기 카드.
// satori는 한글 글리프를 위해 폰트를 명시해야 함(없으면 □로 깨짐) → Pretendard OTF 주입.
// 폰트 로드 실패해도 이미지 생성은 되도록 try/catch (빌드 견고성).

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = ko.app.title;

const FONT_URL =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Bold.otf';

async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(FONT_URL);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const font = await loadFont();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(120% 80% at 50% 0%, #14141c 0%, #0b0b10 60%)',
          color: '#fafafa',
        }}
      >
        {/* 브랜드 타깃 마크 — 동심원(이모지 의존 없이 div로) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 168,
            height: 168,
            borderRadius: '50%',
            border: '14px solid #ef4444',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 92,
              height: 92,
              borderRadius: '50%',
              border: '14px solid #fbbf24',
            }}
          >
            <div
              style={{ width: 26, height: 26, borderRadius: '50%', background: '#fbbf24' }}
            />
          </div>
        </div>

        <div style={{ marginTop: 56, fontSize: 116, fontWeight: 700, letterSpacing: -4 }}>
          {ko.app.title}
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 38,
            color: '#a1a1aa',
            maxWidth: 940,
            textAlign: 'center',
          }}
        >
          {ko.app.metaDescription}
        </div>

        {/* 마블 색 점 줄 — 마블 레이스 정체성. 이모지 폰트 의존 없이 div로. */}
        <div style={{ marginTop: 44, display: 'flex', gap: 16 }}>
          {MARBLE_COLORS.slice(0, 7).map((c) => (
            <div
              key={c}
              style={{ width: 26, height: 26, borderRadius: '50%', background: c }}
            />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: 'Pretendard', data: font, weight: 700 as const, style: 'normal' as const }]
        : undefined,
    },
  );
}
