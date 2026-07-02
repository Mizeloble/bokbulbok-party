import { customAlphabet, nanoid } from 'nanoid';

// 6-char uppercase room ID (no 0/O/1/I to avoid scan ambiguity)
const roomAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_ID_LENGTH = 6;
const roomIdGen = customAlphabet(roomAlphabet, ROOM_ID_LENGTH);

export const newRoomId = () => roomIdGen();

/** Normalize a hand-typed room code (uppercase, trim). */
export const normalizeRoomId = (raw: string) => raw.trim().toUpperCase();

const roomIdRe = new RegExp(`^[${roomAlphabet}]{${ROOM_ID_LENGTH}}$`);
/** Shape check for a hand-typed room code — catches typos before navigating. */
export const isValidRoomId = (raw: string) => roomIdRe.test(normalizeRoomId(raw));
export const newPlayerToken = () => nanoid(16);
export const newHostToken = () => nanoid(24);
