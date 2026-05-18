/**
 * Fairness harness for the marble race.
 *
 * Question under test: "player #1 always loses". We run simulateRace over many
 * random seeds and tally, per player count N:
 *   - how often each *player index* (0..N-1) is the loser
 *   - how often each *spawn slot* (derived from frame-0 x) is the loser
 *
 * Player-index skew  → a seating/RNG-order coupling bug (the real bug we'd fix).
 * Slot-only skew      → track geometry favors certain x positions, but the
 *                        player→slot mapping is fair, so no per-player unfairness.
 *
 * box2d-wasm instantiates a fresh Emscripten module per simulateRace and never
 * frees it, so thousands of runs in one process OOM (exit 134). Each N is run
 * in its own short-lived child process so the WASM heap is reclaimed between Ns.
 *
 * Run: npx tsx scripts/marble-fairness.ts [trialsPerN]
 */
import { execFileSync } from 'node:child_process';
import { simulateRace } from '../src/games/marble/sim';

// frame[0] x ≈ spawn x = 10.25 + slotInLine * 0.6  (see sim.ts spawnMarbles)
function slotFromX(x: number): number {
  return Math.round((x - 10.25) / 0.6);
}

// One-sided chi-square against a uniform distribution over `k` bins.
function chiSquareUniform(counts: number[], total: number): number {
  const expected = total / counts.length;
  let chi = 0;
  for (const c of counts) chi += ((c - expected) ** 2) / expected;
  return chi;
}

// 95% chi-square critical values for df = 3..11 (N = 4..12, df = N-1).
const CHI_CRIT_95: Record<number, number> = {
  3: 7.815, 4: 9.488, 5: 11.07, 6: 12.592, 7: 14.067,
  8: 15.507, 9: 16.919, 10: 18.307, 11: 19.675,
};

function fmtRow(label: string, counts: number[], total: number): string {
  const expected = total / counts.length;
  const cells = counts
    .map((c, i) => {
      const pct = ((c / total) * 100).toFixed(1);
      const dev = (((c - expected) / expected) * 100).toFixed(0);
      const sign = Number(dev) >= 0 ? '+' : '';
      return `[${i}] ${pct}% (${sign}${dev}%)`;
    })
    .join('  ');
  return `${label}: ${cells}`;
}

async function runSingleN(N: number, trials: number) {
  const players = Array.from({ length: N }, (_, i) => ({ playerToken: `p${i}` }));
  const idxLoss = new Array(N).fill(0);
  const slotLoss = new Array(10).fill(0);

  for (let t = 0; t < trials; t++) {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const r = await simulateRace(seed, players);
    const loserToken = r.finishOrder[r.finishOrder.length - 1];
    const loserIdx = r.playerOrder.indexOf(loserToken);
    idxLoss[loserIdx]++;
    const slot = slotFromX(r.frames[0][loserIdx * 2]);
    if (slot >= 0 && slot < 10) slotLoss[slot]++;
  }

  const df = N - 1;
  const chiIdx = chiSquareUniform(idxLoss, trials);
  const crit = CHI_CRIT_95[df];
  const verdict = chiIdx > crit ? 'SKEWED ✗' : 'uniform ✔';

  console.log(`\n=== N=${N}  (${trials} trials, expected ${(trials / N).toFixed(0)}/index) ===`);
  console.log(fmtRow('  by index', idxLoss, trials));
  console.log(fmtRow('  by slot ', slotLoss, trials));
  console.log(`  chi²(index)=${chiIdx.toFixed(2)}  crit95(df=${df})=${crit}  → index distribution ${verdict}`);
}

async function main() {
  const single = process.argv.indexOf('--single');
  if (single !== -1) {
    await runSingleN(Number(process.argv[single + 1]), Number(process.argv[single + 2]));
    return;
  }

  const trialsPerN = Number(process.argv[2] ?? 1500);
  const Ns = [4, 6, 8, 10, 12];
  for (const N of Ns) {
    // Fresh child process per N: box2d-wasm leaks a module instance per
    // simulateRace, so isolating each N keeps the WASM heap from OOMing.
    execFileSync(
      'npx',
      ['tsx', process.argv[1], '--single', String(N), String(trialsPerN)],
      { stdio: 'inherit' },
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
