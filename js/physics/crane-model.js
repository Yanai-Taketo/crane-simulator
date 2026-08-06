// 天井クレーンの運動モデル(デカルト座標・完全ニュートン形式)
//
// 状態ベクトル s (10 要素):
//   [0] X   ブリッジ位置 (走行)      [1] dX  ブリッジ速度
//   [2] Y   トロリ位置 (横行)        [3] dY  トロリ速度
//   [4] px  吊り質点 x               [5] py  吊り質点 y
//   [6] pz  吊り質点 z               [7] vx  [8] vy  [9] vz
//
// 吊り質点 = 吊具+吊荷(玉掛け時)の合成質量中心。
// ワイヤロープは「片側弾性要素」: 自然長 Leff より伸びた時のみ
// 張力 T = kR·δ + cR·δ' (T ≥ 0) を発生する。kR は実ロープの EA と
// 掛数から求めた物理剛性(simulator.js で算出)。これにより
// たるみ・地切り・着床・横引きが単一の連続モデルで表現される。
//
// 運動方程式:
//   (mb+mt)·ddX = FdrvX − cx·dX − T·ex      (トロリはブリッジに x 方向拘束)
//   mt·ddY      = FdrvY − cy·dY − T·ey      (y 反力はレールが受ける)
//   mp·dv       = T·e − mp·g·ez + F接触 + F空力
//   e = (吊点 − 質点)/|吊点 − 質点|
//
// u (入力): { vcmdX, vcmdY, L0, dL, t0, windX, windY }
//   Leff(t) = L0 + dL·(t − t0)  (ウインチは速度制御・逆駆動不能)

export function rhsCartesian(t, s, u, p, out, aux = null) {
  const X = s[0], dX = s[1], Y = s[2], dY = s[3];
  const px = s[4], py = s[5], pz = s[6];
  const vx = s[7], vy = s[8], vz = s[9];

  // 吊点(トロリ下面シーブ)
  const rx = px - X, ry = py - Y, rz = pz - p.pivotH;
  const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const Leff = u.L0 + u.dL * (t - u.t0);
  const inv = dist > 1e-9 ? 1 / dist : 0;
  const ex = -rx * inv, ey = -ry * inv, ez = -rz * inv; // 質点→吊点 単位ベクトル

  // 張力(片側弾性: 伸びた時のみ)
  const stretch = dist - Leff;
  let T = 0;
  if (stretch > 0 && dist > 1e-9) {
    const relvx = vx - dX, relvy = vy - dY;             // 吊点は z 不動
    const ddist = (rx * relvx + ry * relvy + rz * vz) * inv;
    T = p.kRope * stretch + p.cRope * (ddist - u.dL);
    if (T < 0) T = 0;
  }

  // 駆動力(インバータ速度制御 + 推力飽和)
  let FdrvX = p.kpX * (u.vcmdX - dX);
  if (FdrvX > p.FmaxX) FdrvX = p.FmaxX; else if (FdrvX < -p.FmaxX) FdrvX = -p.FmaxX;
  let FdrvY = p.kpY * (u.vcmdY - dY);
  if (FdrvY > p.FmaxY) FdrvY = p.FmaxY; else if (FdrvY < -p.FmaxY) FdrvY = -p.FmaxY;

  // 地面接触(ペナルティ法: 反発ほぼ零・正則化クーロン摩擦)
  let Nz = 0, Ffx = 0, Ffy = 0;
  const zBot = pz - p.bottomOff;
  if (zBot < 0) {
    Nz = -p.kn * zBot - p.cn * vz;
    if (Nz < 0) Nz = 0;
    const vh = Math.hypot(vx, vy);
    const Ff = p.mu * Nz / (vh + 0.02);
    Ffx = -Ff * vx; Ffy = -Ff * vy;
  }

  // 空力抗力(風との相対速度・二次抗力 + 微小線形項)
  const wx = vx - u.windX, wy = vy - u.windY, wz = vz;
  const wmag = Math.sqrt(wx * wx + wy * wy + wz * wz);
  const cd = 0.5 * p.rhoAir * p.CdA * wmag + p.cLin;
  const Fdx = -cd * wx, Fdy = -cd * wy, Fdz = -cd * wz;

  out[0] = dX;
  out[1] = (FdrvX - p.cx * dX - T * ex) / (p.mb + p.mt);
  out[2] = dY;
  out[3] = (FdrvY - p.cy * dY - T * ey) / p.mt;
  out[4] = vx;
  out[5] = vy;
  out[6] = vz;
  out[7] = (T * ex + Fdx + Ffx) / p.mp;
  out[8] = (T * ey + Fdy + Ffy) / p.mp;
  out[9] = (T * ez + Fdz + Nz) / p.mp - p.g;

  if (aux) {
    aux.T = T; aux.N = Nz; aux.dist = dist; aux.stretch = stretch;
    aux.FdrvX = FdrvX; aux.FdrvY = FdrvY;
    aux.ropeHx = T * ex; aux.ropeHy = T * ey;
  }
  return out;
}

// 全力学的エネルギー(検証用):
// KE = ½mb·dX² + ½mt·(dX²+dY²) + ½mp·|v|²  (トロリは x, y 両方向に運動)
// PE = mp·g·pz + ½kR·δ²  (伸び δ のロープ弾性エネルギー)
export function totalEnergy(s, Leff, p) {
  const X = s[0], dX = s[1], Y = s[2], dY = s[3];
  const px = s[4], py = s[5], pz = s[6];
  const vx = s[7], vy = s[8], vz = s[9];
  const ke = 0.5 * (p.mb + p.mt) * dX * dX + 0.5 * p.mt * dY * dY
           + 0.5 * p.mp * (vx * vx + vy * vy + vz * vz);
  const rx = px - X, ry = py - Y, rz = pz - p.pivotH;
  const st = Math.max(0, Math.sqrt(rx * rx + ry * ry + rz * rz) - Leff);
  return ke + p.mp * p.g * pz + 0.5 * p.kRope * st * st;
}
