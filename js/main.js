// エントリポイント: シミュレータ・描画・UI の結線と描画ループ
import { CraneSimulator } from './physics/simulator.js';
import { SceneManager } from './render/scene.js';
import { PendantInput } from './ui/pendant.js';
import { LeverPanel } from './ui/levers.js';
import { CabKeys } from './ui/cab-keys.js';
import { Hud } from './ui/hud.js';
import { SwayScope } from './ui/swayscope.js';
import { TrainingTask, START_POS } from './training.js';

const $ = (id) => document.getElementById(id);

const sim = new CraneSimulator();
const scene = new SceneManager($('scene'));
const pendant = new PendantInput();
const hud = new Hud();
const scope = new SwayScope($('swayscope'));

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

const task = new TrainingTask(scene, toast);

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
    scene.setCameraMode('cab');
    setActive(camBtns, 'btn-cam-cab');
    toast('運転室モード: レバーをドラッグ、または矢印/W/S キー。画面ドラッグで見回し');
  } else {
    sim.setCommand(pendant.getCommand());
    scene.setCameraMode('orbit');
    setActive(camBtns, 'btn-cam-orbit');
    toast('床上操作(ペンダント)モード');
  }
}

// ---- トップバー ----
function setActive(groupIds, activeId) {
  for (const id of groupIds) $(id).classList.toggle('active', id === activeId);
}
const camBtns = ['btn-cam-orbit', 'btn-cam-cab', 'btn-cam-operator', 'btn-cam-follow'];
$('btn-cam-orbit').addEventListener('click', () => { scene.setCameraMode('orbit'); setActive(camBtns, 'btn-cam-orbit'); });
$('btn-cam-cab').addEventListener('click', () => { scene.setCameraMode('cab'); setActive(camBtns, 'btn-cam-cab'); });
$('btn-cam-operator').addEventListener('click', () => { scene.setCameraMode('operator'); setActive(camBtns, 'btn-cam-operator'); });
$('btn-cam-follow').addEventListener('click', () => { scene.setCameraMode('follow'); setActive(camBtns, 'btn-cam-follow'); });
setActive(camBtns, 'btn-cam-orbit');

$('btn-ctrl-pendant').addEventListener('click', () => setControlMode('pendant'));
$('btn-ctrl-cab').addEventListener('click', () => setControlMode('cab'));
setActive(ctrlBtns, 'btn-ctrl-pendant');

const modeBtns = ['btn-mode-free', 'btn-mode-task'];
$('btn-mode-free').addEventListener('click', () => { task.cancel(); setActive(modeBtns, 'btn-mode-free'); toast('自由練習モード'); });
$('btn-mode-task').addEventListener('click', () => {
  if (task.start(sim)) setActive(modeBtns, 'btn-mode-task');
});
setActive(modeBtns, 'btn-mode-free');

$('btn-reset').addEventListener('click', () => {
  sim.reset();
  sim.setWind(Number($('set-wind').value));   // 設定パネルの表示値と同期を保つ
  sim.placeLoad(START_POS.x, START_POS.y);
  scope.reset();
  scene.setTrailVisible($('set-trails').checked);
  if (task.state !== 'idle') task.cancel();
  setActive(modeBtns, 'btn-mode-free');
  toast('リセットしました');
});

$('btn-settings').addEventListener('click', () => $('settings-panel').classList.toggle('hidden'));

// ---- 設定 ----
$('set-mass').addEventListener('input', (e) => {
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
let slowmo = false;
$('set-slowmo').addEventListener('change', (e) => { slowmo = e.target.checked; });

// ---- 初期状態 ----
sim.placeLoad(START_POS.x, START_POS.y);
scene.setZone('start', START_POS.x, START_POS.y, true);

// ---- メインループ(物理は固定刻み・シミュレータ内部でサブステップ) ----
let last = performance.now();
let hudAccum = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);  // タブ復帰時のスパイラル防止
  last = now;

  if (ctrlMode === 'pendant') sim.setCommand(pendant.getCommand());
  sim.step(slowmo ? dt * 0.25 : dt);

  const rs = sim.getRenderState();
  scene.update(rs, dt);
  task.update(rs, slowmo ? dt * 0.25 : dt);

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
