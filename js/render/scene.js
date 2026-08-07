// 3D 描画: 工場内観とクレーン本体
// 物理座標系: x = 走行(東西), y = 横行(南北), z = 上向き
// Three.js 座標系: y-up。マッピングは toWorld() に集約する。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GEOM } from '../physics/params.js';

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

    this.cameraMode = 'orbit'; // orbit | operator | follow
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();

    this._buildLights();
    this._buildFactory();
    this._buildCrane();
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
    this.scene.add(sun, sun.target);
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
    this.ropePos = new Float32Array(2 * 12 * 3); // 2本 × 12セグメント点
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

  _buildLoad() {
    const { load } = GEOM;
    this.loadMesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(load.sx, load.sz, load.sy),
      new THREE.MeshStandardMaterial({ color: COL.load, roughness: 0.8 })
    );
    body.castShadow = true; body.receiveShadow = true;
    this.loadMesh.add(body);
    for (const bz of [-load.sz * 0.3, load.sz * 0.3]) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(load.sx + 0.02, 0.06, load.sy + 0.02),
        new THREE.MeshStandardMaterial({ color: COL.loadBand, roughness: 0.5, metalness: 0.5 })
      );
      band.position.y = bz;
      this.loadMesh.add(band);
    }
    this.scene.add(this.loadMesh);

    // 玉掛けワイヤ(4本)
    this.slingGeo = new THREE.BufferGeometry();
    this.slingPos = new Float32Array(4 * 2 * 3);
    this.slingGeo.setAttribute('position', new THREE.BufferAttribute(this.slingPos, 3));
    this.slings = new THREE.LineSegments(this.slingGeo, new THREE.LineBasicMaterial({ color: COL.sling }));
    this.slings.frustumCulled = false;
    this.scene.add(this.slings);
  }

  _buildTrail() {
    this.trailMax = 600;
    this.trailCount = 0;
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(this.trailMax * 3);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: 0x58c4ff, transparent: true, opacity: 0.65 }));
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
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(r - 0.12, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.015;
    g.add(disc);
    this.scene.add(g);
    return g;
  }

  setZone(which, x, y, visible = true) {
    const z = which === 'start' ? this.startZone : this.targetZone;
    z.position.set(x, 0, y);
    z.visible = visible;
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this.controls.enabled = (mode === 'orbit');
  }

  setTrailVisible(v) {
    this.trail.visible = v;
    if (!v) { this.trailCount = 0; this.trailGeo.setDrawRange(0, 0); }
  }

  // rs: シミュレータの描画状態
  // { X, Y, ropeLen, hookPos:{x,y,z}, loadPos:{x,y,z}, loadAttached, loadOnGround, slack, loadYaw }
  update(rs, dtRender) {
    const { railH, span } = GEOM;
    this.bridge.position.set(rs.X, 0, 0);
    this.trolley.position.set(rs.X, 0, rs.Y);

    // フックブロック
    toWorld(rs.hookPos.x, rs.hookPos.y, rs.hookPos.z, this._tmpV);
    this.hookBlock.position.copy(this._tmpV);
    // ロープ方向にフックを傾ける
    this._tmpV2.set(rs.X, GEOM.pivotH, rs.Y).sub(this._tmpV);
    if (this._tmpV2.lengthSq() > 1e-8) {
      const up = this._tmpV2.normalize();
      this.hookBlock.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    }

    // ワイヤロープ描画(2本掛け、たるみは2次曲線で表現)
    const pivotY = GEOM.pivotH;
    let k = 0;
    for (const off of [-0.16, 0.16]) {
      const ax = rs.X + off, ay = pivotY, az = rs.Y;
      const bx = this.hookBlock.position.x + off * 0.6,
            by = this.hookBlock.position.y + 0.25,
            bz = this.hookBlock.position.z;
      const sag = rs.slack ? Math.min(1.2, rs.ropeLen * 0.06) : 0;
      const segs = 6;
      for (let i = 0; i < segs; i++) {
        for (const t of [i / segs, (i + 1) / segs]) {
          const px = ax + (bx - ax) * t;
          const py = ay + (by - ay) * t - sag * 4 * t * (1 - t);
          const pz = az + (bz - az) * t;
          this.ropePos[k++] = px; this.ropePos[k++] = py; this.ropePos[k++] = pz;
        }
      }
    }
    this.ropeGeo.attributes.position.needsUpdate = true;

    // 吊荷と玉掛けワイヤ
    toWorld(rs.loadPos.x, rs.loadPos.y, rs.loadPos.z, this._tmpV);
    this.loadMesh.position.copy(this._tmpV);
    this.loadMesh.rotation.y = rs.loadYaw || 0;
    if (rs.loadAttached) {
      this.loadMesh.quaternion.copy(this.hookBlock.quaternion);
      this.loadMesh.rotateY(rs.loadYaw || 0);
      this.slings.visible = true;
      const { load } = GEOM;
      const hp = this.hookBlock.position;
      let s = 0;
      const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (const [cx, cz] of corners) {
        this.slingPos[s++] = hp.x; this.slingPos[s++] = hp.y - 0.45; this.slingPos[s++] = hp.z;
        this._tmpV2.set(cx * load.sx * 0.45, load.sz * 0.5, cz * load.sy * 0.45)
          .applyQuaternion(this.loadMesh.quaternion)
          .add(this.loadMesh.position);
        this.slingPos[s++] = this._tmpV2.x; this.slingPos[s++] = this._tmpV2.y; this.slingPos[s++] = this._tmpV2.z;
      }
      this.slingGeo.attributes.position.needsUpdate = true;
    } else {
      this.slings.visible = false;
      this.loadMesh.quaternion.identity();
      this.loadMesh.rotation.y = rs.loadYaw || 0;
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

    // カメラ
    if (this.cameraMode === 'orbit') {
      this.controls.update();
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
