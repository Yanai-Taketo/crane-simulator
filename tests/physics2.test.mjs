// 物理コア v2(二質点+ヨー)の解析解照合テスト
// 根拠: docs/RESEARCH-v2.md「力学解析解」節
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rhs2, totalEnergy2 } from '../js/physics/crane-model2.js';
import { makeRK4 } from '../js/physics/integrator.js';

const g = 9.80665;
const PIVOT = 7.9;

// 標準ジオメトリ: 荷 1.2m 角・スリング上端リング r1=0.06
function params(over = {}) {
  const corners = [[-0.54, -0.54], [-0.54, 0.54], [0.54, -0.54], [0.54, 0.54]];
  const topDirs = corners.map(([x, y]) => { const l = Math.hypot(x, y); return [x / l, y / l]; });
  const legLen0 = Math.hypot(1.55, 0.54 * Math.SQRT2 - 0.06); // 上端リング→隅
  const mLoad = over.mLoad ?? 1030;
  return {
    mb: 1e12, mt: 1e12, mHook: 30, mLoad, attached: true, g,
    cx: 0, cy: 0, kpX: 0, kpY: 0, FmaxX: 0, FmaxY: 0,
    pivotH: PIVOT,
    kRope: 3e6, cRope: 0, kLeg: 2e6, cLeg: 0,
    legLen0, corners, topDirs, hookEyeR: 0.06,
    cgOffX: 0, cgOffY: 0, topOffZ: 0.45,
    Iyaw: mLoad * (1.44 + 1.44) / 12, cYaw: 0,
    knL: 0, cnL: 0, knH: 0, cnH: 0, mu: 0,
    loadBottomOff: -1e9, hookBottomOff: -1e9, hookBlock: null,
    rhoAir: 0, CdALoad: 0, CdAHook: 0, cLin: 0,
    ...over,
  };
}

const U = { vcmdX: 0, vcmdY: 0, dL: 0, t0: 0, windX: 0, windY: 0 };

// 剛体連結を仮定した初期状態: 吊点から角度 th1 でフック、フックから th2 で荷
function makeState(p, L1, th1, th2, yaw = 0) {
  const s = new Float64Array(18);
  s[0] = 10; s[2] = 8;
  s[4] = s[0] + L1 * Math.sin(th1);
  s[5] = s[2];
  s[6] = PIVOT - L1 * Math.cos(th1);
  const L2 = 2.0; // フック→重心
  s[10] = s[4] + L2 * Math.sin(th2);
  s[11] = s[5];
  s[12] = s[6] - L2 * Math.cos(th2);
  s[16] = yaw;
  return s;
}

function run(p, s, u, dur, h, sample) {
  const rk4 = makeRK4(18);
  const rhs = (t, st, out) => rhs2(t, st, u, p, out);
  const n = Math.round(dur / h);
  for (let i = 0; i < n; i++) { rk4(rhs, i * h, s, h); sample?.(i * h + h, s); }
}

// 上昇ゼロクロス間隔から周期を求める
function period(ts, xs) {
  const cr = [];
  for (let i = 1; i < xs.length; i++) if (xs[i - 1] < 0 && xs[i] >= 0) cr.push(ts[i]);
  assert.ok(cr.length >= 3, `ゼロクロス不足 ${cr.length}`);
  return (cr[cr.length - 1] - cr[0]) / (cr.length - 1);
}

test('v2: 二重振り子の低次固有周期が閉形式解と一致(±1%)', () => {
  // L1=4, L2=2, m1=30, m2=1030 → ω²± 閉形式(調査文書)
  const p = params();
  const L1 = 4;
  const M = p.mHook + p.mLoad;
  const sum = L1 + 2;
  const disc = Math.sqrt(sum * sum - 4 * (p.mHook / M) * L1 * 2);
  const w2lo = g * M / (2 * p.mHook * L1 * 2) * (sum - disc);
  const Tth = 2 * Math.PI / Math.sqrt(w2lo);
  const th = 2 * Math.PI / 180;
  const s = makeState(p, L1 + 0.004, th, th);   // 静的伸び分をロープ長に上乗せ
  const u = { ...U, L0: L1 };
  const ts = [], xs = [];
  run(p, s, u, 25, 1 / 2880, (t, st) => { if (ts.length === 0 || t - ts[ts.length - 1] > 0.004) { ts.push(t); xs.push(st[4] - st[0]); } });
  const T = period(ts, xs);
  assert.ok(Math.abs(T - Tth) / Tth < 0.01, `T=${T.toFixed(4)} vs 理論 ${Tth.toFixed(4)}`);
});

