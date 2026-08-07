// 物理コアの検証テスト(node --test で実行)
// 解析解との比較・保存則・モード遷移の頑健性を検証する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rhsCartesian, totalEnergy } from '../js/physics/crane-model.js';
import { makeRK4 } from '../js/physics/integrator.js';
import { CraneSimulator } from '../js/physics/simulator.js';
import { GEOM, CRANE, PHYS, NOTCH } from '../js/physics/params.js';

const g = PHYS.g;

// 散逸・駆動なしの理想パラメータ(保存則検証用)
function idealParams(over = {}) {
  return {
    mb: 7000, mt: 900, mp: 1080, g,
    cx: 0, cy: 0, kpX: 0, kpY: 0, FmaxX: 0, FmaxY: 0,
    pivotH: GEOM.pivotH,
    kRope: 4.0e6, cRope: 0,
    kn: 2.0e7, cn: 0, mu: 0,
    bottomOff: -1e9,          // 接触無効
    rhoAir: 0, CdA: 0, cLin: 0,
    rig: 0,
    ...over,
  };
}

function freeze(u) { return { vcmdX: 0, vcmdY: 0, windX: 0, windY: 0, t0: 0, dL: 0, ...u }; }

// 初期状態: 吊点直下からの角度 th で静止スタート
function stateAtAngle(p, Leff, thx, thy = 0) {
  const s = new Float64Array(10);
  s[0] = 10; s[2] = 8;
  s[4] = s[0] + Leff * Math.sin(thx) * Math.cos(thy);
  s[5] = s[2] + Leff * Math.sin(thy);
  s[6] = p.pivotH - Leff * Math.cos(thx) * Math.cos(thy);
  return s;
}

test('静的釣り合い: 張力 T = mp·g、加速度ゼロ', () => {
  const p = idealParams();
  const Leff = 5;
  const st = Leff + p.mp * g / p.kRope;   // 自重による伸びを含めた釣り合い長
  const s = stateAtAngle(p, st, 0);
  const out = new Float64Array(10);
  const aux = {};
  rhsCartesian(0, s, freeze({ L0: Leff }), p, out, aux);
  assert.ok(Math.abs(aux.T - p.mp * g) / (p.mp * g) < 1e-12, `T=${aux.T} vs mg=${p.mp * g}`);
  for (let i = 0; i < 10; i++) assert.ok(Math.abs(out[i]) < 1e-9, `deriv[${i}]=${out[i]}`);
});

test('たるみ状態では張力ゼロ', () => {
  const p = idealParams();
  const s = stateAtAngle(p, 3.0, 0.2);
  const out = new Float64Array(10);
  const aux = {};
  rhsCartesian(0, s, freeze({ L0: 5.0 }), p, out, aux);   // 実距離 3 < 自然長 5
  assert.equal(aux.T, 0);
  assert.ok(Math.abs(out[7]) < 1e-12 && Math.abs(out[9] + g) < 1e-12, '自由落下になること');
});

test('エネルギー保存: 散逸なし大振幅スイング 20 秒で相対ドリフト < 1e-7', () => {
  const p = idealParams();
  const Leff = 6;
  const s = stateAtAngle(p, Leff, 0.5, 0.3);
  const u = freeze({ L0: Leff });
  const rk4 = makeRK4(10);
  const h = PHYS.dt;
  const E0 = totalEnergy(s, Leff, p);
  const rhs = (t, st, out) => rhsCartesian(t, st, u, p, out);
  let maxDrift = 0;
  for (let i = 0; i < Math.round(20 / h); i++) {
    rk4(rhs, i * h, s, h);
    const drift = Math.abs(totalEnergy(s, Leff, p) - E0) / Math.abs(E0);
    if (drift > maxDrift) maxDrift = drift;
  }
  assert.ok(maxDrift < 1e-7, `エネルギードリフト ${maxDrift}`);
});

