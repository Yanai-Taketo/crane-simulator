// クレーン運転士 実技試験モード(状態機械+採点+デブリーフ)
// 手順(実試験どおり):
//  prep-attach: S の 1t 荷に玉掛け
//  prep-ground: 地切り 10–20 cm で一旦停止(1 秒)— 怠ると減点
//  prep-height: 荷底 2.0 m まで巻上げ・静定 → 計時開始
//  run: A→…→F を順に経由(接触・振れ・高さ逸脱・時間で減点)
//  finish: S 上で着床前一旦停止 → 円内に着床 → 玉外し → 減点表と合否
import { LICENSE_COURSE as C } from './course-license.js';
import { checkContacts } from './collision.js';
import { DeductionSheet } from './deduction.js';
import { GEOM } from '../physics/params.js';

const $ = (id) => document.getElementById(id);

export class LicenseExam {
  constructor(scene, toast) {
    this.scene = scene;
    this.toast = toast;
    this.state = 'idle';
    this.panel = $('task-panel');
    this.elText = $('task-text');
    this.elTime = $('task-time');
    this.elMaxSway = $('task-maxsway');
    this.elResult = $('task-result');
  }

  start(sim) {
    if (sim.attached) { this.toast('玉外しして荷を置いてから開始してください'); return false; }
    this.sim = sim;
    this.sheet = new DeductionSheet(40);
    this.time = 0;
    this.maxSway = 0;
    this.wpIndex = 0;
    this.stopTimer = 0;
    this.groundStopDone = false;
    this.setdownStopTimer = 0;
    this.setdownStopDone = false;
    this.prevOnGround = true;
    this.prevVz = 0;
    this.traj = [];
    this.state = 'prep-attach';
    sim.setCgOffset(0, 0);
    sim.loadMass = C.loadMass;
    sim.placeLoad(C.start.x, C.start.y);
    this.scene.setZone('start', C.start.x, C.start.y, true);
    this.scene.setZone('target', 0, 0, false);
    this.scene.setCourse(C);
    $('task-panel-title').textContent = '運転士実技試験';
    this.panel.classList.remove('hidden');
    this.elResult.classList.add('hidden');
    this.elTime.textContent = '—';
    this.elMaxSway.textContent = '—';
    this._say('S の 1t 荷に玉掛けしてください(E)');
    return true;
  }

  cancel() {
    this.state = 'idle';
    this.panel.classList.add('hidden');
    this.scene.setCourse(null);
    $('task-panel-title').textContent = '運搬課題';
  }

  _say(msg) {
    this.elText.innerHTML = `<b>運転士実技試験</b><br>${msg}<br>` +
      `<span style="color:var(--text-dim)">高さ2m維持・制限 2:30・減点40以下で合格</span>`;
  }

