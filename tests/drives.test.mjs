// 駆動系 v2 のテスト: 過負荷防止装置・ブレーキシーケンス・試験場仕様機
// 根拠: docs/RESEARCH-v2.md TASK2(クロス式・比例推移・JEED 実測値)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CraneSimulator } from '../js/physics/simulator.js';
import { GEOM, CRANE, PHYS, PROFILES } from '../js/physics/params.js';

const g = PHYS.g;

function rigAttached(sim, L = 4) {
  sim.attached = true;
  sim.attachedLoadMass = sim.loadMass;
  sim.attachedCgOff = { x: 0, y: 0 };
  sim.L = L;
  sim._syncParams();
  const s = sim.s;
  const stR = (CRANE.mHook + sim.attachedLoadMass) * g / sim.p.kRope;
  const stC = sim.attachedLoadMass * g / sim.p.kChain;
  s[4] = s[0]; s[5] = s[2]; s[6] = GEOM.pivotH - L - stR;
  s[7] = s[8] = s[9] = 0;
  s[10] = s[0]; s[11] = s[2]; s[12] = s[6] - 2.0 - stC;
  s[13] = s[14] = s[15] = 0; s[16] = 0; s[17] = 0;
  sim._refreshAux();
}

test('過負荷防止装置: 定格 1.05 倍超で巻上のみ自動停止・巻下は可・警報表示', () => {
  const sim = new CraneSimulator({ loadMass: 3300 });   // 定格 2800 超
  rigAttached(sim, 4);
  for (let i = 0; i < 30; i++) sim.step(1 / 60);
  assert.ok(sim.overload, '過負荷ラッチ');
  const L0 = sim.L;
  sim.setLevers({ hoist: 5 });   // 巻上指令
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  assert.ok(sim.L >= L0 - 1e-6, `巻上が阻止されること (L ${L0} → ${sim.L})`);
  const rs = sim.getRenderState();
  assert.ok(rs.warnings.some(w => w.text.includes('過負荷防止')), '警報表示');
  assert.ok(rs.loadMeter > 3300, `荷重計表示 ${rs.loadMeter.toFixed(0)} kg`);
  sim.setLevers({ hoist: -3 });  // 巻下は許可される
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  assert.ok(sim.L > L0 + 0.05, '巻下は可能');
});

test('ブレーキシーケンス(インバータ): 始動遅れ~0.35s・停止後ブレーキ閉で保持', () => {
  const sim = new CraneSimulator({ loadMass: 2000 });
  rigAttached(sim, 4);
  assert.equal(sim.hoistBrake.state, 'set');
  sim.setLevers({ hoist: 5 });
  // 0.3 秒時点ではまだ動かない(トルク確立+開放)
  for (let i = 0; i < Math.round(0.3 * 60); i++) sim.step(1 / 60);
  assert.ok(Math.abs(sim.dL) < 1e-9, '始動遅れ中は繰出しゼロ');
  for (let i = 0; i < 60 * 2; i++) sim.step(1 / 60);
  assert.ok(sim.dL < -0.02, '開放後に巻上が始まる');
  const L1 = sim.L;
  sim.setLevers({ hoist: 0 });
  for (let i = 0; i < 60 * 2; i++) sim.step(1 / 60);
  assert.equal(sim.hoistBrake.state, 'set', '停止後にブレーキ閉');
  const L2 = sim.L;
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  assert.ok(Math.abs(sim.L - L2) < 1e-9, 'ブレーキ保持中は繰出し不変(ずり下がりなし)');
  assert.ok(L2 < L1 + 0.01, '停止時に大きく落ちない');
});

