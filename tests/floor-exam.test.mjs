// 技能講習モードの純ロジック検証: 指差呼称シーケンサ・円柱衝突・コース幾何
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallSequencer } from '../js/exam/calls.js';
import { checkContacts } from '../js/exam/collision.js';
import { FLOOR_COURSE as C } from '../js/exam/course-floor.js';

test('呼称: perform で順に進み、consumeThrough が未実施分を返す', () => {
  const seq = new CallSequencer([
    { id: 'a', label: 'A' }, { id: 'b', label: 'B' },
    { id: 'c', label: 'C' }, { id: 'd', label: 'D' },
  ]);
  assert.equal(seq.current.id, 'a');
  assert.equal(seq.perform().id, 'a');
  assert.equal(seq.current.id, 'b');
  assert.ok(seq.pending('c'));
  // b を飛ばして c の動作を開始 → b, c が未実施として返る
  const missed = seq.consumeThrough('c');
  assert.deepEqual(missed.map((m) => m.id), ['b', 'c']);
  assert.equal(seq.current.id, 'd');
  // 実施済み区間の再消化は空
  assert.deepEqual(seq.consumeThrough('a'), []);
  // 実施してから消化した場合は missed に含まれない
  seq.perform();
  assert.deepEqual(seq.consumeThrough('d'), []);
  assert.equal(seq.current, null);
});

test('円柱吊荷の衝突: ポールとの円-円判定と z 範囲', () => {
  const obstacles = [{ id: 'P', type: 'pole', x: 5, y: 5, r: 0.1, zLo: 0, zHi: 3 }];
  const drum = (x, y, z) => ({ x, y, z, r: 0.3, halfZ: 0.445 });
  // 中心間 0.35 < 0.4 → 接触
  assert.deepEqual(checkContacts(drum(5.35, 5, 1), null, obstacles), ['P']);
  // 中心間 0.45 > 0.4 → 非接触
  assert.deepEqual(checkContacts(drum(5.45, 5, 1), null, obstacles), []);
  // 荷を z=4 へ(荷底 3.55 > ポール上端)→ 非接触
  assert.deepEqual(checkContacts(drum(5.2, 5, 4), null, obstacles), []);
});

test('円柱吊荷の衝突: 柵(AABB)へのクランプ判定', () => {
  const fence = [{ id: 'F', type: 'box', x: 10, y: 3.2, halfX: 5, halfY: 0.03, zLo: 0, zHi: 1 }];
  const drum = (x, y, z) => ({ x, y, z, r: 0.2925, halfZ: 0.445 });
  // 柵面から 0.25 m(< r)→ 接触
  assert.deepEqual(checkContacts(drum(10, 3.48, 0.6), null, fence), ['F']);
  // 柵面から 0.4 m(> r)→ 非接触
  assert.deepEqual(checkContacts(drum(10, 3.63, 0.6), null, fence), []);
  // 柵上端より上を通過(荷底 1.05 > 1.0)→ 非接触
  assert.deepEqual(checkContacts(drum(10, 3.2, 1.5), null, fence), []);
});

test('コース幾何: 柵回廊の幅・バーポール間隔・発着円の位置', () => {
  const drumDia = C.drum.r * 2;
  // 走行経路(矩形)と柵オフセット: 両側 1.3 m → 回廊幅 2.6 m ≧ 荷径 + 振れ余裕
  const fo = C.obstacles.find((o) => o.id === 'FoN');
  const fi = C.obstacles.find((o) => o.id === 'FiN');
  const corridor = fi.y - fo.y;
  assert.ok(corridor >= drumDia + 1.5, `回廊幅 ${corridor}`);
  // 経路線は回廊の中央
  assert.ok(Math.abs((fo.y + fi.y) / 2 - C.legs[0].to.y) < 1e-9);
  // バーのポール間隔 = 荷巾 + 1 m(基発第66号 別図2 準用・ポール半径ぶん外側)
  const bp1 = C.obstacles.find((o) => o.id === 'BP1');
  const bp2 = C.obstacles.find((o) => o.id === 'BP2');
  const innerGap = (bp2.y - bp1.y) - bp1.r - bp2.r;
  assert.ok(Math.abs(innerGap - (drumDia + 1.0)) < 0.05, `通過幅 ${innerGap}`);
  // バー高さ ≈ 2.5 m・受け越え側のポールはバーより高い
  const bar = C.obstacles.find((o) => o.id === 'BAR');
  assert.ok(Math.abs((bar.zLo + bar.zHi) / 2 - 2.5) < 0.05);
  assert.ok(bp1.zHi > bar.zHi);
  // 発着円は外周柵の内側・内周柵の外側(南側回廊内)
  const foS = C.obstacles.find((o) => o.id === 'FoN');
  assert.ok(C.start.y > foS.y + C.start.r);
  assert.ok(C.start.y < fi.y - C.start.r);
  // 呼称は 22 項目・順序どおり(最初が周囲・最後が着床)
  assert.equal(C.calls.length, 22);
  assert.equal(C.calls[0].id, 'shui');
  assert.equal(C.calls.at(-1).id, 'landed');
});

test('コース幾何: 4 脚が閉路をなし発着点へ戻る', () => {
  const last = C.legs.at(-1).to;
  assert.equal(last.x, C.start.x);
  assert.equal(last.y, C.start.y);
  // 各脚は軸平行に接続
  let prev = { x: C.start.x, y: C.start.y };
  for (const leg of C.legs) {
    const dx = leg.to.x - prev.x, dy = leg.to.y - prev.y;
    if (leg.axis === 'x') {
      assert.equal(dy, 0);
      assert.ok(Math.sign(dx) === leg.dir);
    } else {
      assert.equal(dx, 0);
      assert.ok(Math.sign(dy) === leg.dir);
    }
    prev = leg.to;
  }
});
