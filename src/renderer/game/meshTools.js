import * as THREE from 'three';

/**
 * meshTools.js — 静态网格切割工具集
 * 从 characterModel.js 抽出，供角色程序化关节（腿部）与骨骼切分共用。
 */

/** 克隆网格几何体，把顶点/法线烘焙进 toAnim 变换（输出在该变换的局部空间）。 */
export function bakeGeometry(mesh, toAnim) {
  const geo = mesh.geometry.clone();
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toAnim);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  if (geo.attributes.normal) {
    const nrm = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(toAnim);
    const n = new THREE.Vector3();
    for (let i = 0; i < nrm.count; i++) {
      n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
  }
  geo.computeBoundingSphere();
  return geo;
}

/** 封盖材质：双面，避免切割面因绕序问题出现空洞。 */
export function makeCapMaterial(baseMat) {
  const mat = baseMat.clone();
  mat.side = THREE.DoubleSide;
  mat.needsUpdate = true;
  return mat;
}

/**
 * 水平面封盖（points 为 {x,z,u,v}[]，输出几何在该 y 平面上）。
 *
 * 刻意不复用 buildPlanarCap：原 characterModel.js 是在 (x,z) 左手系里求凸包，并按 `facing > 0`
 * 决定扇形绕序；buildPlanarCap 的判据是 sign(cross(U,V)·N)，对同一组点恰好互为镜像。
 * 任何能保持顶点顺序的基底（要求 uAxis.x·vAxis.z > 0）都会让 U×V 与 N 反向，从而必定翻转；
 * 而改用 uAxis.x·vAxis.z < 0 的基底又会把凸包顶点顺序整体倒转。两者不可兼得，
 * 故此处保留原始算法，使输出与抽取前逐字节一致。通用平面封盖请用 buildPlanarCap。
 */
function buildCapGeometry(points, y, facing) {
  const pts = points.map((p) => ({ x: p.x, z: p.z, u: p.u, v: p.v }));
  pts.sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const buildHalf = () => {
    const half = [];
    for (const p of pts) {
      while (half.length >= 2 && cross(half[half.length - 2], half[half.length - 1], p) <= 0) half.pop();
      half.push(p);
    }
    return half;
  };
  const lower = buildHalf();
  pts.reverse();
  const upper = buildHalf();
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) return null;

  let cx = 0;
  let cz = 0;
  let cu = 0;
  let cv = 0;
  for (const p of hull) {
    cx += p.x;
    cz += p.z;
    cu += p.u;
    cv += p.v;
  }
  cx /= hull.length;
  cz /= hull.length;
  cu /= hull.length;
  cv /= hull.length;

  const positions = [cx, y, cz];
  const uvs = [cu, cv];
  const normals = [0, facing, 0];
  for (const p of hull) {
    positions.push(p.x, y, p.z);
    uvs.push(p.u, p.v);
    normals.push(0, facing, 0);
  }
  const indices = [];
  for (let i = 0; i < hull.length; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % hull.length);
    if (facing > 0) indices.push(0, a, b);
    else indices.push(0, b, a);
  }

  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  capGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  capGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  capGeo.setIndex(indices);
  capGeo.computeBoundingSphere();
  return capGeo;
}

/**
 * 任意平面凸包封盖：把共面点投影到 (U,V) 基底求凸包并扇形三角化。
 * points: [{x,y,z,u,v}]，origin/uAxis/vAxis/normal 为同坐标系下的平面定义。
 *
 * 注意：调用方须保证 (uAxis, vAxis, normal) 构成右手系（cross(uAxis,vAxis) 与 normal 同向），
 * 此时扇形的几何朝向与 normal 一致，可安全配合单面材质使用。左手系会让封盖朝内。
 *
 * 【暂不被 buildCapGeometry 复用】`buildCapGeometry` 必须在 (x,z) 左手系里求凸包，
 * 否则输出无法与抽取前逐字节一致（推导见 buildCapGeometry 上方注释）。
 * 本函数是通用平面封盖实现，由 segmentMeshByPlane（任意平面切分）调用。
 */