test('試験場仕様機: 走行 N1 定常速度 ≈ 79% 同期・N5 ≈ 99%(負荷依存の無調整駆動)', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.setProfile('exam');
  const vs = PROFILES.exam.travel.vSync;
  sim.setLevers({ travel: 1 });
  for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60);
  const v1 = sim.s[1];
  assert.ok(Math.abs(v1 - 0.791 * vs) / (0.791 * vs) < 0.05, `N1 ${v1.toFixed(3)} vs ${(0.791 * vs).toFixed(3)}`);
  sim.setLevers({ travel: 0 });
  // 惰行(コースト): 直ちには止まらない
  const vCoast0 = sim.s[1];
  for (let i = 0; i < 30; i++) sim.step(1 / 60);
  assert.ok(sim.s[1] > vCoast0 * 0.7, 'ノッチ0は惰行(急停止しない)');
  // 反対側から N5: コンタクタ順次投入(2.8 s)後に高速へ
  sim.s[0] = 24; sim.s[1] = 0; sim.s[4] = 24; sim.s[10] = 24;
  sim.setLevers({ travel: -5 });
  for (let i = 0; i < 60 * 9; i++) sim.step(1 / 60);
  const v5 = -sim.s[1];
  assert.ok(Math.abs(v5 - 0.991 * vs) / (0.991 * vs) < 0.04, `N5 ${v5.toFixed(3)} vs ${(0.991 * vs).toFixed(3)}`);
});

test('試験場仕様機: 巻上速度が荷で低下(N3 サグ)・重荷重 N1 は巻き上げ不能(実機挙動)', () => {
  // 軽荷重 1000 kg @N3
  const a = new CraneSimulator({ loadMass: 1000 });
  a.setProfile('exam');
  rigAttached(a, 5);
  a.setLevers({ hoist: 3 });
  for (let i = 0; i < 60 * 6; i++) a.step(1 / 60);
  const vLight = -a.dL;
  // 重荷重 4800 kg @N3
  const b = new CraneSimulator({ loadMass: 4800 });
  b.setProfile('exam');
  rigAttached(b, 5);
  b.setLevers({ hoist: 3 });
  for (let i = 0; i < 60 * 6; i++) b.step(1 / 60);
  const vHeavy = -b.dL;
  assert.ok(vLight > 0.2 * PROFILES.exam.hoist.vSync, `軽荷重で巻上 ${vLight.toFixed(3)}`);
  assert.ok(vHeavy < vLight * 0.9, `荷による速度低下 ${vLight.toFixed(3)} → ${vHeavy.toFixed(3)}`);
  // 重荷重 N1: τ > 停動トルク比 → 巻き上げられずずり下がる(FK 制御の実挙動)
  const c = new CraneSimulator({ loadMass: 4800 });
  c.setProfile('exam');
  rigAttached(c, 5);
  const L0 = c.L;
  c.setLevers({ hoist: 1 });
  for (let i = 0; i < 60 * 4; i++) c.step(1 / 60);
  assert.ok(c.L > L0 - 0.01, `N1 重荷重は上がらない (L ${L0} → ${c.L})`);
});

test('試験場仕様機: レバー0でトルクフリー窓のずり下がり後にブレーキ保持', () => {
  const sim = new CraneSimulator({ loadMass: 2000 });
  sim.setProfile('exam');
  rigAttached(sim, 4);
  sim.setLevers({ hoist: 2 });
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  sim.setLevers({ hoist: 0 });
  for (let i = 0; i < 60; i++) sim.step(1 / 60);
  assert.equal(sim.hoistBrake.state, 'set');
  const L1 = sim.L;
  for (let i = 0; i < 60 * 2; i++) sim.step(1 / 60);
  assert.ok(Math.abs(sim.L - L1) < 1e-9, 'ブレーキ閉後は保持');
});

test('試験場仕様機: 逆ノッチ(プラッギング)は惰行より速く減速する', () => {
  const mk = () => {
    const sim = new CraneSimulator({ loadMass: 1000 });
    sim.setProfile('exam');
    sim.setLevers({ travel: 5 });
    for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60);
    return sim;
  };
  const coast = mk();
  coast.setLevers({ travel: 0 });
  const plug = mk();
  plug.setLevers({ travel: -1 });
  for (let i = 0; i < 60 * 2; i++) { coast.step(1 / 60); plug.step(1 / 60); }
  assert.ok(plug.s[1] < coast.s[1] - 0.15,
    `プラッギング減速 ${plug.s[1].toFixed(3)} vs 惰行 ${coast.s[1].toFixed(3)}`);
});