test('水平運動量保存: 駆動・摩擦なしで (mb+mt)dX + mp·vx と mt·dY + mp·vy が不変', () => {
  const p = idealParams();
  const Leff = 6;
  const s = stateAtAngle(p, Leff, 0.4, -0.25);
  s[1] = 0.3; s[3] = -0.2; // 初速を与える
  const u = freeze({ L0: Leff });
  const rk4 = makeRK4(10);
  const h = PHYS.dt;
  const Px0 = (p.mb + p.mt) * s[1] + p.mp * s[7];
  const Py0 = p.mt * s[3] + p.mp * s[8];
  const rhs = (t, st, out) => rhsCartesian(t, st, u, p, out);
  for (let i = 0; i < Math.round(15 / h); i++) rk4(rhs, i * h, s, h);
  const Px = (p.mb + p.mt) * s[1] + p.mp * s[7];
  const Py = p.mt * s[3] + p.mp * s[8];
  assert.ok(Math.abs(Px - Px0) < 1e-6, `Px ${Px0} → ${Px}`);
  assert.ok(Math.abs(Py - Py0) < 1e-6, `Py ${Py0} → ${Py}`);
});

test('微小振幅の周期 ≈ 2π√(L/g) (0.3% 以内)', () => {
  // ブリッジを事実上固定(超大質量)して純粋な振り子として測定
  const p = idealParams({ mb: 1e12, mt: 1e12, kRope: 4e7 });
  const Leff = 6;
  const st = Leff + p.mp * g / p.kRope;
  const s = stateAtAngle(p, st, 0.01);
  const u = freeze({ L0: Leff });
  const rk4 = makeRK4(10);
  const h = PHYS.dt;
  const rhs = (t, st_, out) => rhsCartesian(t, st_, u, p, out);
  // x 方向変位のゼロクロスから周期を測定(2 回目の上昇ゼロクロスまで)
  const x0 = s[0];
  let prev = s[4] - x0, crossings = [];
  for (let i = 0; i < Math.round(15 / h); i++) {
    rk4(rhs, i * h, s, h);
    const cur = s[4] - x0;
    if (prev < 0 && cur >= 0) crossings.push((i + 1) * h);
    prev = cur;
  }
  assert.ok(crossings.length >= 2, 'ゼロクロス不足');
  const T = crossings[1] - crossings[0];
  const Tth = 2 * Math.PI * Math.sqrt(st / g);
  assert.ok(Math.abs(T - Tth) / Tth < 0.003, `T=${T} vs ${Tth}`);
});

test('球面振り子: 鉛直軸まわり角運動量の保存', () => {
  const p = idealParams({ mb: 1e12, mt: 1e12 });
  const Leff = 6;
  const s = stateAtAngle(p, Leff, 0.4);
  s[8] = 0.8;  // 接線方向初速 → 円錐振り子的運動
  const u = freeze({ L0: Leff });
  const rk4 = makeRK4(10);
  const h = PHYS.dt;
  const rhs = (t, st_, out) => rhsCartesian(t, st_, u, p, out);
  const lz = () => {
    const rx = s[4] - s[0], ry = s[5] - s[2];
    return p.mp * (rx * s[8] - ry * s[7]);
  };
  const L0 = lz();
  for (let i = 0; i < Math.round(15 / h); i++) rk4(rhs, i * h, s, h);
  assert.ok(Math.abs(lz() - L0) / Math.abs(L0) < 1e-8, `Lz ${L0} → ${lz()}`);
});

test('巻上の仕事収支: dE = ∫T·(−dL̇)dt (0.5% 以内)', () => {
  const p = idealParams();
  const Leff0 = 7;
  const s = stateAtAngle(p, Leff0, 0.25);
  const rk4 = makeRK4(10);
  const h = PHYS.dt;
  const dL = -0.1;   // 巻上(自然長を縮める)
  const out = new Float64Array(10);
  const aux = {};
  let W = 0;
  let t = 0;
  const dur = 10;
  for (let i = 0; i < Math.round(dur / h); i++) {
    const u = freeze({ L0: Leff0 + dL * t, dL, t0: t });
    // 台形則で仕事 W = ∫ T·(−dL) dt を数値積分
    rhsCartesian(t, s, u, p, out, aux);
    const T1 = aux.T;
    rk4((tt, st_, o) => rhsCartesian(tt, st_, u, p, o), t, s, h);
    t += h;
    rhsCartesian(t, s, freeze({ L0: Leff0 + dL * t, dL, t0: t }), p, out, aux);
    W += 0.5 * (T1 + aux.T) * (-dL) * h;
  }
  const E0 = totalEnergy(stateAtAngle(p, Leff0, 0.25), Leff0, p);
  const E1 = totalEnergy(s, Leff0 + dL * dur, p);
  const err = Math.abs((E1 - E0) - W) / Math.abs(W);
  assert.ok(err < 0.005, `dE=${E1 - E0} W=${W} 相対誤差=${err}`);
});

