// 衝突判定・減点エンジンのテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContacts } from '../js/exam/collision.js';
import { DeductionSheet } from '../js/exam/deduction.js';

const LOAD = (x, y, z, yaw = 0) => ({ x, y, z, yaw, halfX: 0.6, halfY: 0.6, halfZ: 0.45 });
const HOOK = (x, y, z) => ({ x, y, z, r: 0.25 });

test('衝突: ポール(円柱)と回転した吊荷 OBB', () => {
  const pole = { id: 'A1', type: 'pole', x: 10, y: 5, r: 0.15, zLo: 0, zHi: 3.5 };
  // 触れない位置
  assert.deepEqual(checkContacts(LOAD(11.0, 5, 2), null, [pole]), []);
  // 接触位置(x 距離 0.72 < 0.6+0.15)
  assert.deepEqual(checkContacts(LOAD(10.72, 5, 2), null, [pole]), ['A1']);
  // 45° ヨー: 角が届く(対角半径 0.85)
  assert.deepEqual(checkContacts(LOAD(10.95, 5, 2, Math.PI / 4), null, [pole]), ['A1']);
  // 45° ヨーの支持半径は対角 0.849 → それ+r を超える 1.05 離れれば触れない
  assert.deepEqual(checkContacts(LOAD(10, 6.05, 2, Math.PI / 4), null, [pole]), []);
  // z 範囲外(バー越え相当: 荷底 3.55 > ポール上端 3.5)
  assert.deepEqual(checkContacts(LOAD(10.6, 5, 4.0), null, [pole]), []);
});

test('衝突: バー(水平梁)は高さで回避できる・壁は z 全域', () => {
  const bar = { id: 'B', type: 'box', x: 10, y: 5, halfX: 0.1, halfY: 1.2, zLo: 2.8, zHi: 3.0 };
  // 2m 搬送高さ(荷心 2.0 → 上端 2.45)ならバー(2.8〜)の下を通過できる
  assert.deepEqual(checkContacts(LOAD(10, 5, 2.0), null, [bar]), []);
  // 巻上げ不足でバーの高さ帯に入ると接触
  assert.deepEqual(checkContacts(LOAD(10, 5, 2.6), null, [bar]), ['B']);
  // 十分巻き上げてバー越え(荷底 3.15 > 3.0)
  assert.deepEqual(checkContacts(LOAD(10, 5, 3.6), null, [bar]), []);
  // フック単独でもバーに当たる
  assert.deepEqual(checkContacts(null, HOOK(10, 5, 2.9), [bar]), ['B']);
});

test('衝突: 壁ギャップの斜行通過(ギャップ内は接触なし・壁は上へ逃げられない)', () => {
  const wall1 = { id: 'F1', type: 'box', x: 20, y: 6.0, halfX: 0.05, halfY: 1.8, zLo: 0, zHi: 4.0 };
  const pole2 = { id: 'F2', type: 'pole', x: 20, y: 2.6, r: 0.15, zLo: 0, zHi: 4.0 };
  const obs = [wall1, pole2];
  // ギャップ中央(y=3.4 付近)を通過 → 接触なし
  assert.deepEqual(checkContacts(LOAD(20, 3.35, 2.0), null, obs), []);
  // 壁寄り → 接触
  assert.deepEqual(checkContacts(LOAD(20, 4.0, 2.0), null, obs), ['F1']);
  // 高く巻いても壁はかわせない(zHi 4.0)
  assert.deepEqual(checkContacts(LOAD(20, 4.0, 3.5), null, obs), ['F1']);
});

test('減点: ヒステリシス付きエッジは中間帯で再計上しない', () => {
  const d = new DeductionSheet(40);
  // 発火 0.35 超 / 解除 0.2 未満(荷振れ・高さ逸脱の実装と同じ形)
  const step = (amp) => d.edge('sway', 'sway', '荷振れ大', 10, 0, amp > 0.35, amp < 0.2);
  assert.ok(step(0.4));      // 計上
  assert.ok(!step(0.3));     // 中間帯: 解除されない
  assert.ok(!step(0.4));     // 継続中は再計上しない
  step(0.1);                 // 0.2 未満で解除
  assert.ok(step(0.4));      // 収まってからの再発のみ再計上
  assert.equal(d.total(), 20);
});

test('減点: エッジ計上・合計・40 点以下合格', () => {
  const d = new DeductionSheet(40);
  // 接触継続は 1 回だけ計上
  assert.ok(d.edge('c:A', 'contact', 'ポール接触', 5, 1.0, true));
  assert.ok(!d.edge('c:A', 'contact', 'ポール接触', 5, 1.1, true));
  d.edge('c:A', 'contact', 'ポール接触', 5, 1.5, false);
  assert.ok(d.edge('c:A', 'contact', 'ポール接触', 5, 2.0, true));   // 再接触は再計上
  d.add('sway', '荷振れ大', 10, 3.0);
  assert.equal(d.total(), 20);
  assert.ok(d.passed());
  d.add('time', '時間超過', 25, 150);
  assert.equal(d.total(), 45);
  assert.ok(!d.passed());
  assert.equal(d.count('contact'), 2);
});
