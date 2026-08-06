// 剛体拘束(伸びなしロープ)による天井クレーン厳密運動方程式 — 検証リファレンス
//
// ラグランジュ法(sympy による記号導出)とニュートン・オイラー+デカルト拘束法の
// 2 系統で独立に導出し、5000 のランダム状態で数値照合済み(開発ワークフロー参照)。
// ランタイムには js/physics/crane-model.js(弾性ロープ・デカルト形式)を用い、
// 本モデルはテスト (tests/cross-model.test.mjs) での軌道相互照合に使用する。
//
// 一般化座標 q = (X, Y, thx, thy)、ロープ長 L(t) は規定入力(レオノーマス拘束)。
// 吊荷位置: px = X + L·sin(thx)·cos(thy), py = Y + L·sin(thy),
//           pz = -L·cos(thx)·cos(thy)  (吊点基準・下向き負)
//
// s = {X, dX, Y, dY, thx, dthx, thy, dthy}
// u = {Fx, Fy, L, dL, ddL}
// p = {mb, mt, mp, g, cx, cy}
// 戻り値 {ddX, ddY, ddthx, ddthy, T}
export function rhsRigid(s, u, p) {
  const dX = s.dX, dY = s.dY, dthx = s.dthx, dthy = s.dthy;
  const Fx = u.Fx, Fy = u.Fy, L = u.L, dL = u.dL, ddL = u.ddL;
  const mb = p.mb, mt = p.mt, mp = p.mp, g = p.g;

  const sx = Math.sin(s.thx), cx = Math.cos(s.thx);
  const sy = Math.sin(s.thy), cy = Math.cos(s.thy);

  // M(q)·q̈ = f の右辺(コリオリ・遠心・重力・外力)
  const f0 = Fx - p.cx * dX + mp * (
      L * (dthx * dthx + dthy * dthy) * sx * cy
    + 2 * L * dthx * dthy * cx * sy
    - 2 * dL * dthx * cx * cy
    + 2 * dL * dthy * sx * sy
    - ddL * sx * cy);
  const f1 = Fy - p.cy * dY + mp * (
      L * dthy * dthy * sy
    - 2 * dL * dthy * cy
    - ddL * sy);
  const f2 = L * mp * cy * (2 * L * dthx * dthy * sy - 2 * dL * dthx * cy - g * sx);
  const f3 = -L * mp * (L * dthx * dthx * sy * cy + 2 * dL * dthy + g * cx * sy);

  // 質量行列(対称・M23 = 0)から θ 行を消去したシューア補元 2×2 を解く
  const A11 = mb + mt + mp * sx * sx * cy * cy;
  const A12 = mp * sx * sy * cy;
  const A22 = mt + mp * sy * sy;

  const b1 = f0 - (cx / (L * cy)) * f2 + (sx * sy / L) * f3;
  const b2 = f1 - (cy / L) * f3;

  const det = A11 * A22 - A12 * A12;
  const ddX = (b1 * A22 - b2 * A12) / det;
  const ddY = (b2 * A11 - b1 * A12) / det;

  const ddthx = (f2 - mp * L * cx * cy * ddX) / (mp * L * L * cy * cy);
  const ddthy = (f3 + mp * L * sx * sy * ddX - mp * L * cy * ddY) / (mp * L * L);

  // 張力: T = mp·(a_p + g·ez)·e_r
  const T = mp * (g * cx * cy + L * (dthx * dthx * cy * cy + dthy * dthy)
                  - ddL - ddX * sx * cy - ddY * sy);

  return { ddX, ddY, ddthx, ddthy, T };
}