test('たるみ→張り遷移: 落下からの再張架で発散しない', () => {
  const p = idealParams({ cRope: 2 * 0.15 * Math.sqrt(4e6 * 1080) });
  const Leff = 5;
  const s = stateAtAngle(p, 2.0, 0);   // 自然長より 3 m 上(たるみ)から自由落下
  const u = freeze({ L0: Leff });
  const rk4 = makeRK4(10);
  const h = PHYS.dt;
  const rhs = (t, st_, out) => rhsCartesian(t, st_, u, p, out);
  let maxT = 0;
  const aux = {};
  const out = new Float64Array(10);
  for (let i = 0; i < Math.round(8 / h); i++) {
    rk4(rhs, i * h, s, h);
    rhsCartesian(i * h, s, u, p, out, aux);
    maxT = Math.max(maxT, aux.T);
    for (let k = 0; k < 10; k++) assert.ok(Number.isFinite(s[k]), 'NaN/Inf 発生');
  }
  // 減衰後はほぼ静止・張力は自重近傍に収束していること
  const speed = Math.hypot(s[7], s[8], s[9]);
  assert.ok(speed < 0.5, `残留速度 ${speed}`);
  assert.ok(maxT > p.mp * g, '衝撃張力が自重を上回ること(スナップ荷重)');
  assert.ok(aux.T > 0.5 * p.mp * g && aux.T < 2 * p.mp * g, `最終張力 ${aux.T}`);
});

test('シミュレータ統合: 玉掛け→巻上→地切り→着床→玉外し', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.placeLoad(8, 8);   // ブリッジ・トロリの初期位置直下
  // フックを玉掛け高さまで巻下げ
  sim.setCommand({ travel: 0, traverse: 0, hoist: -1, step: 2 });
  let guard = 0;
  while (sim.s[6] - GEOM.hookHalf > GEOM.load.sz + GEOM.slingLen - 0.2 && guard++ < 12000) sim.step(1 / 60);
  sim.setCommand({ travel: 0, traverse: 0, hoist: 0, step: 1 });
  for (let i = 0; i < 60; i++) sim.step(1 / 60);
  const r1 = sim.tryToggleHook();
  assert.ok(r1.ok, `玉掛け失敗: ${r1.msg}`);

  // 巻上げ → 地切り
  sim.setCommand({ travel: 0, traverse: 0, hoist: 1, step: 1 });
  guard = 0;
  while (sim.getRenderState().loadOnGround && guard++ < 30000) sim.step(1 / 60);
  assert.ok(guard < 30000, '地切りできない');
  const rs = sim.getRenderState();
  assert.ok(rs.T > 900 * PHYS.g * 0.9, `吊上げ時張力 ${rs.T}`);

  // 少し吊り上げてから着床
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
  sim.setCommand({ travel: 0, traverse: 0, hoist: -1, step: 1 });
  guard = 0;
  while (!sim.getRenderState().loadOnGround && guard++ < 30000) sim.step(1 / 60);
  assert.ok(guard < 30000, '着床できない');
  sim.setCommand({ travel: 0, traverse: 0, hoist: -1, step: 1 });
  for (let i = 0; i < 90; i++) sim.step(1 / 60);   // ロープを緩める
  sim.setCommand({ travel: 0, traverse: 0, hoist: 0, step: 1 });
  for (let i = 0; i < 60; i++) sim.step(1 / 60);
  const r2 = sim.tryToggleHook();
  assert.ok(r2.ok, `玉外し失敗: ${r2.msg}`);
  assert.ok(!sim.getRenderState().loadAttached);
});

