// シミュレーション定数(SI 単位系)
// 実機調査に基づく 2.8t 床上操作式天井クレーン(インバータ制御)の諸元。
// 出典: 日本ホイスト 2.8t×8m 組立図 (NHEY2.8MRV)、三菱電機 U2-2.8、
// KITO RYW 2.8t (RYWA028) カタログ等 — 詳細は README.md「実機調査」参照。

// 建屋・幾何
export const GEOM = {
  bayLen: 30,     // 建屋長さ(走行方向 x) [m] — ランウェイ 30 m
  span: 16,       // スパン(横行方向 y) [m]
  railH: 6.0,     // 走行レール踏面高さ [m]
  pivotH: 7.9,    // ロープ吊点(トロリシーブ)高さ = railH + 1.9 [m]
  load: { sx: 1.2, sy: 1.2, sz: 0.9 },  // 吊荷寸法 [m]
  slingLen: 1.1,  // 玉掛けワイヤ長(フック下端→吊荷上面) [m]
  hookHalf: 0.45, // フックブロック中心~下端 [m]
};

// クレーン諸元(2.8t クラス実機カタログ値)
export const CRANE = {
  mb: 2100,        // ブリッジ(ガーダ+サドル)質量 [kg] (スパン16m 換算)
  mt: 450,         // トロリ(電動横行ホイスト)質量 [kg]
  mHook: 30,       // フックブロック質量 [kg]
  ratedLoad: 2800, // 定格荷重 [kg]

  // 速度(2段速: [1速(低), 2速(高)] m/s)
  travelSpeed: [0.067, 0.40],    // 走行 4 / 24 m/min
  traverseSpeed: [0.067, 0.40],  // 横行 4 / 24 m/min
  hoistSpeed: [0.022, 0.133],    // 巻上 1.3 / 8.0 m/min(定格荷重時)
  hoistSpeedLight: 0.20,         // 軽負荷高速 12 m/min(定格の50%未満)

  // 加減速ランプ時間(停止→2速)
  travelRamp: 3.0,    // [s] → 加速度 0.133 m/s²
  traverseRamp: 2.5,  // [s]
  hoistRamp: 1.5,     // [s]

  // 駆動系(インバータ速度制御 + 推力飽和)
  // 走行 0.4kW×2, 横行 0.25kW×2 を定格速度・始動トルク余裕から換算
  travelForceMax: 3500,   // [N]
  traverseForceMax: 2000, // [N]
  travelFriction: 700,    // cx [N·s/m] 走行抵抗(粘性等価)
  traverseFriction: 250,  // cy [N·s/m]
  velGainTravel: 15000,   // [N/(m/s)] 速度制御 P ゲイン
  velGainTraverse: 8000,

  // ロープ長の可動範囲(吊点→フック中心)。揚程 ≈ 6.5 m
  ropeMin: 0.9,
  ropeMax: 7.4,

  // 移動範囲(緩衝器位置)
  travelMin: 1.6, travelMax: 28.4,
  traverseMin: 1.0, traverseMax: 15.0,
};

// 運転室モード: ノッチ式コントローラー(インバータ多段速)
// fractions[n] = ノッチ n の速度基準(定格速度比)。実機調査に基づき設定。
export const NOTCH = {
  count: 5,
  fractions: [0, 0.10, 0.25, 0.50, 0.75, 1.00],
};

export const PHYS = {
  g: 9.80665,
  dt: 1 / 720,          // 物理刻み [s](60fps 描画で 12 サブステップ)
  rhoAir: 1.225,
  dragCdA: 1.8,         // 吊荷の抗力係数×投影面積 [m²]
  muGround: 0.45,       // 吊荷-床の動摩擦係数
};
