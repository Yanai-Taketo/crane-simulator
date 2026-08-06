// クレーンシミュレータ本体: 駆動指令・ウインチ・玉掛け・接触・警報を統括
import { rhsCartesian, totalEnergy } from './crane-model.js';
import { makeRK4 } from './integrator.js';
import { GEOM, CRANE, PHYS } from './params.js';

// ワイヤロープ実効軸剛性 [N]: JIS G 3525 6×Fi(29) φ12 の金属断面積 ≈ 70 mm²,
// E ≈ 100 GPa → EA ≈ 7.0e6 N。2 本掛け(掛数2)のフック剛性 k = n·EA/L。
const EA_EFF = 2 * 7.0e6;

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

export class CraneSimulator {
  constructor(opts = {}) {
    this.rk4 = makeRK4(10);
    this.s = new Float64Array(10);
    this.deriv = new Float64Array(10);
    this.aux = { T: 0, N: 0, dist: 0, stretch: 0, FdrvX: 0, FdrvY: 0, ropeHx: 0, ropeHy: 0 };
    this.loadMass = opts.loadMass ?? 1000;
    this.reset();
    this._rs = null; // getRenderState 用キャッシュ
  }

  reset() {
    this.time = 0;
    this.acc = 0;
    this.L = 4.0;                 // ウインチ繰出し長(吊点→フック中心)
    this.dL = 0;
    this.attached = false;
    this.estopActive = false;
    this.windMean = 0;
    this.gust = { x: 0, y: 0 };
    this.cmd = { travel: 0, traverse: 0, hoist: 0, step: 1 };
    this.vcmdX = 0; this.vcmdY = 0;
    this.loadStatic = { x: 6, y: 4, yaw: 0 };  // 玉掛けされていない吊荷(置かれている)
    const s = this.s;
    s.fill(0);
    s[0] = 8; s[2] = 8;                        // ブリッジ・トロリ初期位置
    s[4] = s[0]; s[5] = s[2];
    s[6] = GEOM.pivotH - this.L;               // フックはロープ下端に吊持
    this._syncParams();
  }

  // 現在の吊り体(フックのみ / フック+吊荷)に応じた物理パラメータ
  _syncParams() {
    const mp = this.attached ? CRANE.mHook + this.loadMass : CRANE.mHook;
    const rig = this.attached ? GEOM.hookHalf + GEOM.slingLen + GEOM.load.sz / 2 : 0;
    const h = PHYS.dt;
    const wCap = 0.45 / h;                     // 数値安定のための最大角周波数
    const kRopeRaw = EA_EFF / Math.max(0.8, this.L + rig);
    const kRope = Math.min(kRopeRaw, mp * wCap * wCap);
    const knRaw = 2.0e7;
    const kn = Math.min(knRaw, mp * wCap * wCap);
    this.p = {
      mb: CRANE.mb, mt: CRANE.mt, mp,
      g: PHYS.g,
      cx: CRANE.travelFriction, cy: CRANE.traverseFriction,
      kpX: CRANE.velGainTravel, kpY: CRANE.velGainTraverse,
      FmaxX: this.estopActive ? CRANE.travelForceMax * 2 : CRANE.travelForceMax,
      FmaxY: this.estopActive ? CRANE.traverseForceMax * 2 : CRANE.traverseForceMax,
      pivotH: GEOM.pivotH,
      kRope, cRope: 2 * 0.15 * Math.sqrt(kRope * mp),
      kn, cn: 2 * 0.9 * Math.sqrt(kn * mp),
      mu: PHYS.muGround,
      // 質点から吊り体底面までの距離(玉掛け時 = 吊荷重心→吊荷底面)
      bottomOff: this.attached ? GEOM.load.sz / 2 : GEOM.hookHalf,
      rhoAir: PHYS.rhoAir,
      CdA: this.attached ? PHYS.dragCdA : 0.15,
      cLin: 0.6,
      rig,
    };
  }

  // 状態を直接書き換えた後に補助量(張力・接地反力)を再評価する
  _refreshAux() {
    const u = {
      vcmdX: this.vcmdX, vcmdY: this.vcmdY,
      L0: this.L + this.p.rig, dL: this.dL, t0: this.time,
      windX: 0, windY: 0,
    };
    rhsCartesian(this.time, this.s, u, this.p, this.deriv, this.aux);
  }

  setCommand(cmd) { this.cmd = cmd; }
  setLoadMass(kg) {
    this.loadMass = kg;
    if (this.attached) this._syncParams();
  }
  setWind(v) { this.windMean = v; }

  estop() {
    this.estopActive = true;
    this._syncParams();
  }

  placeLoad(x, y) {
    if (this.attached) return;
    this.loadStatic = { x, y, yaw: 0 };
  }

