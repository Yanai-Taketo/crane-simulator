// 計器盤の表示更新
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      swayAngle: $('hud-sway-angle'), swayAmp: $('hud-sway-amp'),
      hookHeight: $('hud-hook-height'), rope: $('hud-rope'),
      travelSpeed: $('hud-travel-speed'), traverseSpeed: $('hud-traverse-speed'),
      hoistSpeed: $('hud-hoist-speed'), tension: $('hud-tension'),
      loadMeter: $('hud-loadmeter'),
      loadMass: $('hud-load-mass'), time: $('hud-time'),
      warnings: $('hud-warnings'),
    };
    this._warnHold = new Map();   // text → { level, until }
    this._warnEls = new Map();    // text → DOM ノード(点滅アニメの位相を保つ)
    this._lastSimTime = 0;
  }

  update(rs, simTime) {
    const e = this.el;
    e.swayAngle.textContent = `${(rs.sway.angle * 180 / Math.PI).toFixed(1)}°`;
    e.swayAmp.textContent = `${rs.sway.amp.toFixed(2)} m`;
    e.hookHeight.textContent = `${Math.max(0, rs.hookPos.z).toFixed(2)} m`;
    e.rope.textContent = `${rs.ropeLen.toFixed(2)} m`;
    e.travelSpeed.textContent = `${rs.speeds.travel.toFixed(2)} m/s`;
    e.traverseSpeed.textContent = `${rs.speeds.traverse.toFixed(2)} m/s`;
    e.hoistSpeed.textContent = `${rs.speeds.hoist.toFixed(2)} m/s`;
    e.tension.textContent = `${(rs.T / 1000).toFixed(1)} kN`;
    e.loadMeter.textContent = `${(rs.loadMeter / 1000).toFixed(2)} t`;
    e.loadMeter.style.color = rs.overload ? 'var(--danger)' : '';
    e.loadMass.textContent = rs.loadAttached ? `${rs.loadMass} kg` : `— (フックのみ)`;
    const m = Math.floor(simTime / 60), s = Math.floor(simTime % 60);
    e.time.textContent = `${m}:${String(s).padStart(2, '0')}`;

    // 警告チップ: チャタリング防止のため表示側でも 1.2 s 保持し、
    // 既存ノードは再利用する(全消し+再構築だと点滅アニメが毎回リスタートする)
    if (simTime < this._lastSimTime) {          // リセットで時計が巻き戻ったら全消去
      this._warnHold.clear();
      for (const el of this._warnEls.values()) el.remove();
      this._warnEls.clear();
    }
    this._lastSimTime = simTime;
    for (const w of rs.warnings) this._warnHold.set(w.text, { level: w.level, until: simTime + 1.2 });
    for (const [text, h] of this._warnHold) {
      if (h.until <= simTime) {
        this._warnHold.delete(text);
        this._warnEls.get(text)?.remove();
        this._warnEls.delete(text);
      } else if (!this._warnEls.has(text)) {
        const div = document.createElement('div');
        div.className = h.level === 'danger' ? 'warn' : 'warn warn-info';
        div.textContent = text;
        e.warnings.appendChild(div);
        this._warnEls.set(text, div);
      }
    }
  }
}