export function buildPlanarCap(points, origin, uAxis, vAxis, normal) {
  const proj = points.map((p) => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const dz = p.z - origin.z;
    return {
      a: dx * uAxis.x + dy * uAxis.y + dz * uAxis.z,
      b: dx * vAxis.x + dy * vAxis.y + dz * vAxis.z,
      u: p.u,
      v: p.v,
    };
  });

  proj.sort((s, t) => s.a - t.a || s.b - t.b);
  // 同一条棱的交点会被多个三角形重复收集；重合点在下面的单调链里会让
  // half() 的 cross<=0 弹栈判据失效，导致凸包端点被弹掉、接缝处同一个投影点
  // 在 lower/upper 各保留一份，拼接后仍重复，扇形三角化时产生零面积三角形。
  // 故先就地合并重合点，再交给单调链。
  const pts = [];
  for (const p of proj) {
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev.a - p.a) < 1e-12 && Math.abs(prev.b - p.b) < 1e-12) continue;
    pts.push(p);
  }
  const cross = (o, s, t) => (s.a - o.a) * (t.b - o.b) - (s.b - o.b) * (t.a - o.a);
  const half = () => {
    const h = [];
    for (const p of pts) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    return h;
  };
  const lower = half();
  pts.reverse();
  const upper = half();
  // 单调链的两条半链共享一对端点，各去掉末项后首尾不再重复
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) return null;

  let ca = 0;
  let cb = 0;
  let cu = 0;
  let cv = 0;
  for (const p of hull) {
    ca += p.a;
    cb += p.b;
    cu += p.u;
    cv += p.v;
  }
  ca /= hull.length;
  cb /= hull.length;
  cu /= hull.length;
  cv /= hull.length;

  const toWorld = (a, b, u, v) => ({
    x: origin.x + uAxis.x * a + vAxis.x * b,
    y: origin.y + uAxis.y * a + vAxis.y * b,
    z: origin.z + uAxis.z * a + vAxis.z * b,
  });

  const center = toWorld(ca, cb, cu, cv);
  const positions = [center.x, center.y, center.z];
  const uvs = [cu, cv];
  const normals = [normal.x, normal.y, normal.z];
  for (const p of hull) {
    const w = toWorld(p.a, p.b, p.u, p.v);
    positions.push(w.x, w.y, w.z);
    uvs.push(p.u, p.v);
    normals.push(normal.x, normal.y, normal.z);
  }

  // (U,V,N) 为右手系时，扇形正向绕序为 (0,a,b)；法线反向则翻转
  const crossUV = {
    x: uAxis.y * vAxis.z - uAxis.z * vAxis.y,
    y: uAxis.z * vAxis.x - uAxis.x * vAxis.z,
    z: uAxis.x * vAxis.y - uAxis.y * vAxis.x,
  };
  const facingPositive =
    crossUV.x * normal.x + crossUV.y * normal.y + crossUV.z * normal.z >= 0;

  const indices = [];
  for (let i = 0; i < hull.length; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % hull.length);
    if (facingPositive) indices.push(0, a, b);
    else indices.push(0, b, a);
  }

  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  capGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  capGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  capGeo.setIndex(indices);
  capGeo.computeBoundingSphere();
  return capGeo;
}

