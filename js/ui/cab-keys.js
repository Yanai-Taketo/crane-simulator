// 運転室モードのキーボード入力: タップでノッチを 1 段ずつ入れる/戻す
// (実機のレバー操作の「ノッチ飛ばしをしない」運転に対応)
export class CabKeys {
  constructor(leverPanel) {
    this.levers = leverPanel;
    this.enabled = false;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      switch (e.code) {
        case 'ArrowRight': e.preventDefault(); this.levers.nudge('travel', 1); break;   // 東
        case 'ArrowLeft':  e.preventDefault(); this.levers.nudge('travel', -1); break;  // 西
        case 'ArrowUp':    e.preventDefault(); this.levers.nudge('traverse', -1); break; // 北
        case 'ArrowDown':  e.preventDefault(); this.levers.nudge('traverse', 1); break;  // 南
        case 'KeyW':       this.levers.nudge('hoist', 1); break;   // 巻上
        case 'KeyS':       this.levers.nudge('hoist', -1); break;  // 巻下
        case 'KeyX':       this.levers.zeroAll(); break;           // 全ノッチ中立
      }
    });
  }
}
