// 天井クレーン運動モデル v2(二質点+ヨー: フック・吊荷を分離)
//
// 状態ベクトル s (18 要素):
//   [0] X   ブリッジ位置        [1] dX
//   [2] Y   トロリ位置          [3] dY
//   [4..6]  フック質点位置      [7..9]   フック速度
//   [10..12] 吊荷重心位置       [13..15] 吊荷速度
//   [16] ψ  吊荷ヨー角          [17] dψ
//
// 要素:
//  - ロープ(吊点→フック): 片側弾性 kR·δ + cR·δ'(T ≥ 0)。反力はトロリ/ブリッジへ
//  - スリング 4 本(フック→荷上面 4 隅): 各脚が片側弾性。脚別張力・ねじれ復元
//    トルク(四線振り子 k=Mgr₁r₂/h)・偏心時の張力再配分が幾何から自然に生じる
//  - 吊荷ヨー: I·ψ̈ = Σ(r×F)z − cψ·ψ̇
//  - 接地: 荷は床、フックは床+支持面(置き荷/吊り荷の上面)
//  - 空力抗力は荷・フック双方(荷が支配的)
//
// u: { vcmdX, vcmdY, L0, dL, t0, windX, windY }
// p: { mb, mt, mHook, mLoad, attached, g, cx, cy, kpX, kpY, FmaxX, FmaxY,
//      pivotH, kRope, cRope, kLeg, cLeg, legLen0, corners[4][2](荷ローカル水平),
//      cgOffX, cgOffY, topOffZ(重心→上面), Iyaw, cYaw,
//      knL, cnL, knH, cnH, mu, loadBottomOff, hookBottomOff,
//      hookBlock{ x,y,halfX,halfY,top }|null(フックの支持面),
//      rhoAir, CdALoad, CdAHook, cLin }
// aux: { T, legT[4], N, NHook, dist, stretch, yawTorque }

