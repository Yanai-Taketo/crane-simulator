// 運搬課題: 開始ゾーンの荷を目標ゾーンへ運び、静かに据え付ける
const $ = (id) => document.getElementById(id);

const TARGETS = [
  { x: 24.5, y: 12.5 }, { x: 25.0, y: 4.0 }, { x: 14.0, y: 13.5 },
  { x: 21.0, y: 8.0 }, { x: 9.0, y: 12.0 },
];
export const START_POS = { x: 6.0, y: 4.0 };

export class TrainingTask {
  constructor(scene, toast) {
    this.scene = scene;
    this.toast = toast;
    this.state = 'idle';   // idle | await-lift | transport | done
    this.panel = $('task-panel');
    this.elText = $('task-text');
    this.elTime = $('task-time');
    this.elMaxSway = $('task-maxsway');
    this.elResult = $('task-result');
    this.target = null;
    this._reset();
  }

  _reset() {
    this.time = 0;
    this.maxSway = 0;
    this.obliqueTime = 0;   // 斜め吊り累積時間 [s]
    this.setDownSpeed = 0;
  }

  start(sim) {
    this._reset();
    this.target = TARGETS[Math.floor(Math.random() * TARGETS.length)];
    sim.placeLoad(START_POS.x, START_POS.y);
    this.scene.setZone('start', START_POS.x, START_POS.y, true);
    this.scene.setZone('target', this.target.x, this.target.y, true);
    this.state = 'await-lift';
    this.panel.classList.remove('hidden');
    this.elResult.classList.add('hidden');
    this.elText.innerHTML =
      `黄ゾーンの荷に玉掛けし(<b>E</b>)、<b>緑ゾーン</b>へ運搬して静かに据え付け、玉掛けを外してください。地切りで計時開始。`;
    this.toast('課題開始: 荷を緑ゾーンへ運搬してください');
  }

  cancel() {
    this.state = 'idle';
    this.panel.classList.add('hidden');
    this.scene.setZone('target', 0, 0, false);
  }

  update(rs, dt) {
    if (this.state === 'idle' || this.state === 'done') return;

    if (this.state === 'await-lift') {
      if (rs.loadAttached && !rs.loadOnGround) {
        this.state = 'transport';
        this.toast('地切り確認 — 計時開始');
      }
    } else if (this.state === 'transport') {
      this.time += dt;
      this.maxSway = Math.max(this.maxSway, rs.sway.amp);
      if (rs.warnings.some(w => w.text.includes('斜め'))) this.obliqueTime += dt;
      if (rs.loadOnGround) this.setDownSpeed = Math.max(this.setDownSpeed, Math.abs(rs.speeds.hoist));

      // 据え付け完了 = 目標ゾーン内で接地し玉掛け解除
      if (!rs.loadAttached && rs.loadOnGround) {
        const err = Math.hypot(rs.loadPos.x - this.target.x, rs.loadPos.y - this.target.y);
        if (err <= 1.3) this._finish(err);
        else this.toast(`目標ゾーン外です(誤差 ${err.toFixed(2)} m)。吊り直してください`);
      }
      this.elTime.textContent = `${this.time.toFixed(1)} s`;
      this.elMaxSway.textContent = `${this.maxSway.toFixed(2)} m`;
    }
  }

  _finish(err) {
    this.state = 'done';
    // 採点: 基準時間 60s、振れ・据付誤差・斜め吊りで減点
    const tPen = Math.max(0, (this.time - 60) * 0.5);
    const swayPen = this.maxSway * 25;
    const errPen = err * 20;
    const obliquePen = this.obliqueTime * 2;
    const score = Math.max(0, Math.round(100 - tPen - swayPen - errPen - obliquePen));
    const rank = score >= 90 ? '模範運転' : score >= 75 ? '良好' : score >= 55 ? '合格' : '要練習';
    this.elResult.classList.remove('hidden');
    this.elResult.innerHTML =
      `<div class="score-big">${score} 点 — ${rank}</div>` +
      `所要時間: ${this.time.toFixed(1)} s(減点 ${tPen.toFixed(1)})<br>` +
      `最大振れ: ${this.maxSway.toFixed(2)} m(減点 ${swayPen.toFixed(1)})<br>` +
      `据付誤差: ${err.toFixed(2)} m(減点 ${errPen.toFixed(1)})<br>` +
      `斜め吊り: ${this.obliqueTime.toFixed(1)} s(減点 ${obliquePen.toFixed(1)})`;
    this.toast(`据え付け完了! スコア ${score} 点`);
  }
}
