// モデル相互照合テスト:
// ランタイムの「デカルト座標・弾性ロープ」モデルと、独立導出された
// 「一般化座標・剛体拘束」リファレンスモデル(rigid-model.js)を
// 同一条件で積分し、吊荷軌道が一致することを検証する。
// ロープ剛性を実機より高くとれば弾性モデルは剛体拘束の特異摂動として
// 収束するため、軌道差はミリメートルオーダーに収まるはずである。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rhsCartesian } from '../js/physics/crane-model.js';
import { rhsRigid } from '../js/physics/rigid-model.js';
import { makeRK4 } from '../js/physics/integrator.js';

const g = 9.80665;
const PIVOT_H = 7.9;

function integrateRigid(q0, uc, p, tEnd, h) {
  // q = [X, dX, Y, dY, thx, dthx, thy, dthy]
  const q = Float64Array.from(q0);
  const rk4 = makeRK4(8);
  const rhs = (t, s, out) => {
    const r = rhsRigid(
      { X: s[0], dX: s[1], Y: s[2], dY: s[3], thx: s[4], dthx: s[5], thy: s[6], dthy: s[7] },
      { Fx: uc.Fx, Fy: uc.Fy, L: uc.L + uc.dL * t, dL: uc.dL, ddL: 0 },
      p);
    out[0] = s[1]; out[1] = r.ddX;
    out[2] = s[3]; out[3] = r.ddY;
    out[4] = s[5]; out[5] = r.ddthx;
    out[6] = s[7]; out[7] = r.ddthy;
  };
  const n = Math.round(tEnd / h);
  const traj = [];
  for (let i = 0; i < n; i++) {
    rk4(rhs, i * h, q, h);
    if (i % 24 === 23) {
      const L = uc.L + uc.dL * (i + 1) * h;
      traj.push([
        q[0] + L * Math.sin(q[4]) * Math.cos(q[6]),
        q[2] + L * Math.sin(q[6]),
        PIVOT_H - L * Math.cos(q[4]) * Math.cos(q[6]),
      ]);
    }
  }
  return traj;
}

function integrateCartesian(q0, uc, p, tEnd, h) {
  // 剛体モデルと同じ初期条件をデカルト状態へ写像(伸びゼロ・静止)
  const [X, dX, Y, dY, thx, , thy] = [q0[0], q0[1], q0[2], q0[3], q0[4], q0[5], q0[6]];
  const s = new Float64Array(10);
  s[0] = X; s[1] = dX; s[2] = Y; s[3] = dY;
  const sx = Math.sin(thx), cx = Math.cos(thx);
  const sy = Math.sin(thy), cy = Math.cos(thy);
  s[4] = X + uc.L * sx * cy;
  s[5] = Y + uc.L * sy;
  s[6] = PIVOT_H - uc.L * cx * cy;
  // 角速度ゼロでも巻上げ中 (dL≠0) はロープ方向の半径方向速度を持つ:
  // v_p = v_pivot + dL·û(û = 吊点→吊荷 単位ベクトル)
  s[7] = dX + uc.dL * sx * cy;
  s[8] = dY + uc.dL * sy;
  s[9] = -uc.dL * cx * cy;
  const rk4 = makeRK4(10);
  const u = { vcmdX: 0, vcmdY: 0, L0: uc.L, dL: uc.dL, t0: 0, windX: 0, windY: 0 };
  const rhs = (t, st, out) => rhsCartesian(t, st, u, p, out);
  const n = Math.round(tEnd / h);
  const traj = [];
  for (let i = 0; i < n; i++) {
    rk4(rhs, i * h, s, h);
    if (i % 24 === 23) traj.push([s[4], s[5], s[6]]);
  }
  return traj;
}

test('剛体拘束リファレンスと弾性デカルトモデルの軌道一致(自由振動・実機質量比)', () => {
  const mp = 2030, mb = 2100, mt = 450;
  const L = 5.0;
  const h = 1 / 2880;
  const tEnd = 10;
  const pRigid = { mb, mt, mp, g, cx: 0, cy: 0 };
  const kRope = 1e8;   // 剛体拘束の極限として高剛性・無減衰
  const pCart = {
    mb, mt, mp, g, cx: 0, cy: 0, kpX: 0, kpY: 0, FmaxX: 0, FmaxY: 0,
    pivotH: PIVOT_H, kRope, cRope: 0,
    kn: 0, cn: 0, mu: 0, bottomOff: -1e9,
    rhoAir: 0, CdA: 0, cLin: 0, rig: 0,
  };
  const q0 = [10, 0, 8, 0, 0.35, 0, 0.22, 0];
  const uc = { Fx: 0, Fy: 0, L, dL: 0 };

  const ta = integrateRigid(q0, uc, pRigid, tEnd, h);
  const tb = integrateCartesian(q0, uc, pCart, tEnd, h);
  assert.equal(ta.length, tb.length);
  let maxErr = 0;
  for (let i = 0; i < ta.length; i++) {
    const e = Math.hypot(ta[i][0] - tb[i][0], ta[i][1] - tb[i][1], ta[i][2] - tb[i][2]);
    if (e > maxErr) maxErr = e;
  }
  // 弾性による半径方向微小振動(≈ mp·g/kRope ≈ 0.2 mm)を考慮し 5 mm を許容
  assert.ok(maxErr < 0.005, `軌道最大差 ${maxErr} m`);
});

test('剛体拘束リファレンスと弾性デカルトモデルの軌道一致(巻上げ中・ブリッジ初速あり)', () => {
  const mp = 1030, mb = 2100, mt = 450;
  const L = 6.0;
  const h = 1 / 2880;
  const tEnd = 8;
  const pRigid = { mb, mt, mp, g, cx: 0, cy: 0 };
  const pCart = {
    mb, mt, mp, g, cx: 0, cy: 0, kpX: 0, kpY: 0, FmaxX: 0, FmaxY: 0,
    pivotH: PIVOT_H, kRope: 1e8, cRope: 0,
    kn: 0, cn: 0, mu: 0, bottomOff: -1e9,
    rhoAir: 0, CdA: 0, cLin: 0, rig: 0,
  };
  const q0 = [10, 0.3, 8, -0.15, 0.25, 0, -0.15, 0];
  const uc = { Fx: 0, Fy: 0, L, dL: -0.12 };   // 巻上げながら振れる(パラメトリック)

  const ta = integrateRigid(q0, uc, pRigid, tEnd, h);
  const tb = integrateCartesian(q0, uc, pCart, tEnd, h);
  let maxErr = 0;
  for (let i = 0; i < ta.length; i++) {
    const e = Math.hypot(ta[i][0] - tb[i][0], ta[i][1] - tb[i][1], ta[i][2] - tb[i][2]);
    if (e > maxErr) maxErr = e;
  }
  assert.ok(maxErr < 0.005, `軌道最大差 ${maxErr} m`);
});
