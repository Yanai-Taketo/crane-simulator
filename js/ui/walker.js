// 床上操作の歩行オペレータ
// 床上操作式クレーンの定義どおり、押釦ペンダントはトロリ(ホイスト)から
// 吊り下がっており、操作者はケーブル到達範囲内でクレーンと共に歩く。
// クレーンが移動すればケーブルに引かれて追従する(到達半径で拘束)。
export class Walker {
  constructor(x = 8, y = 6) {
    this.x = x; this.y = y;
    this.reach = 1.6;      // ペンダントケーブルの水平到達半径 [m]
    this.speed = 1.4;      // 歩行速度 [m/s]
    this.eyeH = 1.6;       // 目線高さ [m]
    this.bounds = { xMin: 0.5, xMax: 29.5, yMin: 0.5, yMax: 15.5 };
  }

  // input: { fwd: -1..1, strafe: -1..1 }, yaw: 視線方位(物理系, 0 = 北 = −y)
  // craneX/craneY: ペンダント吊下点(トロリ位置)
  update(dt, input, yaw, craneX, craneY) {
    // 視線基準の歩行(FPS 規約): fwd は視線方向、strafe は右方向
    const fx = -Math.sin(yaw), fy = -Math.cos(yaw);   // yaw=0 → 北(−y)
    const rx = -fy, ry = fx;                           // 右手方向
    let mx = fx * input.fwd + rx * input.strafe;
    let my = fy * input.fwd + ry * input.strafe;
    const m = Math.hypot(mx, my);
    if (m > 1e-6) {
      mx /= m; my /= m;
      this.x += mx * this.speed * dt;
      this.y += my * this.speed * dt;
    }
    // ペンダントケーブル拘束: 到達半径を超えたら引き戻される
    const dx = this.x - craneX, dy = this.y - craneY;
    const d = Math.hypot(dx, dy);
    if (d > this.reach) {
      const f = this.reach / d;
      this.x = craneX + dx * f;
      this.y = craneY + dy * f;
    }
    // 建屋範囲
    this.x = Math.min(this.bounds.xMax, Math.max(this.bounds.xMin, this.x));
    this.y = Math.min(this.bounds.yMax, Math.max(this.bounds.yMin, this.y));
  }
}
