// 床上操作式クレーン 技能講習修了試験モード
// 実講習どおり: 指差呼称(V)を順に行いながらドラム缶を低所搬送で 1 周。
// 呼称せずに動作を始めると「安全確認不足 -2」。柵・バー接触、バー落下、
// つり荷直下立入り・前方歩行(床上操作の歩行制約)も減点。
// 100 点から減点し 70 点以上(減点 30 以下)で合格。
import { FLOOR_COURSE as C } from './course-floor.js';
import { checkContacts } from './collision.js';
import { DeductionSheet } from './deduction.js';
import { CallSequencer } from './calls.js';

const $ = (id) => document.getElementById(id);
const P = C.points;

export class FloorExam {
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
    this.sheet = new DeductionSheet(C.passDeduct);
    this.calls = new CallSequencer(C.calls);
    this.time = 0;
    this.maxSway = 0;
    this.legIdx = 0;
    this.callDeduct = 0;
    this.stopTimer = 0;
    this.groundStopDone = false;
    this.setdownStopTimer = 0;
    this.setdownStopDone = false;
    this.prevAttached = false;
    this.prevOnGround = true;
    this.prevVz = 0;
    this.liftCalled = false;
    this.barDropped = false;
    this.underLoadActive = false;
    this.aheadTimer = 0;
    this.aheadDeducted = false;
    this.traj = [];
    this.trajAcc = 1;
    this._lastPrompt = '';
    this.state = 'prep';
    sim.setCgOffset(0, 0);
    sim.loadMass = C.loadMass;
    sim.placeLoad(C.start.x, C.start.y);
    this.scene.setZone('start', C.start.x, C.start.y, true, C.start.r);
    this.scene.setZone('target', 0, 0, false);
    this.scene.setCourse(C);
    this.scene.setLoadStyle('drum');
    sim.setLoadShape(C.drum);
    $('task-panel-title').textContent = '技能講習 修了試験';
    this.panel.classList.remove('hidden');
    this.elResult.classList.add('hidden');
    this.elTime.textContent = '—';
    this.elMaxSway.textContent = '—';
    this._refresh();
    return true;
  }

  cancel() {
    this.state = 'idle';
    this.panel.classList.add('hidden');
    this.scene.setCourse(null);
    this.scene.setLoadStyle('box');
    this.sim?.setLoadShape(null);
    $('task-panel-title').textContent = '運搬課題';
  }

  // V キー: 現在の指差呼称を実施
  call() {
    if (this.state === 'idle' || this.state === 'done') return;
    const it = this.calls.perform();
    if (it) {
      this.toast(`指差呼称: ${it.label}`, 1300);
      this._refresh();
    }
  }

  // 動作イベントで呼称を消化。飛ばした呼称は減点(上限 callCap)
  _consume(id) {
    for (const it of this.calls.consumeThrough(id)) {
      if (this.callDeduct >= P.callCap) continue;
      this.callDeduct += P.call;
      this.sheet.add('call', `指差呼称なし(${it.label})`, P.call, this.time);
    }
  }

  _refresh() {
    const inst = {
      'prep': this.sim?.attached
        ? '呼称の上、<b>垂直に巻上げ</b>て地切りへ'
        : '点検の指差呼称を順に行い、S のドラム缶に玉掛け(E)',
      'ground': this.groundStopDone
        ? '呼称して低所(荷底 0.1–0.7 m)のまま搬送開始'
        : '地切り 10–20 cm で<b>一旦停止(1 秒)</b>',
      'run': (() => {
        const leg = C.legs[this.legIdx];
        return leg
          ? `${this.legIdx + 1}/4: <b>${leg.label}</b>` +
            (leg.id === 'E' ? '<br>バーは呼称の上巻上げて越え、越えたら巻下げ' : '')
          : '';
      })(),
      'land': 'S 上で<b>着地前一旦停止</b> → 着床 → 呼称 → 玉外し(E)',
      'after': 'フックを 2 m まで巻上げて終了',
    }[this.state] ?? '';
    const cur = this.calls?.current;
    const html = `<b>技能講習 修了試験</b><br>${inst}<br>` +
      (cur ? `<span style="color:var(--accent)">次の指差呼称: <b>${cur.label}</b>(V キー)</span><br>` : '') +
      `<span style="color:var(--text-dim)">制限 7:00・減点 30 以下(70 点以上)で合格</span>`;
    if (html !== this._lastPrompt) { this.elText.innerHTML = html; this._lastPrompt = html; }
  }

  // walker: 歩行オペレータ({x,y})、walkerOn: 歩行モード中のみ位置規則を採点
  update(rs, dt, walker, walkerOn) {
    if (this.state === 'idle' || this.state === 'done') return;
    this.time += dt;
    const bottomZ = rs.loadPos.z - C.drum.h / 2;
    const horizSpeed = Math.hypot(rs.speeds.travel, rs.speeds.traverse);
    const moving = horizSpeed > 0.03 || Math.abs(rs.speeds.hoist) > 0.01;
    const lx = rs.loadPos.x, ly = rs.loadPos.y;

    // ---- 接触判定(ドラム = 鉛直円柱 + フック球 + 吊り具・ロープの鉛直円柱) ----
    const load = rs.loadAttached
      ? { x: lx, y: ly, z: rs.loadPos.z, r: C.drum.r, halfZ: C.drum.h / 2 }
      : null;
    const hook = { x: rs.hookPos.x, y: rs.hookPos.y, z: rs.hookPos.z, r: 0.3 };
    const hits = checkContacts(load, hook, C.obstacles);
    const rigLo = load ? rs.loadPos.z + C.drum.h / 2 : rs.hookPos.z;
    const rig = {
      x: rs.hookPos.x, y: rs.hookPos.y, r: load ? 0.22 : 0.12,
      z: (rigLo + 7.9) / 2, halfZ: (7.9 - rigLo) / 2,
    };
    for (const id of checkContacts(rig, null, C.obstacles)) {
      if (!hits.includes(id)) hits.push(id);
    }
    for (const id of hits) {
      if (id === 'BAR') {
        // バーは 5 cm の受け金具に載っているだけ → 接触即落下
        if (!this.barDropped) {
          this.barDropped = true;
          this.scene.dropBar('BAR');
          this.sheet.add('barDrop', 'バー落下', P.barDrop, this.time);
          this.toast('バーを落としました(−10)');
        }
        continue;
      }
      this.sheet.edge(`c:${id}`, 'contact',
        id.startsWith('F') ? `柵接触 (${id})` : `ポール接触 (${id})`,
        P.contact, this.time, true);
    }
    for (const ob of C.obstacles) {
      if (ob.id !== 'BAR' && !hits.includes(ob.id)) {
        this.sheet.edge(`c:${ob.id}`, '', '', 0, this.time, false);
      }
    }

    // 3 ボタン同時押しの禁止(基発第66号)
    this.sheet.edge('threeOp', 'threeOp', '3動作同時投入', P.threeOp, this.time,
      (rs.activeAxes ?? 0) >= 3);

    // ---- 歩行オペレータの位置規則(クレーン則29条・エレファン図12) ----
    if (walkerOn && walker && rs.loadAttached && bottomZ > 0.05) {
      const dx = walker.x - lx, dy = walker.y - ly;
      const dHoriz = Math.hypot(dx, dy);
      if (dHoriz < C.drum.r + 0.5 && !this.underLoadActive) {
        this.underLoadActive = true;
        this.sheet.add('underLoad', 'つり荷直下立入り', P.underLoad, this.time);
        this.toast('つり荷の下に入ってはいけません(−5)');
      } else if (dHoriz > C.drum.r + 0.8) {
        this.underLoadActive = false;
      }
      if (horizSpeed > 0.15) {
        const vx = rs.speeds.travel / horizSpeed, vy = rs.speeds.traverse / horizSpeed;
        const proj = dx * vx + dy * vy;
        if (proj > 0.8 && dHoriz < 2.2) {
          this.aheadTimer += dt;
          if (this.aheadTimer > 0.7 && !this.aheadDeducted) {
            this.aheadDeducted = true;
            this.sheet.add('ahead', 'つり荷前方を歩行', P.aheadOfLoad, this.time);
            this.toast('つり荷の後方・横から付いて歩いてください(−5)');
          }
        } else { this.aheadTimer = 0; this.aheadDeducted = false; }
      } else { this.aheadTimer = 0; }
    }

    // ---- 状態機械 ----
    switch (this.state) {
      case 'prep':
        if (rs.loadAttached && !this.prevAttached) this._consume('hookpos');
        if (rs.loadAttached && !this.liftCalled && rs.speeds.hoist > 0.02) {
          this.liftCalled = true;
          this._consume('vertical');
        }
        if (rs.loadAttached && bottomZ > 0.05) { this.state = 'ground'; this.stopTimer = 0; }
        break;
      case 'ground':
        if (!rs.loadAttached) {           // 置き直し・掛け直し → 準備からやり直し
          this.state = 'prep';
          this.groundStopDone = false;
          this.stopTimer = 0;
          this.liftCalled = false;
          this._refresh();
          break;
        }
        if (bottomZ > 0.05 && bottomZ < 0.25 && !moving) {
          this.stopTimer += dt;
          if (this.stopTimer >= 1.0 && !this.groundStopDone) this.groundStopDone = true;
        } else {
          this.stopTimer = 0;
          // 停止せずそのまま上げ続ける/走り出す(0.25–0.45 m 帯でも成立)
          if (!this.groundStopDone && (bottomZ > 0.45 || (bottomZ > 0.05 && horizSpeed > 0.15))) {
            this.sheet.add('noStopGround', '地切り一旦停止なし', P.noStopGround, this.time);
            this.groundStopDone = true;
          }
        }
        if (this.groundStopDone && (horizSpeed > 0.08 || bottomZ > C.carryBand.hi)) {
          this.state = 'run';
          this.legIdx = 0;
        }
        break;
      case 'run': {
        if (!rs.loadAttached) break;      // 途中で降ろした場合は掛け直しを待つ(進行・採点停止)
        this.maxSway = Math.max(this.maxSway, rs.sway.amp);
        // 軌跡は約 8 Hz に間引き(4000 点で 7 分をカバー)
        this.trajAcc += dt;
        if (this.trajAcc >= 0.12) {
          this.trajAcc = 0;
          this.traj.push([lx, ly, rs.sway.amp]);
          if (this.traj.length > 4000) this.traj.shift();
        }

        const inBar = Math.abs(lx - C.bar.x) < C.bar.zoneR && Math.abs(ly - C.bar.y) < 1.5;
        const leg = C.legs[this.legIdx];
        if (leg) {
          const v = leg.axis === 'x' ? rs.speeds.travel : rs.speeds.traverse;
          if (v * leg.dir > 0.08) this._consume(leg.callId);
          if (Math.hypot(lx - leg.to.x, ly - leg.to.y) < 0.9) { this.legIdx++; this._refresh(); }
        }
        // バー越えの巻上げ・巻下げ呼称
        if (inBar && rs.speeds.hoist > 0.03) this._consume('hoistup');
        if (lx > C.bar.x + 0.8 && Math.abs(ly - C.bar.y) < 1.5 && rs.speeds.hoist < -0.03) {
          this._consume('hoistdown');
        }
        // 低所搬送の高さ帯(バー越え区間は除外。帯内復帰まで再計上しない)
        const offBand = bottomZ < C.carryBand.lo || bottomZ > C.carryBand.hi;
        this.sheet.edge('height', 'height', '搬送高さ不良', P.height, this.time,
          offBand && horizSpeed > 0.08 && !inBar, !offBand);

        if (this.legIdx >= C.legs.length) { this.state = 'land'; this._refresh(); }
        break;
      }
      case 'land': {
        this.maxSway = Math.max(this.maxSway, rs.sway.amp);
        this.traj.push([lx, ly, rs.sway.amp]);
        if (!this.setdownStopDone) {
          if (bottomZ > 0.05 && bottomZ < 0.25 && !moving) {
            this.setdownStopTimer += dt;
            if (this.setdownStopTimer >= 1.0) this.setdownStopDone = true;
          } else this.setdownStopTimer = 0;
        }
        // 着床衝撃(接地エッジで直前の降下速度を評価)
        if (rs.loadAttached && rs.loadOnGround && !this.prevOnGround && this.prevVz < -0.3) {
          this.sheet.add('impact', '乱暴な着床', P.impact, this.time);
        }
        if (!rs.loadAttached && rs.loadOnGround) {
          this._consume('landed');
          if (!this.setdownStopDone) {
            this.sheet.add('noStopSetdown', '着床前一旦停止なし', P.noStopSetdown, this.time);
          }
          const err = Math.hypot(lx - C.start.x, ly - C.start.y);
          if (err > C.start.r) this.sheet.add('outOfZone', '着床位置不良', P.outOfZone, this.time);
          this.state = 'after';
          this._refresh();
        }
        break;
      }
      case 'after':
        if (rs.hookPos.z >= 1.9) this._finish();
        break;
    }

    // 制限時間(超過 = 不合格相当の減点を 1 回)
    if (this.time > C.timeLimit && this.sheet.count('timeOver') === 0) {
      this.sheet.add('timeOver', '制限時間超過', P.timeOver, this.time);
      this.toast('制限時間 7:00 を超過しました');
    }

    this.prevAttached = rs.loadAttached;
    this.prevOnGround = rs.loadAttached ? rs.loadOnGround : true;
    this.prevVz = rs.speeds.loadVz ?? 0;
    if (this.state !== 'done') {
      this.elTime.textContent =
        `${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')} / 7:00`;
      this.elMaxSway.textContent = this.maxSway ? `${this.maxSway.toFixed(2)} m` : '—';
      this._refresh();
    }
  }

  _finish() {
    this.state = 'done';
    const total = Math.min(100, this.sheet.total());
    const score = 100 - total;
    const pass = total <= C.passDeduct;
    const rows = this.sheet.items.map((i) =>
      `<tr><td>${Math.floor(i.t / 60)}:${String(Math.floor(i.t % 60)).padStart(2, '0')}</td><td>${i.label}</td><td>−${i.points}</td></tr>`
    ).join('');
    this.elResult.classList.remove('hidden');
    this.elResult.innerHTML =
      `<div class="score-big" style="color:${pass ? 'var(--ok)' : 'var(--danger)'}">${pass ? '合格' : '不合格'} — ${score} 点</div>` +
      `所要 ${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, '0')} / 最大振れ ${this.maxSway.toFixed(2)} m` +
      (this.sheet.items.length
        ? `<table class="ded-table"><tr><th>時刻</th><th>減点項目</th><th>点</th></tr>${rows}</table>`
        : '<div>減点なし — 模範運転!</div>') +
      `<canvas id="exam-traj" width="200" height="120"></canvas>`;
    this._drawTraj();
    this.toast(pass ? `合格! ${score} 点(70 点以上)` : `不合格 — ${score} 点`);
  }

  // デブリーフ: 平面軌跡(振れ量で色分け)+柵・バー
  _drawTraj() {
    const cv = $('exam-traj');
    if (!cv || this.traj.length < 2) return;
    const ctx = cv.getContext('2d');
    const sx = (x) => x / 30 * cv.width;
    const sy = (y) => y / 15 * cv.height;
    ctx.fillStyle = 'rgba(20,26,34,0.9)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(160,170,185,0.9)';
    for (const ob of C.obstacles) {
      if (ob.type === 'pole') { ctx.beginPath(); ctx.arc(sx(ob.x), sy(ob.y), 2, 0, 7); ctx.fill(); }
      else ctx.fillRect(sx(ob.x - ob.halfX), sy(ob.y - ob.halfY),
        Math.max(1, sx(2 * ob.halfX)), Math.max(1, sy(2 * ob.halfY)));
    }
    for (let i = 1; i < this.traj.length; i++) {
      const [x1, y1] = this.traj[i - 1];
      const [x2, y2, amp] = this.traj[i];
      ctx.strokeStyle = amp > 0.35 ? '#ff5252' : amp > 0.2 ? '#ffb63d' : '#58c4ff';
      ctx.beginPath(); ctx.moveTo(sx(x1), sy(y1)); ctx.lineTo(sx(x2), sy(y2)); ctx.stroke();
    }
  }
}