test('シミュレータ統合: 走行指令で定格速度に到達し停止後に振れが残る', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.placeLoad(8, 8);
  // 玉掛け状態を直接構成(吊荷を吊点直下に吊持)
  sim.attached = true;
  sim._syncParams();
  sim.L = 4;
  sim.s[4] = sim.s[0]; sim.s[5] = sim.s[2];
  sim.s[6] = GEOM.pivotH - (sim.L + sim.p.rig) - sim.p.mp * PHYS.g / sim.p.kRope;
  sim.s[7] = sim.s[8] = sim.s[9] = 0;

  sim.setCommand({ travel: 1, traverse: 0, hoist: 0, step: 2 });
  for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60);
  const v = sim.getRenderState().speeds.travel;
  assert.ok(Math.abs(v - CRANE.travelSpeed[1]) < 0.03, `走行速度 ${v} vs ${CRANE.travelSpeed[1]}`);

  sim.setCommand({ travel: 0, traverse: 0, hoist: 0, step: 1 });
  for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60);
  const rs = sim.getRenderState();
  assert.ok(Math.abs(rs.speeds.travel) < 0.02, 'ブリッジが停止すること');
  assert.ok(rs.sway.amp > 0.05, `急停止後に荷振れが残ること (amp=${rs.sway.amp})`);
  for (let i = 0; i < 10; i++) { sim.step(1 / 60); assert.ok(Number.isFinite(sim.energy())); }
});

test('ファズ: ランダム操作 120 秒で NaN・発散なし', () => {
  const sim = new CraneSimulator({ loadMass: 2000 });
  sim.setWind(4);
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let f = 0; f < 60 * 120; f++) {
    if (f % 45 === 0) {
      sim.setCommand({
        travel: Math.floor(rand() * 3) - 1,
        traverse: Math.floor(rand() * 3) - 1,
        hoist: Math.floor(rand() * 3) - 1,
        step: rand() > 0.5 ? 2 : 1,
      });
    }
    if (f === 1800) sim.estop();
    if (f % 600 === 0 && !sim.attached) sim.tryToggleHook();
    sim.step(1 / 60);
    if (f % 60 === 0) {
      const rs = sim.getRenderState();
      assert.ok(Number.isFinite(rs.T) && Number.isFinite(rs.hookPos.z), `frame ${f} で非有限値`);
      assert.ok(rs.hookPos.z > -1 && rs.hookPos.z < GEOM.pivotH + 1, `フック高さ異常 ${rs.hookPos.z}`);
      assert.ok(rs.sway.amp < 8, `振れ発散 ${rs.sway.amp}`);
    }
  }
});

test('回帰: 玉掛け許容高さ内でも初期伸びが生じる場合は拒否(吊荷射出防止)', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.placeLoad(8, 8);
  // フック下端を 2.3 m(旧許容窓の上半分 = ロープ予伸張 0.3 m 相当)に配置
  sim.L = GEOM.pivotH - (2.3 + GEOM.hookHalf);
  sim.s[4] = 8; sim.s[5] = 8; sim.s[6] = 2.3 + GEOM.hookHalf;
  sim.s[7] = sim.s[8] = sim.s[9] = 0;
  sim._refreshAux();
  const r = sim.tryToggleHook();
  assert.ok(!r.ok, '予伸張状態の玉掛けは拒否されること');
  assert.ok(r.msg.includes('高すぎ'), r.msg);
  // 適正高さ(スリング丈より低く・ロープたるみ側)では成功すること
  sim.L = GEOM.pivotH - (1.95 + GEOM.hookHalf);
  sim.s[6] = 1.95 + GEOM.hookHalf;
  sim._refreshAux();
  const r2 = sim.tryToggleHook();
  assert.ok(r2.ok, `適正高さで玉掛けできること: ${r2.msg}`);
  // 結合直後に張力が跳ねないこと(1 秒運転して確認)
  sim.setCommand({ travel: 0, traverse: 0, hoist: 0, step: 1 });
  let maxT = 0;
  for (let i = 0; i < 60; i++) { sim.step(1 / 60); maxT = Math.max(maxT, sim.aux.T); }
  assert.ok(maxT < 2000, `結合直後の張力スパイク ${maxT} N`);
});

