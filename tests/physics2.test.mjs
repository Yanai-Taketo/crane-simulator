// 物理コア v2(二質点+ヨー)の解析解照合テスト
// 根拠: docs/RESEARCH-v2.md「力学解析解」節、docs/PLAN-v2.md「Stage 1 設計改訂」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rhs2, totalEnergy2 } from '../js/physics/crane-model2.js';
import { makeRK4 } from '../js/physics/integrator.js';

const g = 9.80665;
const PIVOT = 7.9;
const R_TOP = 0.54 * Math.SQRT2;   // 荷上面隅の水平半径(1.08m 角)
const H_VERT = 1.55;               // フック→荷上面の鉛直高さ
const LEG_LEN = Math.hypot(H_VERT, R_TOP - 0.06);
const LEG_COS = H_VERT / LEG_LEN;

function params(over = {}) {
  const mLoad = over.mLoad ?? 1030;
  return {
    mb: 1e12, mt: 1e12, mHook: 30, mLoad, attached: true, g,
    cx: 0, cy: 0, kpX: 0, kpY: 0, FmaxX: 0, FmaxY: 0,
    pivotH: PIVOT,
    kRope: 3e6, cRope: 0,
    kChain: 6e6, cChain: 0, chainLen0: 2.0,
    hookEyeR: 0.06, rTop: R_TOP, hVert: H_VERT, legCos: LEG_COS,
    legSpanA: 1.08, legSpanB: 1.08,
    cgOffX: 0, cgOffY: 0,
    Iyaw: mLoad * (1.44 + 1.44) / 12, cYaw: 0,
    knL: 0, cnL: 0, knH: 0, cnH: 0, mu: 0,
    loadBottomOff: -1e9, hookBottomOff: -1e9, hookBlock: null,
    rhoAir: 0, CdALoad: 0, CdAHook: 0, cLin: 0, cLinHook: 0,
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
  s[10] = s[4] + 2.0 * Math.sin(th2);
  s[11] = s[5];
  s[12] = s[6] - 2.0 * Math.cos(th2);
  s[16] = yaw;
  return s;
}

function run(p, s, u, dur, h, sample) {
  const rk4 = makeRK4(18);
  const rhs = (t, st, out) => rhs2(t, st, u, p, out);
  const n = Math.round(dur / h);
  for (let i = 0; i < n; i++) { rk4(rhs, i * h, s, h); sample?.(i * h + h, s); }
}

function period(ts, xs) {
  const cr = [];
  for (let i = 1; i < xs.length; i++) if (xs[i - 1] < 0 && xs[i] >= 0) cr.push(ts[i]);
  assert.ok(cr.length >= 3, `ゼロクロス不足 ${cr.length}`);
  return (cr[cr.length - 1] - cr[0]) / (cr.length - 1);
}

// 二重振り子の閉形式固有値(調査文書の式)
function modes(m1, m2, L1, L2) {
  const M = m1 + m2, sum = L1 + L2;
  const disc = Math.sqrt(sum * sum - 4 * (m1 / M) * L1 * L2);
  return {
    lo: g * M / (2 * m1 * L1 * L2) * (sum - disc),
    hi: g * M / (2 * m1 * L1 * L2) * (sum + disc),
  };
}

test('v2: 二重振り子の低次固有周期が閉形式解と一致(±1%)', () => {
  const p = params();
  const { lo } = modes(p.mHook, p.mLoad, 4, 2);
  const Tth = 2 * Math.PI / Math.sqrt(lo);
  const th = 2 * Math.PI / 180;
  const s = makeState(p, 4.0035, th, th);
  const u = { ...U, L0: 4 };
  const ts = [], xs = [];
  run(p, s, u, 25, 1 / 2880, (t, st) => { if (ts.length === 0 || t - ts[ts.length - 1] > 0.004) { ts.push(t); xs.push(st[4] - st[0]); } });
  const T = period(ts, xs);
  assert.ok(Math.abs(T - Tth) / Tth < 0.01, `T=${T.toFixed(4)} vs 理論 ${Tth.toFixed(4)}`);
});

test('v2: 二重振り子の高次モード(フックフラッタ)周波数が閉形式解と一致(±3%)', () => {
  const p = params();
  const { hi } = modes(p.mHook, p.mLoad, 4, 2);
  const fth = Math.sqrt(hi) / (2 * Math.PI);
  const ratio = 4 * hi / (g - 2 * hi);   // Θ2/Θ1 = L1·ω²/(g − L2·ω²)
  const th1 = 0.5 * Math.PI / 180;
  const s = makeState(p, 4.0035, th1, th1 * ratio);
  const u = { ...U, L0: 4 };
  const ts = [], xs = [];
  run(p, s, u, 6, 1 / 2880, (t, st) => {
    if (ts.length === 0 || t - ts[ts.length - 1] > 0.002) {
      ts.push(t);
      // フックの荷に対する相対角で高次モードを観測
      xs.push((st[4] - st[0]) / 4 - (st[10] - st[4]) / 2);
    }
  });
  const T = period(ts, xs);
  const f = 1 / T;
  assert.ok(Math.abs(f - fth) / fth < 0.03, `f=${f.toFixed(3)} Hz vs 理論 ${fth.toFixed(3)}`);
});

test('v2: 四線振り子のねじれ周期 T=2π√(I/(Mgr₁r₂/h)) と一致(±2%)・質量不変', () => {
  let Tprev = null;
  for (const mLoad of [1000, 2000]) {
    const p = params({ mLoad });
    const k = mLoad * g * 0.06 * R_TOP / H_VERT;
    const I = mLoad * (1.44 + 1.44) / 12;
    const Tth = 2 * Math.PI * Math.sqrt(I / k);
    const s = makeState(p, 4 + (p.mHook + mLoad) * g / p.kRope, 0, 0, 5 * Math.PI / 180);
    s[12] -= mLoad * g / p.kChain;   // チェーン静的伸び分
    const u = { ...U, L0: 4 };
    const ts = [], xs = [];
    run(p, s, u, Math.min(30, 3.2 * Tth), 1 / 1440, (t, st) => { if (ts.length === 0 || t - ts[ts.length - 1] > 0.006) { ts.push(t); xs.push(st[16]); } });
    const T = period(ts, xs);
    assert.ok(Math.abs(T - Tth) / Tth < 0.02, `mLoad=${mLoad}: T=${T.toFixed(3)} vs 理論 ${Tth.toFixed(3)}`);
    if (Tprev !== null) assert.ok(Math.abs(T - Tprev) / Tprev < 0.02, 'ヨー周期は質量に依存しない');
    Tprev = T;
  }
});

test('v2: 偏心重心の脚別張力がてこ配分則と一致・重心はフック直下へ静定', () => {
  const e = 0.10;
  // 減衰は軽節点(フック 30kg)基準で設計 — 荷基準だと τ=m/c < h で数値固着する
  const p = params({
    cgOffX: e,
    cRope: 2 * 0.7 * Math.sqrt(3e6 * 30),
    cChain: 2 * 0.7 * Math.sqrt(6e6 * 30),
    cYaw: 300, cLin: 8,
  });
  const s = makeState(p, 4, 0, 0);
  const u = { ...U, L0: 4 };
  const aux = {};
  const rk4 = makeRK4(18);
  const rhs = (t, st, out) => rhs2(t, st, u, p, out);
  const h = 1 / 1440;
  for (let i = 0; i < Math.round(20 / h); i++) rk4(rhs, i * h, s, h);
  rhs2(0, s, u, p, new Float64Array(18), aux);
  const W = p.mLoad * g;
  // チェーン張力 = 荷重量(±1%)
  assert.ok(Math.abs(aux.Tc - W) / W < 0.01, `Tc=${aux.Tc.toFixed(0)} vs W=${W.toFixed(0)}`);
  // てこ配分則: 近い側(+x)ペアの鉛直分担 = W/2·(1+2e/a)
  const nearV = (aux.legT[2] + aux.legT[3]) * p.legCos;
  const farV = (aux.legT[0] + aux.legT[1]) * p.legCos;
  const nearTh = W / 2 * (1 + 2 * e / 1.08), farTh = W / 2 * (1 - 2 * e / 1.08);
  assert.ok(Math.abs(nearV - nearTh) / nearTh < 0.02, `近側 ${nearV.toFixed(0)} vs ${nearTh.toFixed(0)}`);
  assert.ok(Math.abs(farV - farTh) / farTh < 0.02, `遠側 ${farV.toFixed(0)} vs ${farTh.toFixed(0)}`);
  // 重心はフックのほぼ直下
  assert.ok(Math.hypot(s[10] - s[4], s[11] - s[5]) < 0.01, '重心がフック直下に静定');
});

test('v2: エネルギー保存(散逸なし・二重振り子スイング)相対ドリフト < 1e-6', () => {
  // 軽フック節点の高周波モードを十分に解像するため軟バネで検証
  // (剛性を上げた場合の打切り誤差は有界で成長しないことを別テストが担保)
  const p = params({ kRope: 4e5, kChain: 2e5 });
  const st1 = (p.mHook + p.mLoad) * g / p.kRope;
  const s = makeState(p, 4 + st1, 0.3, 0.22);
  s[12] -= p.mLoad * g / p.kChain;   // チェーン静的伸び分(弾性バウンスの励起を防ぐ)
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
  assert.ok(maxD < 1e-6, `エネルギードリフト ${maxD}`);
});

test('v2: v1 相当極限(フック質量→小)で単振り子周期に収斂', () => {
  // 軽フック節点の数値剛性を避けるため軟バネ+静的伸び込み実効長で評価
  const p = params({ mHook: 15, kRope: 6e5, kChain: 6e5 });
  const st1 = (p.mHook + p.mLoad) * g / p.kRope;   // ロープ静的伸び
  const st2 = p.mLoad * g / p.kChain;              // チェーン静的伸び
  const L1e = 4 + st1, L2e = 2 + st2;
  const { lo } = modes(p.mHook, p.mLoad, L1e, L2e);
  const Tclosed = 2 * Math.PI / Math.sqrt(lo);
  const Tsingle = 2 * Math.PI * Math.sqrt((L1e + L2e) / g);
  // 閉形式の低次モードは単振り子に 1% 以内で収斂しているはず
  assert.ok(Math.abs(Tclosed - Tsingle) / Tsingle < 0.01, `閉形式 ${Tclosed.toFixed(4)} vs 単振り子 ${Tsingle.toFixed(4)}`);
  const th = 1 * Math.PI / 180;
  const s = makeState(p, L1e, th, th);
  s[12] -= st2;
  const u = { ...U, L0: 4 };
  const ts = [], xs = [];
  run(p, s, u, 25, 1 / 2880, (t, st) => { if (ts.length === 0 || t - ts[ts.length - 1] > 0.004) { ts.push(t); xs.push(st[10] - st[0]); } });
  const T = period(ts, xs);
  assert.ok(Math.abs(T - Tclosed) / Tclosed < 0.01, `T=${T.toFixed(4)} vs 閉形式 ${Tclosed.toFixed(4)}`);
});