  update(rs, dt) {
    if (this.state === 'idle' || this.state === 'done') return;
    const bottomZ = rs.loadPos.z - GEOM.load.sz / 2;
    const speed = Math.hypot(rs.speeds.travel, rs.speeds.traverse);
    const moving = speed > 0.03 || Math.abs(rs.speeds.hoist) > 0.01;

    // 接触判定は準備段階から常時(吊り中の荷+フック vs 全障害物)
    const load = rs.loadAttached ? {
      x: rs.loadPos.x, y: rs.loadPos.y, z: rs.loadPos.z, yaw: rs.loadYaw,
      halfX: GEOM.load.sx / 2, halfY: GEOM.load.sy / 2, halfZ: GEOM.load.sz / 2,
    } : null;
    const hook = { x: rs.hookPos.x, y: rs.hookPos.y, z: rs.hookPos.z, r: 0.3 };
    const hits = checkContacts(load, hook, C.obstacles);
    for (const id of hits) {
      const wall = id.startsWith('F');
      const bar = id === 'B' || id === 'E';
      this.sheet.edge(`c:${id}`, 'contact',
        wall ? `壁接触 (${id})` : bar ? `バー接触 (${id})` : `ポール接触 (${id})`,
        wall ? C.points.contactWall : bar ? C.points.contactBar : C.points.contactPole,
        this.time, true);
    }
    // 離れた障害物のエッジ解除
    for (const ob of C.obstacles) {
      if (!hits.includes(ob.id)) this.sheet.edge(`c:${ob.id}`, '', '', 0, this.time, false);
    }

    switch (this.state) {
      case 'prep-attach':
        if (rs.loadAttached) {
          this.state = 'prep-ground';
          this._say('地切り: 10–20 cm 吊り上げて<b>一旦停止(1秒)</b>');
        }
        break;
      case 'prep-ground': {
        if (bottomZ > 0.05 && bottomZ < 0.25 && !moving) {
          this.stopTimer += dt;
          if (this.stopTimer >= 1.0) {
            this.groundStopDone = true;
            this.state = 'prep-height';
            this._say('荷底を 2.0 m まで巻上げて静定させてください');
          }
        } else {
          this.stopTimer = 0;
          if (bottomZ > 0.45 && !this.groundStopDone) {
            this.sheet.add('noStopGround', '地切り一旦停止なし', C.points.noStopGround, this.time);
            this.groundStopDone = true;   // 一度だけ減点し先へ
            this.state = 'prep-height';
            this._say('荷底を 2.0 m まで巻上げて静定させてください(地切り停止忘れ −5)');
          }
        }
        break;
      }
      case 'prep-height':
        if (Math.abs(bottomZ - C.carryHeight) < 0.15 && Math.abs(rs.speeds.hoist) < 0.01) {
          this.state = 'run';
          this.time = 0;
          this.toast('高さ確認 — 計時開始! コースを順に周回してください');
          this._nextWp();
        }
        break;
      case 'run': {
        this.time += dt;
        this.maxSway = Math.max(this.maxSway, rs.sway.amp);
        this.traj.push([rs.loadPos.x, rs.loadPos.y, rs.sway.amp]);
        if (this.traj.length > 4000) this.traj.shift();

        // 荷振れ大(0.35 m 超のエクスカーションごとに 10 点)
        this.sheet.edge('sway', 'sway', '荷振れ大', C.points.sway, this.time, rs.sway.amp > 0.35);
        if (rs.sway.amp < 0.2) this.sheet.edge('sway', '', '', 0, this.time, false);

        // 搬送高さ逸脱(バー越え区間は上方向を許容)
        const nearBar = C.barZones.some(z => Math.hypot(rs.loadPos.x - z.x, rs.loadPos.y - z.y) < z.r);
        const tooLow = bottomZ < C.carryHeight - C.carryTol;
        const tooHigh = bottomZ > C.carryHeight + C.carryTol && !nearBar;
        this.sheet.edge('height', 'height', '搬送高さ不良', C.points.height, this.time, (tooLow || tooHigh) && speed > 0.05);
        if (!tooLow && !tooHigh) this.sheet.edge('height', '', '', 0, this.time, false);

        // 経由点
        const wp = C.waypoints[this.wpIndex];
        if (wp && Math.hypot(rs.loadPos.x - wp.x, rs.loadPos.y - wp.y) < wp.r) {
          this.wpIndex++;
          if (this.wpIndex >= C.waypoints.length) {
            this._say('S へ戻り、<b>着床前 10–20 cm で一旦停止</b>してから円内に着床・玉外し');
          } else this._nextWp();
        }

        // 時間超過(1 回のみ計上 → 実質不合格)
        if (this.time > C.timeLimit && this.sheet.count('timeOver') === 0) {
          this.sheet.add('timeOver', '制限時間超過', C.points.timeOver, this.time);
          this.toast('制限時間 2:30 を超過しました');
        }

        // 全経由後: 着床前 10–20 cm の一旦停止(1 秒)を監視
        if (this.wpIndex >= C.waypoints.length && !this.setdownStopDone) {
          if (bottomZ > 0.05 && bottomZ < 0.25 && !moving) {
            this.setdownStopTimer += dt;
            if (this.setdownStopTimer >= 1.0) this.setdownStopDone = true;
          } else this.setdownStopTimer = 0;
        }

        // 着床衝撃(接地エッジで直前の降下速度を評価)
        if (rs.loadAttached && rs.loadOnGround && !this.prevOnGround && this.prevVz < -0.3) {
          this.sheet.add('impact', '乱暴な着床', 5, this.time);
        }

        // 着床・玉外しで終了(全経由後のみ完了扱い)
        if (!rs.loadAttached && rs.loadOnGround) {
          const err = Math.hypot(rs.loadPos.x - C.start.x, rs.loadPos.y - C.start.y);
          if (this.wpIndex < C.waypoints.length) {
            this.sheet.add('skip', '指定経路未経由でゴール(失格)', 100, this.time);
          } else if (!this.setdownStopDone) {
            this.sheet.add('noStopSetdown', '着床前一旦停止なし', C.points.noStopSetdown, this.time);
          }
          if (err > C.start.r) this.sheet.add('outOfZone', '着床位置不良', C.points.outOfZone, this.time);
          this._finish();
        }
        this.elTime.textContent = `${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')} / 2:30`;
        this.elMaxSway.textContent = `${this.maxSway.toFixed(2)} m`;
        break;
      }
    }
    this.prevOnGround = rs.loadAttached ? rs.loadOnGround : true;
    this.prevVz = rs.speeds.loadVz ?? 0;
  }