test('回帰: 非常停止は操作ボタンを離すまで復帰せず勝手に再走行しない', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.setCommand({ travel: 1, traverse: 0, hoist: 0, step: 2 });
  for (let i = 0; i < 60 * 5; i++) sim.step(1 / 60);
  assert.ok(Math.abs(sim.s[1]) > 0.3, '走行中であること');
  sim.estop();
  // ボタンは押しっぱなしのまま 6 秒経過
  for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60);
  assert.ok(sim.estopActive, '押下中は非常停止が保持されること');
  assert.ok(Math.abs(sim.s[1]) < 0.02, '停止していること');
  // ボタンを離すと復帰し、以後は通常運転できる
  sim.setCommand({ travel: 0, traverse: 0, hoist: 0, step: 1 });
  for (let i = 0; i < 60 * 2; i++) sim.step(1 / 60);
  assert.ok(!sim.estopActive, '全ボタン解放後に復帰すること');
});

test('運転室レバー: 各ノッチが規定の速度基準に到達し、位置を保持する', () => {

  const sim = new CraneSimulator({ loadMass: 1000 });
  for (let n = 1; n <= NOTCH.count; n++) {
    sim.setLevers({ travel: n, traverse: 0, hoist: 0 });
    for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60);
    const expected = NOTCH.fractions[n] * CRANE.travelSpeed[1];
    const v = sim.getRenderState().speeds.travel;
    assert.ok(Math.abs(v - expected) < 0.03, `ノッチ${n}: ${v} vs ${expected}`);
  }
  // レバーはディテント保持: 入力を触らず 5 秒経過しても速度を維持
  const vBefore = sim.getRenderState().speeds.travel;
  for (let i = 0; i < 60 * 5; i++) sim.step(1 / 60);
  const vAfter = sim.getRenderState().speeds.travel;
  assert.ok(Math.abs(vAfter - vBefore) < 0.02, `保持失敗 ${vBefore} → ${vAfter}`);
  sim.setLevers({ travel: 0 });
  for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60);
  assert.ok(Math.abs(sim.getRenderState().speeds.travel) < 0.02, 'ノッチ0で停止');
});

test('運転室レバー: ゼロノッチインターロック(レバー投入のままでは非常停止が復帰しない)', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.setLevers({ travel: 5, traverse: 0, hoist: 0 });
  for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60);
  sim.estop();
  for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60);
  assert.ok(sim.estopActive, 'レバー投入中は復帰しないこと');
  assert.ok(Math.abs(sim.s[1]) < 0.02, '停止していること');
  sim.setLevers({ travel: 0, traverse: 0, hoist: 0 });
  for (let i = 0; i < 60 * 2; i++) sim.step(1 / 60);
  assert.ok(!sim.estopActive, '全レバー中立で復帰すること');
  // 復帰後は再度運転できる
  sim.setLevers({ travel: 2 });
  for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60);
  assert.ok(sim.getRenderState().speeds.travel > 0.05, '復帰後の再運転');
});

test('運転室レバー: 巻上ノッチと軽負荷高速・巻下でロープが繰り出される', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  const L0 = sim.L;
  sim.setLevers({ hoist: -3 });   // 巻下
  for (let i = 0; i < 60 * 4; i++) sim.step(1 / 60);
  assert.ok(sim.L > L0 + 0.05, `巻下で L 増加: ${L0} → ${sim.L}`);
  sim.setLevers({ hoist: 5 });    // 巻上全速(フック+1000kg < 定格50% → 軽負荷高速)
  for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60);
  const v = sim.getRenderState().speeds.hoist;
  assert.ok(Math.abs(v - CRANE.hoistSpeedLight) < 0.02, `軽負荷高速 ${v} vs ${CRANE.hoistSpeedLight}`);
});

test('回帰: モード切替でゼロノッチインターロックを迂回できない', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.setLevers({ travel: 5, traverse: 0, hoist: 0 });
  for (let i = 0; i < 60 * 5; i++) sim.step(1 / 60);
  sim.estop();
  for (let i = 0; i < 60 * 5; i++) sim.step(1 / 60);
  assert.ok(sim.estopActive, 'レバー投入中は復帰しない');
  // ペンダントへ切替(指令は中立)でも、レバーが投入されたままなら復帰しない
  sim.setCommand({ travel: 0, traverse: 0, hoist: 0, step: 1 });
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  assert.ok(sim.estopActive, 'モード切替では迂回できないこと');
  sim.setLevers({ travel: 0, traverse: 0, hoist: 0 });
  sim.setCommand({ travel: 0, traverse: 0, hoist: 0, step: 1 });
  for (let i = 0; i < 60 * 2; i++) sim.step(1 / 60);
  assert.ok(!sim.estopActive, '全系統中立で復帰');
});

