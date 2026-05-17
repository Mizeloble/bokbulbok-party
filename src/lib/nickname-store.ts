'use client';

const KEY = 'bbk:identity';

export type StoredIdentity = {
  nickname: string;
  playerToken: string;
  updatedAt: number;
};

export function loadIdentity(): StoredIdentity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIdentity;
    if (!parsed.nickname || !parsed.playerToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveIdentity(nickname: string, playerToken: string) {
  if (typeof window === 'undefined') return;
  const payload: StoredIdentity = { nickname, playerToken, updatedAt: Date.now() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {}
}

export function clearNickname() {
  if (typeof window === 'undefined') return;
  const cur = loadIdentity();
  if (!cur) return;
  // keep token, clear nickname so next visit prompts again
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...cur, nickname: '' }));
  } catch {}
}
