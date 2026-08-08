// 音響エンジン(WebAudio 全合成・音源ファイル不要)
// 各音は物理状態から駆動される。レシピは docs/RESEARCH-v2.md (d) 節に基づく:
//  - モータ音: インバータ機 = 2f・17f 成分+キャリア AM(周波数∝速度)、
//    試験場仕様機 = 電源ハム 100Hz 固定+回転スロット成分(二次抵抗制御の音)
//  - ブレーキ開放/閉クラック、コンタクタ投入クリック
//  - 過負荷警報(90% 断続 / 100% 連続 — 実機ロードメータの慣習)・過巻警報
//  - 着床サッド・スナップ荷重トゥワン(張力スパイク駆動)・警報ホーン
import { CRANE, PHYS, PROFILES } from '../physics/params.js';

export class CraneAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.5;
    this._prev = { brake: 'set', ctcX: 0, ctcY: 0, N: 1, T: 0, notches: { travel: 0, traverse: 0, hoist: 0 } };
    this._alarmPhase = 0;
    this._horn = null;
    // ブラウザの自動再生制限: 最初の操作でコンテキストを生成
    const boot = () => { this._init(); window.removeEventListener('pointerdown', boot); window.removeEventListener('keydown', boot); };
    window.addEventListener('pointerdown', boot);
    window.addEventListener('keydown', boot);
  }

  _init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // 軸別モータボイス
    this.voices = {};
    for (const axis of ['travel', 'traverse', 'hoist']) {
      const g = ctx.createGain(); g.gain.value = 0;
      const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 1200; lpf.Q.value = 1;
      const oscA = ctx.createOscillator(); oscA.type = 'sawtooth'; oscA.frequency.value = 20;
      const gA = ctx.createGain(); gA.gain.value = 0.3;
      const oscB = ctx.createOscillator(); oscB.type = 'triangle'; oscB.frequency.value = 170;
      const gB = ctx.createGain(); gB.gain.value = 0.12;
      oscA.connect(gA).connect(lpf); oscB.connect(gB).connect(lpf);
      lpf.connect(g).connect(this.master);
      oscA.start(); oscB.start();
      this.voices[axis] = { g, lpf, oscA, oscB };
    }
    // 警報ボイス(過負荷/過巻 共用の矩形波)
    this.alarm = ctx.createGain(); this.alarm.gain.value = 0;
    const alOsc = ctx.createOscillator(); alOsc.type = 'square'; alOsc.frequency.value = 2000;
    alOsc.connect(this.alarm).connect(this.master);
    alOsc.start();
    this.alarmOsc = alOsc;
    // ノイズバッファ(クリック/クランク/サッド用)
    const len = Math.floor(ctx.sampleRate * 0.1);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }
  setVolume(v) {
    this.volume = v;
    if (this.master && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // ノイズ一発音: bandpass(center,Q) + 減衰 τ
  _burst(dur, center, q, gain, tau, type = 'bandpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = center; f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, tau);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  _thump(freq, gain, tau) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.setTargetAtTime(0, t, tau);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + tau * 6);
  }

  horn(on) {
    if (!this.ctx) return;
    if (on && !this._horn) {
      const o1 = this.ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = 420;
      const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 630;
      const g = this.ctx.createGain(); g.gain.value = 0.12;
      o1.connect(g); o2.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      this._horn = { o1, o2, g };
    } else if (!on && this._horn) {
      this._horn.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      const h = this._horn;
      setTimeout(() => { h.o1.stop(); h.o2.stop(); }, 200);
      this._horn = null;
    }
  }

  update(rs, dt) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const exam = rs.profile === 'exam';
    const pr = PROFILES[rs.profile] || PROFILES.inverter;

    // ---- モータ音(周波数∝速度、音量∝負荷トルク近似) ----
    const spec = [
      ['travel', Math.abs(rs.speeds.travel), exam ? pr.travel.vSync : CRANE.travelSpeed[1]],
      ['traverse', Math.abs(rs.speeds.traverse), exam ? pr.traverse.vSync : CRANE.traverseSpeed[1]],
      ['hoist', Math.abs(rs.speeds.hoist), exam ? pr.hoist.vSync : CRANE.hoistSpeedLight],
    ];
    for (const [axis, v, vmax] of spec) {
      const vo = this.voices[axis];
      const fOut = 60 * Math.min(1.2, v / vmax);
      const running = v > 0.003;
      if (exam) {
        // 巻線形: 電源ハム固定+スロット成分は軸速度追従
        vo.oscA.frequency.setTargetAtTime(100, t, 0.05);
        vo.oscB.frequency.setTargetAtTime(Math.max(30, 17 * fOut), t, 0.05);
      } else {
        vo.oscA.frequency.setTargetAtTime(Math.max(8, 2 * fOut), t, 0.05);
        vo.oscB.frequency.setTargetAtTime(Math.max(30, 17 * fOut), t, 0.05);
      }
      vo.lpf.frequency.setTargetAtTime(1200 + 20 * fOut, t, 0.05);
      const loadFrac = axis === 'hoist' ? Math.min(1.5, rs.T / ((pr.ratedLoad + CRANE.mHook) * PHYS.g)) : 0.4;
      vo.g.gain.setTargetAtTime(running ? 0.04 + 0.1 * loadFrac : 0, t, 0.07);
    }

    // ---- ブレーキ開閉音 ----
    if (rs.hoistBrake !== this._prev.brake) {
      if (rs.hoistBrake === 'released') this._burst(0.05, 900, 1.5, 0.25, 0.015);   // 開放クラック
      if (rs.hoistBrake === 'set') { this._burst(0.05, 600, 1.5, 0.4, 0.015); this._thump(80, 0.4, 0.06); }
      this._prev.brake = rs.hoistBrake;
    }

    // ---- コンタクタ投入クリック(試験場仕様)/ ノッチ操作クリック ----
    if (rs.contactor) {
      if (rs.contactor.x !== this._prev.ctcX || rs.contactor.y !== this._prev.ctcY) {
        this._burst(0.02, 2500, 1, 0.18, 0.006, 'highpass');
        this._prev.ctcX = rs.contactor.x; this._prev.ctcY = rs.contactor.y;
      }
    }
    for (const a of ['travel', 'traverse', 'hoist']) {
      if (rs.notches[a] !== this._prev.notches[a]) {
        this._burst(0.015, 3000, 1, 0.1, 0.004, 'highpass');
        this._prev.notches[a] = rs.notches[a];
      }
    }

    // ---- 警報: 過負荷(90% 断続 / 超過 連続)・過巻(断続 1.5kHz) ----
    const ratedGross = (rs.ratedLoad + CRANE.mHook);
    const frac = rs.loadMeter / ratedGross;
    this._alarmPhase += dt;
    let alarmGain = 0, alarmFreq = 2000;
    if (rs.overload) { alarmGain = 0.14; }
    else if (frac >= 0.9) { alarmGain = (this._alarmPhase % 1.0) < 0.5 ? 0.11 : 0; }
    else if (rs.overwind) { alarmFreq = 1500; alarmGain = (this._alarmPhase % 0.6) < 0.3 ? 0.08 : 0; }   // HUD 表示とヒステリシスを共有
    this.alarmOsc.frequency.setTargetAtTime(alarmFreq, t, 0.02);
    this.alarm.gain.setTargetAtTime(alarmGain, t, 0.02);

    // ---- 着床サッド(接地遷移・衝撃速度比例)/ スナップ荷重トゥワン ----
    const N = rs.loadAttached ? (rs.loadOnGround ? 1 : 0) : 1;
    if (N === 1 && this._prev.N === 0) {
      const impact = Math.min(1, Math.abs(rs.speeds.loadVz ?? 0) / 0.4);
      this._thump(60, 0.2 + 0.5 * impact, 0.09);
      this._burst(0.08, 250, 1, 0.15 + 0.3 * impact, 0.03);
    }
    this._prev.N = N;
    if (rs.T > this._prev.T * 2.5 && rs.T > 4000 && this._prev.T > 100) {
      this._burst(0.1, 300, 4, 0.3, 0.05);   // ワイヤの張りトゥワン
    }
    this._prev.T = rs.T;
  }
}
