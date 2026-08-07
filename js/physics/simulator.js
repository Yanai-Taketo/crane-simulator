// クレーンシミュレータ本体 v2: 駆動指令・ウインチ・玉掛け・接触・警報を統括
// 物理コアは crane-model2.js(二質点+ヨー)。フック・吊荷とも実体の質点であり、
// v1 で描画用に導出していたフック位置・静置・たるみはすべて実物理から得られる。
import { rhs2, totalEnergy2 } from './crane-model2.js';
import { makeRK4 } from './integrator.js';
import { GEOM, CRANE, PHYS, NOTCH } from './params.js';

// ワイヤロープ実効軸剛性 [N]: JIS G 3525 6×Fi(29) φ12 の金属断面積 ≈ 70 mm²,
// E ≈ 100 GPa → EA ≈ 7.0e6 N。2 本掛け(掛数2)のフック剛性 k = n·EA/L。
const EA_EFF = 2 * 7.0e6;
// スリング 4 脚合成の実効剛性上限(軽いフック節点の数値安定条件で制限)
const CHAIN_LEN = GEOM.hookHalf + GEOM.slingLen + GEOM.load.sz / 2;   // 2.0 m
const R_TOP = Math.hypot(GEOM.load.sx, GEOM.load.sy) * 0.45 / Math.SQRT2 * Math.SQRT2; // 隅半径
const H_VERT = GEOM.hookHalf + GEOM.slingLen;                          // フック→荷上面
const LEG_LEN = Math.hypot(H_VERT, R_TOP - 0.06);
const LEG_COS = H_VERT / LEG_LEN;

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

export class CraneSimulator {
  constructor(opts = {}) {
    this.rk4 = makeRK4(18);
    this.s = new Float64Array(18);
    this.deriv = new Float64Array(18);
    this.aux = { T: 0, Tc: 0, N: 0, NHook: 0, dist: 0, stretch: 0, legT: [0, 0, 0, 0], FdrvX: 0, FdrvY: 0, ropeHx: 0, ropeHy: 0 };
    this.loadMass = opts.loadMass ?? 1000;
    this.cgOff = { x: 0, y: 0 };   // 吊荷の偏心重心(幾何中心→重心)。課題・設定で使用
    this.reset();
  }

  reset() {
    this.time = 0;
    this.acc = 0;
    this.L = 4.0;                 // ウインチ繰出し長(吊点→フック中心)
    this.dL = 0;
    this.attached = false;
    this.attachedLoadMass = this.loadMass;
    this.attachedCgOff = { x: 0, y: 0 };
    this.estopActive = false;
    this.windMean = 0;
    this.gust = { x: 0, y: 0 };
    this.cmd = { travel: 0, traverse: 0, hoist: 0, step: 1 };
    this.notches = { travel: 0, traverse: 0, hoist: 0 };
    this.controlMode = 'pendant';   // 'pendant' | 'lever'(運転室)
    this.vcmdX = 0; this.vcmdY = 0;
    this.loadStatic = { x: 6, y: 4, yaw: 0 };  // 置かれている吊荷(幾何中心)
    const s = this.s;
    s.fill(0);
    s[0] = 8; s[2] = 8;                        // ブリッジ・トロリ初期位置
    s[4] = s[0]; s[5] = s[2];
    s[6] = GEOM.pivotH - this.L;               // フックはロープ下端に吊持
    this._syncParams();
    this._refreshAux();
  }

