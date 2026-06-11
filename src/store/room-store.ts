'use client';

import { create } from 'zustand';
import type {
  GameStartPayload,
  PublicPlayer,
  PublicRoomState,
  ResultPayload,
} from '@/lib/protocol';

export type { GameStartPayload, PublicPlayer, PublicRoomState, ResultPayload };

type RoomStore = {
  myToken: string | null;
  isHost: boolean;
  state: PublicRoomState | null;
  gameStart: GameStartPayload | null;
  result: ResultPayload | null;
  setMe: (token: string, isHost: boolean) => void;
  setState: (s: PublicRoomState) => void;
  setGameStart: (g: GameStartPayload | null) => void;
  setResult: (r: ResultPayload | null) => void;
  /** Drop all room-scoped data. Called when entering a room different from the one
   * the store currently holds — the store is a module singleton and survives route
   * changes, so stale state would otherwise leak into the next room. */
  reset: () => void;
};

export const useRoomStore = create<RoomStore>((set) => ({
  myToken: null,
  isHost: false,
  state: null,
  gameStart: null,
  result: null,
  setMe: (token, isHost) => set({ myToken: token, isHost }),
  setState: (s) => set({ state: s }),
  setGameStart: (g) => set({ gameStart: g, result: null }),
  setResult: (r) => set({ result: r }),
  reset: () => set({ myToken: null, isHost: false, state: null, gameStart: null, result: null }),
}));