test('回帰: 非有限ノッチ入力で NaN 汚染しない', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.setLevers({ travel: NaN, traverse: Infinity, hoist: undefined });
  assert.deepEqual(sim.notches, { travel: 0, traverse: 0, hoist: 0 });
  sim.setLevers({ travel: 2 });
  sim.setLevers({ traverse: 'abc' });
  assert.equal(sim.notches.travel, 2);
  assert.equal(sim.notches.traverse, 0);
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
  assert.ok(Number.isFinite(sim.energy()), 'エネルギーが有限');
});

test('回帰: 軽負荷倍速は最上段ノッチのみ(中間ノッチは通常速度基準)', () => {
  const sim = new CraneSimulator({ loadMass: 500 });   // 軽負荷(定格50%未満)
  sim.setLevers({ hoist: -3 });   // まず巻下で余裕を作る
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  sim.setLevers({ hoist: 3 });    // 中間ノッチ巻上
  for (let i = 0; i < 60 * 5; i++) sim.step(1 / 60);
  const vMid = sim.getRenderState().speeds.hoist;
  const expectMid = 0.5 * CRANE.hoistSpeed[1];   // 50% × 通常最高速(増速なし)
  assert.ok(Math.abs(vMid - expectMid) < 0.01, `N3 軽負荷 ${vMid} vs ${expectMid}`);
  sim.setLevers({ hoist: -5 });   // 最上段は軽負荷倍速が効く
  for (let i = 0; i < 60 * 5; i++) sim.step(1 / 60);
  const vTop = Math.abs(sim.getRenderState().speeds.hoist);
  assert.ok(Math.abs(vTop - CRANE.hoistSpeedLight) < 0.015, `N5 軽負荷 ${vTop} vs ${CRANE.hoistSpeedLight}`);
});

test('回帰: 横行南端はキャブ保護リミットで停止する', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.setLevers({ traverse: 5 });   // 南進(+y)
  for (let i = 0; i < 60 * 40; i++) sim.step(1 / 60);
  assert.ok(sim.s[2] <= CRANE.traverseMax + 1e-9, `Y=${sim.s[2]}`);
  assert.ok(Math.abs(CRANE.traverseMax - 13.0) < 1e-9, 'キャブ保護リミット 13.0 m');
});

test('描画状態: 着床後の繰出しでフックが降下し荷上面に静置、ロープたるみ量が増加', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.placeLoad(8, 8);
  // 玉掛け状態を直接構成し、着床させる
  sim.attached = true;
  sim.attachedLoadMass = 1000;
  sim._syncParams();
  sim.L = 5.0;
  sim.s[4] = 8; sim.s[5] = 8;
  sim.s[6] = GEOM.load.sz / 2 - (sim.p.mp * PHYS.g) / sim.p.kn;
  sim.s[7] = sim.s[8] = sim.s[9] = 0;
  sim._refreshAux();

  // 繰り出し(巻下)を続ける
  sim.setLevers({ hoist: -5 });
  let prevHookZ = Infinity;
  let sawDescent = false;
  const restZ = GEOM.load.sz + GEOM.hookHalf;   // 静置フック中心高さ ≈ 1.35
  let guard = 0;
  while (sim.L < CRANE.ropeMax - 0.05 && guard++ < 20000) {
    sim.step(1 / 60);
    const rs = sim.getRenderState();
    if (rs.hookPos.z < prevHookZ - 1e-4) sawDescent = true;
    prevHookZ = rs.hookPos.z;
  }
  const rs = sim.getRenderState();
  assert.ok(sawDescent, '繰出し中にフックが降下すること');
  assert.ok(Math.abs(rs.hookPos.z - restZ) < 0.12, `フックが荷上面に静置 (z=${rs.hookPos.z} vs ${restZ})`);
  assert.ok(rs.hookResting, 'hookResting フラグ');
  assert.ok(rs.ropeSag > 0.3, `ロープたるみ量が明確に可視 (${rs.ropeSag} m)`);
  assert.ok(rs.T < 10, `たるみ時の表示張力はほぼ零 (${rs.T} N)`);

  // 巻上げると: たるみ解消 → フック吊持(張力≈フック自重)→ 吊上げ張力
  sim.setLevers({ hoist: 5 });
  guard = 0;
  let sawHookWeight = false;
  while (sim.getRenderState().loadOnGround && guard++ < 30000) {
    sim.step(1 / 60);
    const r = sim.getRenderState();
    if (!r.hookResting && r.slack && Math.abs(r.T - 30 * PHYS.g) < 1) sawHookWeight = true;
  }
  assert.ok(sawHookWeight, 'フック吊持区間で表示張力がフック自重になること');
  assert.ok(guard < 30000, '再吊上げで地切りできること');
  const r2 = sim.getRenderState();
  assert.ok(r2.ropeSag === 0, `吊上げ後はたるみ零 (${r2.ropeSag})`);
  assert.ok(r2.T > 900 * PHYS.g, `吊上げ張力 (${r2.T})`);
});