  // 現在の状態に応じた物理パラメータ
  // 吊荷質量・偏心は玉掛け時点の値で固定(吊持中の変更は次回玉掛けから)
  _syncParams() {
    const mLoad = this.attachedLoadMass;
    const h = PHYS.dt;
    const wCap = 0.45 / h;                     // 軽節点(フック)の数値安定上限
    const kBudget = CRANE.mHook * wCap * wCap; // フック節点の合計剛性予算
    const kRope = Math.min(EA_EFF / Math.max(0.8, this.L), kBudget * 0.5);
    const kChain = Math.min(6e6, kBudget * 0.5);
    const knH = kBudget * 0.4;
    const knL = Math.min(2.0e7, mLoad * wCap * wCap);
    this.p = {
      mb: CRANE.mb, mt: CRANE.mt,
      mHook: CRANE.mHook, mLoad,
      attached: this.attached,
      g: PHYS.g,
      cx: CRANE.travelFriction, cy: CRANE.traverseFriction,
      kpX: CRANE.velGainTravel, kpY: CRANE.velGainTraverse,
      FmaxX: this.estopActive ? CRANE.travelForceMax * 2 : CRANE.travelForceMax,
      FmaxY: this.estopActive ? CRANE.traverseForceMax * 2 : CRANE.traverseForceMax,
      pivotH: GEOM.pivotH,
      // 減衰は軽節点(フック)基準で設計(荷基準では τ=m/c < h となり数値固着)
      kRope, cRope: 2 * 0.25 * Math.sqrt(kRope * CRANE.mHook),
      kChain, cChain: 2 * 0.25 * Math.sqrt(kChain * CRANE.mHook),
      chainLen0: CHAIN_LEN,
      hookEyeR: 0.06, rTop: R_TOP, hVert: H_VERT, legCos: LEG_COS,
      legSpanA: GEOM.load.sx * 0.9, legSpanB: GEOM.load.sy * 0.9,
      cgOffX: this.attachedCgOff.x, cgOffY: this.attachedCgOff.y,
      Iyaw: mLoad * (GEOM.load.sx ** 2 + GEOM.load.sy ** 2) / 12
        + mLoad * (this.attachedCgOff.x ** 2 + this.attachedCgOff.y ** 2),
      cYaw: 2 * 0.1 * Math.sqrt(Math.max(1, mLoad * PHYS.g * 0.06 * R_TOP / H_VERT)
        * mLoad * (GEOM.load.sx ** 2 + GEOM.load.sy ** 2) / 12),
      knL, cnL: 2 * 0.9 * Math.sqrt(knL * mLoad),
      knH, cnH: 2 * 0.9 * Math.sqrt(knH * CRANE.mHook),
      mu: PHYS.muGround,
      loadBottomOff: GEOM.load.sz / 2,
      hookBottomOff: GEOM.hookHalf,
      // フックの支持面: 玉掛け中は吊り荷の上面(実体)、単独時は置き荷の上面
      hookBlock: this.attached
        ? { x: this.s[10], y: this.s[11], halfX: GEOM.load.sx / 2, halfY: GEOM.load.sy / 2, top: this.s[12] + GEOM.load.sz / 2 }
        : { x: this.loadStatic.x, y: this.loadStatic.y, halfX: GEOM.load.sx / 2, halfY: GEOM.load.sy / 2, top: GEOM.load.sz },
      rhoAir: PHYS.rhoAir,
      CdALoad: PHYS.dragCdA, CdAHook: 0.15,
      cLin: 0.6, cLinHook: 0.2,
    };
  }

  // 状態を直接書き換えた後に補助量(張力・接地反力)を再評価する
  _refreshAux() {
    const u = {
      vcmdX: this.vcmdX, vcmdY: this.vcmdY,
      L0: this.L, dL: this.dL, t0: this.time,
      windX: 0, windY: 0,
    };
    rhs2(this.time, this.s, u, this.p, this.deriv, this.aux);
  }

  setCommand(cmd) { this.cmd = cmd; this.controlMode = 'pendant'; }

  // 運転室モード: ノッチ式コントローラー(ディテント保持・段付きレバー)
  // 3 動作同時投入は禁止(走行+横行の斜行など 2 動作までは可)。
  setLevers(n) {
    const c = NOTCH.count;
    const safe = (v, cur) => Number.isFinite(v) ? clamp(Math.round(v), -c, c) : cur;
    const next = {
      travel: safe(n.travel ?? this.notches.travel, this.notches.travel),
      traverse: safe(n.traverse ?? this.notches.traverse, this.notches.traverse),
      hoist: safe(n.hoist ?? this.notches.hoist, this.notches.hoist),
    };
    let blocked = null;
    const axes = ['travel', 'traverse', 'hoist'];
    if (axes.filter(a => next[a] !== 0).length >= 3) {
      for (const a of axes) {
        if (this.notches[a] === 0 && next[a] !== 0) { next[a] = 0; blocked = a; }
      }
    }
    this.notches = next;
    this.controlMode = 'lever';
    return { blocked };
  }

  // 全操作が中立(ゼロノッチ)か — 非常停止復帰インターロック(構造規格 34 条 2 項)
  controlsNeutral() {
    return this.notches.travel === 0 && this.notches.traverse === 0 && this.notches.hoist === 0
        && this.cmd.travel === 0 && this.cmd.traverse === 0 && this.cmd.hoist === 0;
  }

