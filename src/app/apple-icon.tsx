import { ImageResponse } from 'next/og';

// iOS 홈 화면 아이콘 — app/icon.svg의 과녁을 180px PNG로 재현(iOS는 manifest의
// SVG를 무시하고 apple-touch-icon만 씀). 비율은 icon.svg의 32px 좌표계 × 5.625.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0b0b10',
        }}
      >
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: '50%',
            border: '17px solid #ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: '50%',
              border: '17px solid #fbbf24',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                backgroundColor: '#fbbf24',
              }}
            />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
