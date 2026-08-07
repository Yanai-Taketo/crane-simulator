// エントリポイント: シミュレータ・描画・UI の結線と描画ループ
import { CraneSimulator } from './physics/simulator.js';
import { SceneManager } from './render/scene.js';
import { PendantInput } from './ui/pendant.js';
import { LeverPanel } from './ui/levers.js';
import { CabKeys } from './ui/cab-keys.js';
import { Hud } from './ui/hud.js';
import { CraneAudio } from './ui/audio.js';
import { SwayScope } from './ui/swayscope.js';
import { TrainingTask, START_POS } from './training.js';
import { Walker } from './ui/walker.js';
import { LicenseExam } from './exam/license-mode.js';
import { FloorExam } from './exam/floor-mode.js';

const $ = (id) => document.getElementById(id);

const sim = new CraneSimulator();
const scene = new SceneManager($('scene'));
const pendant = new PendantInput();
const hud = new Hud();
const scope = new SwayScope($('swayscope'));
const audio = new CraneAudio();

// 警報ホーン(H 押下中)
window.addEventListener('keydown', (e) => { if (e.code === 'KeyH' && !e.repeat) audio.horn(true); });
window.addEventListener('keyup', (e) => { if (e.code === 'KeyH') audio.horn(false); });

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

const task = new TrainingTask(scene, toast);
const exam = new LicenseExam(scene, toast);
const floorExam = new FloorExam(scene, toast);

// V キー: 指差呼称(技能講習モード)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyV' || e.repeat) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
  floorExam.call();
});

// ---- ペンダント結線 ----
pendant.onEstop = () => {
  sim.estop();
  toast(ctrlMode === 'cab'
    ? '非常停止! 復帰するには全レバーを中立(0)に戻してください'
    : '非常停止! 全動作を停止しました');
};
pendant.onHook = () => {
  const r = sim.tryToggleHook();
  toast(r.msg);
};

// ---- 運転室コントローラー(実機配置: 左=巻上・横行 / 右=走行) ----
// 前後規約(実機調査): 前方押し(画面上)= 巻下 / 北(横行)/ 西(走行)、
// 手前引き = 巻上 / 南 / 東。forwardSign=-1 でノッチ符号に写像。
const leverPanel = new LeverPanel($('lever-levers'), [
  { key: 'hoist',    label: '巻上',  upLabel: '巻下(押)', downLabel: '巻上(引)', keys: 'W/S',  forwardSign: -1 },
  { key: 'traverse', label: '横行',  upLabel: '北(押)',   downLabel: '南(引)',   keys: '↑/↓', forwardSign: -1 },
  { key: 'travel',   label: '走行',  upLabel: '西(押)',   downLabel: '東(引)',   keys: '←/→', forwardSign: -1 },
], (n) => {
  const r = sim.setLevers(n);
  if (r.blocked) {
    leverPanel.sync(sim.notches);
    toast('3動作の同時投入は禁止です(2動作まで・斜行は走行+横行)');
  }
});
const cabKeys = new CabKeys(leverPanel);
$('btn-estop2').addEventListener('click', () => pendant.onEstop());
$('btn-hook2').addEventListener('click', () => pendant.onHook());

// ---- 操作モード切替 ----
let ctrlMode = 'pendant';
const ctrlBtns = ['btn-ctrl-pendant', 'btn-ctrl-cab'];
function setControlMode(m) {
  ctrlMode = m;
  pendant.enabled = (m === 'pendant');
  cabKeys.enabled = (m === 'cab');
  $('pendant').classList.toggle('hidden', m !== 'pendant');
  $('lever-panel').classList.toggle('hidden', m !== 'cab');
  setActive(ctrlBtns, m === 'pendant' ? 'btn-ctrl-pendant' : 'btn-ctrl-cab');
  if (m === 'cab') {
    leverPanel.zeroAll();               // 搭乗時は全ノッチ中立から(零位確認)
    sim.setLevers(leverPanel.notches);
    setWalkActive(false);
    scene.setCameraMode('cab');
    setActive(camBtns, 'btn-cam-cab');
    toast('運転室モード: レバーをドラッグ、または矢印/W/S キー。画面ドラッグで見回し');
  } else {
    leverPanel.zeroAll();               // 降車時は全レバー中立(インターロック維持)
    sim.setLevers(leverPanel.notches);
    sim.setCommand(pendant.getCommand());
    setWalkActive(false);
    scene.setCameraMode('orbit');
    setActive(camBtns, 'btn-cam-orbit');
    toast('床上操作(ペンダント)モード');
  }
}

