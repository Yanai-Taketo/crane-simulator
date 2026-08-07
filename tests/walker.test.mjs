// 歩行オペレータのペンダントケーブル拘束テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Walker } from '../js/ui/walker.js';

test('歩行: ケーブル到達半径内は自由、クレーン移動で引かれて追従する', () => {
  const w = new Walker(8, 6);
  // 半径内の歩行は自由
  w.update(0.5, { fwd: 1, strafe: 0 }, 0, 8, 6);   // 北(−y)へ 0.7m
  assert.ok(Math.abs(w.y - (6 - 0.7)) < 1e-9, `歩行 ${w.y}`);
  // クレーンが東(+x)へ 5m 移動 → ケーブルに引かれて半径 1.6m に拘束
  w.update(1 / 60, { fwd: 0, strafe: 0 }, 0, 13, 6);
  const d = Math.hypot(w.x - 13, w.y - 6);
  assert.ok(Math.abs(d - w.reach) < 1e-9, `拘束距離 ${d}`);
  // 引きずられ方向はクレーン向き
  assert.ok(w.x > 8, '東側へ引かれる');
});

test('歩行: 離れようとしても半径を超えられない', () => {
  const w = new Walker(8, 6);
  for (let i = 0; i < 600; i++) w.update(1 / 60, { fwd: -1, strafe: 0 }, 0, 8, 6);   // 南へ歩き続ける
  const d = Math.hypot(w.x - 8, w.y - 6);
  assert.ok(d <= w.reach + 1e-9, `半径内 ${d}`);
});
