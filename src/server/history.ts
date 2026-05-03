// 누적 게임 히스토리 — 단일 파일 SQLite. 방·플레이어 상태(메모리)와 분리된
// 유일한 영속 데이터. 호스트가 돌아가며 바뀌는 팀에서 "역대 커피값" 누적용.
//
// 동명이인은 같은 사람으로 카운트(닉네임 문자열 식별). 봇은 호출자가 사전 제외.

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { GameId } from '../games/types';

export type LeaderboardRow = {
  nickname: string;
  losses: number;
  plays: number;
  lastSeenAt: number;
};

export type RankedEntry = { nickname: string; was_loser: boolean };

const DB_PATH =
  process.env.HISTORY_DB_PATH ?? path.resolve(process.cwd(), 'data/history.sqlite');

let dbInstance: Database.Database | null = null;

function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      played_at    INTEGER NOT NULL,
      game_id      TEXT    NOT NULL,
      loser_count  INTEGER NOT NULL,
      player_count INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_games_played_at ON games(played_at);

    CREATE TABLE IF NOT EXISTS participations (
      game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      nickname  TEXT    NOT NULL,
      rank      INTEGER NOT NULL,
      was_loser INTEGER NOT NULL,
      PRIMARY KEY (game_id, nickname)
    );
    CREATE INDEX IF NOT EXISTS idx_participations_nickname ON participations(nickname);
  `);
  dbInstance = db;
  return db;
}

export function recordGame(input: {
  gameId: GameId;
  loserCount: number;
  ranking: RankedEntry[];
}): { lossesByNickname: Map<string, number> } {
  const cleaned = input.ranking
    .map((r) => ({ nickname: r.nickname.trim(), was_loser: r.was_loser }))
    .filter((r) => r.nickname.length > 0);

  // Same nickname appearing twice (host-added duplicate via separate room edge case):
  // dedup keeping the first occurrence so PK doesn't blow up.
  const seen = new Set<string>();
  const unique: RankedEntry[] = [];
  for (const r of cleaned) {
    if (seen.has(r.nickname)) continue;
    seen.add(r.nickname);
    unique.push(r);
  }

  if (unique.length === 0) {
    return { lossesByNickname: new Map() };
  }

  const db = getDb();
  const insertGame = db.prepare(
    `INSERT INTO games (played_at, game_id, loser_count, player_count) VALUES (?, ?, ?, ?)`,
  );
  const insertPart = db.prepare(
    `INSERT INTO participations (game_id, nickname, rank, was_loser) VALUES (?, ?, ?, ?)`,
  );
  const sumLosses = db.prepare(
    `SELECT nickname, SUM(was_loser) AS losses
       FROM participations
      WHERE nickname = ?
      GROUP BY nickname`,
  );

  const tx = db.transaction(() => {
    const info = insertGame.run(Date.now(), input.gameId, input.loserCount, unique.length);
    const gameId = info.lastInsertRowid as number;
    for (let i = 0; i < unique.length; i++) {
      insertPart.run(gameId, unique[i].nickname, i + 1, unique[i].was_loser ? 1 : 0);
    }
    const losers = unique.filter((r) => r.was_loser);
    const counts = new Map<string, number>();
    for (const l of losers) {
      const row = sumLosses.get(l.nickname) as { losses: number } | undefined;
      counts.set(l.nickname, Number(row?.losses ?? 0));
    }
    return counts;
  });

  return { lossesByNickname: tx() };
}

export function getLeaderboard(limit = 50): LeaderboardRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.nickname AS nickname,
              SUM(p.was_loser) AS losses,
              COUNT(*) AS plays,
              MAX(g.played_at) AS lastSeenAt
         FROM participations p
         JOIN games g ON g.id = p.game_id
        GROUP BY p.nickname
        ORDER BY losses DESC, plays DESC, lastSeenAt DESC
        LIMIT ?`,
    )
    .all(limit) as Array<{ nickname: string; losses: number; plays: number; lastSeenAt: number }>;
  return rows.map((r) => ({
    nickname: r.nickname,
    losses: Number(r.losses),
    plays: Number(r.plays),
    lastSeenAt: Number(r.lastSeenAt),
  }));
}

export function clearAll(): void {
  const db = getDb();
  db.exec('DELETE FROM participations; DELETE FROM games;');
}
