import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ko } from '@/lib/i18n';
import { AD_NETWORK, ADSENSE_CLIENT } from '@/lib/ads';
import { ANALYTICS_PROVIDER, CF_BEACON_TOKEN, GA_ID, PLAUSIBLE_DOMAIN } from '@/lib/analytics';
import { ConsentBanner } from '@/components/ConsentBanner';
import './globals.css';

// 공유(카카오톡·SNS) 미리보기·OG 절대 URL의 기준. 프로덕션은 NEXT_PUBLIC_SITE_URL로
// 본인 도메인 지정. 미설정 시 로컬 기준(개발).
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: ko.app.title,
  description: ko.app.metaDescription,
  applicationName: ko.app.title,
  // og:image / twitter:image는 app/opengraph-image.tsx가 자동 주입.
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: '/',
    siteName: ko.app.title,
    title: ko.app.title,
    description: ko.app.metaDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: ko.app.title,
    description: ko.app.metaDescription,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No maximumScale: locking zoom blocks low-vision users from enlarging quiz
  // text / rankings (WCAG 1.4.4). Game canvases use `touch-none` where they need
  // to suppress gestures, so global pinch-zoom doesn't interfere with play.
  viewportFit: 'cover',
  themeColor: '#0b0b10',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="min-h-dvh font-sans">
        {children}
        <ConsentBanner />
        {/* 광고 베이스 스크립트 — env로 네트워크가 켜졌을 때만 1회 로드(자리별 단위는 AdSlot에서). */}
        {AD_NETWORK === 'adfit' && (
          <Script src="//t1.daumcdn.net/kas/static/ba.min.js" strategy="afterInteractive" />
        )}
        {AD_NETWORK === 'adsense' && ADSENSE_CLIENT && (
          <Script
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
            strategy="afterInteractive"
            crossOrigin="anonymous"
          />
        )}
        {/* 분석 — env로 켰을 때만. 익명 집계(개인정보처리방침 일치). 기본 none=미로딩. */}
        {ANALYTICS_PROVIDER === 'cloudflare' && CF_BEACON_TOKEN && (
          <Script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
            strategy="afterInteractive"
          />
        )}
        {ANALYTICS_PROVIDER === 'plausible' && PLAUSIBLE_DOMAIN && (
          <Script
            defer
            data-domain={PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.js"
            strategy="afterInteractive"
          />
        )}
        {ANALYTICS_PROVIDER === 'ga' && GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
