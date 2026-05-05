import { simulateRace } from '../src/games/marble/sim';

async function main() {
  const seed = 0xdeadbeef;
  const players = [
    { playerToken: 'a' },
    { playerToken: 'b' },
    { playerToken: 'c' },
    { playerToken: 'd' },
    { playerToken: 'e' },
    { playerToken: 'f' },
  ];

  const a = await simulateRace(seed, players);
  const b = await simulateRace(seed, players);

  const aJson = JSON.stringify({
    frames: a.frames,
    finishOrder: a.finishOrder,
    finishFrames: a.finishFrames,
  });
  const bJson = JSON.stringify({
    frames: b.frames,
    finishOrder: b.finishOrder,
    finishFrames: b.finishFrames,
  });

  if (aJson !== bJson) {
    console.error('NOT deterministic — frames differ between runs.');
    process.exit(1);
  }
  console.log(
    `Deterministic ✔  (frames=${a.frames.length}, durationMs=${a.durationMs}, finishOrder=${a.finishOrder.join(',')})`,
  );

  // marble-cheer style: same with chargeRatios
  const charges = { a: 0.0, b: 0.5, c: 1.0, d: 0.25, e: 0.75, f: 0.1 };
  const c1 = await simulateRace(seed, players, charges);
  const c2 = await simulateRace(seed, players, charges);
  if (
    JSON.stringify({ f: c1.frames, o: c1.finishOrder }) !==
    JSON.stringify({ f: c2.frames, o: c2.finishOrder })
  ) {
    console.error('NOT deterministic with chargeRatios — frames differ.');
    process.exit(1);
  }
  console.log(
    `Deterministic ✔  (cheer mode, frames=${c1.frames.length}, finishOrder=${c1.finishOrder.join(',')})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