  _nextWp(){
    const wp = C.waypoints[this.wpIndex];
    if (wp) this._say(`次の経由点: <b>${wp.label}</b>(${this.wpIndex + 1}/${C.waypoints.length})`);
    if (wp) this.scene.setZone('target', wp.x, wp.y, true);
  }

  _finish() {
    this.state = 'done';
    this.scene.setZone('target', 0, 0, false);
    const total = this.sheet.total();
    const pass = total <= 40;
    const rows = this.sheet.items.map(i =>
      `<tr><td>${Math.floor(i.t / 60)}:${String(Math.floor(i.t % 60)).padStart(2, '0')}</td><td>${i.label}</td><td>−${i.points}</td></tr>`
    ).join('');
    this.elResult.classList.remove('hidden');
    this.elResult.innerHTML =
      `<div class="score-big" style="color:${pass ? 'var(--ok)' : 'var(--danger)'}">${pass ? '合格' : '不合格'} — 減点 ${total}</div>` +
      `所要 ${this.elTime.textContent} / 最大振れ ${this.maxSway.toFixed(2)} m` +
      (this.sheet.items.length
        ? `<table class="ded-table"><tr><th>時刻</th><th>減点項目</th><th>点</th></tr>${rows}</table>`
        : '<div>減点なし — 模範運転!</div>') +
      `<canvas id="exam-traj" width="200" height="120"></canvas>`;
    this._drawTraj();
    this.toast(pass ? `合格! 減点 ${total} 点(40 点以下)` : `不合格 — 減点 ${total} 点`);
  }

  // デブリーフ: 平面軌跡(振れ量で色分け)+障害物+減点イベント
  _drawTraj() {
    const cv = $('exam-traj');
    if (!cv || this.traj.length < 2) return;
    const ctx = cv.getContext('2d');
    const sx = (x) => (x - 0) / 30 * cv.width;
    const sy = (y) => (y - 0) / 15 * cv.height;
    ctx.fillStyle = 'rgba(20,26,34,0.9)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(160,170,185,0.9)';
    for (const ob of C.obstacles) {
      if (ob.type === 'pole') { ctx.beginPath(); ctx.arc(sx(ob.x), sy(ob.y), 2, 0, 7); ctx.fill(); }
      else ctx.fillRect(sx(ob.x - ob.halfX) - 1, sy(ob.y - ob.halfY), 3, sy(2 * ob.halfY) - sy(0));
    }
    for (let i = 1; i < this.traj.length; i++) {
      const [x1, y1] = this.traj[i - 1];
      const [x2, y2, amp] = this.traj[i];
      ctx.strokeStyle = amp > 0.35 ? '#ff5252' : amp > 0.2 ? '#ffb63d' : '#58c4ff';
      ctx.beginPath(); ctx.moveTo(sx(x1), sy(y1)); ctx.lineTo(sx(x2), sy(y2)); ctx.stroke();
    }
  }
}