  setLoadMass(kg) { this.loadMass = kg; }
  setCgOffset(x, y) { this.cgOff = { x: clamp(x, -0.35, 0.35), y: clamp(y, -0.35, 0.35) }; }
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
      // 玉外し: 吊荷が接地しほぼ静止し、チェーンが緩んでいること
      const grounded = this.aux.N > 0 || (s[12] - this.p.loadBottomOff) < 0.01;
      const speed = Math.hypot(s[13], s[14], s[15]);
      if (!grounded) return { ok: false, attached: true, msg: '吊荷が接地していません。着床させてから外してください' };
      if (speed > 0.15) return { ok: false, attached: true, msg: '吊荷が動いています。静止させてから外してください' };
      if (this.aux.Tc > 0.3 * this.p.mLoad * PHYS.g) return { ok: false, attached: true, msg: 'ロープが張っています。巻下げて緩めてから外してください' };
      // 吊荷を置く(幾何中心 = 重心 − 偏心)。フックは実体なのでそのまま残る
      const cs = Math.cos(s[16]), sn = Math.sin(s[16]);
      this.loadStatic = {
        x: s[10] - (this.attachedCgOff.x * cs - this.attachedCgOff.y * sn),
        y: s[11] - (this.attachedCgOff.x * sn + this.attachedCgOff.y * cs),
        yaw: s[16],
      };
      this.attached = false;
      this._syncParams();
      this._refreshAux();
      return { ok: true, attached: false, msg: '玉外し完了' };
    }
    // 玉掛け: フックが吊荷のスリング上端付近にあること
    const lt = this.loadStatic;
    const loadTop = GEOM.load.sz;
    const horiz = Math.hypot(s[4] - lt.x, s[5] - lt.y);
    const hookBottom = s[6] - GEOM.hookHalf;
    if (horiz > 0.6) return { ok: false, attached: false, msg: 'フックが吊荷の真上にありません(水平ずれ ' + horiz.toFixed(2) + ' m)' };
    if (hookBottom < loadTop - 0.35) return { ok: false, attached: false, msg: 'フックが低すぎます。少し巻上げてください' };
    // 結合直後にチェーンが張らない(予伸張ゼロ)ことを保証
    const cgx = lt.x + this.cgOff.x, cgy = lt.y + this.cgOff.y;
    const distNew = Math.hypot(s[4] - cgx, s[5] - cgy, s[6] - GEOM.load.sz / 2);
    if (distNew > CHAIN_LEN - 0.02) return { ok: false, attached: false, msg: 'フックが高すぎます。巻下げてください' };
    // 吊荷を動的状態に載せる(接地静止・偏心は玉掛け時点で確定)
    this.attached = true;
    this.attachedLoadMass = this.loadMass;
    this.attachedCgOff = { x: this.cgOff.x, y: this.cgOff.y };
    s[10] = cgx; s[11] = cgy;
    s[13] = 0; s[14] = 0; s[15] = 0;
    s[16] = lt.yaw || 0; s[17] = 0;
    this._syncParams();
    s[12] = GEOM.load.sz / 2 - (this.p.mLoad * PHYS.g) / this.p.knL;  // 静的貫入で釣り合い
    this._refreshAux();
    return { ok: true, attached: true, msg: '玉掛け完了(質量 ' + this.loadMass + ' kg)' };
  }

  // 1 フレーム分進める(内部で固定刻みサブステップ)
  step(frameDt) {
    this.acc += frameDt;
    const h = PHYS.dt;
    let n = Math.floor(this.acc / h);
    if (n > 60) { n = 60; this.acc = 0; }  // タブ復帰時などは残りを破棄(早送り防止)
    else this.acc -= n * h;
    for (let i = 0; i < n; i++) this._substep(h);
  }

  _substep(h) {
    const s = this.s;

    // --- 指令速度の決定(ペンダント 2 段速 / 運転室ノッチ多段速) ---
    const es = this.estopActive;
    // インバータホイストの軽負荷高速: 吊上げ質量(実張力から判定)が定格の 50% 未満
    const suspended = this.aux.T / PHYS.g;
    const hoistVmax = (suspended < CRANE.ratedLoad * 0.5) ? CRANE.hoistSpeedLight : CRANE.hoistSpeed[1];
    let tgtX, tgtY, tgtL;
    if (this.controlMode === 'lever') {
      const fr = (n) => Math.sign(n) * NOTCH.fractions[Math.abs(n)];
      tgtX = es ? 0 : fr(this.notches.travel) * CRANE.travelSpeed[1];
      tgtY = es ? 0 : fr(this.notches.traverse) * CRANE.traverseSpeed[1];
      const nh = this.notches.hoist;
      const hoistTop = Math.abs(nh) === NOTCH.count ? hoistVmax : CRANE.hoistSpeed[1];
      tgtL = es ? 0 : -Math.sign(nh) * NOTCH.fractions[Math.abs(nh)] * hoistTop;
    } else {
      tgtX = es ? 0 : this.cmd.travel * CRANE.travelSpeed[this.cmd.step - 1];
      tgtY = es ? 0 : this.cmd.traverse * CRANE.traverseSpeed[this.cmd.step - 1];
      const hoistSpd = this.cmd.step === 2 ? hoistVmax : CRANE.hoistSpeed[0];
      tgtL = es ? 0 : -this.cmd.hoist * hoistSpd;
    }

    // --- 台形加減速ランプ ---
    const aX = CRANE.travelSpeed[1] / CRANE.travelRamp * (es ? 2.5 : 1);
    const aY = CRANE.traverseSpeed[1] / CRANE.traverseRamp * (es ? 2.5 : 1);
    this.vcmdX = clamp(tgtX, this.vcmdX - aX * h, this.vcmdX + aX * h);
    this.vcmdY = clamp(tgtY, this.vcmdY - aY * h, this.vcmdY + aY * h);

    // --- ウインチ(巻上 = L 減少)。逆駆動不能・速度制御 ---
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
      L0: this.L, dL: this.dL, t0: this.time,
      windX: this.windMean * 0.94 + this.gust.x,
      windY: this.windMean * 0.34 + this.gust.y,
    };
    const p = this.p;
    this.rk4((t, st, out) => rhs2(t, st, u, p, out), this.time, s, h);
    this.L = clamp(this.L + this.dL * h, CRANE.ropeMin, CRANE.ropeMax);
    this.time += h;

    // --- 終端ストッパ(緩衝器) ---
    if (s[0] < CRANE.travelMin) { s[0] = CRANE.travelMin; if (s[1] < 0) s[1] = 0; }
    if (s[0] > CRANE.travelMax) { s[0] = CRANE.travelMax; if (s[1] > 0) s[1] = 0; }
    if (s[2] < CRANE.traverseMin) { s[2] = CRANE.traverseMin; if (s[3] < 0) s[3] = 0; }
    if (s[2] > CRANE.traverseMax) { s[2] = CRANE.traverseMax; if (s[3] > 0) s[3] = 0; }

    // --- 補助量の再評価と静止摩擦(スティクション) ---
    const u2 = { ...u, L0: this.L, t0: this.time };
    rhs2(this.time, s, u2, p, this.deriv, this.aux);
    if (this.attached && this.aux.N > 0) {
      const vh = Math.hypot(s[13], s[14]);
      // 荷に働く水平外力 ≈ チェーン水平成分
      const Fh = Math.hypot(s[10] - s[4], s[11] - s[5]) > 1e-9 && this.aux.Tc > 0
        ? this.aux.Tc * Math.hypot(s[10] - s[4], s[11] - s[5]) / Math.hypot(s[10] - s[4], s[11] - s[5], s[12] - s[6])
        : 0;
      if (vh < 0.02 && Fh < 1.22 * p.mu * this.aux.N) { s[13] = 0; s[14] = 0; }
    }
    if (this.aux.NHook > 0) {
      const vh = Math.hypot(s[7], s[8]);
      const Fh = Math.hypot(this.aux.ropeHx, this.aux.ropeHy);
      if (vh < 0.02 && Fh < 1.22 * p.mu * this.aux.NHook) { s[7] = 0; s[8] = 0; }
    }

    // --- 非常停止の復帰: 全軸停止かつ全操作が中立(ゼロノッチインターロック) ---
    if (es && Math.abs(s[1]) < 0.005 && Math.abs(s[3]) < 0.005 &&
        Math.abs(this.dL) < 0.002 && this.vcmdX === 0 && this.vcmdY === 0 &&
        this.controlsNeutral()) {
      this.estopActive = false;
      this._syncParams();
    }
  }

  energy() { return totalEnergy2(this.s, this.L, this.p); }

  getRenderState() {
    const s = this.s;
    const pivotH = GEOM.pivotH;
    const rx = s[4] - s[0], ry = s[5] - s[2], rz = s[6] - pivotH;
    const slack = this.aux.stretch < -0.01;
    const hook = { x: s[4], y: s[5], z: s[6] };
    // ロープ余剰長 → 物理たるみ量(放物線近似)
    const chord = Math.hypot(rx, ry, rz);
    const excess = Math.max(0, this.L - chord);
    const ropeSag = (excess > 0.005 && chord > 0.2)
      ? Math.min(0.45 * chord, Math.sqrt(3 * chord * excess / 8))
      : 0;
    const hookResting = this.aux.NHook > 0;

    // 吊荷(描画は幾何中心): 重心 − R(ψ)·偏心
    let load, tilt = { dirX: 0, dirY: 0, angle: 0 };
    if (this.attached) {
      const cs = Math.cos(s[16]), sn = Math.sin(s[16]);
      const ox = this.attachedCgOff.x * cs - this.attachedCgOff.y * sn;
      const oy = this.attachedCgOff.x * sn + this.attachedCgOff.y * cs;
      load = { x: s[10] - ox, y: s[11] - oy, z: s[12] };
      // 偏心による準静的傾き: 吊上げ時、重心がフック直下に来るため荷が傾く
      const e = Math.hypot(ox, oy);
      if (e > 1e-6 && this.aux.Tc > 0.3 * this.p.mLoad * PHYS.g && !(this.aux.N > 0)) {
        const frac = Math.min(1, this.aux.Tc / (this.p.mLoad * PHYS.g));
        tilt = { dirX: ox / e, dirY: oy / e, angle: Math.atan2(e, CHAIN_LEN) * frac };
      }
    } else {
      load = { x: this.loadStatic.x, y: this.loadStatic.y, z: GEOM.load.sz / 2 };
    }

    // 振れ計測: 玉掛け時は吊荷、単独時はフックの吊点に対する水平偏差
    const bx = this.attached ? s[10] : s[4], by = this.attached ? s[11] : s[5];
    const bz = this.attached ? s[12] : s[6];
    const horiz = Math.hypot(bx - s[0], by - s[2]);
    const swayAngle = Math.atan2(horiz, Math.max(0.2, pivotH - bz));
    const grounded = this.aux.N > 0;

    const warnings = [];
    if (this.estopActive) warnings.push({ level: 'danger', text: '非常停止 作動中' });
    if (this.attached && grounded && this.aux.Tc > 50 && swayAngle > 4 * Math.PI / 180)
      warnings.push({ level: 'danger', text: '斜め吊り(横引き)! 真上に吊点を合わせてください' });
    if (this.L <= CRANE.ropeMin + 0.05) warnings.push({ level: 'info', text: '過巻注意(上限リミット)' });
    if (this.attached && !grounded && horiz > 0.8) warnings.push({ level: 'info', text: '荷振れ大 — 追いノッチで制振を' });
    if (tilt.angle > 3 * Math.PI / 180)
      warnings.push({ level: 'danger', text: '荷が傾いています(偏心) — 重心の真上に掛け直してください' });
    if (tilt.angle > Math.atan(PHYS.muGround * 0.4))
      warnings.push({ level: 'danger', text: '荷ずれの危険! スリングが滑ります' });
    if (this.attached && this.aux.T > (CRANE.ratedLoad + CRANE.mHook) * PHYS.g * 1.1)
      warnings.push({ level: 'danger', text: '過負荷! 定格荷重を超えています' });

    return {
      X: s[0], Y: s[2],
      ropeLen: this.L,
      hookPos: hook,
      loadPos: load,
      loadAttached: this.attached,
      loadOnGround: this.attached ? grounded : true,
      loadYaw: this.attached ? s[16] : (this.loadStatic.yaw || 0),
      loadTilt: tilt,
      slack,
      ropeSag,
      hookResting,
      T: this.aux.T,
      Tc: this.aux.Tc,
      legT: this.aux.legT.slice(),
      loadMass: this.attached ? this.attachedLoadMass : this.loadMass,
      sway: { angle: swayAngle, amp: horiz },
      speeds: { travel: s[1], traverse: s[3], hoist: -this.dL, loadVz: this.attached ? s[15] : s[9] },
      controlMode: this.controlMode,
      notches: { travel: this.notches.travel, traverse: this.notches.traverse, hoist: this.notches.hoist },
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
