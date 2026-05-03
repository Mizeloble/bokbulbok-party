// Lightweight wrapper around navigator.vibrate. Honors a localStorage mute toggle
// so users can opt out without a UI yet. No-op on devices without the API.

const MUTE_KEY = 'marble.haptics.muted';

function isMuted(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (isMuted()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // some browsers throw on user-gesture requirements; silently ignore
  }
}

export const haptics = {
  countdownTick(): void {
    vibrate(30);
  },
  countdownGo(): void {
    vibrate([0, 60, 40, 80]);
  },
  myFinish(): void {
    vibrate([60, 40, 120]);
  },
  loserConfirmed(): void {
    vibrate([0, 0, 0, 200]);
  },
  chargeTap(): void {
    vibrate(8);
  },
  reactionGo(): void {
    vibrate(40);
  },
  reactionFalseStart(): void {
    vibrate([0, 30, 30, 30]);
  },
  triviaCorrect(): void {
    vibrate([0, 25, 30, 25]);
  },
  triviaWrong(): void {
    vibrate([0, 50, 30, 80]);
  },
  triviaCombo(): void {
    vibrate([0, 15, 25, 15, 25, 30]);
  },
  triviaUrgentTick(): void {
    vibrate(15);
  },
};
