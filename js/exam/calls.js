// 指差呼称シーケンサ(純ロジック・テスト可能)
// 技能講習の呼称は順序が決まっている: items を順に perform() で実施する。
// 呼称せずに対応する動作を始めた場合、採点側が consumeThrough(id) を呼び、
// 飛ばされた未実施の呼称(減点対象)を受け取る。
export class CallSequencer {
  constructor(items) {
    this.items = items.map((it) => ({ ...it, done: false, missed: false }));
    this.idx = 0;
  }

  get current() { return this.items[this.idx] ?? null; }
  get remaining() { return this.items.length - this.idx; }

  indexOf(id) { return this.items.findIndex((it) => it.id === id); }

  // id の呼称がまだ実施されていない(現在位置以降にある)か
  pending(id) { return this.indexOf(id) >= this.idx; }

  // 現在の呼称を実施して次へ進む
  perform() {
    const it = this.items[this.idx];
    if (!it) return null;
    it.done = true;
    this.idx++;
    return it;
  }

  // 動作イベント発生: id の呼称まで(id 含む)を消化し、未実施分を返す
  consumeThrough(id) {
    const end = this.indexOf(id);
    if (end < this.idx) return [];
    const missed = [];
    while (this.idx <= end) {
      const it = this.items[this.idx];
      if (!it.done) { it.missed = true; missed.push(it); }
      this.idx++;
    }
    return missed;
  }
}
