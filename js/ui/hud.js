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
    this._lastWarnKey = '';
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

    const key = rs.warnings.map(w => w.text).join('|');
    if (key !== this._lastWarnKey) {
      this._lastWarnKey = key;
      e.warnings.innerHTML = '';
      for (const w of rs.warnings) {
        const div = document.createElement('div');
        div.className = w.level === 'danger' ? 'warn' : 'warn warn-info';
        div.textContent = w.text;
        e.warnings.appendChild(div);
      }
    }
  }
}