test('描画状態: フック単独の巻下は下限リミットで停止しロープは張ったまま', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.setLevers({ hoist: -5 });
  let guard = 0;
  while (sim.L < CRANE.ropeMax - 0.001 && guard++ < 30000) sim.step(1 / 60);
  sim.setLevers({ hoist: 0 });
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
  const rs = sim.getRenderState();
  // 下限リミット(巻下過巻防止)によりフックは床のわずか上で停止、ロープは張ったまま
  assert.ok(Math.abs(sim.L - CRANE.ropeMax) < 1e-6, `L が下限リミットで停止 (${sim.L})`);
  const bottom = rs.hookPos.z - GEOM.hookHalf;
  assert.ok(bottom > 0 && bottom < 0.15, `フック下端は床のわずか上 (${bottom} m)`);
  assert.equal(rs.ropeSag, 0, 'ロープは張ったまま(たるみなし)');
  assert.ok(rs.T > 25 * PHYS.g && rs.T < 40 * PHYS.g, `張力 ≈ フック自重 (${rs.T} N)`);
});

test('回帰: たるみ静置状態で玉外ししてもフックは荷の上に留まる(瞬間移動・貫通なし)', () => {
  const sim = new CraneSimulator({ loadMass: 1000 });
  sim.placeLoad(8, 8);
  sim.attached = true;
  sim.attachedLoadMass = 1000;
  sim._syncParams();
  sim.L = 5.0;
  sim.s[4] = 8; sim.s[5] = 8;
  sim.s[6] = GEOM.load.sz / 2 - (sim.p.mp * PHYS.g) / sim.p.kn;
  sim.s[7] = sim.s[8] = sim.s[9] = 0;
  sim._refreshAux();
  // 全繰出し → フック静置
  sim.setLevers({ hoist: -5 });
  let guard = 0;
  while (sim.L < CRANE.ropeMax - 0.001 && guard++ < 20000) sim.step(1 / 60);
  sim.setLevers({ hoist: 0 });
  for (let i = 0; i < 60; i++) sim.step(1 / 60);
  const before = sim.getRenderState().hookPos;
  assert.ok(sim.getRenderState().hookResting, '前提: フック静置');

  const r = sim.tryToggleHook();
  assert.ok(r.ok, `玉外し: ${r.msg}`);
  const after = sim.getRenderState().hookPos;
  const jump = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
  assert.ok(jump < 0.05, `玉外し時のフック位置跳び ${jump} m`);

  // 2 秒静定後もフックは荷の上(荷上面 0.9 + フック半高 0.45 ≈ 1.35)に留まる
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
  const settled = sim.getRenderState().hookPos;
  assert.ok(Math.abs(settled.z - (GEOM.load.sz + GEOM.hookHalf)) < 0.08,
    `フックが荷の上に静置され続ける (z=${settled.z})`);
  // 荷の内部 (z < 0.9) に沈まないこと
  assert.ok(settled.z - GEOM.hookHalf > GEOM.load.sz - 0.05, '荷を貫通しないこと');

  // 巻上げれば(たるみ 0.85 m を巻き取った後)持ち上がる
  sim.setLevers({ hoist: 5 });
  for (let i = 0; i < 60 * 12; i++) sim.step(1 / 60);
  assert.ok(sim.getRenderState().hookPos.z > 2.2, `巻上でフックが上昇 (z=${sim.getRenderState().hookPos.z})`);
});
