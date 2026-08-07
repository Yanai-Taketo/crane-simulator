// 天井クレーン運動モデル v2(二質点+ヨー: フック・吊荷を分離)
//
// 状態ベクトル s (18 要素):
//   [0] X   ブリッジ位置        [1] dX
//   [2] Y   トロリ位置          [3] dY
//   [4..6]  フック質点位置      [7..9]   フック速度
//   [10..12] 吊荷重心位置       [13..15] 吊荷速度
//   [16] ψ  吊荷ヨー角          [17] dψ
//
// 要素(docs/PLAN-v2.md「Stage 1 設計改訂」参照):
//  - ロープ(吊点→フック): 片側弾性 kR·δ + cR·δ'(T ≥ 0)。反力はトロリ/ブリッジへ
//  - スリングチェーン(フック→荷重心): 単一片側弾性リンク(自然長 chainLen0、
//    剛性 kChain = 4 脚合成)。二重振り子の閉形式解と照合可能
//  - 吊荷ヨー: I·ψ̈ = −k_yaw·ψ − cψ·ψ̇、k_yaw = Fc·r₁·r₂/h(四線振り子・
//    チェーン張力に比例、たるみで消失)。k=Mgr₁r₂/h の解析解と±2%一致を検証済み
//  - 脚別張力(表示・採点用): 偏心てこ配分則 F=(W/4)(1±2ex/a)(1±2ey/b) を
//    チェーン張力から準静的に算出(aux.legT)
//  - 接地: 荷は床、フックは床+支持面(置き荷/吊り荷の上面)
//
// u: { vcmdX, vcmdY, L0, dL, t0, windX, windY }
// p: { mb, mt, mHook, mLoad, attached, g, cx, cy, kpX, kpY, FmaxX, FmaxY,
//      pivotH, kRope, cRope, kChain, cChain, chainLen0,
//      hookEyeR, rTop, hVert, legCos, legSpanA, legSpanB, cgOffX, cgOffY,
//      Iyaw, cYaw, knL, cnL, knH, cnH, mu, loadBottomOff, hookBottomOff,
//      hookBlock{ x,y,halfX,halfY,top }|null, rhoAir, CdALoad, CdAHook, cLin }
// aux: { T, Tc, legT[4], N, NHook, dist, stretch, chainStretch }

