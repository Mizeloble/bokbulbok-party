import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ko } from '@/lib/i18n';
import { AD_NETWORK, ADSENSE_CLIENT } from '@/lib/ads';
import { ConsentBanner } from '@/components/ConsentBanner';
import './globals.css';

export const metadata: Metadata = {
  title: ko.app.title,
  description: ko.app.metaDescription,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
      </body>
    </html>
  );
}
