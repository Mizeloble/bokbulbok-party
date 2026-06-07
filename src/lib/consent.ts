'use client';

// 개인맞춤형 광고 동의 상태. localStorage('bbk:consent')에 1회 저장.
//  - 'granted' : 맞춤 광고 허용
//  - 'denied'  : 비맞춤 광고만
//  - null      : 아직 선택 안 함 → 광고 자리는 비워두고 동의 배너 노출
// 같은 탭 내 즉시 반영을 위해 custom event, 다른 탭 동기화를 위해 'storage' 이벤트 사용.

import { useEffect, useState } from 'react';

export type ConsentChoice = 'granted' | 'denied';

const KEY = 'bbk:consent';
const EVENT = 'bbk:consent-change';

export function readConsent(): ConsentChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

export function writeConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** 동의 상태를 구독. SSR/첫 렌더는 null로 시작해 hydration 불일치를 피함. */
export function useConsent(): ConsentChoice | null {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  useEffect(() => {
    setChoice(readConsent());
    const onChange = () => setChoice(readConsent());
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return choice;
}
