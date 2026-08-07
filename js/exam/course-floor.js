// 床上操作式クレーン技能講習 修了試験コース定義
// 根拠(docs/RESEARCH-v2.md): 柵で囲った矩形周回コース(受講者報告 3 件:
// 西→南→東→北の 1 周・約 2.5 m バー障害 1 箇所・ドラム缶吊荷・制限 6–10 分)。
// バー寸法は運転士試験基準(基発第66号 別図2)を準用: ポール間 = 荷巾+1 m、
// バーは 60° 受け金具に約 5 cm 掛かり → 接触で落下(減点 10)。
// ドラム缶は JIS Z 1600 D 型(呼び 200 L): 外径 ≈0.585 m・高さ ≈0.89 m、
// バラスト充填で 500 kg(運転士試験の「円筒形・約 500 kg 以上」を準用)。
// 採点: 100 点から減点、70 点以上(減点 30 以下)で合格。

// 周回経路の矩形(吊荷中心の目標線)
const X0 = 10.0, X1 = 19.0, Y0 = 4.5, Y1 = 8.5;
const FENCE_OFF = 1.3;    // 経路から柵までのオフセット
const FH = 1.0;           // 柵高さ
const DRUM_R = 0.2925, DRUM_H = 0.89;
const BAR_X = 14.5, BAR_Y = Y1;
const BAR_HALF = (DRUM_R * 2 + 1.0) / 2 + 0.08;   // ポール中心 = 荷巾+1m の通過幅 + ポール半径

export const FLOOR_COURSE = {
  name: '床上操作式クレーン 技能講習コース',
  timeLimit: 420,          // [s] 制限 7 分(報告値 6–10 分の中庸)
  passDeduct: 30,          // 減点 30 以下(70 点以上)で合格
  loadMass: 500,
  drum: { r: DRUM_R, h: DRUM_H },
  carryBand: { lo: 0.1, hi: 0.7 },   // 搬送時の荷底高さ許容 [m](低所搬送)
  start: { x: X1, y: Y0, r: 0.45 },  // 発着円 = 荷径の 1.5 倍
  // 周回脚(順に通過。動作開始前にその方角の指差呼称が必要)
  legs: [
    { id: 'W', callId: 'west',  label: '西へ走行', to: { x: X0, y: Y0 }, axis: 'x', dir: -1 },
    { id: 'S', callId: 'south', label: '南へ横行', to: { x: X0, y: Y1 }, axis: 'y', dir: 1 },
    { id: 'E', callId: 'east',  label: '東へ走行(バー越え)', to: { x: X1, y: Y1 }, axis: 'x', dir: 1 },
    { id: 'N', callId: 'north', label: '北へ横行(S へ)', to: { x: X1, y: Y0 }, axis: 'y', dir: -1 },
  ],
  bar: { x: BAR_X, y: BAR_Y, zTop: 2.53, zoneR: 2.5 },
  obstacles: [
    // 外周柵
    { id: 'FoN', type: 'box', kind: 'fence', x: (X0 + X1) / 2, y: Y0 - FENCE_OFF, halfX: (X1 - X0) / 2 + FENCE_OFF, halfY: 0.03, zLo: 0, zHi: FH },
    { id: 'FoS', type: 'box', kind: 'fence', x: (X0 + X1) / 2, y: Y1 + FENCE_OFF, halfX: (X1 - X0) / 2 + FENCE_OFF, halfY: 0.03, zLo: 0, zHi: FH },
    { id: 'FoW', type: 'box', kind: 'fence', x: X0 - FENCE_OFF, y: (Y0 + Y1) / 2, halfX: 0.03, halfY: (Y1 - Y0) / 2 + FENCE_OFF, zLo: 0, zHi: FH },
    { id: 'FoE', type: 'box', kind: 'fence', x: X1 + FENCE_OFF, y: (Y0 + Y1) / 2, halfX: 0.03, halfY: (Y1 - Y0) / 2 + FENCE_OFF, zLo: 0, zHi: FH },
    // 内周柵(コース中央の島)
    { id: 'FiN', type: 'box', kind: 'fence', x: (X0 + X1) / 2, y: Y0 + FENCE_OFF, halfX: (X1 - X0) / 2 - FENCE_OFF, halfY: 0.03, zLo: 0, zHi: FH },
    { id: 'FiS', type: 'box', kind: 'fence', x: (X0 + X1) / 2, y: Y1 - FENCE_OFF, halfX: (X1 - X0) / 2 - FENCE_OFF, halfY: 0.03, zLo: 0, zHi: FH },
    { id: 'FiW', type: 'box', kind: 'fence', x: X0 + FENCE_OFF, y: (Y0 + Y1) / 2, halfX: 0.03, halfY: (Y1 - Y0) / 2 - FENCE_OFF, zLo: 0, zHi: FH },
    { id: 'FiE', type: 'box', kind: 'fence', x: X1 - FENCE_OFF, y: (Y0 + Y1) / 2, halfX: 0.03, halfY: (Y1 - Y0) / 2 - FENCE_OFF, zLo: 0, zHi: FH },
    // バー障害(東行脚上・高さ約 2.5 m・接触で落下)
    { id: 'BAR', type: 'box', kind: 'bar', x: BAR_X, y: BAR_Y, halfX: 0.04, halfY: BAR_HALF, zLo: 2.47, zHi: 2.53 },
    { id: 'BP1', type: 'pole', x: BAR_X, y: BAR_Y - BAR_HALF, r: 0.08, zLo: 0, zHi: 3.2 },
    { id: 'BP2', type: 'pole', x: BAR_X, y: BAR_Y + BAR_HALF, r: 0.08, zLo: 0, zHi: 3.2 },
  ],
  // 指差呼称の順序(受講者報告+エレファン取説の点検→玉掛け→運転→着床)
  calls: [
    { id: 'shui',      label: '周囲ヨシ!' },
    { id: 'runway',    label: 'ランウェイヨシ!' },
    { id: 'girder',    label: 'ガーダヨシ!' },
    { id: 'trolley',   label: 'トロリヨシ!' },
    { id: 'rope',      label: 'ワイヤロープヨシ!' },
    { id: 'hook',      label: 'フックヨシ!' },
    { id: 'latch',     label: '外れ止め装置ヨシ!' },
    { id: 'gear',      label: 'つり具ヨシ!' },
    { id: 'tsurini',   label: 'つり荷ヨシ!' },
    { id: 'button',    label: '押しボタンスイッチヨシ!' },
    { id: 'hookpos',   label: 'フック位置ヨシ!' },
    { id: 'rigged',    label: '玉掛けヨシ!' },
    { id: 'vertical',  label: '垂直に上げます!' },
    { id: 'jigiri',    label: '地切りヨシ!' },
    { id: 'stable',    label: 'つり荷安定ヨシ!' },
    { id: 'west',      label: '西ヨシ!' },
    { id: 'south',     label: '南ヨシ!' },
    { id: 'east',      label: '東ヨシ!' },
    { id: 'hoistup',   label: '巻上げヨシ!' },
    { id: 'hoistdown', label: '巻下げヨシ!' },
    { id: 'north',     label: '北ヨシ!' },
    { id: 'landed',    label: '着床ヨシ!' },
  ],
  points: {
    contact: 5, barDrop: 10,
    call: 2, callCap: 20,          // 呼称漏れ -2/件(上限 20)
    underLoad: 5, aheadOfLoad: 5,
    height: 5, noStopGround: 5, noStopSetdown: 5,
    impact: 5, outOfZone: 5, timeOver: 100, threeOp: 5,
  },
};