/** 从子集三角形构建子几何体，顶点/法线烘焙进 toAnim（与原实现一致）。 */
export function buildSubGeometry(geo, indices, toAnim, norm) {
  if (indices.length === 0) return null;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  const sub = new THREE.BufferGeometry();
  const oldToNew = new Map();
  const newPos = [];
  const newUv = [];
  const newNorm = [];
  const newIdx = [];
  const v = new THREE.Vector3();
  const nm = norm ? new THREE.Matrix3().getNormalMatrix(toAnim) : null;
  const n = new THREE.Vector3();

  for (const oldI of indices) {
    let newI = oldToNew.get(oldI);
    if (newI === undefined) {
      newI = newPos.length / 3;
      oldToNew.set(oldI, newI);
      v.fromBufferAttribute(pos, oldI).applyMatrix4(toAnim);
      newPos.push(v.x, v.y, v.z);
      if (uv) newUv.push(uv.getX(oldI), uv.getY(oldI));
      if (norm && nm) {
        n.fromBufferAttribute(norm, oldI).applyMatrix3(nm).normalize();
        newNorm.push(n.x, n.y, n.z);
      }
    }
    newIdx.push(newI);
  }

  sub.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  if (uv) sub.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2));
  if (norm && nm) sub.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
  sub.setIndex(newIdx);
  sub.computeBoundingSphere();
  return sub;
}

/**
 * 在给定的水平切面（升序 Y）处把一个网格重切成多段，并给每个切面生成封盖。
 *
 * skipTris（可选）为**要跳过的三角形序号集合**：调用方已经把这些三角形单独装配到骨架上
 * （例如手臂分段），从躯干带里排除它们，避免同一块几何被画两遍。
 *
 * keepTris（可选）为**只参与切分的三角形序号集合**：用于把左右腿分开切分，
 * 这样每个切面的封盖只覆盖一条腿，不会在双腿之间连出一片「蹼」。
 */
export function segmentMesh(mesh, toAnim, planeYs, nextCapOffset, skipTris = null, keepTris = null) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const uv = geo.attributes.uv;
  const norm = geo.attributes.normal;
  if (!idx) return null;

  const nP = planeYs.length;
  const bandIndices = Array.from({ length: nP + 1 }, () => []);
  const cutPoints = Array.from({ length: nP }, () => []);

  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const ua = new THREE.Vector2();
  const ub = new THREE.Vector2();

  for (let t = 0; t < idx.count / 3; t++) {
    if (skipTris && skipTris.has(t)) continue;
    if (keepTris && !keepTris.has(t)) continue;
    const i0 = idx.getX(t * 3);
    const i1 = idx.getX(t * 3 + 1);
    const i2 = idx.getX(t * 3 + 2);
    va.fromBufferAttribute(pos, i0).applyMatrix4(toAnim);
    vb.fromBufferAttribute(pos, i1).applyMatrix4(toAnim);
    vc.fromBufferAttribute(pos, i2).applyMatrix4(toAnim);
    const cy = (va.y + vb.y + vc.y) / 3;

    let band = 0;
    for (let p = 0; p < nP; p++) {
      if (cy > planeYs[p]) band = p + 1;
    }
    bandIndices[band].push(i0, i1, i2);

    const tri = [
      [va, i0],
      [vb, i1],
      [vc, i2],
    ];
    for (let e = 0; e < 3; e++) {
      const pa = tri[e][0];
      const pb = tri[(e + 1) % 3][0];
      for (let p = 0; p < nP; p++) {
        const py = planeYs[p];
        if ((pa.y - py) * (pb.y - py) < 0) {
          const s = (py - pa.y) / (pb.y - pa.y);
          const px = pa.x + (pb.x - pa.x) * s;
          const pz = pa.z + (pb.z - pa.z) * s;
          let pu = 0;
          let pv = 0;
          if (uv) {
            ua.fromBufferAttribute(uv, tri[e][1]);
            ub.fromBufferAttribute(uv, tri[(e + 1) % 3][1]);
            pu = ua.x + (ub.x - ua.x) * s;
            pv = ua.y + (ub.y - ua.y) * s;
          }
          cutPoints[p].push({ x: px, z: pz, u: pu, v: pv });
        }
      }
    }
  }

  const bands = [];
  for (let b = 0; b <= nP; b++) {
    const subGeo = buildSubGeometry(geo, bandIndices[b], toAnim, norm);
    let geoL = null;
    let geoR = null;
    // 左右腿分离 (对于低于 neckY 的下肢段 band 0 足部和 band 1 小腿)
    if (b < 2 && bandIndices[b].length > 0) {
      const idxL = [];
      const idxR = [];
      for (let k = 0; k < bandIndices[b].length; k += 3) {
        const i0 = bandIndices[b][k];
        const i1 = bandIndices[b][k + 1];
        const i2 = bandIndices[b][k + 2];
        va.fromBufferAttribute(pos, i0).applyMatrix4(toAnim);
        vb.fromBufferAttribute(pos, i1).applyMatrix4(toAnim);
        vc.fromBufferAttribute(pos, i2).applyMatrix4(toAnim);
        const cx = (va.x + vb.x + vc.x) / 3;
        if (cx < 0) {
          idxL.push(i0, i1, i2);
        } else {
          idxR.push(i0, i1, i2);
        }
      }
      geoL = buildSubGeometry(geo, idxL, toAnim, norm);
      geoR = buildSubGeometry(geo, idxR, toAnim, norm);
    }
    bands.push({ geo: subGeo, geoL, geoR });
  }

  // 每个切面用凸包封盖（略微错开避免 z-fighting）
  for (let p = 0; p < nP; p++) {
    if (cutPoints[p].length >= 3) {
      const off = nextCapOffset();
      // 切面点若同时跨左右两侧 (例如脚踝/膝盖切面)，左右分别封盖，杜绝跨腿蹼状相连
      const ptsL = cutPoints[p].filter((pt) => pt.x < 0);
      const ptsR = cutPoints[p].filter((pt) => pt.x >= 0);
      if (p < 2 && ptsL.length >= 3 && ptsR.length >= 3) {
        bands[p].capTopL = buildCapGeometry(ptsL, planeYs[p] + off, 1);
        bands[p].capTopR = buildCapGeometry(ptsR, planeYs[p] + off, 1);
        bands[p + 1].capBottomL = buildCapGeometry(ptsL, planeYs[p] - off, -1);
        bands[p + 1].capBottomR = buildCapGeometry(ptsR, planeYs[p] - off, -1);
      }
      bands[p].capTop = buildCapGeometry(cutPoints[p], planeYs[p] + off, 1);
      bands[p + 1].capBottom = buildCapGeometry(cutPoints[p], planeYs[p] - off, -1);
    }
  }
  return bands;
}

