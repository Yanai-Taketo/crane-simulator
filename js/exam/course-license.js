// クレーン・デリック運転士 実技試験コース定義
// 根拠: JEED 兵庫論文の図1(A–F 障害・S 発着)を本シミュレータのベイ
// (x 1.6–28.4, y 1.0–13.0)に適合させた推定寸法(docs/RESEARCH-v2.md)。
// 実寸は非公開のため比例推定であることを README に明記する。
//
// 課題: 1t 荷・搬送高さ(荷底)2.0 m 維持・バー B/E は一旦停止→巻上→越え→
// 2 m へ戻す・C ポールでヘアピン(走行方向転換)・最後の F 壁ギャップを
// 斜行で通過し S へ戻って着床。制限時間 2 分 30 秒。減点合計 40 点以下で合格。

export const LICENSE_COURSE = {
  name: 'クレーン運転士 実技試験コース',
  timeLimit: 150,          // [s]
  carryHeight: 2.0,        // 荷底の搬送高さ [m]
  carryTol: 0.35,          // 高さ許容 [m]
  loadMass: 1000,
  start: { x: 25.0, y: 5.0, r: 0.9 },
  obstacles: [
    // A ポール門(通過幅 2.0 m)
    { id: 'A1', type: 'pole', x: 20.5, y: 2.0, r: 0.15, zLo: 0, zHi: 4.0 },
    { id: 'A2', type: 'pole', x: 20.5, y: 4.0, r: 0.15, zLo: 0, zHi: 4.0 },
    // B バー障害(高さ 2.85–3.05: 2 m 搬送では荷上端 2.9 が触れる → 巻上げて越える)
    { id: 'B', type: 'box', x: 7.5, y: 3.5, halfX: 0.08, halfY: 1.3, zLo: 2.85, zHi: 3.05 },
    { id: 'Bp1', type: 'pole', x: 7.5, y: 2.1, r: 0.12, zLo: 0, zHi: 3.05 },
    { id: 'Bp2', type: 'pole', x: 7.5, y: 4.9, r: 0.12, zLo: 0, zHi: 3.05 },
    // C 方向転換ポール(ヘアピン)
    { id: 'C', type: 'pole', x: 2.6, y: 5.5, r: 0.15, zLo: 0, zHi: 4.0 },
    // D ポール門
    { id: 'D1', type: 'pole', x: 8.5, y: 7.0, r: 0.15, zLo: 0, zHi: 4.0 },
    { id: 'D2', type: 'pole', x: 8.5, y: 9.0, r: 0.15, zLo: 0, zHi: 4.0 },
    // E バー障害
    { id: 'E', type: 'box', x: 13.5, y: 5.0, halfX: 0.08, halfY: 1.3, zLo: 2.85, zHi: 3.05 },
    { id: 'Ep1', type: 'pole', x: 13.5, y: 3.6, r: 0.12, zLo: 0, zHi: 3.05 },
    { id: 'Ep2', type: 'pole', x: 13.5, y: 6.4, r: 0.12, zLo: 0, zHi: 3.05 },
    // F 壁障害(メッシュパネル・上へは逃げられない)+ポールでギャップ 1.5 m
    { id: 'F', type: 'box', x: 21.0, y: 8.05, halfX: 0.07, halfY: 1.75, zLo: 0, zHi: 4.0 },
    { id: 'Fp', type: 'pole', x: 21.0, y: 4.65, r: 0.15, zLo: 0, zHi: 4.0 },
  ],
  // 経由点(順序どおり通過。未経由でゴール = 失格)
  waypoints: [
    { id: 'A', x: 20.5, y: 3.0, r: 1.0, label: 'A 門' },
    { id: 'WS', x: 10.0, y: 2.0, r: 1.6, label: '南折返し' },
    { id: 'B', x: 7.5, y: 3.5, r: 1.3, label: 'B バー越え' },
    { id: 'C', x: 4.0, y: 5.5, r: 1.6, label: 'C 方向転換' },
    { id: 'D', x: 8.5, y: 8.0, r: 1.0, label: 'D 門' },
    { id: 'N', x: 11.5, y: 9.5, r: 1.8, label: '北頂点' },
    { id: 'E', x: 13.5, y: 5.0, r: 1.3, label: 'E バー越え' },
    { id: 'F', x: 21.0, y: 5.55, r: 1.1, label: 'F 壁ギャップ(斜行)' },
  ],
  // バー越え区間(この水平距離内では 2 m 超の巻上を許容)
  barZones: [
    { x: 7.5, y: 3.5, r: 2.6 },
    { x: 13.5, y: 5.0, r: 2.6 },
  ],
  // 減点表(調査に基づく配点。壁接触は重大)
  points: {
    contactPole: 5, contactBar: 5, contactWall: 20,
    sway: 10, height: 5, noStopGround: 5, noStopSetdown: 5,
    outOfZone: 5, timeOver: 45,
  },
};
