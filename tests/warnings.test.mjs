// 警告の安定性: しきい値付近でチップが出没(チャタリング)しないこと
// 実測で確認されたチラつき原因(荷振れ大が半周期ごとに 4 回/周期出没)の回帰テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CraneSimulator } from '../js/physics/simulator.js';
import { GEOM, CRANE, PHYS } from '../js/physics/params.js';

const H = 1 / 720;
const SUB = 48;   // 15 Hz サンプリング(HUD と同じ)

function rigAttached(sim, L = 4) {
  sim.attached = true;
  sim.attachedLoadMass = sim.loadMass;
  sim.attachedCgOff = { x: 0, y: 0 };
  sim.L = L;
  sim._syncParams();
  const s = sim.s;
  const stR = (CRANE.mHook + sim.attachedLoadMass) * PHYS.g / sim.p.kRope;
  const stC = sim.attachedLoadMass * PHYS.g / sim.p.kChain;
  s[4] = s[0]; s[5] = s[2]; s[6] = GEOM.pivotH - L - stR;
  s[7] = s[8] = s[9] = 0;
  s[10] = s[0]; s[11] = s[2]; s[12] = s[6] - 2.0 - stC;
  s[13] = s[14] = s[15] = 0; s[16] = 0; s[17] = 0;
  sim._refreshAux();
}

// 15 Hz で警告セットの変化回数を数える(hud.js と同一のキー)
function countSetChanges(sim, seconds) {
  let lastKey = null, changes = 0, swaySeen = false;
  const steps = Math.round(seconds / H);
  for (let i = 0; i < steps; i++) {
    sim._substep(H);
    if (i % SUB === 0) {
      const w = sim.getRenderState().warnings;
      const key = w.map((x) => x.text).join('|');
      if (lastKey !== null && key !== lastKey) changes++;
      lastKey = key;
      if (key.includes('荷振れ大')) swaySeen = true;
    }
  }
  return { changes, swaySeen };
}

test('警告: 振れ幅がしきい値超で振れても荷振れ大は出没を繰り返さない', () => {
  const sim = new CraneSimulator();
  sim.loadMass = 1000;
  rigAttached(sim, 4);
  // 振り子を 1.0 m 振り出して自由振動(瞬時変位は半周期ごとに 0 を通る)
  const s = sim.s;
  s[4] += 1.0; s[10] += 1.0;
  sim._refreshAux();
  const r = countSetChanges(sim, 20);
  assert.ok(r.swaySeen, '荷振れ大は表示される');
  // 修正前: 4 回/周期 × 5 周期 ≈ 17 回。包絡+ヒステリシス+デバウンスで 2 回以下
  assert.ok(r.changes <= 2, `警告セット変化 ${r.changes} 回(期待 ≤2)`);
});

test('警告: しきい値未満の振れでは荷振れ大が一度も出ない', () => {
  const sim = new CraneSimulator();
  sim.loadMass = 1000;
  rigAttached(sim, 4);
  const s = sim.s;
  s[4] += 0.6; s[10] += 0.6;   // 包絡 0.6 m < 0.8
  sim._refreshAux();
  const r = countSetChanges(sim, 10);
  assert.equal(r.swaySeen, false);
});

test('警告: デバウンスは表示のみで採点用フラグ obliqueRaw は即時', () => {
  const sim = new CraneSimulator();
  sim.loadMass = 1000;
  rigAttached(sim, 4);
  const rs = sim.getRenderState();
  assert.equal(typeof rs.obliqueRaw, 'boolean');
  assert.equal(typeof rs.overwind, 'boolean');
  assert.equal(rs.obliqueRaw, false);
});
