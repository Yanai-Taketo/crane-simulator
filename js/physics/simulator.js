// クレーンシミュレータ本体: 駆動指令・ウインチ・玉掛け・接触・警報を統括
import { rhsCartesian, totalEnergy } from './crane-model.js';
import { makeRK4 } from './integrator.js';
import { GEOM, CRANE, PHYS, NOTCH } from './params.js';

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
    this.attachedLoadMass = this.loadMass;
    this.estopActive = false;
    this.windMean = 0;
    this.gust = { x: 0, y: 0 };
    this.cmd = { travel: 0, traverse: 0, hoist: 0, step: 1 };
    this.notches = { travel: 0, traverse: 0, hoist: 0 };
    this.controlMode = 'pendant';   // 'pendant' | 'lever'(運転室)
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
  // 吊荷質量は玉掛け時点の値で固定(吊持中のスライダー変更は次回玉掛けから)
  _syncParams() {
    const mp = this.attached ? CRANE.mHook + this.attachedLoadMass : CRANE.mHook;
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

  setCommand(cmd) { this.cmd = cmd; this.controlMode = 'pendant'; }

  // 運転室モード: ノッチ式コントローラー(ディテント保持・段付きレバー)
  // 3 動作同時投入は禁止(走行+横行の斜行など 2 動作までは可)。
  // 3 本目のレバー投入は拒否し blocked にその軸名を返す。
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
    const activeCount = axes.filter(a => next[a] !== 0).length;
    if (activeCount >= 3) {
      // 新規に投入された(0 → 非0)軸を拒否する
      for (const a of axes) {
        if (this.notches[a] === 0 && next[a] !== 0) { next[a] = 0; blocked = a; }
      }
    }
    this.notches = next;
    this.controlMode = 'lever';
    return { blocked };
  }

  // 全操作が中立(ゼロノッチ)か — 非常停止復帰インターロックに使用。
  // モード切替による迂回を防ぐため、両系統(ペンダント指令とレバーノッチ)の
  // すべてが中立であることを要求する(構造規格 34 条 2 項の趣旨)。
  controlsNeutral() {
    return this.notches.travel === 0 && this.notches.traverse === 0 && this.notches.hoist === 0
        && this.cmd.travel === 0 && this.cmd.traverse === 0 && this.cmd.hoist === 0;
  }

  setLoadMass(kg) { this.loadMass = kg; }
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
      if (this.aux.T > 0.3 * this.p.mp * PHYS.g) return { ok: false, attached: true, msg: 'ロープが張っています。巻下げて緩めてから外してください' };
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
    if (hookBottom < loadTop - 0.35) return { ok: false, attached: false, msg: 'フックが低すぎます。少し巻上げてください' };
    // 結合直後にロープが張らない(伸びゼロ以下)ことを保証する。
    // これを怠ると弾性ロープの予伸張で吊荷が跳ね上げられる。
    const rigNew = GEOM.hookHalf + GEOM.slingLen + GEOM.load.sz / 2;
    const distNew = Math.hypot(s[0] - lt.x, s[2] - lt.y, GEOM.pivotH - GEOM.load.sz / 2);
    if (distNew > this.L + rigNew - 0.02) return { ok: false, attached: false, msg: 'フックが高すぎます。巻下げてください' };
    // 質点を吊荷重心へ移す(接地状態で結合)
    s[4] = lt.x; s[5] = lt.y;
    s[7] = 0; s[8] = 0; s[9] = 0;
    this.attached = true;
    this.attachedLoadMass = this.loadMass;
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
    if (n > 60) { n = 60; this.acc = 0; }  // タブ復帰時などは残りを破棄(早送り防止)
    else this.acc -= n * h;
    for (let i = 0; i < n; i++) this._substep(h);
  }

  _substep(h) {
    const s = this.s;

    // --- 指令速度の決定(ペンダント 2 段速 / 運転室ノッチ多段速) ---
    const es = this.estopActive;
    // インバータホイストの軽負荷高速: 吊り上げ質量が定格の 50% 未満なら最高速が増速
    const hoistVmax = (this.p.mp < CRANE.ratedLoad * 0.5) ? CRANE.hoistSpeedLight : CRANE.hoistSpeed[1];
    let tgtX, tgtY, tgtL;
    if (this.controlMode === 'lever') {
      const fr = (n) => Math.sign(n) * NOTCH.fractions[Math.abs(n)];
      tgtX = es ? 0 : fr(this.notches.travel) * CRANE.travelSpeed[1];
      tgtY = es ? 0 : fr(this.notches.traverse) * CRANE.traverseSpeed[1];
      // 軽負荷倍速は最上段ノッチのみ増速(中間ノッチは絶対周波数基準のまま)
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

    // --- 非常停止の復帰: 全軸停止かつ全操作が中立(ゼロノッチインターロック) ---
    // (操作を入れたままの自動復帰は実機の非常停止の教育上も危険)
    if (es && Math.abs(s[1]) < 0.005 && Math.abs(s[3]) < 0.005 &&
        Math.abs(this.dL) < 0.002 && this.vcmdX === 0 && this.vcmdY === 0 &&
        this.controlsNeutral()) {
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
    // フック描画位置(玉掛け時):
    //  - 吊上げ~フック吊持区間: ロープは張っており、吊点→質点の線上・巻出し長 L の点
    //  - さらに繰り出すとフックは実機同様降下を続け、吊荷上面に静置される
    //    (静置後はロープに余剰長が生じ、たるみとして描画される)
    const rigUp = GEOM.load.sz / 2 + GEOM.hookHalf;  // 吊荷重心→静置フック中心
    let hook, hookResting = false;
    if (this.attached) {
      if (dist > 1e-6) {
        const restDist = Math.max(0.3, dist - rigUp); // フックが荷上面に着く繰出し長
        const fLine = Math.min(this.L, restDist) / dist;
        const lineX = s[0] + rx * fLine, lineY = s[2] + ry * fLine, lineZ = pivotH + rz * fLine;
        const restX = s[4], restY = s[5], restZ = s[6] + rigUp;
        // 静置遷移は 0.15 m の区間で連続補間(吊点オフセット時の飛びを防止)
        const b = clamp((this.L - (restDist - 0.15)) / 0.15, 0, 1);
        hook = { x: lineX + (restX - lineX) * b, y: lineY + (restY - lineY) * b, z: lineZ + (restZ - lineZ) * b };
        hookResting = this.L >= restDist;
      } else {
        hook = { x: s[0], y: s[2], z: pivotH - this.L };
      }
    } else {
      hook = { x: s[4], y: s[5], z: s[6] };
    }
    // ロープ余剰長 → 物理たるみ量(放物線近似: excess = 8a²/(3d) → a = √(3·d·excess/8))
    const chord = Math.hypot(hook.x - s[0], hook.y - s[2], hook.z - pivotH);
    const excess = Math.max(0, this.L - chord);
    const ropeSag = (excess > 0.005 && chord > 0.2)
      ? Math.min(0.45 * chord, Math.sqrt(3 * chord * excess / 8))
      : 0;
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

    // 表示張力: スリングがたるみフックのみロープに吊持されている区間は
    // ウインチ側張力 ≈ フック自重(点質量モデルでは 0 になるため補正)
    let Tdisp = this.aux.T;
    if (this.attached && slack && !hookResting && Tdisp < 5) Tdisp = CRANE.mHook * PHYS.g;

    return {
      X: s[0], Y: s[2],
      ropeLen: this.L,
      hookPos: hook,
      loadPos: load,
      loadAttached: this.attached,
      loadOnGround: this.attached ? grounded : true,
      loadYaw: this.attached ? 0 : this.loadStatic.yaw,
      slack,
      ropeSag,
      hookResting,
      T: Tdisp,
      loadMass: this.attached ? this.attachedLoadMass : this.loadMass,
      sway: { angle: swayAngle, amp: horiz },
      speeds: { travel: s[1], traverse: s[3], hoist: -this.dL, loadVz: s[9] },
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