/**
 * 用任意平面把一个网格切成两半，并各自生成平面封盖。
 *
 * plane: { origin: {x,y,z}, normal: {x,y,z} }（法线不必归一化，内部会归一化）
 * 返回 { near: { geo, cap }, far: { geo, cap } } | null
 *   near = 法线所指的一侧；far = 另一侧。
 *   geo 已烘焙到 toAnim 空间；该侧无三角形时 geo 为 null。
 *   cap 是该侧在切面上的凸包封盖；切面点不足 3 个时 cap 为 null。
 *
 * 切面封盖沿法线方向做微小偏移以避免与网格边缘 z-fighting（沿用 segmentMesh 的做法）。
 */
export function segmentMeshByPlane(mesh, toAnim, plane, nextCapOffset) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const uv = geo.attributes.uv;
  const norm = geo.attributes.normal;
  if (!idx) return null;

  const n = new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z);
  if (n.lengthSq() < 1e-12) return null;
  n.normalize();
  const o = new THREE.Vector3(plane.origin.x, plane.origin.y, plane.origin.z);

  // 顶点变换到 toAnim 空间，并算各顶点到切面的有符号距离
  const count = pos.count;
  const tp = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toAnim);
    tp[i * 3] = v.x;
    tp[i * 3 + 1] = v.y;
    tp[i * 3 + 2] = v.z;
  }
  const dist = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    dist[i] = (tp[i * 3] - o.x) * n.x + (tp[i * 3 + 1] - o.y) * n.y + (tp[i * 3 + 2] - o.z) * n.z;
  }

  // 三角形按质心归到两侧，同时收集跨切面的边交点
  // 注意：buildSubGeometry 收的是顶点索引（与 segmentMesh 一致），故这里按 i0,i1,i2 展开。
  const nearTris = [];
  const farTris = [];
  const cutPoints = [];
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const ua = new THREE.Vector2();
  const ub = new THREE.Vector2();
  for (let t = 0; t < idx.count / 3; t++) {
    const i0 = idx.getX(t * 3);
    const i1 = idx.getX(t * 3 + 1);
    const i2 = idx.getX(t * 3 + 2);
    const d0 = dist[i0], d1 = dist[i1], d2 = dist[i2];
    const cd = (d0 + d1 + d2) / 3;
    (cd >= 0 ? nearTris : farTris).push(i0, i1, i2);

    const tri = [[i0, d0], [i1, d1], [i2, d2]];
    for (let e = 0; e < 3; e++) {
      const [ia, da] = tri[e];
      const [ib, db] = tri[(e + 1) % 3];
      // 严格穿越切面的边：取线性插值交点
      if (da * db < 0) {
        const s = -da / (db - da);
        va.set(tp[ia * 3], tp[ia * 3 + 1], tp[ia * 3 + 2]);
        vb.set(tp[ib * 3], tp[ib * 3 + 1], tp[ib * 3 + 2]);
        let pu = 0;
        let pv = 0;
        if (uv) {
          ua.fromBufferAttribute(uv, ia);
          ub.fromBufferAttribute(uv, ib);
          pu = ua.x + (ub.x - ua.x) * s;
          pv = ua.y + (ub.y - ua.y) * s;
        }
        cutPoints.push({
          x: va.x + (vb.x - va.x) * s,
          y: va.y + (vb.y - va.y) * s,
          z: va.z + (vb.z - va.z) * s,
          u: pu,
          v: pv,
        });
      } else if (da === 0) {
        // 顶点恰在切面上时它本身就是切面点，不能只靠严格穿越的边（否则斜切退化时封盖丢失）
        cutPoints.push({
          x: tp[ia * 3], y: tp[ia * 3 + 1], z: tp[ia * 3 + 2],
          u: uv ? uv.getX(ia) : 0, v: uv ? uv.getY(ia) : 0,
        });
      } else if (db === 0) {
        cutPoints.push({
          x: tp[ib * 3], y: tp[ib * 3 + 1], z: tp[ib * 3 + 2],
          u: uv ? uv.getX(ib) : 0, v: uv ? uv.getY(ib) : 0,
        });
      }
    }
  }

  // 切面基底：uAxis ⟂ 法线，vAxis = 法线 × uAxis，使 (uAxis, vAxis, normal) 成右手系，
  // 满足 buildPlanarCap 对基底方向的前置要求（cross(uAxis,vAxis) 与 normal 同向）。
  const helper = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const uAxis = new THREE.Vector3().crossVectors(n, helper).normalize();
  const vAxis = new THREE.Vector3().crossVectors(n, uAxis).normalize();

  // 封盖沿法线朝各自材料的外侧偏移，避免与网格边缘 z-fighting；
  // 法线也朝外侧，与 segmentMesh 的 facing 约定一致（bands[p] 在平面之下 → facing=1/+Y，bands[p+1] → -1/-Y）。
  const off = nextCapOffset ? nextCapOffset() : 0;
  const nearOrigin = new THREE.Vector3(o.x - n.x * off, o.y - n.y * off, o.z - n.z * off);
  const farOrigin = new THREE.Vector3(o.x + n.x * off, o.y + n.y * off, o.z + n.z * off);
  const capNear = buildPlanarCap(cutPoints, nearOrigin, uAxis, vAxis, n.clone().negate());
  const capFar = buildPlanarCap(cutPoints, farOrigin, uAxis, vAxis, n);

  return {
    near: { geo: buildSubGeometry(geo, nearTris, toAnim, norm), cap: capNear },
    far: { geo: buildSubGeometry(geo, farTris, toAnim, norm), cap: capFar },
  };
}
