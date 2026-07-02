'use client';

import { io, type Socket } from 'socket.io-client';

let singleton: Socket | null = null;

export function getSocket(): Socket {
  if (singleton) return singleton;
  singleton = io({
    autoConnect: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    // A party round can outlast a long network blip (elevator, subway, phone
    // locked). Giving up after a handful of tries left the client silently frozen
    // with no path back, so keep retrying indefinitely with a capped backoff — the
    // UI surfaces a manual refresh if it drags on.
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });
  return singleton;
}

export function disposeSocket() {
  if (singleton) {
    singleton.disconnect();
    singleton = null;
  }
}
