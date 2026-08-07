// エントリポイント: シミュレータ・描画・UI の結線と描画ループ
import { CraneSimulator } from './physics/simulator.js';
import { SceneManager } from './render/scene.js';
import { PendantInput } from './ui/pendant.js';
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
pendant.onEstop = () => { sim.estop(); toast('非常停止! 全動作を停止しました'); };
pendant.onHook = () => {
  const r = sim.tryToggleHook();
  toast(r.msg);
};

// ---- トップバー ----
function setActive(groupIds, activeId) {
  for (const id of groupIds) $(id).classList.toggle('active', id === activeId);
}
const camBtns = ['btn-cam-orbit', 'btn-cam-operator', 'btn-cam-follow'];
$('btn-cam-orbit').addEventListener('click', () => { scene.setCameraMode('orbit'); setActive(camBtns, 'btn-cam-orbit'); });
$('btn-cam-operator').addEventListener('click', () => { scene.setCameraMode('operator'); setActive(camBtns, 'btn-cam-operator'); });
$('btn-cam-follow').addEventListener('click', () => { scene.setCameraMode('follow'); setActive(camBtns, 'btn-cam-follow'); });
setActive(camBtns, 'btn-cam-orbit');

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

  sim.setCommand(pendant.getCommand());
  sim.step(slowmo ? dt * 0.25 : dt);

  const rs = sim.getRenderState();
  scene.update(rs, dt);
  task.update(rs, slowmo ? dt * 0.25 : dt);

  hudAccum += dt;
  if (hudAccum >= 1 / 15) {   // HUD・スコープは 15Hz で十分
    hud.update(rs, sim.time);
    scope.update(rs);
    $('btn-hook-label').textContent = rs.loadAttached ? '玉外し' : '玉掛け';
    hudAccum = 0;
  }
}
requestAnimationFrame(frame);

// E2E テスト・デバッグ用ハンドル
window.__craneSim = sim;
window.__craneScene = scene;
