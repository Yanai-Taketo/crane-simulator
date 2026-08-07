// 試験コースの衝突判定(純ロジック・テスト可能)
// 吊荷 = ヨー回転する直方体(OBB)または鉛直円柱(ドラム缶)、フック = 球。障害物:
//  - pole: 鉛直円柱 { id, x, y, r, zLo, zHi }
//  - box:  軸平行直方体 { id, x, y, halfX, halfY, zLo, zHi }(バー・壁・フェンス)

// OBB(2D 回転矩形+z 範囲)と鉛直円柱
function obbPole(load, p) {
  if (load.zHi < p.zLo || load.zLo > p.zHi) return false;
  const cs = Math.cos(-load.yaw), sn = Math.sin(-load.yaw);
  const dx = p.x - load.x, dy = p.y - load.y;
  const lx = dx * cs - dy * sn;
  const ly = dx * sn + dy * cs;
  const qx = Math.max(-load.halfX, Math.min(load.halfX, lx));
  const qy = Math.max(-load.halfY, Math.min(load.halfY, ly));
  return (lx - qx) ** 2 + (ly - qy) ** 2 <= p.r * p.r;
}

// OBB と AABB(2D SAT: 4 分離軸)+ z 範囲
function obbBox(load, b) {
  if (load.zHi < b.zLo || load.zLo > b.zHi) return false;
  const cs = Math.cos(load.yaw), sn = Math.sin(load.yaw);
  // 吊荷の 4 隅(ワールド)
  const cx = [], cy = [];
  for (const [ex, ey] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    cx.push(load.x + ex * load.halfX * cs - ey * load.halfY * sn);
    cy.push(load.y + ex * load.halfX * sn + ey * load.halfY * cs);
  }
  // 軸 1,2: AABB 軸
  if (Math.max(...cx) < b.x - b.halfX || Math.min(...cx) > b.x + b.halfX) return false;
  if (Math.max(...cy) < b.y - b.halfY || Math.min(...cy) > b.y + b.halfY) return false;
  // 軸 3,4: OBB 軸(AABB の 4 隅を OBB ローカルへ)
  const bx = [], by = [];
  for (const [ex, ey] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const wx = b.x + ex * b.halfX - load.x, wy = b.y + ey * b.halfY - load.y;
    bx.push(wx * cs + wy * sn);
    by.push(-wx * sn + wy * cs);
  }
  if (Math.max(...bx) < -load.halfX || Math.min(...bx) > load.halfX) return false;
  if (Math.max(...by) < -load.halfY || Math.min(...by) > load.halfY) return false;
  return true;
}

// 鉛直円柱の吊荷(ドラム缶)と鉛直円柱: 水平円どうし
function cylPole(load, p) {
  if (load.zHi < p.zLo || load.zLo > p.zHi) return false;
  const d2 = (load.x - p.x) ** 2 + (load.y - p.y) ** 2;
  return d2 <= (load.r + p.r) ** 2;
}

// 鉛直円柱の吊荷と AABB: 円中心を矩形へクランプ
function cylBox(load, b) {
  if (load.zHi < b.zLo || load.zLo > b.zHi) return false;
  const qx = Math.max(b.x - b.halfX, Math.min(b.x + b.halfX, load.x));
  const qy = Math.max(b.y - b.halfY, Math.min(b.y + b.halfY, load.y));
  return (load.x - qx) ** 2 + (load.y - qy) ** 2 <= load.r * load.r;
}

function spherePole(s, p) {
  if (s.z + s.r < p.zLo || s.z - s.r > p.zHi) return false;
  const d2 = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
  return d2 <= (s.r + p.r) ** 2;
}

function sphereBox(s, b) {
  if (s.z + s.r < b.zLo || s.z - s.r > b.zHi) return false;
  const qx = Math.max(b.x - b.halfX, Math.min(b.x + b.halfX, s.x));
  const qy = Math.max(b.y - b.halfY, Math.min(b.y + b.halfY, s.y));
  return (s.x - qx) ** 2 + (s.y - qy) ** 2 <= s.r * s.r;
}

// load: { x, y, z(重心), yaw, halfX, halfY, halfZ } … 直方体
//       { x, y, z(重心), r, halfZ } … 鉛直円柱(r 指定で円柱扱い)
//       | null(玉外し中)
// hook: { x, y, z, r }
// 戻り値: 接触中の障害物 id の配列
export function checkContacts(load, hook, obstacles) {
  const hits = [];
  const isCyl = !!(load && load.r);
  for (const ob of obstacles) {
    let hit = false;
    if (load) {
      const l = { ...load, zLo: load.z - load.halfZ, zHi: load.z + load.halfZ };
      hit = isCyl
        ? (ob.type === 'pole' ? cylPole(l, ob) : cylBox(l, ob))
        : (ob.type === 'pole' ? obbPole(l, ob) : obbBox(l, ob));
    }
    if (!hit && hook) {
      hit = ob.type === 'pole' ? spherePole(hook, ob) : sphereBox(hook, ob);
    }
    if (hit) hits.push(ob.id);
  }
  return hits;
}