export function rhs2(t, s, u, p, out, aux = null) {
  const X = s[0], dX = s[1], Y = s[2], dY = s[3];
  const hx = s[4], hy = s[5], hz = s[6], hvx = s[7], hvy = s[8], hvz = s[9];
  const px = s[10], py = s[11], pz = s[12], pvx = s[13], pvy = s[14], pvz = s[15];
  const psi = s[16], dpsi = s[17];

  // ---- ロープ(吊点→フック・片側弾性) ----
  const rx = hx - X, ry = hy - Y, rz = hz - p.pivotH;
  const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const Leff = u.L0 + u.dL * (t - u.t0);
  const inv = dist > 1e-9 ? 1 / dist : 0;
  const ex = -rx * inv, ey = -ry * inv, ez = -rz * inv;
  const stretch = dist - Leff;
  let T = 0;
  if (stretch > 0 && dist > 1e-9) {
    const ddist = (rx * (hvx - dX) + ry * (hvy - dY) + rz * hvz) * inv;
    T = p.kRope * stretch + p.cRope * (ddist - u.dL);
    if (T < 0) T = 0;
  }

  // ---- 駆動力(現行どおり速度制御+飽和。試験場仕様は simulator 側で置換) ----
  let FdrvX = p.kpX * (u.vcmdX - dX);
  if (FdrvX > p.FmaxX) FdrvX = p.FmaxX; else if (FdrvX < -p.FmaxX) FdrvX = -p.FmaxX;
  let FdrvY = p.kpY * (u.vcmdY - dY);
  if (FdrvY > p.FmaxY) FdrvY = p.FmaxY; else if (FdrvY < -p.FmaxY) FdrvY = -p.FmaxY;

  // ---- スリング 4 脚(玉掛け時のみ) ----
  let Fsx = 0, Fsy = 0, Fsz = 0;     // フックが受ける脚反力の合力(荷側は逆符号)
  let tauZ = 0;
  const legT = aux ? (aux.legT || (aux.legT = [0, 0, 0, 0])) : null;
  if (p.attached) {
    const cs = Math.cos(psi), sn = Math.sin(psi);
    for (let i = 0; i < 4; i++) {
      // 取付隅(荷ローカル→ワールド): 幾何中心 = 重心 − cgOff を回転
      const lx = p.corners[i][0] - p.cgOffX;
      const ly = p.corners[i][1] - p.cgOffY;
      const cxw = px + lx * cs - ly * sn;
      const cyw = py + lx * sn + ly * cs;
      const czw = pz + p.topOffZ;
      // 脚上端はフックアイ(半径 hookEyeR のリング・世界方位固定)。
      // 点吊りではねじれ復元が生じないため有限半径が本質(四線振り子 k=Mgr₁r₂/h)
      const tx = hx + p.hookEyeR * p.topDirs[i][0];
      const ty = hy + p.hookEyeR * p.topDirs[i][1];
      const dxl = cxw - tx, dyl = cyw - ty, dzl = czw - hz;
      const ll = Math.sqrt(dxl * dxl + dyl * dyl + dzl * dzl);
      if (ll < 1e-9) continue;
      const st = ll - p.legLen0;
      if (st <= 0) { if (legT) legT[i] = 0; continue; }
      // 脚の伸び速度(隅の速度はヨー回転項を含む)
      const cvx = pvx + (-dpsi) * (lx * sn + ly * cs) * 1;      // d/dt(lx cs − ly sn)
      const cvy = pvy + dpsi * (lx * cs - ly * sn);
      const drate = ((dxl) * (cvx - hvx) + (dyl) * (cvy - hvy) + (dzl) * (pvz - hvz)) / ll;
      let F = p.kLeg * st + p.cLeg * drate;
      if (F < 0) F = 0;
      if (legT) legT[i] = F;
      const ux = dxl / ll, uy = dyl / ll, uz = dzl / ll;
      // フックは隅方向へ引かれ、荷は隅からフック方向へ引かれる
      Fsx += F * ux; Fsy += F * uy; Fsz += F * uz;
      // 荷へのヨートルク: r×F の z 成分(r = 隅 − 重心, F = フック向き)
      const rxl = cxw - px, ryl = cyw - py;
      tauZ += rxl * (-F * uy) - ryl * (-F * ux);
    }
  } else if (legT) { legT[0] = legT[1] = legT[2] = legT[3] = 0; }

  // ---- 接地(荷: 床 / フック: 床+支持面) ----
  let NL = 0, FfLx = 0, FfLy = 0;
  if (p.attached) {
    const zBot = pz - p.loadBottomOff;
    if (zBot < 0) {
      NL = -p.knL * zBot - p.cnL * pvz;
      if (NL < 0) NL = 0;
      const vh = Math.hypot(pvx, pvy);
      const Ff = p.mu * NL / (vh + 0.02);
      FfLx = -Ff * pvx; FfLy = -Ff * pvy;
    }
  }
  let NH = 0, FfHx = 0, FfHy = 0;
  {
    let gz = 0;
    const b = p.hookBlock;
    if (b && Math.abs(hx - b.x) < b.halfX && Math.abs(hy - b.y) < b.halfY) gz = b.top;
    const zBot = hz - p.hookBottomOff - gz;
    if (zBot < 0) {
      NH = -p.knH * zBot - p.cnH * hvz;
      if (NH < 0) NH = 0;
      const vh = Math.hypot(hvx, hvy);
      const Ff = p.mu * NH / (vh + 0.02);
      FfHx = -Ff * hvx; FfHy = -Ff * hvy;
    }
  }

  // ---- 空力(荷・フック) ----
  const lwx = pvx - u.windX, lwy = pvy - u.windY;
  const lw = Math.sqrt(lwx * lwx + lwy * lwy + pvz * pvz);
  const cdL = 0.5 * p.rhoAir * p.CdALoad * lw + p.cLin;
  const hwx = hvx - u.windX, hwy = hvy - u.windY;
  const hw = Math.sqrt(hwx * hwx + hwy * hwy + hvz * hvz);
  const cdH = 0.5 * p.rhoAir * p.CdAHook * hw + 0.2;

  // ---- 運動方程式 ----
  out[0] = dX;
  out[1] = (FdrvX - p.cx * dX - T * ex) / (p.mb + p.mt);
  out[2] = dY;
  out[3] = (FdrvY - p.cy * dY - T * ey) / p.mt;
  out[4] = hvx; out[5] = hvy; out[6] = hvz;
  out[7] = (T * ex + Fsx - cdH * hwx + FfHx) / p.mHook;
  out[8] = (T * ey + Fsy - cdH * hwy + FfHy) / p.mHook;
  out[9] = (T * ez + Fsz + NH - cdH * hvz) / p.mHook - p.g;
  if (p.attached) {
    out[10] = pvx; out[11] = pvy; out[12] = pvz;
    out[13] = (-Fsx - cdL * lwx + FfLx) / p.mLoad;
    out[14] = (-Fsy - cdL * lwy + FfLy) / p.mLoad;
    out[15] = (-Fsz + NL - cdL * pvz) / p.mLoad - p.g;
    out[16] = dpsi;
    out[17] = (tauZ - p.cYaw * dpsi) / p.Iyaw;
  } else {
    out[10] = 0; out[11] = 0; out[12] = 0;
    out[13] = 0; out[14] = 0; out[15] = 0;
    out[16] = 0; out[17] = 0;
  }

  if (aux) {
    aux.T = T; aux.N = NL; aux.NHook = NH;
    aux.dist = dist; aux.stretch = stretch; aux.yawTorque = tauZ;
    aux.FdrvX = FdrvX; aux.FdrvY = FdrvY;
    aux.ropeHx = T * ex; aux.ropeHy = T * ey;
  }
  return out;
}

// 全力学的エネルギー(検証用・散逸なし条件で保存)
export function totalEnergy2(s, Leff, p) {
  const ke = 0.5 * (p.mb + p.mt) * s[1] * s[1] + 0.5 * p.mt * s[3] * s[3]
    + 0.5 * p.mHook * (s[7] * s[7] + s[8] * s[8] + s[9] * s[9])
    + (p.attached ? 0.5 * p.mLoad * (s[13] * s[13] + s[14] * s[14] + s[15] * s[15])
      + 0.5 * p.Iyaw * s[17] * s[17] : 0);
  const rx = s[4] - s[0], ry = s[5] - s[2], rz = s[6] - p.pivotH;
  const st = Math.max(0, Math.sqrt(rx * rx + ry * ry + rz * rz) - Leff);
  let pe = p.mHook * p.g * s[6] + 0.5 * p.kRope * st * st;
  if (p.attached) {
    pe += p.mLoad * p.g * s[12];
    const cs = Math.cos(s[16]), sn = Math.sin(s[16]);
    for (let i = 0; i < 4; i++) {
      const lx = p.corners[i][0] - p.cgOffX, ly = p.corners[i][1] - p.cgOffY;
      const cxw = s[10] + lx * cs - ly * sn, cyw = s[11] + lx * sn + ly * cs, czw = s[12] + p.topOffZ;
      const tx = s[4] + p.hookEyeR * p.topDirs[i][0], ty = s[5] + p.hookEyeR * p.topDirs[i][1];
      const ll = Math.hypot(cxw - tx, cyw - ty, czw - s[6]);
      const stl = Math.max(0, ll - p.legLen0);
      pe += 0.5 * p.kLeg * stl * stl;
    }
  }
  return ke + pe;
}