// ---- トップバー ----
function setActive(groupIds, activeId) {
  for (const id of groupIds) $(id).classList.toggle('active', id === activeId);
}
// 歩行オペレータ(床上操作の実制約: ペンダントケーブルで追従)
const walker = new Walker(8, 6);
scene.walker = walker;
let walkActive = false;
const walkKeys = { fwd: 0, strafe: 0 };
window.addEventListener('keydown', (e) => {
  if (!walkActive || e.repeat) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
  if (e.code === 'KeyW') walkKeys.fwd = 1;
  if (e.code === 'KeyS') walkKeys.fwd = -1;
  if (e.code === 'KeyA') walkKeys.strafe = -1;
  if (e.code === 'KeyD') walkKeys.strafe = 1;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW' && walkKeys.fwd === 1) walkKeys.fwd = 0;
  if (e.code === 'KeyS' && walkKeys.fwd === -1) walkKeys.fwd = 0;
  if (e.code === 'KeyA' && walkKeys.strafe === -1) walkKeys.strafe = 0;
  if (e.code === 'KeyD' && walkKeys.strafe === 1) walkKeys.strafe = 0;
});
// タブ切替などで keyup を取り逃しても歩行・ホーンが残らないように
window.addEventListener('blur', () => {
  walkKeys.fwd = 0; walkKeys.strafe = 0;
  audio.horn(false);
});
function setWalkActive(on) {
  walkActive = on;
  scene.walkerActive = on;
  pendant.setWalkMode(on && ctrlMode === 'pendant');
  if (on) {
    walker.x = sim.s[0] - 1.0; walker.y = Math.min(14.5, sim.s[2] + 1.2);
    toast('歩行モード: WASD 歩行 / 矢印 走行・横行 / R・F 巻上下 / ドラッグで見回し');
  }
}

const camBtns = ['btn-cam-orbit', 'btn-cam-cab', 'btn-cam-walk', 'btn-cam-operator', 'btn-cam-follow'];
const camSelect = (mode, id) => {
  scene.setCameraMode(mode);
  setActive(camBtns, id);
  setWalkActive(mode === 'walk');
};
$('btn-cam-orbit').addEventListener('click', () => camSelect('orbit', 'btn-cam-orbit'));
$('btn-cam-cab').addEventListener('click', () => camSelect('cab', 'btn-cam-cab'));
$('btn-cam-walk').addEventListener('click', () => {
  // 歩行 = 床上操作。運転室モードのままでは W/S がレバーと衝突するため降車する
  if (ctrlMode === 'cab') setControlMode('pendant');
  camSelect('walk', 'btn-cam-walk');
});
$('btn-cam-operator').addEventListener('click', () => camSelect('operator', 'btn-cam-operator'));
$('btn-cam-follow').addEventListener('click', () => camSelect('follow', 'btn-cam-follow'));
setActive(camBtns, 'btn-cam-orbit');

$('btn-ctrl-pendant').addEventListener('click', () => setControlMode('pendant'));
$('btn-ctrl-cab').addEventListener('click', () => setControlMode('cab'));
setActive(ctrlBtns, 'btn-ctrl-pendant');

const modeBtns = ['btn-mode-free', 'btn-mode-task', 'btn-mode-exam', 'btn-mode-floor'];
// 開始条件(玉外し済み)を満たさないうちは現行モードを壊さない
const requireUnhooked = () => {
  if (!sim.attached) return true;
  toast('玉外しして荷を置いてから開始してください');
  return false;
};
$('btn-mode-free').addEventListener('click', () => { task.cancel(); exam.cancel(); floorExam.cancel(); setActive(modeBtns, 'btn-mode-free'); toast('自由練習モード'); });
$('btn-mode-task').addEventListener('click', () => {
  if (!requireUnhooked()) return;
  exam.cancel(); floorExam.cancel();
  if (task.start(sim)) setActive(modeBtns, 'btn-mode-task');
  else setActive(modeBtns, 'btn-mode-free');
});
$('btn-mode-exam').addEventListener('click', () => {
  if (!requireUnhooked()) return;
  task.cancel(); floorExam.cancel();
  if (exam.start(sim)) {
    setActive(modeBtns, 'btn-mode-exam');
    // 実試験と同じ 5t 試験場仕様機(二次抵抗制御)に切替・荷は 1t 固定
    sim.setProfile('exam');
    $('set-profile').value = 'exam';
    $('set-mass').value = 1000; $('set-mass-val').textContent = '1000';
    $('set-cg').value = 0; $('set-cg-val').textContent = '0.00';
    toast('運転士実技試験: 試験場仕様機(二次抵抗制御)に切替えました');
  } else setActive(modeBtns, 'btn-mode-free');
});
$('btn-mode-floor').addEventListener('click', () => {
  if (!requireUnhooked()) return;
  task.cancel(); exam.cancel();
  if (floorExam.start(sim)) {
    setActive(modeBtns, 'btn-mode-floor');
    // 床上操作式 = ペンダント+荷と共に歩く(インバータ機・ドラム缶 500 kg)
    sim.setProfile('inverter');
    $('set-profile').value = 'inverter';
    $('set-mass').value = 500; $('set-mass-val').textContent = '500';
    $('set-cg').value = 0; $('set-cg-val').textContent = '0.00';
    setControlMode('pendant');
    camSelect('walk', 'btn-cam-walk');
    toast('技能講習: 歩行モードで荷に付いて歩き、V で指差呼称');
  } else setActive(modeBtns, 'btn-mode-free');
});
setActive(modeBtns, 'btn-mode-free');

