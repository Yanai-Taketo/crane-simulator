// 押釦ペンダント + キーボード入力 → 運転指令
// 2段速: 通常押し = 1速(低速) / Shift 併用 = 2速(高速)
export class PendantInput {
  constructor() {
    this.cmd = { travel: 0, traverse: 0, hoist: 0, step: 1 };
    this.enabled = true;   // 運転室(レバー)モード中は false
    this.onEstop = null;
    this.onHook = null;
    this._shift = false;
    this._pointer = { travel: 0, traverse: 0, hoist: 0 };  // 画面ボタン由来
    this._keys = { travel: 0, traverse: 0, hoist: 0 };     // キー由来
    this._keyMap = {
      ArrowLeft:  ['travel', -1], ArrowRight: ['travel', 1],
      ArrowUp:    ['traverse', -1], ArrowDown: ['traverse', 1],
      KeyW: ['hoist', 1], KeyS: ['hoist', -1],
    };
    this._bindButtons();
    this._bindKeys();
  }

  _bindButtons() {
    for (const btn of document.querySelectorAll('.pbtn[data-axis]')) {
      const axis = btn.dataset.axis;
      const dir = Number(btn.dataset.dir);
      const press = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        this._pointer[axis] = dir;
        this._refresh();
      };
      const release = () => {
        if (this._pointer[axis] === dir) this._pointer[axis] = 0;
        this._refresh();
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    document.getElementById('btn-estop').addEventListener('click', () => this.onEstop?.());
    document.getElementById('btn-hook').addEventListener('click', () => this.onHook?.());
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // スライダー等のフォーム操作中はクレーン操作キーを奪わない
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'Shift') { this._shift = true; this._refresh(); return; }
      if (e.code === 'KeyE') { this.onHook?.(); return; }
      if (e.code === 'Space') { e.preventDefault(); this.onEstop?.(); return; }
      if (!this.enabled) return;   // 移動キーはペンダントモードのみ(E/Space は共通)
      const m = this._keyMap[e.code];
      if (m) { e.preventDefault(); this._keys[m[0]] = m[1]; this._refresh(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') { this._shift = false; this._refresh(); return; }
      const m = this._keyMap[e.code];
      if (m && this._keys[m[0]] === m[1]) { this._keys[m[0]] = 0; this._refresh(); }
    });
    window.addEventListener('blur', () => {
      this._shift = false;
      for (const k of Object.keys(this._keys)) this._keys[k] = 0;
      for (const k of Object.keys(this._pointer)) this._pointer[k] = 0;
      this._refresh();
    });
  }

  _refresh() {
    for (const axis of ['travel', 'traverse', 'hoist']) {
      this.cmd[axis] = this.enabled
        ? (this._pointer[axis] !== 0 ? this._pointer[axis] : this._keys[axis])
        : 0;
    }
    this.cmd.step = this._shift ? 2 : 1;
    // ボタンの押下表示(キー操作でも点灯)
    for (const btn of document.querySelectorAll('.pbtn[data-axis]')) {
      const active = this.cmd[btn.dataset.axis] === Number(btn.dataset.dir);
      btn.classList.toggle('pressed', active);
      btn.classList.toggle('fast', active && this.cmd.step === 2);
    }
  }

  getCommand() { return this.cmd; }
}
