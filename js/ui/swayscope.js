// 振れスコープ: トロリ直下を原点に、吊荷の水平変位を真上から表示
export class SwayScope {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.range = 1.6;               // 表示半径 [m]
    this.hist = [];                 // 軌跡 [{x, y}]
    this.histMax = 90;
  }

  update(rs) {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    const cx = w / 2, cy = h / 2;
    const scale = (w / 2 - 12) / this.range;

    // 吊り体(玉掛け時は吊荷、単独時はフック)の水平偏差
    // (物理座標: x=東, y=南 → 画面: 右=東, 下=南)
    const p = rs.loadAttached ? rs.loadPos : rs.hookPos;
    const dx = p.x - rs.X;
    const dy = p.y - rs.Y;
    this.hist.push({ x: dx, y: dy });
    if (this.hist.length > this.histMax) this.hist.shift();

    ctx.clearRect(0, 0, w, h);

    // 目盛りリング (0.5 / 1.0 / 1.5 m)
    ctx.strokeStyle = 'rgba(120,150,180,0.35)';
    ctx.fillStyle = 'rgba(138,160,181,0.8)';
    ctx.font = '9px sans-serif';
    ctx.lineWidth = 1;
    for (const r of [0.5, 1.0, 1.5]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${r.toFixed(1)}`, cx + r * scale + 2, cy - 2);
    }
    // 十字線
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + 6, cy); ctx.lineTo(cx + w / 2 - 6, cy);
    ctx.moveTo(cx, cy - h / 2 + 6); ctx.lineTo(cx, cy + h / 2 - 6);
    ctx.stroke();
    ctx.fillText('東', w - 16, cy - 4);
    ctx.fillText('南', cx + 4, h - 6);

    // 軌跡
    if (this.hist.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < this.hist.length; i++) {
        const p = this.hist[i];
        const px = cx + p.x * scale, py = cy + p.y * scale;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(88,196,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 現在位置
    const px = cx + dx * scale, py = cy + dy * scale;
    const amp = Math.hypot(dx, dy);
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = amp > 0.7 ? '#ff5252' : amp > 0.3 ? '#ffb63d' : '#5dd879';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
  }

  reset() { this.hist.length = 0; }
}