  // 玉掛け / 玉外し
  tryToggleHook() {
    const s = this.s;
    if (this.attached) {
      // 玉外し: 吊荷が接地しほぼ静止していること
      const grounded = this.aux.N > 0 || (s[6] - this.p.bottomOff) < 0.01;
      const speed = Math.hypot(s[7], s[8], s[9]);
      if (!grounded) return { ok: false, attached: true, msg: '吊荷が接地していません。着床させてから外してください' };
      if (speed > 0.15) return { ok: false, attached: true, msg: '吊荷が動いています。静止させてから外してください' };
      // 吊荷を置き、フックを玉掛け前の位置(スリング上端相当)へ
      this.loadStatic = { x: s[4], y: s[5], yaw: 0 };
      const rig = this.p.rig;
      const rx = s[0] - s[4], ry = s[2] - s[5], rz = GEOM.pivotH - s[6];
      const d = Math.hypot(rx, ry, rz) || 1;
      s[4] += (rx / d) * rig; s[5] += (ry / d) * rig; s[6] += (rz / d) * rig;
      s[7] = 0; s[8] = 0; s[9] = 0;
      this.attached = false;
      this._syncParams();
      this._refreshAux();
      return { ok: true, attached: false, msg: '玉外し完了' };
    }
    // 玉掛け: フック(=質点)が吊荷のスリング上端付近にあること
    const lt = this.loadStatic;
    const loadTop = GEOM.load.sz;
    const horiz = Math.hypot(s[4] - lt.x, s[5] - lt.y);
    const hookBottom = s[6] - GEOM.hookHalf;
    if (horiz > 0.6) return { ok: false, attached: false, msg: 'フックが吊荷の真上にありません(水平ずれ ' + horiz.toFixed(2) + ' m)' };
    if (hookBottom > loadTop + GEOM.slingLen + 0.5) return { ok: false, attached: false, msg: 'フックが高すぎます。巻下げてください' };
    if (hookBottom < loadTop - 0.35) return { ok: false, attached: false, msg: 'フックが低すぎます。少し巻上げてください' };
    // 質点を吊荷重心へ移す(接地状態で結合)
    s[4] = lt.x; s[5] = lt.y;
    s[7] = 0; s[8] = 0; s[9] = 0;
    this.attached = true;
    this._syncParams();
    // ペナルティ接触の静的平衡貫入量だけ沈めて N = mp·g で釣り合わせる
    s[6] = GEOM.load.sz / 2 - (this.p.mp * PHYS.g) / this.p.kn;
    this._refreshAux();
    return { ok: true, attached: true, msg: '玉掛け完了(質量 ' + this.loadMass + ' kg)' };
  }

  // 1 フレーム分進める(内部で固定刻みサブステップ)
  step(frameDt) {
    this.acc += frameDt;
    const h = PHYS.dt;
    let n = Math.floor(this.acc / h);
    if (n > 60) n = 60;                  // タブ復帰時などのスパイラル防止
    this.acc -= n * h;
    for (let i = 0; i < n; i++) this._substep(h);
  }

  _substep(h) {
    const s = this.s;

    // --- 指令速度のランプ(台形加減速) ---
    const es = this.estopActive;
    const tgtX = es ? 0 : this.cmd.travel * CRANE.travelSpeed[this.cmd.step - 1];
    const tgtY = es ? 0 : this.cmd.traverse * CRANE.traverseSpeed[this.cmd.step - 1];
    const aX = CRANE.travelSpeed[1] / CRANE.travelRamp * (es ? 2.5 : 1);
    const aY = CRANE.traverseSpeed[1] / CRANE.traverseRamp * (es ? 2.5 : 1);
    this.vcmdX = clamp(tgtX, this.vcmdX - aX * h, this.vcmdX + aX * h);
    this.vcmdY = clamp(tgtY, this.vcmdY - aY * h, this.vcmdY + aY * h);

    // --- ウインチ(巻上 = L 減少)。逆駆動不能・速度制御 ---
    // インバータホイストの軽負荷高速: 吊り上げ質量が定格の 50% 未満なら 2 速が増速
    const hoistHigh = (this.p.mp < CRANE.ratedLoad * 0.5) ? CRANE.hoistSpeedLight : CRANE.hoistSpeed[1];
    const hoistSpd = this.cmd.step === 2 ? hoistHigh : CRANE.hoistSpeed[0];
    const tgtL = es ? 0 : -this.cmd.hoist * hoistSpd;
    const aL = CRANE.hoistSpeed[1] / CRANE.hoistRamp * (es ? 3 : 1);
    this.dL = clamp(tgtL, this.dL - aL * h, this.dL + aL * h);
    if ((this.L <= CRANE.ropeMin && this.dL < 0) || (this.L >= CRANE.ropeMax && this.dL > 0)) this.dL = 0;

    // --- 突風(オルンシュタイン=ウーレンベック過程) ---
    if (this.windMean > 0) {
      const tau = 3.5, sigma = this.windMean * 0.35;
      const q = Math.sqrt(2 * sigma * sigma / tau * h);
      this.gust.x += (-this.gust.x / tau) * h + q * gauss();
      this.gust.y += (-this.gust.y / tau) * h + q * gauss();
    } else { this.gust.x = 0; this.gust.y = 0; }

    // --- RK4 積分 ---
    this._syncParams();
    const u = {
      vcmdX: this.vcmdX, vcmdY: this.vcmdY,
      L0: this.L + this.p.rig, dL: this.dL, t0: this.time,
      windX: this.windMean * 0.94 + this.gust.x,
      windY: this.windMean * 0.34 + this.gust.y,
    };
    const p = this.p;
    this.rk4((t, st, out) => rhsCartesian(t, st, u, p, out), this.time, s, h);
    this.L = clamp(this.L + this.dL * h, CRANE.ropeMin, CRANE.ropeMax);
    this.time += h;

    // --- 終端ストッパ(緩衝器) ---
    if (s[0] < CRANE.travelMin) { s[0] = CRANE.travelMin; if (s[1] < 0) s[1] = 0; }
    if (s[0] > CRANE.travelMax) { s[0] = CRANE.travelMax; if (s[1] > 0) s[1] = 0; }
    if (s[2] < CRANE.traverseMin) { s[2] = CRANE.traverseMin; if (s[3] < 0) s[3] = 0; }
    if (s[2] > CRANE.traverseMax) { s[2] = CRANE.traverseMax; if (s[3] > 0) s[3] = 0; }

    // --- 補助量の再評価と静止摩擦(スティクション) ---
    const u2 = { ...u, L0: this.L + this.p.rig, t0: this.time };
    rhsCartesian(this.time, s, u2, p, this.deriv, this.aux);
    if (this.aux.N > 0) {
      const vh = Math.hypot(s[7], s[8]);
      const Fh = Math.hypot(this.aux.ropeHx, this.aux.ropeHy);
      if (vh < 0.02 && Fh < 1.22 * p.mu * this.aux.N) { s[7] = 0; s[8] = 0; }
    }

    // --- 非常停止の自動復帰(全軸停止後) ---
    if (es && Math.abs(s[1]) < 0.005 && Math.abs(s[3]) < 0.005 &&
        Math.abs(this.dL) < 0.002 && this.vcmdX === 0 && this.vcmdY === 0) {
      this.estopActive = false;
      this._syncParams();
    }
  }