test('v2: 二重振り子の高次モード(フックフラッタ)周波数が閉形式解と一致(±3%)', () => {
  const p = params();
  const L1 = 4;
  const M = p.mHook + p.mLoad;
  const sum = L1 + 2;
  const disc = Math.sqrt(sum * sum - 4 * (p.mHook / M) * L1 * 2);
  const w2hi = g * M / (2 * p.mHook * L1 * 2) * (sum + disc);
  const fth = Math.sqrt(w2hi) / (2 * Math.PI);
  // 高次モード形状 Θ2/Θ1 = L1·ω²/(g − L2·ω²) で初期化
  const ratio = L1 * w2hi / (g - 2 * w2hi);
  const th1 = 1 * Math.PI / 180;
  const s = makeState(p, L1 + 0.004, th1, th1 * ratio);
  const u = { ...U, L0: L1 };
  // フックの荷に対する相対角で高次モードを観測
  const ts = [], xs = [];
  run(p, s, u, 6, 1 / 2880, (t, st) => {
    if (ts.length === 0 || t - ts[ts.length - 1] > 0.002) {
      ts.push(t);
      xs.push((st[4] - st[0]) / (L1) - (st[10] - st[4]) / 2);
    }
  });
  const T = period(ts, xs);
  const f = 1 / T;
  assert.ok(Math.abs(f - fth) / fth < 0.03, `f=${f.toFixed(3)} Hz vs 理論 ${fth.toFixed(3)}`);
});

test('v2: 四線振り子のねじれ周期 T=2π√(I/(Mgr₁r₂/h)) と一致(±2%)・質量不変', () => {
  for (const mLoad of [1000, 2000]) {
    const p = params({ mLoad, kLeg: 4e6 });
    const r1 = 0.06, r2 = 0.54 * Math.SQRT2, h = 1.55;
    const k = mLoad * g * r1 * r2 / h;
    const I = mLoad * (1.44 + 1.44) / 12;
    const Tth = 2 * Math.PI * Math.sqrt(I / k);
    const s = makeState(p, 4 + (p.mHook + mLoad) * g / p.kRope, 0, 0, 5 * Math.PI / 180);
    const u = { ...U, L0: 4 };
    const ts = [], xs = [];
    run(p, s, u, Math.min(30, 3.2 * Tth), 1 / 1440, (t, st) => { if (ts.length === 0 || t - ts[ts.length - 1] > 0.006) { ts.push(t); xs.push(st[16]); } });
    const T = period(ts, xs);
    assert.ok(Math.abs(T - Tth) / Tth < 0.02, `mLoad=${mLoad}: T=${T.toFixed(3)} vs 理論 ${Tth.toFixed(3)}`);
  }
});

test('v2: 偏心重心の脚別張力がてこ配分則と一致・重心はフック直下へ(静定)', () => {
  const e = 0.10;
  const p = params({ cgOffX: e, cRope: 2 * 0.7 * Math.sqrt(3e6 * 30), cLeg: 2 * 0.7 * Math.sqrt(2e6 * 260), cYaw: 200, cLin: 5 });
  const s = makeState(p, 4, 0, 0);
  const u = { ...U, L0: 4 };
  const aux = {};
  const rk4 = makeRK4(18);
  const rhs = (t, st, out) => rhs2(t, st, u, p, out, aux);
  const h = 1 / 1440;
  for (let i = 0; i < Math.round(30 / h); i++) rk4(rhs, i * h, s, h);
  rhs2(0, s, u, p, new Float64Array(18), aux);
  const W = p.mLoad * g;
  // 垂直分担のてこ則: 近い側ペア W/2·(1+2e/a), a = 1.08(脚間隔)
  const near = aux.legT[2] + aux.legT[3];   // +x 側(重心が +x に偏る → 近い側)
  const far = aux.legT[0] + aux.legT[1];
  const legCos = 1.55 / p.legLen0;
  const nearV = near * legCos, farV = far * legCos;
  const nearTh = W / 2 * (1 + 2 * e / 1.08), farTh = W / 2 * (1 - 2 * e / 1.08);
  assert.ok(Math.abs(nearV - nearTh) / nearTh < 0.05, `近側 ${nearV.toFixed(0)} vs ${nearTh.toFixed(0)}`);
  assert.ok(Math.abs(farV - farTh) / farTh < 0.05, `遠側 ${farV.toFixed(0)} vs ${farTh.toFixed(0)}`);
  // 重心はフックのほぼ直下(数 mm)
  assert.ok(Math.hypot(s[10] - s[4], s[11] - s[5]) < 0.02, `重心-フック水平差 ${Math.hypot(s[10] - s[4], s[11] - s[5])}`);
  // 全脚張力の合計(鉛直成分)= 荷重量
  assert.ok(Math.abs((nearV + farV) - W) / W < 0.02, '鉛直合計 = W');
});

test('v2: エネルギー保存(散逸なし・振れ+ヨー同時)相対ドリフト < 2e-5', () => {
  const p = params();
  const s = makeState(p, 4.004, 0.3, 0.25, 0.2);
  s[1] = 0;
  const u = { ...U, L0: 4 };
  const E0 = totalEnergy2(s, 4, p);
  let maxD = 0;
  const rk4 = makeRK4(18);
  const rhs = (t, st, out) => rhs2(t, st, u, p, out);
  const h = 1 / 2880;
  for (let i = 0; i < Math.round(10 / h); i++) {
    rk4(rhs, i * h, s, h);
    const d = Math.abs(totalEnergy2(s, 4, p) - E0) / Math.abs(E0);
    if (d > maxD) maxD = d;
  }
  assert.ok(maxD < 2e-5, `エネルギードリフト ${maxD}`);
});
