# v2 実装のための詳細調査結果(一次資料)

実装時はこの文書を参照する。出典 URL は各節に記載。

---
# 運転士実技試験コース
## TASK 1: クレーン運転士実技試験コース — extracted data

### PRIMARY SOURCE (fetched, full PDF read at 600–1200 dpi)
**「クレーン運転士・実技試験に向けたクレーン仕様の検討」** 池田貴則・西田夏輝・和田雅, 担当教官 梶篤雄, 港湾職業能力開発短期大学校神戸校 (ポリテックビジョン2023), https://www3.jeed.go.jp/hyogo/college/assets/pdf/info/pv2023_07_crane_untensi.pdf (2 pages; local copy: /tmp/claude-0/-home-user-crane-simulator/9add8ab2-6c07-588d-983b-dbab92bb9ed3/scratchpad/crane.pdf, figure crops: fig1-1.png, fig6-2.png, fig6b-2.png same dir).

### EXAM TASK DEFINITION (verbatim from paper)
- 「実技試験は、1tの荷を吊って、2mの高さを維持しながら、図1のコースを所定の時間内に運転する。」
- 「コースには、A～Fのポール、バー、壁障害があり、特に最後の『F 壁障害』を斜行で通過することが難しく、合否のポイントになっている。」
- Load: **1 t**, drawn as a cylinder (weight bucket). Carry height: **2 m** (運行高さ2m annotated on 3 course legs).
- Start-point annotations (red, in 図1): 「スタート地点」(square pad with circle) → 「巻上げ後 一旦停止」 → 「高さ測定 (2m)」. I.e., hoist, mandatory stop, examiner measures 2 m height, then timed run starts.

### COURSE TOPOLOGY (図1, fully decoded; diamond/zigzag plan, all legs are 斜行=simultaneous travel+traverse)
Sequence (F is explicitly LAST): **S(start, east corner) → A ポール障害 → (south corner waypoint) → B バー障害 → C ポール障害 (west corner; 走行方向変更 = travel reverses, path hairpins around the C pole) → D ポール障害 → (north apex) → E バー障害 (bottom of a V in the middle) → F 壁障害 (tall mesh-wall panel + pole forming a gap on the NE edge, passed diagonally) → S (goal = start pad, land load in circle)**.
- Obstacle types: A, C, D = pole gates (pairs of poles on yellow bases; C is the turn pole); B, E = bar obstacles (horizontal/diagonal bar between poles); F = wall (tall fence panel, cannot pass over — must go through gap).
- Bar maneuver (arrows in 図1 + ikigaiblog): approach at 2 m → **一旦停止 before bar → hoist UP over the bar (バー越え) → pass → lower back to exactly 2 m** (「巻下げを忘れる方が多い」= common fault).
- Wall F maneuver: 一旦停止 before F → pass gap by 斜行 at 2 m (no hoisting).

### DETAILED RUN PROCEDURE + TIME LIMIT (source: https://ikigaiblog.com/crane-jitsugi/ — 教習所検定, same course format)
1. 足踏ブザー to start; 2. tension wire, stop; 3. **地切り 10–20 cm, stop** (stability check); 4. hoist to 2 m; 5. height measured; 6. START (timer); 7. 斜行 to A; 8. stop before B, hoist over B, lower to 2 m; 9. B→C→D 斜行 (travel direction change at C); 10. 斜行 to E, stop, hoist over E, lower to 2 m; 11. stop before F, pass F; 12. return to S, align over circle; 13. lower to 地切り height, **stop**, then slow touchdown, buzzer = end. **制限時間 2分30秒**. Controls: 走行ハンドル=right hand, 横行+巻上下ハンドル=left hand, 足踏ブレーキ (travel), 足踏ブザー; notches 1–6 per handle (教習クレーン); **3 simultaneous operations forbidden, max 2**.