  energy() { return totalEnergy(this.s, this.L + this.p.rig, this.p); }

  getRenderState() {
    const s = this.s;
    const pivotH = GEOM.pivotH;
    const rx = s[4] - s[0], ry = s[5] - s[2], rz = s[6] - pivotH;
    const dist = Math.hypot(rx, ry, rz);
    const slack = this.aux.stretch < -0.01;
    // フック描画位置: 玉掛け時はロープ線上、単独時は質点そのもの
    let hook;
    if (this.attached) {
      if (!slack && dist > 1e-6) {
        const f = this.L / dist;
        hook = { x: s[0] + rx * f, y: s[2] + ry * f, z: pivotH + rz * f };
      } else {
        hook = { x: s[0], y: s[2], z: pivotH - this.L };
      }
    } else {
      hook = { x: s[4], y: s[5], z: s[6] };
    }
    const load = this.attached
      ? { x: s[4], y: s[5], z: s[6] }
      : { x: this.loadStatic.x, y: this.loadStatic.y, z: GEOM.load.sz / 2 };

    const horiz = Math.hypot(rx, ry);
    const drop = pivotH - s[6];
    const swayAngle = Math.atan2(horiz, Math.max(0.2, drop));
    const grounded = this.aux.N > 0;

    const warnings = [];
    if (this.estopActive) warnings.push({ level: 'danger', text: '非常停止 作動中' });
    if (this.attached && grounded && this.aux.T > 30 && swayAngle > 4 * Math.PI / 180)
      warnings.push({ level: 'danger', text: '斜め吊り(横引き)! 真上に吊点を合わせてください' });
    if (this.L <= CRANE.ropeMin + 0.05) warnings.push({ level: 'info', text: '過巻注意(上限リミット)' });
    if (this.attached && !grounded && horiz > 0.8) warnings.push({ level: 'info', text: '荷振れ大 — 追いノッチで制振を' });
    if (this.attached && this.aux.T > (CRANE.ratedLoad + CRANE.mHook) * PHYS.g * 1.1)
      warnings.push({ level: 'danger', text: '過負荷! 定格荷重を超えています' });

    return {
      X: s[0], Y: s[2],
      ropeLen: this.L,
      hookPos: hook,
      loadPos: load,
      loadAttached: this.attached,
      loadOnGround: this.attached ? grounded : true,
      loadYaw: this.attached ? 0 : this.loadStatic.yaw,
      slack,
      T: this.aux.T,
      loadMass: this.loadMass,
      sway: { angle: swayAngle, amp: horiz },
      speeds: { travel: s[1], traverse: s[3], hoist: -this.dL },
      warnings,
    };
  }
}

// Box–Muller 法による標準正規乱数
let spare = null;
function gauss() {
  if (spare !== null) { const v = spare; spare = null; return v; }
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  u2 = Math.random();
  const r = Math.sqrt(-2 * Math.log(u1));
  spare = r * Math.sin(2 * Math.PI * u2);
  return r * Math.cos(2 * Math.PI * u2);
}
