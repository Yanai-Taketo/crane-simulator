// 3D 描画: 工場内観とクレーン本体
// 物理座標系: x = 走行(東西), y = 横行(南北), z = 上向き
// Three.js 座標系: y-up。マッピングは toWorld() に集約する。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GEOM, CAB } from '../physics/params.js';

const toWorld = (x, y, z, out = new THREE.Vector3()) => out.set(x, z, y);

const COL = {
  floor: 0x8d9299,
  floorLine: 0x6d7278,
  wall: 0xb8c0c8,
  roof: 0x9aa4ae,
  steelCol: 0x4a6741,
  runway: 0x37536b,
  girder: 0xd8a021,     // クレーン本体は黄色系(安全色)
  endTruck: 0xc2571e,
  trolley: 0x2e6db4,
  hoist: 0x394450,
  hook: 0x23282e,
  rope: 0x1c1f24,
  sling: 0x274e13,
  load: 0x7a6a52,
  loadBand: 0x3d3527,
  targetZone: 0x2ecc71,
  startZone: 0xf1c40f,
};

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10151c);
    this.scene.fog = new THREE.Fog(0x10151c, 55, 110);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    this.camera.position.set(21, 5.5, 14);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(9, 2.5, 6.5);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 80;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.cameraMode = 'orbit'; // orbit | operator | follow | cab
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();
    this._tmpQ2 = new THREE.Quaternion();
    this._UP = new THREE.Vector3(0, 1, 0);
    this._hookSmooth = null;   // フック描画位置の平滑化(1フレーム跳びの吸収)
    this._ropePerp = { x: 1, z: 0 };   // ロープ弧の張り出し方向(フレーム間連続)
    this._sagSmooth = 0;               // ロープたるみ量の表示平滑値

    // 運転席視点のマウスルック(ヨー・ピッチ)
    this.cabYaw = 0;          // 0 = 北向き(ガーダ沿い・反対側ランウェイ方向)
    this.cabPitch = -0.5;     // やや下向き(吊荷注視)
    this._bindCabLook(canvas);

    this._buildLights();
    this._buildFactory();
    this._buildCrane();
    this._buildCab();
    this._buildWalkerFig();
    this._buildLoad();
    this._buildTrail();
    this._buildZones();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x4a4f46, 0.95));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(GEOM.bayLen * 0.35, 22, -6);
    sun.target.position.set(GEOM.bayLen / 2, 0, GEOM.span / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
    sun.shadow.camera.near = 2; sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;   // 実 GPU の深度精度差によるアクネ防止
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  // 影の描画切替(GPU 負荷軽減・描画不具合の切り分け用)
  setShadows(on) {
    this.sun.castShadow = on;
  }

  _buildFactory() {
    const { bayLen, span, railH } = GEOM;
    const wallH = railH + 3.2;

    // 床
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(bayLen + 4, span + 4),
      new THREE.MeshStandardMaterial({ color: COL.floor, roughness: 0.92 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(bayLen / 2, 0, span / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 床の目地ライン
    const lineMat = new THREE.LineBasicMaterial({ color: COL.floorLine });
    const linePts = [];
    for (let x = 0; x <= bayLen; x += 3) linePts.push(new THREE.Vector3(x, 0.01, -1), new THREE.Vector3(x, 0.01, span + 1));
    for (let y = 0; y <= span; y += 3) linePts.push(new THREE.Vector3(-1, 0.01, y), new THREE.Vector3(bayLen + 1, 0.01, y));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    this.scene.add(new THREE.LineSegments(lineGeo, lineMat));

    // 建屋シェル(内側からのみ見える)
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(bayLen + 4, wallH, span + 4),
      new THREE.MeshStandardMaterial({ color: COL.wall, roughness: 0.95, side: THREE.BackSide })
    );
    shell.position.set(bayLen / 2, wallH / 2, span / 2);
    shell.receiveShadow = true;
    this.scene.add(shell);

    // 窓(高窓・発光面)
    const winMat = new THREE.MeshBasicMaterial({ color: 0xbfd9ef, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      for (const zs of [-1.98, span + 1.98]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.4), winMat);
        win.position.set(2.5 + i * 5, railH + 1.9, zs + (zs < 0 ? 0.01 : -0.01));
        this.scene.add(win);
      }
    }

    // 支柱とランウェイガーダ(走行レール)
    const colGeo = new THREE.BoxGeometry(0.5, railH, 0.5);
    const colMat = new THREE.MeshStandardMaterial({ color: COL.steelCol, roughness: 0.6, metalness: 0.3 });
    const runwayGeo = new THREE.BoxGeometry(bayLen + 3, 0.7, 0.55);
    const runwayMat = new THREE.MeshStandardMaterial({ color: COL.runway, roughness: 0.5, metalness: 0.5 });
    const railGeo = new THREE.BoxGeometry(bayLen + 3, 0.12, 0.12);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x888e96, roughness: 0.3, metalness: 0.85 });
    for (const yRail of [0, span]) {
      const zoff = yRail === 0 ? -0.9 : 0.9;
      for (let x = 0; x <= bayLen; x += 6) {
        const c = new THREE.Mesh(colGeo, colMat);
        c.position.set(x, railH / 2, yRail + zoff);
        c.castShadow = true;
        this.scene.add(c);
      }
      const rw = new THREE.Mesh(runwayGeo, runwayMat);
      rw.position.set(bayLen / 2, railH + 0.35, yRail + zoff);
      rw.castShadow = true;
      this.scene.add(rw);
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(bayLen / 2, railH + 0.76, yRail + zoff);
      this.scene.add(rail);
    }

    // 屋根トラス(簡易)
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x5b646e, roughness: 0.6, metalness: 0.4 });
    for (let x = 3; x < bayLen; x += 6) {
      const chord = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, span + 3.4), trussMat);
      chord.position.set(x, wallH - 0.4, span / 2);
      this.scene.add(chord);
    }

    // 置き場のパレット・資材(雰囲気用の障害物ではない装飾)
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x5f6d79, roughness: 0.85 });
    const cratePos = [[2.5, 2.2], [2.5, 13.5], [27.5, 3.0], [27.2, 13.0]];
    for (const [cx, cy] of cratePos) {
      const s = 0.9 + ((cx * 7 + cy * 13) % 10) / 14;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s), crateMat);
      crate.position.set(cx, s * 0.4, cy);
      crate.castShadow = true; crate.receiveShadow = true;
      this.scene.add(crate);
    }
  }

  _buildCrane() {
    const { span, railH } = GEOM;

    // ---- ブリッジ(ガーダ+エンドトラック): x に走行 ----
    this.bridge = new THREE.Group();
    const girderMat = new THREE.MeshStandardMaterial({ color: COL.girder, roughness: 0.55, metalness: 0.25 });
    const girderGeo = new THREE.BoxGeometry(0.55, 0.8, span + 1.2);
    for (const dx of [-0.62, 0.62]) {
      const g = new THREE.Mesh(girderGeo, girderMat);
      g.position.set(dx, railH + 1.25, span / 2);
      g.castShadow = true;
      this.bridge.add(g);
    }
    const truckMat = new THREE.MeshStandardMaterial({ color: COL.endTruck, roughness: 0.55, metalness: 0.3 });
    const truckGeo = new THREE.BoxGeometry(2.6, 0.55, 0.5);
    for (const yRail of [0, span]) {
      const zoff = yRail === 0 ? -0.9 : 0.9;
      const t = new THREE.Mesh(truckGeo, truckMat);
      t.position.set(0, railH + 1.05, yRail + zoff);
      t.castShadow = true;
      this.bridge.add(t);
      // 車輪
      const whGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.14, 20);
      const whMat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.4, metalness: 0.7 });
      for (const wx of [-1.0, 1.0]) {
        const w = new THREE.Mesh(whGeo, whMat);
        w.rotation.x = Math.PI / 2;
        w.position.set(wx, railH + 0.86, yRail + zoff);
        this.bridge.add(w);
      }
    }
    // 横行レール(ガーダ上面)
    const tRailMat = new THREE.MeshStandardMaterial({ color: 0x888e96, roughness: 0.3, metalness: 0.85 });
    for (const dx of [-0.62, 0.62]) {
      const tr = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, span - 0.6), tRailMat);
      tr.position.set(dx, railH + 1.7, span / 2);
      this.bridge.add(tr);
    }
    this.scene.add(this.bridge);

    // ---- トロリ(クラブ): ブリッジ上を y に横行 ----
    this.trolley = new THREE.Group();
    const trolleyBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.75, 1.6),
      new THREE.MeshStandardMaterial({ color: COL.trolley, roughness: 0.5, metalness: 0.3 })
    );
    trolleyBody.position.y = railH + 2.13;
    trolleyBody.castShadow = true;
    this.trolley.add(trolleyBody);
    // 巻上ドラム
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 1.0, 24),
      new THREE.MeshStandardMaterial({ color: COL.hoist, roughness: 0.4, metalness: 0.6 })
    );
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0.35, railH + 2.72, 0);
    this.trolley.add(drum);
    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.7, 16),
      new THREE.MeshStandardMaterial({ color: 0x8a2f2f, roughness: 0.5 })
    );
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-0.6, railH + 2.72, 0.35);
    this.trolley.add(motor);
    this.scene.add(this.trolley);

    // ---- ワイヤロープ(4本掛けを2本で表現) ----
    this.ropeGeo = new THREE.BufferGeometry();
    this.ropePos = new Float32Array(2 * 16 * 3); // 2本 × 8セグメント × 2端点
    this.ropeGeo.setAttribute('position', new THREE.BufferAttribute(this.ropePos, 3));
    this.rope = new THREE.LineSegments(this.ropeGeo, new THREE.LineBasicMaterial({ color: COL.rope }));
    this.rope.frustumCulled = false;
    this.scene.add(this.rope);

    // ---- フックブロック ----
    this.hookBlock = new THREE.Group();
    const sheaveCase = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.5, 0.22),
      new THREE.MeshStandardMaterial({ color: COL.hook, roughness: 0.45, metalness: 0.6 })
    );
    this.hookBlock.add(sheaveCase);
    const hookShape = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.05, 10, 24, Math.PI * 1.45),
      new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.35, metalness: 0.8 })
    );
    hookShape.position.y = -0.42;
    hookShape.rotation.z = Math.PI * 0.7;
    this.hookBlock.add(hookShape);
    this.hookBlock.traverse(o => { o.castShadow = true; });
    this.scene.add(this.hookBlock);
  }

  // 運転室(キャブ): ガーダ端部吊下げ形。ブリッジと共に走行する。
  // 実機調査に基づく: 密閉鋼製・前面+側面ガラス・グリッド付き床窓・
  // 着座はガーダ軸沿いに反対側ランウェイ(北)向き。
  _buildCab() {
    const g = new THREE.Group();
    const W = CAB.sx, D = CAB.sy, H = CAB.h;
    const fz = CAB.floorZ;                       // 床面高さ(ワールド y)
    const steel = new THREE.MeshStandardMaterial({ color: 0x5a7d5a, roughness: 0.6, metalness: 0.3 });
    const steelIn = new THREE.MeshStandardMaterial({ color: 0x9db4a0, roughness: 0.85, side: THREE.DoubleSide });

    // キャブ内照明(天井灯)
    const cabLight = new THREE.PointLight(0xfff2dc, 5.5, 5.5, 1.6);
    cabLight.position.set(0, CAB.floorZ + CAB.h - 0.15, CAB.y);
    g.add(cabLight);
    const glass = new THREE.MeshBasicMaterial({ color: 0x9fc4de, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3c4a3e, roughness: 0.5, metalness: 0.4 });

    // 吊り金具(ガーダ下面へ 2 本)
    const hangerGeo = new THREE.BoxGeometry(0.12, GEOM.railH + 0.85 - (fz + H), 0.12);
    for (const dx of [-W * 0.35, W * 0.35]) {
      const hg = new THREE.Mesh(hangerGeo, steel);
      hg.position.set(dx, (GEOM.railH + 0.85 + fz + H) / 2, CAB.y);
      g.add(hg);
    }

    // 床(前方に床窓の開口: 前半分に窓、後半分は鋼板)
    const floorBack = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, D * 0.55), steel);
    floorBack.position.set(0, fz - 0.04, CAB.y + D * 0.225);
    g.add(floorBack);
    for (const dx of [-W * 0.375, W * 0.375]) {  // 床窓の両脇
      const fs = new THREE.Mesh(new THREE.BoxGeometry(W * 0.25, 0.08, D * 0.45), steel);
      fs.position.set(dx, fz - 0.04, CAB.y - D * 0.275);
      g.add(fs);
    }
    // 床窓(合わせガラス+保護グリッド)
    const floorWin = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.5, D * 0.45), glass);
    floorWin.rotation.x = -Math.PI / 2;
    floorWin.position.set(0, fz - 0.02, CAB.y - D * 0.275);
    g.add(floorWin);
    for (let i = -2; i <= 2; i++) {              // グリッドバー
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, D * 0.45), frameMat);
      bar.position.set(i * W * 0.1, fz - 0.01, CAB.y - D * 0.275);
      g.add(bar);
    }

    // 屋根
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W, 0.07, D), steel);
    roof.position.set(0, fz + H + 0.035, CAB.y);
    g.add(roof);

    // 後壁(南面・鋼板)
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.06), steelIn);
    back.position.set(0, fz + H / 2, CAB.y + D / 2);
    g.add(back);

    // 前面(北面): 下部やや内傾のガラス+フレーム
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H * 0.62), glass);
    front.position.set(0, fz + H * 0.69, CAB.y - D / 2);
    g.add(front);
    const frontLow = new THREE.Mesh(new THREE.PlaneGeometry(W, H * 0.42), glass);
    frontLow.position.set(0, fz + H * 0.19, CAB.y - D / 2 + 0.09);
    frontLow.rotation.x = 0.22;                  // 下部内傾(下方視界の映り込み低減)
    g.add(frontLow);
    // 側壁: 下半分鋼板・上半分ガラス
    for (const dx of [-W / 2, W / 2]) {
      const low = new THREE.Mesh(new THREE.BoxGeometry(0.06, H * 0.45, D), steelIn);
      low.position.set(dx, fz + H * 0.225, CAB.y);
      g.add(low);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(D, H * 0.5), glass);
      win.rotation.y = Math.PI / 2;
      win.position.set(dx, fz + H * 0.7, CAB.y);
      g.add(win);
    }
    // 柱(四隅)
    for (const dx of [-W / 2 + 0.04, W / 2 - 0.04]) {
      for (const dz of [-D / 2 + 0.04, D / 2 - 0.04]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, 0.08), frameMat);
        post.position.set(dx, fz + H / 2, CAB.y + dz);
        g.add(post);
      }
    }

    // 座席(中央・北向き)
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x37424e, roughness: 0.8 });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.45, 12), frameMat);
    pedestal.position.set(0, fz + 0.225, CAB.y + 0.25);
    g.add(pedestal);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.44), seatMat);
    seat.position.set(0, fz + 0.49, CAB.y + 0.25);
    g.add(seat);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.09), seatMat);
    backrest.position.set(0, fz + 0.78, CAB.y + 0.47);
    g.add(backrest);

    // コントローラーコンソール: 右手=走行 / 左手=横行(内)+巻上(外)
    // 運転者は北向き → 右 = 東(+x)、左 = 西(−x)
    const consoleMat = new THREE.MeshStandardMaterial({ color: 0x2b333c, roughness: 0.5, metalness: 0.3 });
    const mkConsole = (dx, w) => {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, 0.5), consoleMat);
      c.position.set(dx, fz + 0.55, CAB.y + 0.1);
      g.add(c);
      return c;
    };
    mkConsole(0.42, 0.3);    // 右: 走行
    mkConsole(-0.5, 0.46);   // 左: 横行+巻上
    const leverMat = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.35, metalness: 0.6 });
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x8a2f2f, roughness: 0.4 });
    const mkLever = (dx) => {
      const pivot = new THREE.Group();
      pivot.position.set(dx, fz + 0.84, CAB.y + 0.1);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.3, 10), leverMat);
      stick.position.y = 0.15;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), knobMat);
      knob.position.y = 0.31;
      pivot.add(stick, knob);
      g.add(pivot);
      return pivot;
    };
    // 実機の前後規約: 前方押し = 巻下/北横行/西走行(ノッチ負)、手前引き = 正
    this.cabLevers = {
      hoist: mkLever(-0.62),
      traverse: mkLever(-0.38),
      travel: mkLever(0.42),
    };

    g.traverse(o => { if (o.isMesh && o.material !== glass) o.castShadow = true; });
    this.bridge.add(g);
    this.cabGroup = g;
  }

  // 運転席視点のマウスルック
  _bindCabLook(canvas) {
    let dragging = false, px = 0, py = 0;
    const lookMode = () => this.cameraMode === 'cab' || this.cameraMode === 'walk';
    canvas.addEventListener('pointerdown', (e) => {
      if (!lookMode()) return;
      dragging = true; px = e.clientX; py = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging || !lookMode()) return;
      const dy = this.cabYaw - (e.clientX - px) * 0.004;
      // 歩行時は全周旋回(±π ラップ)、着座時は運転席の首振り範囲に制限
      this.cabYaw = this.cameraMode === 'walk'
        ? ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
        : Math.max(-2.4, Math.min(2.4, dy));
      this.cabPitch = Math.max(-1.35, Math.min(0.45, this.cabPitch - (e.clientY - py) * 0.004));
      px = e.clientX; py = e.clientY;
    });
    const end = () => { dragging = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // 床上歩行オペレータの人形とペンダントケーブル
  _buildWalkerFig() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 1.15, 10),
      new THREE.MeshStandardMaterial({ color: 0x2e5f8a, roughness: 0.8 })
    );
    body.position.y = 0.78;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xc8a080, roughness: 0.8 })
    );
    head.position.y = 1.5;
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0xf5d020, roughness: 0.5 })
    );
    helmet.position.y = 1.53;
    g.add(body, head, helmet);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.visible = false;
    this.scene.add(g);
    this.walkerFig = g;
    // ペンダントケーブル(トロリ→手元)
    this.pendantGeo = new THREE.BufferGeometry();
    this.pendantPos = new Float32Array(2 * 3);
    this.pendantGeo.setAttribute('position', new THREE.BufferAttribute(this.pendantPos, 3));
    this.pendantLine = new THREE.Line(this.pendantGeo, new THREE.LineBasicMaterial({ color: 0x222629 }));
    this.pendantLine.frustumCulled = false;
    this.pendantLine.visible = false;
    this.scene.add(this.pendantLine);
  }

  _buildLoad() {
    const { load } = GEOM;
    this.loadMesh = new THREE.Group();
    this._boxParts = [];
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(load.sx, load.sz, load.sy),
      new THREE.MeshStandardMaterial({ color: COL.load, roughness: 0.8 })
    );
    body.castShadow = true; body.receiveShadow = true;
    this.loadMesh.add(body);
    this._boxParts.push(body);
    for (const bz of [-load.sz * 0.3, load.sz * 0.3]) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(load.sx + 0.02, 0.06, load.sy + 0.02),
        new THREE.MeshStandardMaterial({ color: COL.loadBand, roughness: 0.5, metalness: 0.5 })
      );
      band.position.y = bz;
      this.loadMesh.add(band);
      this._boxParts.push(band);
    }
    // ドラム缶(JIS Z 1600 D 型 φ0.585×0.89・技能講習コース用)— 既定は非表示
    this.loadStyle = 'box';
    this.drumMesh = new THREE.Group();
    const drumBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2925, 0.2925, 0.89, 28),
      new THREE.MeshStandardMaterial({ color: 0x2f6bb3, roughness: 0.55, metalness: 0.25 })
    );
    drumBody.castShadow = true; drumBody.receiveShadow = true;
    this.drumMesh.add(drumBody);
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0x24507f, roughness: 0.45, metalness: 0.4 });
    for (const hz of [-0.89 * 0.22, 0.89 * 0.22, 0.435]) {   // ローリングフープ×2+天面チャイム
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.301, 0.301, 0.035, 28), hoopMat);
      hoop.position.y = hz;
      this.drumMesh.add(hoop);
    }
    this.drumMesh.visible = false;
    this.loadMesh.add(this.drumMesh);
    this.scene.add(this.loadMesh);

    // 玉掛けワイヤ(4本・たるみ弧付き 5 セグメント描画)
    this.slingGeo = new THREE.BufferGeometry();
    this.slingPos = new Float32Array(4 * 5 * 2 * 3);
    this.slingGeo.setAttribute('position', new THREE.BufferAttribute(this.slingPos, 3));
    this.slings = new THREE.LineSegments(this.slingGeo, new THREE.LineBasicMaterial({ color: COL.sling }));
    this.slings.frustumCulled = false;
    this.scene.add(this.slings);
    // スリング張り切り長(フック下端→荷上面コーナー / ドラム天面リム)
    const cornerOff = Math.hypot(GEOM.load.sx * 0.45, GEOM.load.sy * 0.45);
    this.slingTaut = Math.hypot(GEOM.slingLen, cornerOff);
    this.slingTautDrum = Math.hypot(GEOM.slingLen, 0.26);
  }

  // 吊荷の見た目: 'box'(直方体・4 本吊り)/ 'drum'(ドラム缶・3 本吊りチェーン)
  setLoadStyle(style) {
    this.loadStyle = style;
    const drum = style === 'drum';
    for (const m of this._boxParts) m.visible = !drum;
    this.drumMesh.visible = drum;
  }

  _buildTrail() {
    this.trailMax = 600;
    this.trailCount = 0;
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(this.trailMax * 3);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: 0x58c4ff, transparent: true, opacity: 0.65, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.scene.add(this.trail);
  }

  _buildZones() {
    // 開始ゾーン(黄) - 実位置は main から設定
    this.startZone = this._makeZoneRing(1.3, COL.startZone);
    this.targetZone = this._makeZoneRing(1.3, COL.targetZone);
    this.targetZone.visible = false;
  }

  _makeZoneRing(r, color) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.12, r, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(r - 0.12, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.015;
    g.add(disc);
    this.scene.add(g);
    return g;
  }

  // 試験コースの障害物(ポール・バー・壁)を構築/撤去
  setCourse(course) {
    if (this.courseGroup) {
      this.scene.remove(this.courseGroup);
      this.courseGroup.traverse(o => { o.geometry?.dispose?.(); });
      this.courseGroup = null;
      this.courseMeshes = null;
    }
    if (!course) return;
    const g = new THREE.Group();
    this.courseMeshes = {};
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xe8c33a, roughness: 0.6 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x333940, roughness: 0.8 });
    const barMat = new THREE.MeshStandardMaterial({ color: 0xd84a3a, roughness: 0.6 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xb9a13c, roughness: 0.75, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    for (const ob of course.obstacles) {
      if (ob.type === 'pole') {
        const h = ob.zHi - ob.zLo;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(ob.r, ob.r, h, 12), poleMat);
        pole.position.set(ob.x, ob.zLo + h / 2, ob.y);
        pole.castShadow = true;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.1, 16), baseMat);
        base.position.set(ob.x, 0.05, ob.y);
        g.add(pole, base);
        this.courseMeshes[ob.id] = pole;
      } else {
        const h = ob.zHi - ob.zLo;
        const tall = ob.zLo < 0.5 && ob.zHi > 3.0;   // 壁(上に逃げられない)
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(ob.halfX * 2, h, ob.halfY * 2),
          ob.kind === 'fence' ? fenceMat : tall ? wallMat : barMat
        );
        m.position.set(ob.x, ob.zLo + h / 2, ob.y);
        m.castShadow = !tall && ob.kind !== 'fence';
        g.add(m);
        this.courseMeshes[ob.id] = m;
      }
    }
    this.scene.add(g);
    this.courseGroup = g;
  }

  // バー障害の落下表現(受け金具から外れて床へ)
  dropBar(id) {
    const m = this.courseMeshes?.[id];
    if (!m || m.userData.dropped) return;
    m.userData.dropped = true;
    m.position.y = 0.06;
    m.rotation.y = 0.22;   // わずかに斜めに転がった見た目
  }

  // r: 実際の判定半径(採点円と表示円を一致させる)。省略時は既定 1.3 m
  setZone(which, x, y, visible = true, r = 1.3) {
    const z = which === 'start' ? this.startZone : this.targetZone;
    z.position.set(x, 0, y);
    z.scale.setScalar(r / 1.3);   // リングは半径 1.3 で生成済み → 一様スケール
    z.visible = visible;
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this.controls.enabled = (mode === 'orbit');
    // 歩行で全周ラップした向きを、着座時の首振り範囲へ戻す
    if (mode === 'cab') this.cabYaw = Math.max(-2.4, Math.min(2.4, this.cabYaw));
  }

  setTrailVisible(v) {
    this.trail.visible = v;
    if (!v) this.clearTrail();
  }

  clearTrail() {
    this.trailCount = 0;
    this.trailGeo.setDrawRange(0, 0);
  }

  // rs: シミュレータの描画状態
  // { X, Y, ropeLen, hookPos:{x,y,z}, loadPos:{x,y,z}, loadAttached, loadOnGround, slack, loadYaw }
  update(rs, dtRender) {
    const { railH, span } = GEOM;
    this.bridge.position.set(rs.X, 0, 0);
    this.trolley.position.set(rs.X, 0, rs.Y);

    // フックブロック(位置は短時定数で平滑化し、玉掛け/玉外し時の
    // 1 フレーム跳びを数フレームの滑らかな移動に吸収する)
    toWorld(rs.hookPos.x, rs.hookPos.y, rs.hookPos.z, this._tmpV);
    if (!this._hookSmooth) this._hookSmooth = this._tmpV.clone();
    this._hookSmooth.lerp(this._tmpV, 1 - Math.exp(-dtRender / 0.05));
    this.hookBlock.position.copy(this._hookSmooth);
    // フック姿勢: ロープが張っている時のみロープ方向に追従。
    // 静置・たるみ時は直立(スラープで滑らかに遷移)
    if (rs.hookResting || rs.ropeSag > 0.02) {
      this._tmpQ.identity();
    } else {
      this._tmpV2.set(rs.X, GEOM.pivotH, rs.Y).sub(this._hookSmooth);
      if (this._tmpV2.lengthSq() > 1e-8) {
        this._tmpQ.setFromUnitVectors(this._UP, this._tmpV2.normalize());
      } else {
        this._tmpQ.identity();
      }
    }
    this.hookBlock.quaternion.slerp(this._tmpQ, 1 - Math.exp(-dtRender / 0.1));

    // ワイヤロープ描画(2本掛け)。たるみは余剰長から求めた物理たるみ量
    // rs.ropeSag を弦と直交する水平方向に膨らませて表現(2 本は左右へ開く)
    // 弦の水平法線は 2 本で共有し、前フレームとの連続性で符号を選ぶ。
    // (グローバルな符号正規化だと、弦方向が軸をまたぐ瞬間に弧が 180° 反転して
    //  1 フレームで大きく飛ぶチラつきになる — 実測 122 cm/フレーム)
    {
      let px = this._hookSmooth.z - rs.Y, pz = -(this._hookSmooth.x - rs.X);
      const pl = Math.hypot(px, pz);
      // 真上(水平成分 < 5 cm)では方向が定義できずノイズになるため前の向きを保持
      if (pl > 0.05) {
        px /= pl; pz /= pl;
        if (px * this._ropePerp.x + pz * this._ropePerp.z < 0) { px = -px; pz = -pz; }
        // 真上通過時は弦方向が高速回転するため、向きの変化も短時定数で平滑化
        // (弛んだロープの弧が 1 フレームで大きく振り回されるのを防ぐ)
        const f = 1 - Math.exp(-dtRender / 0.15);
        const nx = this._ropePerp.x + (px - this._ropePerp.x) * f;
        const nz = this._ropePerp.z + (pz - this._ropePerp.z) * f;
        const nl = Math.hypot(nx, nz);
        if (nl > 1e-6) { this._ropePerp.x = nx / nl; this._ropePerp.z = nz / nl; }
      }
    }
    // たるみ量は表示側で短時定数の平滑化(弛み判定の境界で √ 特性により
    // 1 フレームで十数 cm 立ち上がる段差ポップを滑らかな遷移にする)
    this._sagSmooth += ((rs.ropeSag || 0) - this._sagSmooth) * (1 - Math.exp(-dtRender / 0.12));
    const pivotY = GEOM.pivotH;
    let k = 0;
    for (const off of [-0.16, 0.16]) {
      const ax = rs.X + off, ay = pivotY, az = rs.Y;
      const bx = this.hookBlock.position.x + off * 0.6,
            by = this.hookBlock.position.y + 0.25,
            bz = this.hookBlock.position.z;
      const cx = bx - ax, cy = by - ay, cz = bz - az;
      const pxn = this._ropePerp.x, pzn = this._ropePerp.z;
      const side = off < 0 ? -1 : 1;
      const sag = this._sagSmooth;
      const segs = 8;
      for (let i = 0; i < segs; i++) {
        for (const t of [i / segs, (i + 1) / segs]) {
          const bow = sag * 4 * t * (1 - t);
          this.ropePos[k++] = ax + cx * t + pxn * side * bow;
          this.ropePos[k++] = ay + cy * t - bow * 0.35;   // 自重によるわずかな下方成分
          this.ropePos[k++] = az + cz * t + pzn * side * bow;
        }
      }
    }
    this.ropeGeo.attributes.position.needsUpdate = true;

    // 吊荷と玉掛けワイヤ
    toWorld(rs.loadPos.x, rs.loadPos.y, rs.loadPos.z, this._tmpV);
    this.loadMesh.position.copy(this._tmpV);
    // 吊荷姿勢 = チェーン追従(空中・張り時) × ヨー回転 × 偏心傾き
    // 接地中は水平+ヨーのみ(床にめり込む傾き表示を防止)
    if (rs.loadAttached && !rs.loadOnGround && !(rs.ropeSag > 0.02)) {
      this._tmpQ.copy(this.hookBlock.quaternion);
    } else {
      this._tmpQ.identity();
    }
    if (rs.loadYaw) {
      this._tmpQ2.setFromAxisAngle(this._UP, -rs.loadYaw);   // 物理 z 軸ヨー → three −Y
      this._tmpQ.multiply(this._tmpQ2);
    }
    if (rs.loadTilt && rs.loadTilt.angle > 1e-4) {
      // 偏心方向の側が下がる傾き(axis = up × dir)
      this._tmpV2.set(rs.loadTilt.dirY, 0, -rs.loadTilt.dirX);
      this._tmpQ2.setFromAxisAngle(this._tmpV2.normalize(), rs.loadTilt.angle);
      this._tmpQ.multiply(this._tmpQ2);
    }
    this.loadMesh.quaternion.slerp(this._tmpQ, 1 - Math.exp(-dtRender / 0.12));
    if (rs.loadAttached) {
      this.slings.visible = true;
      const { load } = GEOM;
      const hp = this.hookBlock.position;
      let s = 0;
      // 玉掛け点: 箱 = 上面 4 隅 / ドラム = 天面リム 3 点(3 本吊り。4 本目は縮退)
      const taut = this.loadStyle === 'drum' ? this.slingTautDrum : this.slingTaut;
      const pts = this.loadStyle === 'drum'
        ? [0, 1, 2, 2].map((k) => {
            const a = Math.PI / 2 + k * (2 * Math.PI / 3);
            return [Math.cos(a) * 0.26, 0.445, Math.sin(a) * 0.26];
          })
        : [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([cx, cz]) =>
            [cx * load.sx * 0.45, load.sz * 0.5, cz * load.sy * 0.45]);
      for (const [px, py, pz] of pts) {
        // 始点: フック下端 / 終点: 玉掛け点
        const sx0 = hp.x, sy0 = hp.y - 0.45, sz0 = hp.z;
        this._tmpV2.set(px, py, pz)
          .applyQuaternion(this.loadMesh.quaternion)
          .add(this.loadMesh.position);
        const ex = this._tmpV2.x, ey = this._tmpV2.y, ez = this._tmpV2.z;
        // 弦長と張り切り長からたるみ量(放物線近似)を計算。
        // 弛みは荷の内部へ入らないよう「外側へ膨らむ」ドレープで描く
        const c = Math.hypot(ex - sx0, ey - sy0, ez - sz0);
        const slackLen = Math.max(0, taut - c);
        const sag = slackLen > 0.005 ? Math.min(0.4 * taut, Math.sqrt(3 * Math.max(0.05, c) * slackLen / 8)) : 0;
        let ox = ex - this.loadMesh.position.x, oz = ez - this.loadMesh.position.z;
        const ol = Math.hypot(ox, oz) || 1;
        ox /= ol; oz /= ol;
        const segs = 5;
        for (let i = 0; i < segs; i++) {
          for (const t of [i / segs, (i + 1) / segs]) {
            const bow = sag * 4 * t * (1 - t);
            this.slingPos[s++] = sx0 + (ex - sx0) * t + ox * bow * 0.85;
            this.slingPos[s++] = sy0 + (ey - sy0) * t - bow * 0.25;
            this.slingPos[s++] = sz0 + (ez - sz0) * t + oz * bow * 0.85;
          }
        }
      }
      this.slingGeo.attributes.position.needsUpdate = true;
    } else {
      this.slings.visible = false;
    }

    // 軌跡(リングバッファ満杯時はクリアして描き直し — 巻き戻り線分の防止)
    if (this.trail.visible && rs.loadAttached) {
      if (this.trailCount >= this.trailMax) {
        this.trailCount = 0;
        this.trailGeo.setDrawRange(0, 0);
      }
      const i = this.trailCount * 3;
      this.trailPos[i] = this._tmpV.x; this.trailPos[i + 1] = this._tmpV.y; this.trailPos[i + 2] = this._tmpV.z;
      this.trailCount++;
      this.trailGeo.setDrawRange(0, this.trailCount);
      this.trailGeo.attributes.position.needsUpdate = true;
    }

    // 歩行オペレータ(人形は一人称時は非表示)とペンダントケーブル
    if (this.walker) {
      const show = this.walkerActive === true;
      this.walkerFig.visible = show && this.cameraMode !== 'walk';
      this.pendantLine.visible = show;
      if (show) {
        this.walkerFig.position.set(this.walker.x, 0, this.walker.y);
        this.pendantPos[0] = rs.X; this.pendantPos[1] = GEOM.railH + 0.9; this.pendantPos[2] = rs.Y;
        this.pendantPos[3] = this.walker.x; this.pendantPos[4] = 1.15; this.pendantPos[5] = this.walker.y;
        this.pendantGeo.attributes.position.needsUpdate = true;
      }
    }

    // キャブ内レバーの表示(前方押し = ノッチ負 → 前傾)
    if (rs.notches && this.cabLevers) {
      const tilt = 9 * Math.PI / 180;   // 1 ノッチあたり約 9°
      this.cabLevers.travel.rotation.x = rs.notches.travel * tilt;
      this.cabLevers.traverse.rotation.x = rs.notches.traverse * tilt;
      this.cabLevers.hoist.rotation.x = rs.notches.hoist * tilt;
    }

    // カメラ
    if (this.cameraMode === 'orbit') {
      this.controls.update();
    } else if (this.cameraMode === 'cab') {
      // 運転席: キャブ内の着座目線(ブリッジと共に移動)・マウスルック
      this.camera.position.set(rs.X, CAB.eyeZ, CAB.y + 0.25 + CAB.eyeYOff);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.cabYaw;    // 既定 0 = 北向き(three −z = 物理 −y)
      this.camera.rotation.x = this.cabPitch;
    } else if (this.cameraMode === 'walk' && this.walker) {
      // 床上歩行視点: オペレータの目線・マウスルック
      this.camera.position.set(this.walker.x, this.walker.eyeH, this.walker.y);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.cabYaw;
      this.camera.rotation.x = this.cabPitch;
    } else if (this.cameraMode === 'operator') {
      // 床上運転者: ブリッジの少し南側を歩いて追従
      const px = rs.X - 3.5, pz = Math.min(span - 1, rs.Y + 5.5);
      this.camera.position.lerp(this._tmpV2.set(px, 1.6, pz), 1 - Math.exp(-3 * dtRender));
      toWorld(rs.loadPos.x, rs.loadPos.y, rs.loadPos.z + 0.8, this._tmpV);
      this.camera.lookAt(this._tmpV);
    } else if (this.cameraMode === 'follow') {
      toWorld(rs.hookPos.x, rs.hookPos.y, rs.hookPos.z, this._tmpV);
      this.camera.position.lerp(this._tmpV2.set(this._tmpV.x + 6, this._tmpV.y + 3.5, this._tmpV.z + 6), 1 - Math.exp(-4 * dtRender));
      this.camera.lookAt(this._tmpV);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