// クロスの式による駆動力。drv = { vSync(符号付き・0=無通電), sm, Fb }
export function klossForce(drv, v) {
  if (!drv || drv.vSync === 0) return 0;
  const sl = (drv.vSync - v) / drv.vSync;
  if (Math.abs(sl) < 1e-9) return 0;
  return Math.sign(drv.vSync) * 2 * drv.Fb / (sl / drv.sm + drv.sm / sl);
}

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

  // ---- 駆動力 ----
  // inverter: 速度制御+推力飽和 / kloss(試験場仕様): トルク-すべり曲線
  // T(s) = 2·Tb/(s/sm + sm/s)。s はコンタクタ方向基準 → 逆ノッチ(プラッギング)
  // や巻下の回生制動が同一式から自然に生じる
  let FdrvX, FdrvY;
  if (p.klossX) {
    FdrvX = klossForce(p.klossX, dX) - (u.brakeX || 0) * Math.sign(dX);
    FdrvY = klossForce(p.klossY, dY) - (u.brakeY || 0) * Math.sign(dY);
  } else {
    FdrvX = p.kpX * (u.vcmdX - dX);
    if (FdrvX > p.FmaxX) FdrvX = p.FmaxX; else if (FdrvX < -p.FmaxX) FdrvX = -p.FmaxX;
    FdrvY = p.kpY * (u.vcmdY - dY);
    if (FdrvY > p.FmaxY) FdrvY = p.FmaxY; else if (FdrvY < -p.FmaxY) FdrvY = -p.FmaxY;
  }

  // ---- スリングチェーン(フック→荷重心・玉掛け時のみ) ----
  let Fcx = 0, Fcy = 0, Fcz = 0;   // フックが受ける力(荷側は逆符号)
  let Tc = 0;
  if (p.attached) {
    const cxv = px - hx, cyv = py - hy, czv = pz - hz;
    const cl = Math.sqrt(cxv * cxv + cyv * cyv + czv * czv);
    if (cl > 1e-9) {
      const cst = cl - p.chainLen0;
      if (cst > 0) {
        const crate = (cxv * (pvx - hvx) + cyv * (pvy - hvy) + czv * (pvz - hvz)) / cl;
        Tc = p.kChain * cst + p.cChain * crate;
        if (Tc < 0) Tc = 0;
        const ux = cxv / cl, uy = cyv / cl, uz = czv / cl;
        Fcx = Tc * ux; Fcy = Tc * uy; Fcz = Tc * uz;   // フックは荷方向へ引かれる
      }
    }
  }

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
  const cdH = 0.5 * p.rhoAir * p.CdAHook * hw + p.cLinHook;

  // ---- 運動方程式 ----
  out[0] = dX;
  out[1] = (FdrvX - p.cx * dX - T * ex) / (p.mb + p.mt);
  out[2] = dY;
  out[3] = (FdrvY - p.cy * dY - T * ey) / p.mt;
  out[4] = hvx; out[5] = hvy; out[6] = hvz;
  out[7] = (T * ex + Fcx - cdH * hwx + FfHx) / p.mHook;
  out[8] = (T * ey + Fcy - cdH * hwy + FfHy) / p.mHook;
  out[9] = (T * ez + Fcz + NH - cdH * hvz) / p.mHook - p.g;
  if (p.attached) {
    out[10] = pvx; out[11] = pvy; out[12] = pvz;
    out[13] = (-Fcx - cdL * lwx + FfLx) / p.mLoad;
    out[14] = (-Fcy - cdL * lwy + FfLy) / p.mLoad;
    out[15] = (-Fcz + NL - cdL * pvz) / p.mLoad - p.g;
    // ヨー: 四線振り子ねじれ復元(チェーン張力に比例・たるみで消失)
    const kYaw = Tc * p.hookEyeR * p.rTop / p.hVert;
    out[16] = dpsi;
    out[17] = (-kYaw * Math.sin(psi) - p.cYaw * dpsi) / p.Iyaw;
  } else {
    out[10] = 0; out[11] = 0; out[12] = 0;
    out[13] = 0; out[14] = 0; out[15] = 0;
    out[16] = 0; out[17] = 0;
  }

  if (aux) {
    aux.T = T; aux.Tc = Tc; aux.N = NL; aux.NHook = NH;
    aux.dist = dist; aux.stretch = stretch;
    aux.FdrvX = FdrvX; aux.FdrvY = FdrvY;
    aux.ropeHx = T * ex; aux.ropeHy = T * ey;
    // 脚別張力(準静的てこ配分則): W = チェーン張力の鉛直成分相当
    const legT = aux.legT || (aux.legT = [0, 0, 0, 0]);
    if (p.attached && Tc > 0) {
      const fx = 2 * p.cgOffX / p.legSpanA, fy = 2 * p.cgOffY / p.legSpanB;
      // 隅順序: [−x−y, −x+y, +x−y, +x+y]
      legT[0] = Math.max(0, Tc / 4 * (1 - fx) * (1 - fy)) / p.legCos;
      legT[1] = Math.max(0, Tc / 4 * (1 - fx) * (1 + fy)) / p.legCos;
      legT[2] = Math.max(0, Tc / 4 * (1 + fx) * (1 - fy)) / p.legCos;
      legT[3] = Math.max(0, Tc / 4 * (1 + fx) * (1 + fy)) / p.legCos;
    } else {
      legT[0] = legT[1] = legT[2] = legT[3] = 0;
    }
  }
  return out;
}

// 全力学的エネルギー(検証用: ヨー励起なし・散逸なし条件で保存)
// ※ ヨー剛性は張力比例(準静的近似)のため、ヨー励起時は厳密保存しない
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
    const cl = Math.hypot(s[10] - s[4], s[11] - s[5], s[12] - s[6]);
    const cst = Math.max(0, cl - p.chainLen0);
    pe += 0.5 * p.kChain * cst * cst;
  }
  return ke + pe;
}