$('btn-reset').addEventListener('click', () => {
  sim.reset();
  sim.setWind(Number($('set-wind').value));   // 設定パネルの表示値と同期を保つ
  if (ctrlMode === 'cab') {                   // 運転室モード中は全ノッチ中立で再開
    leverPanel.zeroAll();
    sim.setLevers(leverPanel.notches);
  }
  sim.placeLoad(START_POS.x, START_POS.y);
  scene.setZone('start', START_POS.x, START_POS.y, true);   // 試験用の位置・縮尺から復帰
  scene.setZone('target', 0, 0, false);
  scope.reset();
  scene.clearTrail();
  scene.setTrailVisible($('set-trails').checked);
  if (task.state !== 'idle') task.cancel();
  if (exam.state !== 'idle') exam.cancel();
  if (floorExam.state !== 'idle') floorExam.cancel();
  setActive(modeBtns, 'btn-mode-free');
  toast('リセットしました');
});

$('btn-settings').addEventListener('click', () => $('settings-panel').classList.toggle('hidden'));

// ---- 設定 ----
// 試験中は条件(荷質量・機体・重心)を固定 — 途中で変えると採点が無意味になる
const examActive = () =>
  (exam.state !== 'idle' && exam.state !== 'done') ||
  (floorExam.state !== 'idle' && floorExam.state !== 'done');
const guardExamSetting = (revert) => {
  if (!examActive()) return false;
  revert();
  toast('試験中は変更できません(リセットまたは自由練習で解除)');
  return true;
};
$('set-mass').addEventListener('input', (e) => {
  if (guardExamSetting(() => {
    e.target.value = sim.loadMass;
    $('set-mass-val').textContent = sim.loadMass;
  })) return;
  const kg = Number(e.target.value);
  $('set-mass-val').textContent = kg;
  sim.setLoadMass(kg);
});
$('set-wind').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('set-wind-val').textContent = v.toFixed(1);
  sim.setWind(v);
});
$('set-trails').addEventListener('change', (e) => scene.setTrailVisible(e.target.checked));
$('set-profile').addEventListener('change', (e) => {
  if (guardExamSetting(() => { e.target.value = sim.profileName; })) return;
  sim.setProfile(e.target.value);
  toast(e.target.value === 'exam'
    ? '試験場仕様機: 二次抵抗制御 — 速度は荷で変わり、ノッチ0は惰行です'
    : 'インバータ機(標準)');
});
$('set-cg').addEventListener('input', (e) => {
  if (guardExamSetting(() => {
    e.target.value = 0;
    $('set-cg-val').textContent = '0.00';
  })) return;
  const v = Number(e.target.value);
  $('set-cg-val').textContent = v.toFixed(2);
  sim.setCgOffset(v, 0);
});
$('set-audio').addEventListener('change', (e) => audio.setEnabled(e.target.checked));
$('set-audio-vol').addEventListener('input', (e) => audio.setVolume(Number(e.target.value)));
let slowmo = false;
$('set-slowmo').addEventListener('change', (e) => { slowmo = e.target.checked; });

// ---- 初期状態 ----
sim.placeLoad(START_POS.x, START_POS.y);
scene.setZone('start', START_POS.x, START_POS.y, true);

// ---- メインループ(物理は固定刻み・シミュレータ内部でサブステップ) ----
let last = performance.now();
let lastSimTime = 0;
let hudAccum = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);  // タブ復帰時のスパイラル防止
  last = now;

  if (ctrlMode === 'pendant') sim.setCommand(pendant.getCommand());
  sim.step(slowmo ? dt * 0.25 : dt);

  const rs = sim.getRenderState();
  // 技能講習中はカメラを切替えてもオペレータはペンダントケーブルに追従し、
  // 立ち位置規則(直下・前方)の採点が続く(床上操作式の定義どおり)
  const floorActive = floorExam.state !== 'idle' && floorExam.state !== 'done';
  if (walkActive || floorActive) {
    walker.update(dt, walkActive ? walkKeys : { fwd: 0, strafe: 0 }, scene.cabYaw, rs.X, rs.Y);
  }
  scene.walkerActive = walkActive || floorActive;
  scene.update(rs, dt);
  audio.update(rs, dt);
  // 課題の計時はシミュレーション時刻に同期(描画レートの影響を受けない)
  const simDt = Math.max(0, sim.time - lastSimTime);
  lastSimTime = sim.time;
  task.update(rs, simDt);
  exam.update(rs, simDt);
  floorExam.update(rs, simDt, walker, walkActive || floorActive);

  hudAccum += dt;
  if (hudAccum >= 1 / 15) {   // HUD・スコープは 15Hz で十分
    hud.update(rs, sim.time);
    scope.update(rs);
    const hookLabel = rs.loadAttached ? '玉外し' : '玉掛け';
    $('btn-hook-label').textContent = hookLabel;
    $('btn-hook2-label').textContent = hookLabel;
    hudAccum = 0;
  }
}
requestAnimationFrame(frame);

// E2E テスト・デバッグ用ハンドル
window.__craneSim = sim;
window.__craneScene = scene;
window.__craneExam = exam;
window.__craneFloorExam = floorExam;