### SCORING (official + unofficial)
- OFFICIAL (https://www.exam.or.jp/introduction/h_shokai206/): subjects = 「クレーンの運転」+「クレーンの運転のための合図」; pass = **減点の合計が40点以下** (=60/100点以上). 玉掛け技能講習修了者は合図科目免除. Fee 実技14,000円. Pass rate: R5年度実技 45.8% (CIC), H26 48.8%.
- UNOFFICIAL per-fault deductions (Yahoo知恵袋 best answer, https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q12102827287 — anecdotal, use as sim defaults): **荷振れ: 振り子運動一往復につき10点減点**; **ポール/バー接触(落下・倒壊なし): 5点**; **吊荷高さ不良での走行: 5点以上**; **走行・横行速度不適切: 5点以上**; **地切り直後・接地直前の一時停止忘れ: 5点以上**; disqualification-class (20点以上〜即失格): 課題障害物への接触・倒壊, 指定ポール不経由でゴール, ストッパーへ激突, 3コントローラ同時操作, 姿勢不良, 指示不服従・暴言; **試験官の安全介入 = 100点減点** (即不合格).
- 時間超過 is a distinct failure cause (12% of failures, see below) — implement as fail/heavy deduction at >2:30.

### FAILURE STATISTICS (paper, n=35 港湾技術科22–24期生)
- 1回目合格 53%, 2回目 27%, 3回目 17%, 4回目 3%.
- Failure causes: **壁に接触 67%, ポールに接触 15%, 時間超過 12%, 減点超過 6%** → 82% fail by obstacle contact (wall F dominates).
- Perceived exam-crane differences vs inverter training crane (図4): 横行が早い 45%, 横行/走行の速度比率が違う 32%, 始動(加速)の動きが違う 14%, 荷の振れ方が違う 9%.

### EXAM CRANE SPEC (図6 table — 近畿安全衛生技術センター〈試験クレーン〉, verbatim)
- つり上げ荷重 5.05 t / 定格荷重 5.0 t / **スパン 13 m** / 揚程 7 m
- **走行: 100 m/min**, 巻線形二次抵抗制御, 巻線形三相誘導電動機 5.5 kW, 足踏油圧ブレーキ
- **横行: 40 m/min**, 巻線形二次抵抗制御, 巻線形三相誘導電動機 2.2 kW, 電磁ブレーキ
- **巻上げ下げ: 15 m/min**, 巻線形二次抵抗制御, 巻線形三相誘導電動機 15 kW, 電磁ブレーキ+電気油圧ブレーキ
- ワイヤーロープ 6×Fi(29) 普通Z B種 **φ12.5 ×4本掛け** (4-fall)
- Character (paper): 巻線形+二次抵抗 → 「立ち上がりがゆっくり」「負荷の大小で速度変化」 (vs インバータ: 「加減速の速度が速い」「速度調整が可能」). Travel:traverse rated ratio = 100:40 = 2.5:1 — the felt "速度比率が違う".
- Comparison cranes: 港湾短大〈実習〉スパン14.6m/揚程8.5m, 走行5–50, 横行2.5–25, 巻1.2–12 m/min, インバータ, かご形 (走行2.2kW×2, 横行1.5kW, 巻15kW), rope φ11.2×4; 港湾技能研修センター〈研修〉スパン15.9m/揚程8.0m, 走行25(60), 横行18(40), 巻8(12) m/min, 巻線形二次抵抗 (format "notch-low (max)" m/min, mimics exam crane).
- Speed formula (実習クレーン 走行): **速度[m/min] = 1110 rpm × (1/9.778) × (18/40) × 0.315π × 設定Hz/60Hz** (motor rpm × reducer × wheel-axle ratio × wheel circumference[m] × inverter freq scale); 同期速度 Ns = 120f/P. Their retune result (to mimic exam crane 1ノッチ): 走行 20.9→25.1, 横行 16.5→26.2, 巻上下 6.2→10.8 m/min.

### DIMENSIONS — NOT PUBLISHED ANYWHERE (searched: exam.or.jp, JCA支部, 教習所, 受験記, alpha-reality simulator site). ALL BELOW = ESTIMATES derived from 図1 pixel proportions scaled to span 13 m and checked against the 2:30 limit:
Plan coords (x=走行[m] east+, y=横行[m] north+), course footprint ≈ **26 m × 8 m** inside 13 m-span bay:
S start/goal pad (≈1 m sq + circle): (25.0, 3.0); A pole gate: (20.5, 1.0); south waypoint: (10.0, 0.0); B bar: (7.5, 1.5); C turn pole: (0.0, 3.5); D pole gate: (8.5, 6.0); north apex: (10.0, 8.0); E bar: (13.5, 3.0); F wall gap: (21.0, 5.0).
Element estimates: pole gate clear width ≈ 2.0 m; pole height ≈ 3.5–4 m on ~φ0.5 m yellow bases; bar top height ≈ 2.8–3.0 m (raise load from 2 m to ~3.3 m to clear); F wall = mesh panel ≈ 3.5–4 m tall × ~3.6 m wide, gap to pole ≈ 1.5–2.0 m; load = 1 t cylinder ≈ φ0.8 × 1.0 m on 4-leg sling.
Consistency check: total path ≈ 55 m; at 50–60% duty of 走行1.67 m/s ⊕ 横行0.67 m/s ≈ 0.7–0.9 m/s avg + 3 stops (~8 s) + 2 hoist-over cycles (1.2 m at 0.25 m/s ≈ 10 s each) ≈ 2:05–2:25 → fits 2:30 with little margin. 
UNKNOWNS to keep configurable: exact obstacle spacing, bar height, wall gap width, per-notch speed steps of the exam crane.

### MISC
- Exam slot ≈ 10 min/person total (http://www.dokidoki.ne.jp/home2/cosmos/life/license_crane.htm); 実技教習 = 基本運転4h + 応用運転4h + 合図1h, 修了試験 (fee例 117,700円 JCA東海); ~2/3 of licensees bypass the center exam via 教習所.
- A commercial VR replica exists (alpha-reality 天井クレーンシミュレータ, https://crane-sim.alpha-reality.co.jp/) — per-test-center speed & cab-position presets, post-run swing/path trace overlay = good feature precedent.

Sources: [JEED paper PDF](https://www3.jeed.go.jp/hyogo/college/assets/pdf/info/pv2023_07_crane_untensi.pdf), [安全衛生技術試験協会 クレーン限定](https://www.exam.or.jp/introduction/h_shokai206/), [ikigaiblog 実技教習](https://ikigaiblog.com/crane-jitsugi/), [知恵袋 減点](https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q12102827287), [CIC column](https://www.cic-ct.co.jp/column/anzencrane-column/anzencrane-column-column03/), [JCA東海](https://www.jcatokai.jp/3kousyuu/syousai/syousai01.html), [港湾技能研修センター神戸](https://anteikyoukai.or.jp/kensyukobe/course/09-2/), [dokidoki受験記](http://www.dokidoki.ne.jp/home2/cosmos/life/license_crane.htm), [alpha-reality simulator](https://crane-sim.alpha-reality.co.jp/)

---
# 試験場クレーン駆動モデル(二次抵抗制御)
## TASK 2 — Wound-rotor + secondary-resistance (FK制御) drive model for exam crane, with brake sequences

### 1. Governing equations (implement exactly this)

Per axis, motor shaft dynamics: `J_eff·dω/dt = T_motor(s, notch) − T_load − T_fric`, with slip `s = (ω_sync,dir − ω)/ω_sync,dir` where `ω_sync,dir = ±ω_sync` follows the CONTACTOR direction (sign of selected direction), not motion. This makes plugging automatic: throwing the lever the other way while moving gives s ≈ 2−s_prev ∈ (1,2) → braking torque from the same formula. s<0 (overhauling load, 巻下げ) gives regenerative braking torque (motor runs above sync; FK control cannot go below sync speed when lowering — Mitsubishi MEE doc: 「巻下げなどのマイナス負荷のときは同期速度以下の速度制御ができません」).

Kloss torque (stator R neglected, adequate here):
`T(s) = 2·T_b / (s/s_m,n + s_m,n/s)`  (signed by s; T_b = breakdown torque, constant across notches)
Rotor-resistance proportional shift (比例推移, JEEA lecture 12130): `s_m,n = s_m0 · (R2 + Rext_n)/R2` — only s_m shifts, T_b unchanged.
Add a 1st-order torque lag τ_elec ≈ 60–100 ms on T_motor to soften contactor steps (electrical transient), plus the notch/step contactor timing below.

### 2. Concrete parameterization (calibrated to JEED notch-1 speeds)

Base motor constants (crane-duty wound rotor, JEM-1202 class): k = T_b/T_n = 2.3 (crane motors 2.2–3.0), natural rated slip s_n = 0.06 → s_m0 = s_n·(k+√(k²−1)) = 0.262. Notch 1 sized by the Mitsubishi FK rule: 「始動時のトルクは通常、モータ定格トルクの70%となるように二次抵抗器を選定」(sometimes 50%) → T(s=1)|N1 = 0.70·T_n → s_m1 = 6.42 (Rtotal ≈ 24.5·R2). Geometric grading ρ_n = 24.5^((5−n)/4):

| notch | s_m,n | stall torque T(1) [%Tn] | plug torque T(2) [%Tn] |
|---|---|---|---|
| N1 | 6.42 | 70 | 131 |
| N2 | 2.89 | 142 | 215 |
| N3 | 1.30 | 222 | 210 |
| N4 | 0.583 | 200 | 124 |
| N5 | 0.262 (shorted) | 113 | 59 |

Steady balance slip closed form: `s_bal(τ) = s_m,n·(k/τ − √((k/τ)²−1))`, τ = T_load/T_n.
Resulting steady speeds (fraction of sync): travel τ=0.15 (friction): N1 79.1%, N2 90.6%, N3 95.8%, N4 98.1%, N5 99.1%. Hoist with 1 t exam load on 5 t crane (τ=0.25 incl. tackle loss): N1 65.0%, N2 84.3%, N3 92.9%, N4 96.8%, N5 98.6%. At rated 5 t (τ=1.0): N1 CANNOT LIFT (balance only at s=1.47, i.e., load creeps DOWN — authentic FK behavior), N2 34%, N3 70%, N5 94% (= rated point s=0.06 ✓).
Load sag (light→rated, hoist): N3 24%, N4 10.5%, N5 4.6% → hits the required "10–30%" on working notches; regulation is 「低速にてきわめて大」/no velocity regulation (open-loop torque control) — MEE table: FK control range 30–100% speed, 変動率 extremely large at low speed; only closed-loop thyristor/eddy-brake variants achieve 3–5% (Hitachi 表3).

Speed anchors (JEED, section 7 of the PDF — measured/tuned 1-notch speeds): 走行 25.1, 横行 26.2, 巻上下 10.8 m/min. Exam crane (近畿安全衛生技術センター) is 巻線形電動モータ+二次抵抗速度制御; noted traits: 「立ち上がりがゆっくり」「負荷の大小で速度変化」. Back-solve sync speeds so N1 steady = JEED values: 走行 v_sync = 25.1/0.791 = 31.7 m/min (N5 full ≈ 31.5); 横行 v_sync = 26.2/0.791 = 33.1 (full ≈ 32.8); 巻上 v_sync = 10.8/0.650 = 16.6 m/min at 1 t (full @1 t = 16.4; nameplate @5 t = 15.6). Full notch table travel (m/min, τ=0.15): 25.1 / 28.8 / 30.4 / 31.1 / 31.5. Hoist @1 t: 10.8 / 14.0 / 15.4 / 16.1 / 16.4. For the 0.4 kW sim axis: 6-pole 60 Hz, n_sync = 1200 rpm (ω_s = 125.7 rad/s), T_n = 400 W / (0.94·125.7) = 3.39 N·m, T_b = 7.79 N·m; pick total gear ratio = 1200 rpm / (v_sync/(π·0.315 m)) (JEED's own crane: v[m/min] = 1110 rpm × 1/9.778 × 18/40 × 0.315π × Hz/60 = 50.6 m/min @60 Hz; 1110 rpm confirms s≈0.075 class slip).

### 3. Controller/notch structure & timing

- Lever: 0–5 notches each direction (crane-club: controllers 0ノッチ〜5ノッチ); mechanical interlock knob at 0.
- Indirect operation (間接操作, what exam cranes use): secondary contactors 11MC→14MC short resistor steps SEQUENTIALLY on definite-time relays (限時方式) — even if the operator slams 0→5, steps close one at a time; use 0.5–1.0 s per step (spec 0.7 s; MEE gives mechanism, interval is standard practice, tune to feel). ≤11 kW FK uses 3 steps (11–13MC) + N1 = 4 stages; standard 4 steps → our 5-notch model is faithful. Balanced shorting (間接) → smooth monotone curves, no torque dip. Direct operation would give the Görges dip (torque sag near 50% speed on notches 2–3, MEE 図12) — optional flavor only.
- Coasting: travel controllers include a coasting (惰行/コースチング) notch — power off, brake NOT applied; operator coasts then brakes (Hitachi 1968). Exam crane practice: 横行 typically has NO powered service brake (coast to stop); 走行 has foot brake; 巻上 has automatic electromagnetic brake.
- Plugging (逆ノッチ): allowed by hardware; torque from the same Kloss with contactor-side slip (N1 plug ≈ 1.3·T_n). Mitsubishi offers PR制御 (automatic plugging) as an option; on exam it is rough handling — flag for scoring.

### 4. Brake sequences

(a) Wound-rotor exam crane (AC magnet drum brake, LS-SY series): brake magnet is wired in parallel with the stator contactor — no torque-check logic. Measured operate times (Hitachi 図11 oscillograms): LS45-SY3: release = 0.005 s pickup + 0.171 s stroke ≈ 0.18 s; set (de-energize) = 0.004–0.01 s + 0.062 s ≈ 0.07 s. LS125-SY2 (larger/hoist): release ≈ 0.013+0.175 = 0.19 s; set ≈ 0.024+0.149 = 0.17 s. Implement: hoist brake torque ratchets to ≥150% of rated-load torque (クレーン構造規格 requirement; CF-type service brakes are 220–300% of motor rated torque). On lever→0: stator drops in ~30 ms, brake sets 0.07–0.17 s later → brief torque-free window; simulate the few-mm load droop physically. On lever→N1: motor torque appears within ~2 cycles (~40 ms) BEFORE brake fully releases (~0.18 s) → no rollback, slight "launch against brake" feel.

(b) Inverter hoist (FREQROL-A800 / A800-CRN brake sequence, Pr.292 = 7 (no ack) or 8 (with BRI ack), confirmed defaults): Pr.278 brake-opening frequency = 3 Hz (0–30), Pr.279 brake-opening current = 130% (0–400), Pr.280 current-detection time = 0.3 s (0–2 s) ← this is the "torque-establishment delay" (task's 0.1–0.3 s: confirmed, default 0.3), Pr.281 brake operation time at start = 0.3 s, Pr.282 brake-operation (closing) frequency = 6 Hz (= 10% of 60 Hz base), Pr.283 brake operation time at stop = 0.3 s. START: run cmd → output ramps and holds ≥Pr.278; when f ≥ 3 Hz AND I ≥ 130% held 0.3 s → BOF (brake-open request) ON → mechanical release ~0.15–0.2 s → (mode 8: wait BRI, timeout ~2 s → E.MB fault) → after Pr.281 = 0.3 s accelerate. Lever-to-motion ≈ 0.4–0.5 s total. STOP: decel; at f ≤ Pr.282 = 6 Hz → BOF OFF → brake sets (~0.1–0.2 s) → inverter keeps torque/DC-injection for Pr.283 = 0.3 s, then base-block. A800-CRN extras: per-direction brake release levels, "quick torque establishment" (fast flux build) shrinking the Pr.280 phase, anti-rollback torque bias at release; with encoder vector + zero-speed hold, brake close threshold can be set ~1–2% speed (task's ~2%) — use 2% in closed-loop mode, 10% (6 Hz) in open-loop V/f mode.

### 5. Audio cue timings (drive-derived)
Contactor "clack" at every notch change AND at each auto-acceleration step (0.7 s cadence while it walks 11MC→14MC); 100/120 Hz magnet hum while brake coil energized; brake release "chunk" at t+0.18 s after lever leaves 0 (wound-rotor) or at BOF+0.15 s (inverter); brake set "clunk" 0.07–0.17 s after power-off; rotor-slip whine pitch ∝ slip frequency s·f1 (audible growl at high slip on N1/plugging).

### Sources
- JEED 兵庫職業能力開発大学校, クレーン運転士・実技試験に向けたクレーン仕様の検討 (notch-1 speeds 25.1/26.2/10.8 m/min; exam crane = 巻線形+二次抵抗; speed formula 1110rpm×1/9.778×18/40×0.315π): https://www3.jeed.go.jp/hyogo/college/assets/pdf/info/pv2023_07_crane_untensi.pdf
- 三菱電機エンジニアリング「三菱クレーン用制御方式」(FK制御 curves, 70%/50% starting-torque sizing, 限時 sequential shorting, Görges note, control range 30–100%, MB/AS variants): https://www.mee.co.jp/sales/system-solution/machine/pdf/sales_fa_machine_control-method_as-mb-fk.pdf
- 日立評論 1968-04 クレーン用三相誘導電動機の制御装置 (brake operate-time oscillograms, CF brake 220–300%, coasting notch, 変動率 3–5% closed-loop only): https://www.hitachihyoron.com/jp/pdf/1968/04/1968_04_15.pdf
- FR-A800 Instruction Manual (Detailed) — brake sequence Pr.278–283 defaults: https://vfds.com/content/manuals/mitsubishi/mitsubishi-a800-manual.pdf ; https://www.manualslib.com/manual/2780325/Mitsubishi-Electric-Fr-A800-Series.html?page=624
- FREQROL-A800 Plus for CRANES (expanded brake sequence, quick torque establishment, per-direction release levels): https://www.mitsubishielectric.co.jp/fa/products/drv/inv/pmerit/fr_a800_plus_crn/index.html ; https://www.mitsubishielectric.co.jp/fa/products/drv/inv/pmerit/fr_a800_plus/crn01.html
- 日本電気技術者協会 比例推移/始動・制動: https://jeea.or.jp/course/contents/12130/ ; https://jeea.or.jp/course/contents/12131/
- CRANE CLUB 制御器 (0–5 notch controllers, brake conventions): http://www.crane-club.com/study/crane/control.html

---
# 床上技能講習コースと歩行制約
TASK 3 FINDINGS: 床上操作式クレーン技能講習修了試験 + 歩行オペレータ制約
=================================================================

## A. LEGAL FRAME / COURSE STRUCTURE (技能講習)
- Definition (安衛法61条, 施行令20条6号, 別表18第26号): 床上操作式クレーン = 「床上で運転し、かつ、当該運転をする者が**荷の移動とともに移動する**方式のクレーン」. Pendant hangs from the **trolley** → operator must follow BOTH travel and traverse. 床上運転式 (different license) = pendant from **girder**, operator follows travel only, need not follow traverse. Source: BCSA PDF https://bcsa.or.jp/kensa/faq/docs/crane_chigai.pdf (verbatim: 「操作ペンダントがトロリから下がり、運転者は常にトロリ（荷）と共に移動する」), https://www.toukiren.or.jp/kousyu_14.html
- Curriculum (3 days, 20h): 学科: クレーン知識6h + 原動機・電気3h + 力学3h + 関係法令1h + 学科修了試験1h; 実技: 運転のための合図1h + 運転6h + 実技修了試験~1h (toukiren.or.jp). 学科 pass: マークシート ~20問3択, retakes given, ~98% pass. 実技 pass rate ~95% overall (blog: xn--08jy42mhyab08bnpoiub9w7a.net/yukauecrane-pass-rate/).
- Practical scoring: 減点方式 from 100 points. 技能講習 convention (forklift precedent, 4492.biz/forklift/kijyun.html): **pass ≥70/100 (i.e. deductions ≤30)**. The national license practical (below) uses deductions ≤40 (≥60). Use 70 as sim pass threshold for the 技能講習 scenario, 60 for the license scenario.

## B. 技能講習 PRACTICAL EXAM AS OBSERVED (3 first-hand reports)
1) dassen-ozisan.com/kurennkousyuumatome: task = 「ドラム缶を床上操作式クレーンで吊り上げていき、所定のコースを1周して運んでいく」. **Time limit ~10 min** (instructor with stopwatch). Judged on: (a) 声かけ・合図 correct, (b) within time, (c) 「コース内に設けられている柵や壁にぶつかっていないか」. Verbatim: most common deduction = 「クレーンの起動・停止時に…荷のブレで壁や柵に激突してしまい減点となるパターンが最多」. Practice calls quoted: 「フックの取り付けヨシ！」「玉掛けヨシ！」「垂直に上げます！」.
2) minkara.carview.co.jp/userid/130170/blog/14521178/: **course = closed loop ~15 m**: 西(走行)→南(横行)→東(走行)→北(横行); one **bar obstacle at ~2.5 m height** (走り高跳びバー style) on the south leg → must hoist over it. Load = vertical cylinder (drum) pre-rigged with **3-leg chain sling**; hook starts ~2 m above floor. **Time limit 6 min**. Sway timing tip (verbatim): 「南北は横行なので『振れが最大になったら』ボタンを押し、東西は走行なので『振れが最大になる少し前に』ボタンを押す」(their crane's travel had different lag). 6/6 candidates passed.
3) moguchan.info/entry267.html: **7 min limit**; direction calls by compass: 「東（ひがし）よし！」「巻き上げよし！」; deduction for missing 指差呼称 = 「安全確認不足」.
→ SIM COURSE (技能講習 scenario): rectangular loop 15-20 m circumference inside fenced corridor (fence panels along path), one lift-over bar at 2.5 m, drum start/goal circle, limit 6-10 min (default 7 min), collision with fence/bar = deduction, missed call = deduction.

## C. 指差呼称 SEQUENCE (ordered, from minkara exam report + dassen + Elephant manual procedure)
Pre-start inspection (each pointed + called): 「周囲ヨシ」「ランウェイヨシ」「ガーダヨシ」「トロリヨシ」「ワイヤロープヨシ」「フックヨシ」「外れ止め装置ヨシ」「つり具ヨシ」「つり荷ヨシ」「押しボタンスイッチヨシ」. Pre-lift: 「フック位置ヨシ」(hook over CG)→「つり角度ヨシ」「重心位置ヨシ」「玉掛けヨシ」→「垂直に上げます」→ hoist until slings taut, pause →「地切りヨシ」(lift ~10-20 cm, pause, check balance — textbook value; guideline only mandates the pause: 「地切り時につり荷の状況を確認し、必要な場合は…玉掛けをやり直す」基発96号) →「つり荷安定ヨシ」→ per move: direction call 「東ヨシ／西ヨシ／南ヨシ／北ヨシ」+「巻上げヨシ／巻下げヨシ」→ landing: pause just before touchdown (着地直前一旦停止) → touchdown → pause again BEFORE slackening slings (Elephant manual (3): 「玉掛け用具…を緩める前に再度一旦停止を行い、つり荷の安定を確かめて」) →「着床ヨシ」→ raise empty hook to ~2 m, return, power off. Scoring: each missed call = deduction (sim: -2 each, cap; see license exam -2/signal-error precedent).

## D. OFFICIAL LICENSE-EXAM COURSE (fully dimensioned template; 基発第66号 平成10.2.25, JAISH) — use as the second scenario and as basis for obstacle geometry
Source: https://www.jaish.gr.jp/anzen/hor/hombun/hor1-39/hor1-39-2-1-0.htm (Shift-JIS; decoded verbatim). Course diagrams downloaded: /tmp/claude-0/-home-user-crane-simulator/9add8ab2-6c07-588d-983b-dbab92bb9ed3/scratchpad/besshu1.gif (別図1 layout), besshu2.gif (別図2 obstacle dims).
- Crane: ≥5 t 天井クレーン, 9-button pendant (電源入/切, 巻上げ, 巻下げ, 東, 西, 南, 北, 警報).
- Route: total **≥45 m**, closed loop; **4 diagonal legs**; **1 wall obstacle** on a first-half diagonal; **3 bar-over obstacles** (first-half travel leg, near midpoint, second-half travel leg); **2 pole obstacles** near turns. White lines + arrows; start/goal circle diameter = **1.5× load diameter**; crane girder side 3-5 m from start point (別図1).
- Obstacle dims (別図2; 荷巾 = load width): (イ) pole pair, h≈2 m, gap = 荷巾+1 m. (ロ) bar obstacle: bar at ≈2 m, poles to ≈3 m (bar+1 m), gap = 荷巾+1 m; bar rests in a 60°-inclined seat with ~5 cm engagement → knocks off when struck (sim: dislodge if contact displacement >5 cm). (ハ) wall obstacle: poles ≈2 m, gap = 荷巾+**1.2 m**, mesh/net panels ≈1.8 m long, vertical arrangement top-down 0.2 m open + 0.9 m panel + 0.9 m panel. (ニ) pole pair h≈3 m, gap = 荷巾+1 m. (ホ) bar at ≈2.5 m, poles to ≈3.5 m, gap = 荷巾+1 m, same 60°/5 cm seat.
- Load: **cylinder, ≥~500 kg** (荷の形状は円筒形とし、質量は約500キログラム以上).
- Carry heights (load bottom): first part **1 m, tolerance 0.8-1.3 m** (out-of-band → examiner orders correction); after midpoint bar, **2 m, tolerance 1.8-2.3 m**. Bar crossing: start hoisting ~1 m before obstacle, load bottom must pass **between bar and pole top**, return to cruise height ~1 m after.
- Button rules: pressing **3 buttons simultaneously forbidden**; on diagonal legs must press **exactly 2** simultaneously.
- Time: standard time = **1.3× instructor's model run** (模範運転時間の30%増し); clock from start whistle to touchdown at goal, minus height-measurement stops.
- Pass: deductions ≤40. Immediate fail: examiner stops run if dangerous. Signal test: identify 5 of the basic crane signals, **-2 per error**.
- Operator corridor: **width 2 m, ≥2 m from the load route**; operating while stepping outside the white lines is a violation (「通路の白線内から逸脱しないで行わせる」) → sim deduction.

## E. DRUM CAN SPEC (exam load body)
JIS Z 1600:2017 鋼製オープンヘッドドラム, domestic type **D** (the common "200 L" drum, actual capacity 208 L): body inner dia **566±2 mm**, chime (rim) outer dia **585-596 mm**, overall height **878-890±5 mm**, sheet 0.6-1.6 mm, empty mass **16.7 kg (1.0/1.0 mm L-grade) to 27.0 kg (1.6/1.6 mm H-grade)** (https://kikakurui.com/z1/Z1600-2017-01.html; trade figure ~20 kg, monotaro/nisshin-yoki). The task's φ567×851 = body inner dia × inner height (JIS 内高 820-855). SIM: render drum φ585×890 mm; exam load = ballasted drum or drum-shaped steel cylinder **500 kg** (license spec) — an empty 20 kg drum is NOT the exam load; 技能講習 centers use a weighted drum with 3-leg chain sling (minkara). 500 kg in a 208 L drum ≈ filled with sand/concrete ballast (water-full = ~220 kg; concrete-full ≈ 480-500 kg — consistent with concrete-filled).

## F. WALKING-OPERATOR CONSTRAINT (implementable model)
- Pendant geometry: cable anchored to trolley/hoist at height h_a; switch head hangs at ~1.1-1.5 m above floor (NO statutory height exists — ergonomic industry practice, waist-chest; sim default: switch top 1.2 m, operator hand 1.1 m). Cable length L_p = h_a − h_switch + s (slack s ≈ 0.3-0.5 m). **Max lag radius r_max = sqrt(L_p² − (h_a − h_hand)²)**. Example h_a=5.0 m, L_p=4.1 m, hand 1.1 m → r_max=1.26 m; with 0.5 m slack → 1.81 m. So operator must stay within **~1.3-1.8 m horizontal of the trolley plumb point**; JCA rule confirms taut-angled operation happens and forbids releasing it: 「斜めに引張った状態でペンダントスイッチを手から離さないこと」 (cranenet.or.jp/susume/susume02_05.html, decoded from Wayback 20260209 snapshot).
- Speeds: standard pendant-operated hoist cranes 0.5-5 t (OS Sangyo standard table, 床上押釦操作6点, ossangyo.co.jp/product/data01.html): 走行 **21/25 m/min (50/60 Hz) = 0.35/0.417 m/s**; 横行 21/25 m/min; 巻上 2.8 t: **6.7/8.0 m/min**, 5 t class similar-lower. The given 24 m/min (0.40 m/s = 1.44 km/h) sits inside the 21-25 band → valid default. Human preferred walk 1.2-1.4 m/s (4.3-5 km/h) ⇒ operator keeps pace at a slow stroll; sim operator max speed 1.4 m/s, so catching up after a 2 m lag takes <2 s. CONFIRMED operators walk alongside: Elephant manual 図12 rule (verbatim): 「運転者は常に前方に注意し、**つり荷の後方または横の位置から、つり荷について歩く**ように運転しなければなりません」 (https://www.elephant.co.jp/files/libs/1060/201910161557186830.pdf) → never ahead of the load in its direction of travel, never under it.
- Standing-position rule set for the sim (violations → deduction/fail):
  1. Never under the load: クレーン則第29条 (verbatim: 「…つり上げられている荷…の下に立ち入ることについて、禁止する旨を…禁止しなければならない」— triggered by 1本づり, ハッカー, 1-clamp etc.; thoz.org 昭和47年労働省令第34号 第29条). Sim: horizontal distance operator↔load CG must exceed load radius + 0.5 m whenever load is airborne.
  2. Not in the direction of travel: operator offset must be behind or lateral: allowed sector = {angle between (op−load) and load velocity ≥ ~90°} (Elephant 図12).
  3. Visibility + attention: 「つり荷がよく見える位置で運転し，周囲の安全を確認」「つり荷の下で運転操作をしないこと」「荷をつったままで運転位置を離れてはならない」(JCA 安全運転心得 III-2 (3)(4)(9)(10)).
  4. Exam corridor: stay inside the 2 m wide walkway ≥2 m from load path (license course) / behind fence line (技能講習 course).
  5. Hook travel height empty: ~2 m above floor (Elephant: 「目安として、フック高さは床面上2メートルぐらい」; end-of-work hook ≥2 m).
  6. 玉掛けガイドライン (平12.2.24 基発96号): operator must halt if anyone enters under load (「つり荷の下に労働者が立入った場合は、直ちにクレーン操作を中断」), signaler positioned to see both operator and slinger; sling angle 原則60度以内/90度以内 caps (anzen-pro.com/blog/column/postid_1310/, jsite.mhlw.go.jp hyogo tamakake01.pdf).

## G. SIM DEDUCTION TABLE (synthesis for 技能講習 scenario; anchor values)
Start 100, pass ≥70. Per event: missed/wrong 指差呼称 -2 (license-exam signal-error precedent); load height out of band (0.8-1.3 m / 1.8-2.3 m) → forced correction + deduction; contact with fence/pole/wall -5; knocking bar off (>5 cm contact) -10; operator steps out of corridor / under load / ahead of load -5 to disqualification; 3-button press = violation; time over = fail; examiner-judged dangerous op = immediate fail (基発66号 2-(8)).

Sources: jaish.gr.jp/anzen/hor/hombun/hor1-39/hor1-39-2-1-0.htm (+ diagrams hor1-39-2-1-2.gif, -3.gif, saved to scratchpad as besshu1.gif/besshu2.gif); dassen-ozisan.com/kurennkousyuumatome; minkara.carview.co.jp/userid/130170/blog/14521178/; moguchan.info/entry267.html; bcsa.or.jp/kensa/faq/docs/crane_chigai.pdf; cranenet.or.jp/susume/susume02_05.html; elephant.co.jp/files/libs/1060/201910161557186830.pdf; kikakurui.com/z1/Z1600-2017-01.html; ossangyo.co.jp/product/data01.html; toukiren.or.jp/kousyu_14.html; thoz.org (クレーン則29条); 4492.biz/forklift/kijyun.html; xn--08jy42mhyab08bnpoiub9w7a.net/yukauecrane-pass-rate/

---
# 力学解析解とWebAudio合成
TASK 4 — Analytical solutions for test verification + WebAudio synthesis recipes. All numbers below verified numerically (g = 9.81 m/s²).

=====================================================================
(a) DOUBLE PENDULUM (hook m1 at L1, load m2 at L2 below hook) — LINEARIZED NORMAL MODES
=====================================================================
Linearized EOM (planar, fixed pivot; moving-trolley correction enters only as prescribed pivot acceleration forcing term, negligible for free-oscillation tests):
  (m1+m2)·L1·θ1″ + m2·L2·θ2″ + (m1+m2)·g·θ1 = 0
  L1·θ1″ + L2·θ2″ + g·θ2 = 0
Characteristic equation (quartic in ω²):
  m1·L1·L2·ω⁴ − (m1+m2)·g·(L1+L2)·ω² + (m1+m2)·g² = 0

CLOSED FORM (exact):
  ω²± = g·(m1+m2) / (2·m1·L1·L2) · [ (L1+L2) ± sqrt( (L1+L2)² − 4·(m1/(m1+m2))·L1·L2 ) ]
Equivalent standard form (Goldstein, Classical Mechanics §6.4; Wikipedia "Double pendulum", normal modes section — same polynomial with point masses):
  ω²± = [ (m1+m2)·g·(L1+L2) ± sqrt( (m1+m2)²·g²·(L1+L2)² − 4·m1·(m1+m2)·g²·L1·L2 ) ] / (2·m1·L1·L2)

NUMERIC (L1=4, L2=2, m1=30, m2=1030, m1+m2=1060):
  ω²− = 1.645414 rad²/s² → ω− = 1.282737 rad/s, f− = 0.204154 Hz, T− = 4.89826 s
  ω²+ = 258.31959 rad²/s² → ω+ = 16.072324 rad/s, f+ = 2.557990 Hz, T+ = 0.390932 s
Sanity anchors: single pendulum L1+L2=6 m gives ω² = 1.635 (low mode is within 0.6% because m2≫m1 — system swings nearly rigidly); heavy-load asymptote ω+² ≈ (m2/m1)·g·(L1+L2)/(L1·L2) = 252.6 (within 2.2%).
Mode shapes (from row 2: Θ2/Θ1 = L1·ω² / (g − L2·ω²)):
  Low mode:  Θ2/Θ1 = +1.00959 (in phase, near-rigid swing — this is the mode the operator sees)
  High mode: Θ2/Θ1 = −2.03871 (anti-phase "hook flutter" — hook whips between trolley and heavy load)
Vieta checks for unit tests: ω²+ + ω²− = (m1+m2)·g·(L1+L2)/(m1·L1·L2) = 259.965; ω²+·ω²− = (m1+m2)·g²/(m1·L1·L2) = 425.043.
TEST RECIPE: initialize θ1=θ2=2° (excites ~pure low mode), run RK4 720 Hz for 60 s, FFT hook-x: peak must sit at 0.2042 Hz ± 0.002. Then initialize θ1=2°, θ2=−4.08° (high-mode shape), expect 2.558 Hz ± 0.02. Nonlinear amplitude softening at 2°: <0.1%, so tight tolerances are valid.

=====================================================================
(b) QUADRIFILAR TORSIONAL (YAW) PENDULUM — k_yaw = M·g·r_hook·r_top/h VERIFIED
=====================================================================
Derivation (this VERIFIES the formula): top attachment radius r1=r_hook, bottom radius r2=r_top, vertical height h, leg length Lw=sqrt(h²+(r2−r1)²). Yaw the load by φ: horizontal chord d² = r1² + r2² − 2·r1·r2·cosφ = (r2−r1)² + 2·r1·r2·(1−cosφ). Vertical drop z = sqrt(Lw² − d²) ≈ h − r1·r2·φ²/(2h). Load RISES by δ = r1·r2·φ²/(2h) → U = M·g·r1·r2·φ²/(2h) → k_yaw = M·g·r1·r2/h  [N·m/rad]. IMPORTANT: h in this formula is the VERTICAL height (1.1 m), not the leg length (1.3534 m) — the leg length cancels in the linearization. This is the asymmetric generalization of the classic bifilar-pendulum stiffness k=Mgr²/h used for aircraft inertia measurement (NACA TN 1629, Gracey 1948; also Newman & Searle, General Properties of Matter).
  T = 2π·sqrt(I / k_yaw), and since k ∝ M: T = 2π·sqrt( k_gyr²·h / (g·r1·r2) ) — INDEPENDENT of mass. Use this as a test invariant: doubling M must not change T.
NUMERIC: r_hook=0.06 m, r_top = 1.2·√2/2 = 0.848528 m (half-diagonal of 1.2 m square), h=1.1 m, M=1000 kg:
  k_yaw = 1000·9.81·0.06·0.848528/1.1 = 454.04 N·m/rad
  I (uniform 1.2 m square box, vertical axis) = M·(a²+b²)/12 = 1000·(1.44+1.44)/12 = 240.0 kg·m²
  ω = sqrt(454.04/240) = 1.37544 rad/s → T = 4.5681 s, f = 0.21891 Hz
TEST RECIPE: yaw-only IC φ=5°, expect period 4.568 s ± 1%. Also verify δz(φ): at φ=5° load rises r1·r2·φ²/(2h) = 0.176 mm — your per-leg elastic sling model must reproduce this coupling (yaw→hoist tension rise ≈ k_rope·δ shared over legs).

=====================================================================
(c) OFF-CENTER CG STATICS (玉掛け)
=====================================================================
TILT: suspended assembly rotates about the hook until CG is plumb under hook contact point:
  tanθ = e / h_cg,  h_cg = vertical distance hook→CG in the hanging configuration.
  θ ≈ e/h_cg (rad) for small offsets. Example: e=0.10 m, h_cg=1.7 m (1.1 m sling height + 0.6 m CG below lug plane) → θ = atan(0.1/1.7) = 3.366°. Exact solution requires solving with the tilted geometry (legs lengthen/shorten); for e/d < 0.2 the plumb-line formula is within ~5% — adequate for test tolerance ±0.3°.
LEVER RULE (per 玉掛け技能講習テキスト, 厚生労働省コンデンスドカリキュラム / 中央労働災害防止協会「玉掛け作業者安全必携」— "重心が偏った荷は重心に近い方のつり索に大きな張力"): leg spacing d, CG offset e from centerline; VERTICAL shares:
  F_near = (W/2)·(1 + 2e/d),  F_far = (W/2)·(1 − 2e/d)   [equivalently F_near = W·b/d, F_far = W·a/d with a,b distances from CG to each leg line, a+b=d]
  Example: W=9810 N (1 t), d=1.2 m, e=0.1 m → near pair 5722.5 N, far pair 4087.5 N (58.3%/41.7%).
  Actual leg tension = vertical share / cos(α_leg) with α_leg the leg angle from vertical (張力増加係数: 1.16 at 60° included, 1.41 at 90° — standard 玉掛け table).
4-LEG RECTANGLE (a×b, offsets ex, ey), bilinear approximation for the elastic (indeterminate) case:
  F_ij = (W/4)·(1 ± 2ex/a)·(1 ± 2ey/b), signs chosen so nearer legs get +. Sum = W exactly.
  SAFETY CONVENTION taught in 玉掛け講習: a 4-leg sling on a rigid load is statically indeterminate — assume only the 2 diagonal legs carry the full load when sizing (掛け数を2本として計算). Implement scoring so the examinee's sling selection passes only under the 2-leg assumption.
  In the simulator itself, model each leg as a unilateral spring k_leg = E·A/L_leg (wire rope E≈100 GPa effective, fill factor ~0.55) and the redistribution/slack-leg behavior emerges; use the bilinear formula as the analytical unit test (elastic solve must match to <2% for stiff, geometrically symmetric legs).
SLIP CONDITION: hooked/basket sling slips on the load (or load slides in the slings) when the tangential force exceeds friction:
  slip ⇔ tanθ_tilt > μs  →  θ_max = atan(μs).
  μs values: wire rope on dry steel 0.10–0.15 (→ slip at 5.7–8.5°), on wood 0.2–0.4, on rubber pad ~0.5. With μs=0.15: θ_slip = 8.53°. Scoring rule: e/h_cg > μs ⇒ "荷ずれ" fault event.

=====================================================================
(d) WEBAUDIO SYNTHESIS — CONCRETE NODE GRAPHS + INITIAL VALUES
=====================================================================
Global: one AudioContext; master GainNode 0.5 → DynamicsCompressor (threshold −12 dB, ratio 4) → destination. All continuous sounds use setTargetAtTime with τ=0.05 s for parameter tracking (no zipper noise).

1) MOTOR WHINE. Two variants:
   INVERTER (VVVF) crane: f_out = f_rated·(v_cmd/v_rated), range 6–60 Hz (60 Hz base, 6 Hz creep = 1:10). Dominant magnetic noise at 2·f_out; slot harmonic ≈ 17·f_out (36 rotor slots, 2 pole-pairs, ≈ Zr/p·(1−s)); PWM carrier fixed.
   Graph: oscA (sawtooth, freq = 2·f_out, i.e. 12–120 Hz) gain 0.30 → LPF; oscB (triangle, freq = 17·f_out) gain 0.12 → LPF; oscC (sine, freq = f_carrier = 2500 Hz) gain 0.06, amplitude-modulated by lfo (sine, 2·f_out) → modGain (lfo→modGain.gain, depth 0.5, base 1.0) → LPF. LPF = BiquadFilter lowpass, cutoff = 1200 + 20·f_out Hz, Q = 1.0 → motorGain. motorGain = 0.05 + 0.15·|T_em|/T_rated (torque from your drive model). Add ±0.3% random detune on oscB refreshed each 100 ms (removes "synthetic" purity).
   WOUND-ROTOR (巻線形, exam crane with resistor notches): NO carrier whine — delete oscC. Constant mains hum oscA at 100 Hz (2×50 Hz mains, use 120 Hz for 60 Hz regions) gain 0.25 regardless of speed; oscB slot component 17·f_rotor_Hz tracks actual shaft speed; per-notch step: on notch change, step motorGain +0.05 for 150 ms (contactor torque surge) and play relay click = noise burst 8 ms through highpass 2 kHz gain 0.15.

2) GEAR NOISE: f_mesh = N_pinion·f_shaft; hoist example: motor 24.2 rev/s (1450 rpm) × 17 teeth ≈ 411 Hz at full speed, scale linearly with |ω_motor|. Graph: oscG (sawtooth, freq = f_mesh, detune jitter ±2% at 10 Hz refresh) gain 0.08, PLUS noise → BiquadFilter bandpass (center = f_mesh, Q = 5) gain 0.05; both → AM by shaft-rate LFO (sine, f_shaft, depth 0.2) → gearGain = 0.1 + 0.2·sqrt(P_transmitted/P_rated). Kill below f_out < 3 Hz (avoid subsonic rumble).

3) BRAKE CLUNK (electromagnetic drum/disc brake dropping in): two parallel one-shots triggered on brake-engage edge:
   (i) AudioBufferSourceNode white noise, duration 50 ms, envelope 0→1 in 2 ms then exp decay τ = 15 ms → BiquadFilter bandpass center 600 Hz Q 1.5 → gain 0.5;
   (ii) osc sine 80 Hz, exp decay τ = 60 ms → gain 0.6 (structural thump).
   On brake RELEASE: same graph at 0.4× gain, bandpass center 900 Hz (lighter "click-clack"). Sequence with your brake timing: release clack at contactor-on +0.1 s, engage clunk at stop-command +0.3 s (typical MB/DC brake drop-in delay).

4) OVERLOAD / OVERWIND ALARMS (Japanese conventions — note: クレーン構造規格 mandates 過負荷防止装置/警報 but the acoustic pattern is manufacturer convention, e.g. KITO ER2/三菱ホイスト manuals: pre-warning intermittent, overload continuous + motion cutout):
   Pre-warning (≥90% rated): square osc 2000 Hz, gain 0.15, gated 0.5 s ON / 0.5 s OFF (1 Hz duty 50%).
   Overload (>100%, e.g. >3.15 t on 2.8 t class with typical 1.1× setting; hoist-up inhibited): SAME 2000 Hz continuous, gain 0.18. Continuous-vs-intermittent distinction is the load-meter convention to implement.
   Overwind (巻過警報, weight/lever limit hit): square 3000 Hz, fast intermittent 4 Hz (80 ms ON/170 ms OFF), gain 0.18, plus hoist-up cutout event.
   Implement gating with a GainNode driven by setValueCurveAtTime square envelopes (2 ms ramps to avoid clicks).
5) HORN (electric dual-tone): oscH1 sawtooth 395 Hz gain 0.3 + oscH2 sawtooth 495 Hz gain 0.3 → WaveShaper (soft clip, curve y = tanh(2x)) → BiquadFilter bandpass center 1000 Hz Q 0.7 → gain envelope attack 10 ms, release 80 ms, sustain while button held, level 0.35. The ~100 Hz beat between the two tones gives the characteristic industrial-horn roughness.

Files: no repo files were modified; all constants above are ready to paste into the audio module and the physics test suite.
Sources: double-pendulum normal modes — Goldstein, Classical Mechanics 3rd ed. §6.4 / en.wikipedia.org/wiki/Double_pendulum; bifilar/multifilar stiffness — NACA TN-1629 (Gracey, "The experimental determination of moments of inertia...", ntrs.nasa.gov) and standard bifilar formula T=2π·sqrt(I·h/(M·g·r1·r2)); 玉掛け lever rule & 2-leg assumption — 中央労働災害防止協会「玉掛け作業者安全必携」/ 厚労省 玉掛け技能講習補助テキスト; sling angle tension factors (1.16@60°,1.41@90°) — same texts; overload device requirement — クレーン構造規格 (厚生労働省告示) 第27条系, acoustic pattern per KITO/Mitsubishi hoist manuals; motor acoustic harmonics (2f line, slot harmonics, PWM carrier sidebands) — Gieras, "Noise of Polyphase Electric Motors", CRC 2005.
