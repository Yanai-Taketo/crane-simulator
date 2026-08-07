// 運転室ノッチ式コントローラー UI
// 実機のカム形/インバータ多段速コントローラーを模した縦レバー。
// ディテント(段付き保持)式: ドラッグで任意ノッチへ、離しても位置を保持する。
// 軸の割当・並び・方向ラベルは実機調査に基づき main.js から注入する。
import { NOTCH } from '../physics/params.js';

export class LeverPanel {
  // axes: [{ key, label, upLabel, downLabel, keys: '←→' }]  表示順 = 実機配置
  constructor(container, axes, onChange) {
    this.container = container;
    this.axes = axes;
    this.onChange = onChange;
    this.notches = {};
    this.els = {};
    for (const ax of axes) this.notches[ax.key] = 0;
    this._build();
  }

  _build() {
    const N = NOTCH.count;
    this.container.innerHTML = '';
    for (const ax of this.axes) {
      const col = document.createElement('div');
      col.className = 'lever-col';
      col.innerHTML =
        `<div class="lever-top">${ax.upLabel}</div>` +
        `<div class="lever-track" data-axis="${ax.key}">` +
        Array.from({ length: 2 * N + 1 }, (_, i) => {
          const n = N - i;
          return `<div class="lever-tick${n === 0 ? ' zero' : ''}" data-n="${n}"></div>`;
        }).join('') +
        `<div class="lever-knob" style="top:50%"><span class="lever-notch-label">0</span></div>` +
        `</div>` +
        `<div class="lever-bottom">${ax.downLabel}</div>` +
        `<div class="lever-name">${ax.label}<span class="lever-keys">${ax.keys}</span></div>`;
      this.container.appendChild(col);
      const track = col.querySelector('.lever-track');
      const knob = col.querySelector('.lever-knob');
      this.els[ax.key] = { track, knob, label: knob.querySelector('.lever-notch-label') };
      this._bindDrag(ax.key, track);
    }
  }

  _bindDrag(key, track) {
    const N = NOTCH.count;
    const move = (e) => {
      const r = track.getBoundingClientRect();
      const frac = (e.clientY - r.top) / r.height;        // 0(上)〜1(下)
      const n = Math.round((0.5 - frac) * 2 * N);          // 上 = +N
      this.set(key, n);
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      move(e);
      const onMove = (ev) => move(ev);
      const onUp = () => {
        track.removeEventListener('pointermove', onMove);
        track.removeEventListener('pointerup', onUp);
        track.removeEventListener('pointercancel', onUp);
      };
      track.addEventListener('pointermove', onMove);
      track.addEventListener('pointerup', onUp);
      track.addEventListener('pointercancel', onUp);
    });
    track.addEventListener('dblclick', () => this.set(key, 0));  // ダブルクリックで中立
  }

  set(key, n) {
    const N = NOTCH.count;
    n = Math.max(-N, Math.min(N, Math.round(n)));
    if (this.notches[key] === n) return;
    this.notches[key] = n;
    this._render(key);
    this.onChange?.({ ...this.notches });
  }

  nudge(key, delta) { this.set(key, this.notches[key] + delta); }

  zeroAll() {
    for (const ax of this.axes) this.notches[ax.key] = 0;
    for (const ax of this.axes) this._render(ax.key);
    this.onChange?.({ ...this.notches });
  }

  _render(key) {
    const N = NOTCH.count;
    const n = this.notches[key];
    const { knob, label } = this.els[key];
    knob.style.top = `${(0.5 - n / (2 * N)) * 100}%`;
    label.textContent = String(Math.abs(n));
    knob.classList.toggle('active', n !== 0);
  }

  // シミュレータ側の状態(非常停止での強制中立など)を反映
  sync(notches) {
    for (const ax of this.axes) {
      if (notches[ax.key] !== undefined && notches[ax.key] !== this.notches[ax.key]) {
        this.notches[ax.key] = notches[ax.key];
        this._render(ax.key);
      }
    }
  }
}
