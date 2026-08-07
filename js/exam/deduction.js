// 減点採点エンジン(実技試験の減点法)
// 合否基準: 減点合計が 40 点以下で合格(安全衛生技術試験協会の公式基準)。
// 接触などの連続イベントは「接触開始」で 1 回だけ計上(離れて再接触で再計上)。
export class DeductionSheet {
  constructor(passLimit = 40) {
    this.passLimit = passLimit;
    this.items = [];          // { t, code, label, points }
    this._active = new Set(); // 継続中イベント(エッジ計上用)
  }

  // 単発の減点
  add(code, label, points, t) {
    this.items.push({ t, code, label, points });
  }

  // 継続イベント: 開始エッジのみ計上。key は個体識別(例: 'contact:A1')
  // releaseNow を分けるとヒステリシスを表現できる(省略時は !triggerNow で解除)。
  // 例: 振れ 0.35 m 超で計上・0.2 m 未満まで解除しない → 中間帯での再計上を防ぐ
  edge(key, code, label, points, t, triggerNow, releaseNow = !triggerNow) {
    if (triggerNow && !this._active.has(key)) {
      this._active.add(key);
      this.add(code, label, points, t);
      return true;
    }
    if (!triggerNow && releaseNow) this._active.delete(key);
    return false;
  }

  total() { return this.items.reduce((a, i) => a + i.points, 0); }
  passed() { return this.total() <= this.passLimit; }
  count(code) { return this.items.filter(i => i.code === code).length; }
}
