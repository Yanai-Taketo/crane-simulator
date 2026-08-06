// 古典的 4 次ルンゲ=クッタ法(固定刻み・割り付け再利用)
// rhs(t, s, out): 状態 s (Float64Array) の時間微分を out に書き込む
export function makeRK4(n) {
  const k1 = new Float64Array(n), k2 = new Float64Array(n),
        k3 = new Float64Array(n), k4 = new Float64Array(n),
        tmp = new Float64Array(n);
  return function rk4Step(rhs, t, s, h) {
    rhs(t, s, k1);
    for (let i = 0; i < n; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
    rhs(t + 0.5 * h, tmp, k2);
    for (let i = 0; i < n; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
    rhs(t + 0.5 * h, tmp, k3);
    for (let i = 0; i < n; i++) tmp[i] = s[i] + h * k3[i];
    rhs(t + h, tmp, k4);
    const c = h / 6;
    for (let i = 0; i < n; i++) s[i] += c * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  };
}
