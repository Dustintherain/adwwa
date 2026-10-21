import * as THREE from 'three';
import { BONES, ARM_SEGMENTS, ARM_CORRIDOR } from './rigSpec.js';
import { extractLimbSegments } from './limbExtract.js';
import { buildSubGeometry } from './meshTools.js';

/**
 * skinnedMeshRig.js — 基于 Three.js 骨骼动画三大核心概念（Bone、Skeleton、SkinnedMesh）
 * 的统一蒙皮骨架系统。
 *
 * 核心机制：
 * 1. Bone（骨骼）：由 THREE.Bone 构建的具有严格父子拓扑的层次骨骼树。
 * 2. Skeleton（骨架）：由 THREE.Skeleton 管理骨骼数组与骨骼逆绑定矩阵（boneInverses）。
 * 3. SkinnedMesh（蒙皮网格）：顶点携带 skinIndex（vec4）与 skinWeight（vec4）属性，
 *    在 GPU 顶点着色器中按线性混合蒙皮（Linear Blend Skinning）进行形变，
 *    彻底消除肢体硬切导致的关节空洞、断裂与穿帮。
 *
 * 涵盖两大应用场景：
 * - 第一人称（Viewmodel Arms）：完整连续的双臂蒙皮网格，由解析 IK 驱动，肩肘腕三骨平滑形变。
 * - 第三人称（Third-Person Character）：全人型 16 骨骼骨架，躯干、双腿、双臂平滑蒙皮变形。
 */

const SIDES = ['R', 'L'];

/**
 * 第一人称肩关节锚点离手掌目标的距离 = reach × 这个比例（默认值，可被调用方覆盖）。
 * reach 是臂展（上臂 + 前臂 × scale）。0.85 会让手臂几乎完全伸直（肘内角 ~120°），
 * 屏幕上像一根从肩抡到枪的硬棍；0.80 左右肘内角 ~95°，持枪姿态自然，
 * 且肩更靠近手掌、离相机更远，近景透视缩小、不再糊满屏幕。
 */
export const SHOULDER_REACH_FRAC = 0.78;

/** 查 rigSpec 骨骼比例 */
function getBoneSpec(name) {
  return BONES.find((b) => b.name === name);
}

/**
 * 提取一侧手臂所有三角形序号
 */
export function extractArmData(side, positions, indices, height, halfWidth, halfDepth) {
  const chain = ARM_SEGMENTS[side].chain.map((boneName) => {
    const bone = getBoneSpec(boneName);
    return {
      x: bone.x * halfWidth,
      y: bone.y * height,
      z: bone.z * halfDepth,
    };
  });

  const res = extractLimbSegments({
    positions,
    indices,
    chain,
    corridorHalfWidth: ARM_CORRIDOR.halfWidthRatio * halfWidth,
  });

  if (!res.ok) return null;

  const allTris = [...(res.upper || []), ...(res.fore || []), ...(res.hand || [])];
  const flatIndices = [];
  for (const t of allTris) {
    flatIndices.push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
  }

  const shAbs = new THREE.Vector3(chain[0].x, chain[0].y, chain[0].z);
  const elAbs = new THREE.Vector3(chain[1].x, chain[1].y, chain[1].z);
  const wrAbs = new THREE.Vector3(chain[2].x, chain[2].y, chain[2].z);

  // 手部顶点序号（整个手掌连通分量）与手掌质心相对腕关节的偏移。
  // 这个偏移必须由网格实测得到：手质心离腕关节约 5.9cm（掌心+手指），
  // 之前调用方传的 2~3cm 常数会让掌心目标点落在手掌根部，整只手前移 3cm。
  const handVerts = new Set();
  for (const t of res.hand || []) {
    handVerts.add(indices[t * 3]);
    handVerts.add(indices[t * 3 + 1]);
    handVerts.add(indices[t * 3 + 2]);
  }
  const palmCentroid = new THREE.Vector3();
  for (const i of handVerts) {
    palmCentroid.x += positions[i * 3];
    palmCentroid.y += positions[i * 3 + 1];
    palmCentroid.z += positions[i * 3 + 2];
  }
  if (handVerts.size > 0) palmCentroid.divideScalar(handVerts.size);

  return {
    allTris,
    flatIndices,
    shAbs,
    elAbs,
    wrAbs,
    handVertices: [...handVerts],
    palmOffset: handVerts.size > 0 ? palmCentroid.clone().sub(wrAbs) : null,
    upperTris: res.upper || [],
    foreTris: res.fore || [],
    handTris: res.hand || [],
  };
}

/** 点 p 到线段 [a, b] 的距离 */
function distToSegment(p, a, b) {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  const t = lenSq > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / lenSq, 0, 1) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * 为单侧手臂几何体生成蒙皮权重（Bone 0: 肩, 1: 肘, 2: 腕）
 *
 * 两部分：
 * - 袖子（上臂 + 前臂）：沿臂轴的**平面参数**三次平滑过渡肘关节。判据是位置的线性函数，
 *   权重场连续——相邻顶点不会因为「离哪段骨更近」突然互换骨权重。
 * - 手掌：按手部连通分量整体刚性绑到腕骨（见下方注释）。
 *
 * 旧实现用最近骨段硬切（dFore < dUp ? 肘 : 肩）加一条「静止袖口骨」，相邻顶点会分别拿到
 * 纯肩和纯肘，肩部抬起时被拉成 8 倍长的三角面片，屏幕上是从肩部拖到护木的一整片布膜。
 */
const ELBOW_BLEND = 0.05; // 肘关节过渡半宽（米）

/**
 * 上臂内侧贴躯干的布料判据（仅第三人称全身骨架使用：那里有躯干可参考，把这块布料交给 Spine）。
 * 第一人称只有手臂本身，没有任何东西“静止”在背后，所以不能再用静止骨去吸收它——
 * 那会把布料与手臂之间拉成一整片薄膜。
 */
const SLEEVE_D_IN = 0.05;
const SLEEVE_D_OUT = 0.065;
const SLEEVE_X_IN = 0.155;
const SLEEVE_X_OUT = 0.175;

function smooth01(x) {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
}

/** 位置量化键（0.1mm），用于跨几何体认领同一顶点 */
function posKey(x, y, z) {
  return `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
}

/**
 * 胸部/袖口以外的袖子只受「肩→肘」影响；手掌整体刚性地绑到腕骨。
 *
 * 为什么要按「手部连通分量」硬分而不是按腕平面渐变：手与袖子是两个独立壳体，
 * 之间没有任何共享顶点。袖口正是袖子的最后一圈顶点，如果把它按腕平面的渐变
 * 分给手掌旋转，手掌那张大角度手部旋转就会把袖口扭成一圈歪斜的布，
 * 看起来就像“左臂位置不对”。硬分之后袖口始终垂直于前臂。
 *
 * @param {Set<string>} [handKeys] 手掌顶点的位置量化键
 */
function assignArmSkinWeights(armGeo, shAbs, elAbs, handKeys, rigidWrist = false) {
  const pos = armGeo.attributes.position;
  const count = pos.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);

  // 几何体已烘焙到肩局部空间（shAbs 为原点）
  const e = elAbs.clone().sub(shAbs);
  const L1 = e.length();
  const p = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(pos, i);

    skinIndices[i * 4] = 0;
    skinIndices[i * 4 + 1] = 1;
    skinIndices[i * 4 + 2] = 2;
    skinIndices[i * 4 + 3] = 0;

    if (rigidWrist || (handKeys && handKeys.has(posKey(p.x, p.y, p.z)))) {
      // 手掌：整只手刚性跟随腕骨
      skinWeights[i * 4] = 0;
      skinWeights[i * 4 + 1] = 0;
      skinWeights[i * 4 + 2] = 1;
    } else {
      // 上臂/前臂：沿臂轴越肘平面三次平滑过渡
      const overElbow = (p.dot(e) / (L1 * L1) - 1) * L1;
      const kElbow = smooth01((overElbow + ELBOW_BLEND) / (2 * ELBOW_BLEND));
      skinWeights[i * 4] = 1 - kElbow;
      skinWeights[i * 4 + 1] = kElbow;
      skinWeights[i * 4 + 2] = 0;
    }
    skinWeights[i * 4 + 3] = 0;
  }

  armGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  armGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
}

/**
 * 第一人称手臂的几何裁剪策略：**手掌 + 腕后一小截前臂袖管**，肩部泡袖整块不要。
 *
 * koharu 的袖子在肩部是泡袖（离臂轴最远 11.7cm，而前臂管只有 ~5cm），绑在肩骨上时
 * 正好横在相机前 30~45cm：屏幕上就是一大块深蓝布料 + 校徽，看起来像断肢。
 * 只留手掌时又变成“两只悬空的手”。折中方案（也是主流 FPS 的做法）：
 *   手 + 腕后 cuffLength 的袖管 → 前臂从画面下方伸进来，肩部与泡袖完全不出现在画面里。
 * 裁剪面在袖管内部，且由 sealOpenings 封成平面盖，不会看到袖管内壁。
 * 手 + 这一小截袖管整体刚性绑定腕骨，形变只发生在前面那段已经被裁掉的上臂上，
 * 因此画面里的袖口永不会被拉伸。
 */

export const FP_ARM_TRIM = { handOnly: true, axialFrac: 0.72, cuffLength: 0.10 };

/**
 * 沿「腕后 cuffLength 处的轴向平面」**真的把三角形切开**，返回只有手侧部分的几何体。
 *
 * 为什么不能用「保留顶点都在范围内的三角形」这种筛选：布料三角形很长，筛选后边界是
 * 锯齿状的、还会留下与主体不相连的孤立三角片；封口算法只好把它们各自封成小面盖，
 * 屏幕上就是一把粉色/深色的尖碎片（实测封盖顶点占到整只手臂的 42%）。
 * 切平面之后边界是**一条干净的平面环**，封口只需一个平面圆盘。
 *
 * 输出带索引（相邻三角形共享的新顶点坐标逐位相同，可直接合并），后面才能继续做封口。
 */
function clipArmAtPlane({ bodyGeo, tris, bodyMatrixWorld, cutPoint, cutNormal, toShoulderLocal }) {
  const pos = bodyGeo.attributes.position;
  const uvA = bodyGeo.attributes.uv;
  const nrmA = bodyGeo.attributes.normal;
  const bodyIdx = bodyGeo.index ? bodyGeo.index.array : null;
  if (!bodyIdx) return null;

  const nrmMat = new THREE.Matrix3().getNormalMatrix(bodyMatrixWorld);
  const readVert = (idx) => ({
    p: new THREE.Vector3().fromBufferAttribute(pos, idx).applyMatrix4(bodyMatrixWorld),
    n: nrmA
      ? new THREE.Vector3().fromBufferAttribute(nrmA, idx).applyMatrix3(nrmMat).normalize()
      : new THREE.Vector3(0, 1, 0),
    u: uvA ? uvA.getX(idx) : 0,
    v: uvA ? uvA.getY(idx) : 0,
  });

  const outPos = [];
  const outNrm = [];
  const outUv = [];
  const outIdx = [];
  const vertKey = new Map();
  const emit = (q) => {
    const p = q.p.clone().applyMatrix4(toShoulderLocal);
    const key = `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
    const hit = vertKey.get(key);
    if (hit !== undefined) return hit;
    const id = outPos.length / 3;
    vertKey.set(key, id);
    outPos.push(p.x, p.y, p.z);
    outNrm.push(q.n.x, q.n.y, q.n.z);
    outUv.push(q.u, q.v);
    return id;
  };

  for (const t of tris) {
    const poly = [readVert(bodyIdx[t * 3]), readVert(bodyIdx[t * 3 + 1]), readVert(bodyIdx[t * 3 + 2])];
    const kept = [];
    for (let i = 0; i < 3; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % 3];
      const da = a.p.clone().sub(cutPoint).dot(cutNormal);
      const db = b.p.clone().sub(cutPoint).dot(cutNormal);
      if (da >= 0) kept.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const s = da / (da - db);
        kept.push({
          p: a.p.clone().lerp(b.p, s),
          n: a.n.clone().lerp(b.n, s).normalize(),
          u: a.u + (b.u - a.u) * s,
          v: a.v + (b.v - a.v) * s,
        });
      }
    }
    for (let i = 1; i + 1 < kept.length; i++) {
      outIdx.push(emit(kept[0]), emit(kept[i]), emit(kept[i + 1]));
    }
  }
  if (!outIdx.length) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(outNrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
  geo.setIndex(outIdx);
  return geo;
}

/** 取三角形质心（世界系） */
const _triV = new THREE.Vector3();
function triCentroid(src, bodyIdx, t, matrixWorld, out) {
  out.set(0, 0, 0);
  for (let k = 0; k < 3; k++) {
    const i = bodyIdx[t * 3 + k];
    out.add(_triV.fromBufferAttribute(src, i).applyMatrix4(matrixWorld));
  }
  return out.divideScalar(3);
}

/**
 * 按「沿臂轴的开口环聚类」把几何体的所有开口封成平面盖。
 *
 * 手掌壳体 + 袖口壳体各自有一圈开口，位置不同、也不能共用一个扇心，
 * 所以先按投影到臂轴的坐标排序、按间隙分簇，每簇单独做平面凸包扇形封盖。
 * 只有手掌的几何体（FP_ARM_TRIM.handOnly）走这条路径，绕开闭环追踪的局限。
 */
function sealOpenings(geo, axis) {
  const idx = geo.index ? geo.index.array : null;
  if (!idx) return geo;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const nrm = geo.attributes.normal;

  const ekey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const edgeUse = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const kk = ekey(idx[t + k], idx[t + ((k + 1) % 3)]);
      edgeUse.set(kk, (edgeUse.get(kk) || 0) + 1);
    }
  }
  const borderVerts = new Set();
  for (const [k, c] of edgeUse) if (c === 1) for (const s of k.split(',')) borderVerts.add(Number(s));
  if (borderVerts.size < 3) return geo;

  const ax = axis.clone().normalize();
  const tmpV = new THREE.Vector3();
  const list = [...borderVerts]
    .map((i) => ({ i, t: tmpV.fromBufferAttribute(pos, i).dot(ax) }))
    .sort((a, b) => a.t - b.t);
  const groups = [];
  let cur = [list[0]];
  for (let k = 1; k < list.length; k++) {
    if (list[k].t - list[k - 1].t > 0.012) {
      groups.push(cur);
      cur = [];
    }
    cur.push(list[k]);
  }
  groups.push(cur);

  const capGeos = [];
  const p = new THREE.Vector3();
  for (const group of groups) {
    if (group.length < 3) continue;
    const pts = group.map(({ i }) => {
      p.fromBufferAttribute(pos, i);
      return { x: p.x, y: p.y, z: p.z, u: uv ? uv.getX(i) : 0, v: uv ? uv.getY(i) : 0 };
    });
    const origin = new THREE.Vector3();
    for (const q of pts) origin.add(new THREE.Vector3(q.x, q.y, q.z));
    origin.divideScalar(pts.length);

    const helper = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const uA = new THREE.Vector3().crossVectors(ax, helper).normalize();
    let vA = new THREE.Vector3().crossVectors(ax, uA).normalize();
    const normal = ax.clone();
    // 扇形盖的法线统一朝臂轴（双面材质，朝向只影响着色亮度）
    if (new THREE.Vector3().crossVectors(uA, vA).dot(normal) < 0) vA = vA.clone().negate();

    // 只要**一层**扇形盖。旧实现同时叠了「平面凸包 + 角度扇形」两层，
    // 在锯齿边界上每个小岛各生两片，总共 172 个封盖顶点（占整只手臂 42%），
    // 而且封盖顶点继承了手掌的粉色 UV 与袖子的深色 UV —— 屏幕上就是那把尖碎片。
    // 现在只在干净切平面产生的环上封一次，UV 取环上的均值（整片一个颜色）。
    const ps = pts.map((q) => {
      const d = new THREE.Vector3(q.x - origin.x, q.y - origin.y, q.z - origin.z);
      return { ...q, a: d.dot(uA), b: d.dot(vA), ang: Math.atan2(d.dot(vA), d.dot(uA)) };
    }).sort((s, t) => s.ang - t.ang);
    if (ps.length >= 3) {
      const capU = ps.reduce((s, q) => s + q.u, 0) / ps.length;
      const capV = ps.reduce((s, q) => s + q.v, 0) / ps.length;
      const capPos = [origin.x, origin.y, origin.z];
      const capUv = [capU, capV];
      const capNrm = [normal.x, normal.y, normal.z];
      const capIdx = [];
      for (const q of ps) {
        capPos.push(q.x, q.y, q.z);
        capNrm.push(normal.x, normal.y, normal.z);
        capUv.push(capU, capV);
      }
      for (let i = 0; i < ps.length; i++) {
        const a = 1 + i;
        const b = 1 + ((i + 1) % ps.length);
        capIdx.push(0, a, b);
      }
      const fan = new THREE.BufferGeometry();
      fan.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
      fan.setAttribute('uv', new THREE.Float32BufferAttribute(capUv, 2));
      fan.setAttribute('normal', new THREE.Float32BufferAttribute(capNrm, 3));
      fan.setIndex(capIdx);
      capGeos.push(fan);
    }
  }
  if (!capGeos.length) return geo;

  const posArr = Array.from(pos.array);
  const nrmArr = nrm ? Array.from(nrm.array) : null;
  const uvArr = uv ? Array.from(uv.array) : null;
  const idxArr = Array.from(idx);
  for (const cg of capGeos) {
    const base = posArr.length / 3;
    const cp = cg.attributes.position;
    const cu = cg.attributes.uv;
    const cn = cg.attributes.normal;
    for (let i = 0; i < cp.count; i++) {
      posArr.push(cp.getX(i), cp.getY(i), cp.getZ(i));
      if (nrmArr) nrmArr.push(cn.getX(i), cn.getY(i), cn.getZ(i));
      if (uvArr) uvArr.push(cu.getX(i), cu.getY(i));
    }
    for (let i = 0; i < cg.index.count; i++) idxArr.push(base + cg.index.getX(i));
  }

  const sealed = new THREE.BufferGeometry();
  sealed.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  if (nrmArr) sealed.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3));
  if (uvArr) sealed.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  sealed.setIndex(idxArr);
  sealed.computeBoundingSphere();
  sealed.userData.capBase = pos.count;
  return sealed;
}

/**
 * 裁掉上臂肩端的泡袖/披肩布料，返回保留下来的三角形序号（全局三角形序号）。
 * 判据（质心，世界系）：沿肩→肘轴的位置 ≥ axialFrac·L1。
 */
function trimShoulderTris({ armData, bodyGeo, bodyMatrixWorld, trim }) {
  const { upperTris, foreTris, handTris, shAbs, elAbs } = armData;
  const src = bodyGeo.attributes.position;
  const bodyIdx = bodyGeo.index ? bodyGeo.index.array : null;
  if (!bodyIdx) return null;

  const ax = elAbs.clone().sub(shAbs);
  const L1 = ax.length();
  ax.normalize();
  const c = new THREE.Vector3();
  const keep = [];
  for (const t of upperTris) {
    triCentroid(src, bodyIdx, t, bodyMatrixWorld, c);
    const rel = c.clone().sub(shAbs);
    const axial = rel.dot(ax);
    if (axial >= trim.axialFrac * L1) keep.push(t);
  }
  return [...keep, ...foreTris, ...handTris];
}

/**
 * 给袖子的肩端开口加一个扇形封盖。
 *
 * 手臂是从 body 网格里按走廊切出来的，肩端和腕端天然是**开口**。腕端被手掌挡住，
 * 肩端却会正对相机——不封盖时看到的是袖子内壁（暗色）加一圈白边，非常像断肢。
 * 只封离肩最近的环（袖子肩端），腕端不动。
 *
 * 封盖顶点的蒙皮权重沿用位置场；因为权重只跟「沿轴位置」有关，封盖与开口环
 * 拿到完全相同的权重，永远不会被肘部撕开。
 */
function capShoulderOpening(geo, maxDist) {
  const idx = geo.index ? geo.index.array : null;
  if (!idx) return geo;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  const edges = new Map();
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const kk = key(idx[t + k], idx[t + ((k + 1) % 3)]);
      edges.set(kk, (edges.get(kk) || 0) + 1);
    }
  }
  const border = [];
  for (const [k, count] of edges) if (count === 1) border.push(k.split(',').map(Number));
  if (!border.length) return geo;

  // 相邻表 → 串成闭合环
  const adj = new Map();
  for (const [a, b] of border) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  // 按**边**遍历而不是按顶点：走廊裁切得到的肩端是锯齿状、且可能有多个壳体，
  // 按顶点走会在分叉处提前断掉，只封到一小段（实测 21 条开口边只覆盖 5 条）。
  const usedEdge = new Set();
  const loops = [];
  for (const [a0, b0] of border) {
    if (usedEdge.has(key(a0, b0))) continue;
    const loop = [];
    let prev = -1;
    let cur = a0;
    for (let guard = 0; guard < 8192; guard++) {
      const nbrs = adj.get(cur) || [];
      let next;
      for (const n of nbrs) {
        if (usedEdge.has(key(cur, n))) continue;
        if (n === prev && nbrs.length > 1) continue; // 不要立刻原路返回
        next = n;
        break;
      }
      if (next === undefined) break;
      usedEdge.add(key(cur, next));
      loop.push(cur);
      prev = cur;
      cur = next;
      if (cur === loop[0]) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  if (!loops.length) return geo;

  const v3 = new THREE.Vector3();
  const caps = [];
  for (const loop of loops) {
    const center = new THREE.Vector3();
    let cu = 0;
    let cv = 0;
    for (const i of loop) {
      center.add(v3.fromBufferAttribute(pos, i));
      if (uv) {
        cu += uv.getX(i);
        cv += uv.getY(i);
      }
    }
    center.divideScalar(loop.length);
    if (center.length() > maxDist) continue; // 只封肩端（腕端离肩远且被手掌遮住）
    cu /= loop.length;
    cv /= loop.length;

    // Newell 法向（环上点的环绕方向给出朝向）
    const nrm = new THREE.Vector3();
    for (let i = 0; i < loop.length; i++) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, loop[i]);
      const b = new THREE.Vector3().fromBufferAttribute(pos, loop[(i + 1) % loop.length]);
      nrm.x += (a.y - b.y) * (a.z + b.z);
      nrm.y += (a.z - b.z) * (a.x + b.x);
      nrm.z += (a.x - b.x) * (a.y + b.y);
    }
    if (nrm.lengthSq() < 1e-12) continue;
    nrm.normalize();
    caps.push({ loop, center, cu, cv, nrm });
  }
  if (!caps.length) return geo;

  // 合并：原几何 + 封盖（封盖顶点全部复制，避免影响原顶点蒙皮）
  const nrmAttr = geo.attributes.normal;
  const posArr = [];
  const nrmArr = [];
  const uvArr = [];
  const idxArr = Array.from(idx);
  for (let i = 0; i < pos.count; i++) {
    posArr.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (nrmAttr) nrmArr.push(nrmAttr.getX(i), nrmAttr.getY(i), nrmAttr.getZ(i));
    if (uv) uvArr.push(uv.getX(i), uv.getY(i));
  }

  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (const { loop, center, cu, cv, nrm } of caps) {
    const ci = posArr.length / 3;
    posArr.push(center.x, center.y, center.z);
    if (nrmAttr) nrmArr.push(nrm.x, nrm.y, nrm.z);
    if (uv) uvArr.push(cu, cv);

    const ring = loop.map((i) => {
      const vi = posArr.length / 3;
      posArr.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nrmAttr) nrmArr.push(nrmAttr.getX(i), nrmAttr.getY(i), nrmAttr.getZ(i));
      if (uv) uvArr.push(uv.getX(i), uv.getY(i));
      return vi;
    });

    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      pa.set(posArr[a * 3], posArr[a * 3 + 1], posArr[a * 3 + 2]).sub(center);
      pb.set(posArr[b * 3], posArr[b * 3 + 1], posArr[b * 3 + 2]).sub(center);
      fn.crossVectors(pa, pb);
      if (fn.dot(nrm) >= 0) idxArr.push(ci, a, b);
      else idxArr.push(ci, b, a);
    }
  }
  const capped = new THREE.BufferGeometry();
  capped.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  if (nrmAttr) capped.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3));
  if (uv) capped.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  capped.setIndex(idxArr);
  capped.computeBoundingSphere();
  // 诊断用：封盖三角形从这里开始（离线脚本用它验证开口是否被覆盖）
  capped.userData.capBase = pos.count;
  return capped;
}

/**
 * 构建第一人称单侧蒙皮手臂（SkinnedMesh + Skeleton + Bone 链）
 */
export function buildFirstPersonArm({
  side,
  bodyGeo,
  bodyMatrixWorld,
  armData,
  material,
  scale = 0.88,
  palmOffset,
  restPalm,
  shoulderDir,
  poleDir,
  handEuler,
  shoulderFrac = SHOULDER_REACH_FRAC,
  trim = FP_ARM_TRIM,
  capEnds = true,
}) {
  const { flatIndices, shAbs, elAbs, wrAbs } = armData;

  // 将手臂顶点烘焙到以肩膀为原点 (0,0,0) 的局部空间
  const toShoulderLocal = new THREE.Matrix4()
    .makeTranslation(-shAbs.x, -shAbs.y, -shAbs.z)
    .multiply(bodyMatrixWorld);

  // 裁剪策略见 FP_ARM_TRIM。失败时退回原三角形集合，不阻断渲染。
  let buildIndices = flatIndices;
  let rigidWrist = false;
  let clippedGeo = null;
  if (trim && trim.handOnly && armData.handTris && armData.handTris.length) {
    // 手 + （可选）腕后一小截前臂，然后**沿轴平面切开**，而不是挑三角形。
    // 挑三角形会留下锯齿边界和孤立碎片，封口时被各自封成小尖片（就是之前屏幕上的碎片）。
    const cuff = trim.cuffLength ?? 0;
    const cutAxis = wrAbs.clone().sub(elAbs).normalize(); // 肘 → 腕，指向手指
    const cutPoint = wrAbs.clone().addScaledVector(cutAxis, -cuff);
    const tris = [...armData.handTris, ...(cuff > 0 ? armData.foreTris || [] : [])];
    // 注意：裁剪函数输出的是**世界坐标减肩点**，所以这里只传纯平移，不能传
    // toShoulderLocal（它已经包含 bodyMatrixWorld，会对顶点做第二次变换）。
    const toShoulderOnly = new THREE.Matrix4().makeTranslation(-shAbs.x, -shAbs.y, -shAbs.z);
    const clipped = clipArmAtPlane({
      bodyGeo,
      tris,
      bodyMatrixWorld,
      cutPoint,
      cutNormal: cutAxis,
      toShoulderLocal: toShoulderOnly,
    });
    if (clipped) {
      clippedGeo = clipped;
      rigidWrist = true;
    } else {
      const bodyIdx = bodyGeo.index.array;
      buildIndices = [];
      for (const t of armData.handTris) buildIndices.push(bodyIdx[t * 3], bodyIdx[t * 3 + 1], bodyIdx[t * 3 + 2]);
      rigidWrist = true;
    }
  } else if (trim && armData.upperTris && armData.upperTris.length) {
    const kept = trimShoulderTris({ armData, bodyGeo, bodyMatrixWorld, trim });
    if (kept && kept.length) {
      const bodyIdx = bodyGeo.index.array;
      buildIndices = [];
      for (const t of kept) buildIndices.push(bodyIdx[t * 3], bodyIdx[t * 3 + 1], bodyIdx[t * 3 + 2]);
    }
  }

  let armGeo = clippedGeo || buildSubGeometry(bodyGeo, buildIndices, toShoulderLocal, bodyGeo.attributes.normal);
  if (!armGeo) return null;

  // 封住袖子的肩端开口：不封时正对相机看到的是袖管内壁（暗色 + 一圈白边），像断肢。
  if (capEnds) {
    // handOnly 时唯一的开口就在手腕（~0.30m，即臂长），必须封；
    // 保留袖子的模式下肩端裁口在 ~0.14m，取 0.85×臂长 可排除腕端。
    if (rigidWrist) {
      // 只有手掌：所有开口（腕口 + 袖口）都按平面凸包封住
      armGeo = sealOpenings(armGeo, wrAbs.clone().sub(elAbs));
    } else {
      const reach0 = elAbs.clone().sub(shAbs).length() + wrAbs.clone().sub(elAbs).length();
      armGeo = capShoulderOpening(armGeo, reach0 * 0.85);
    }
  }

  // 手掌顶点集合（量化位置键）：几何体已烘焙到肩局部空间，身体网格用同一矩阵变换后量化，
  // 两边浮点结果逐位相同，因此键可以精确匹配。
  const handKeys = new Set();
  if (armData.handVertices && armData.handVertices.length) {
    const src = bodyGeo.attributes.position;
    const hv = new THREE.Vector3();
    for (const oldI of armData.handVertices) {
      hv.fromBufferAttribute(src, oldI).applyMatrix4(toShoulderLocal);
      handKeys.add(posKey(hv.x, hv.y, hv.z));
    }
  }

  assignArmSkinWeights(armGeo, shAbs, elAbs, handKeys, rigidWrist);

  // 1. 创建 Bone 节点树
  const bindUpper = elAbs.clone().sub(shAbs);
  const bindLower = wrAbs.clone().sub(elAbs);

  // DEBUG: 诊断手臂几何与骨骼对齐
  {
    const dbgPos = armGeo.attributes.position;
    const dbgBB = new THREE.Box3();
    for (let i = 0; i < dbgPos.count; i++) {
      dbgBB.expandByPoint(new THREE.Vector3(dbgPos.getX(i), dbgPos.getY(i), dbgPos.getZ(i)));
    }
    const dbgCenter = new THREE.Vector3();
    dbgBB.getCenter(dbgCenter);
    console.log(`[buildFirstPersonArm ${side}] shAbs:`, shAbs);
    console.log(`[buildFirstPersonArm ${side}] elAbs:`, elAbs);
    console.log(`[buildFirstPersonArm ${side}] wrAbs:`, wrAbs);
    console.log(`[buildFirstPersonArm ${side}] bindUpper:`, bindUpper, 'len:', bindUpper.length().toFixed(4));
    console.log(`[buildFirstPersonArm ${side}] bindLower:`, bindLower, 'len:', bindLower.length().toFixed(4));
    console.log(`[buildFirstPersonArm ${side}] armGeo BB min:`, dbgBB.min, 'max:', dbgBB.max);
    console.log(`[buildFirstPersonArm ${side}] armGeo BB center:`, dbgCenter);
    console.log(`[buildFirstPersonArm ${side}] armGeo vertex count:`, dbgPos.count);
    console.log(`[buildFirstPersonArm ${side}] restPalm:`, restPalm);
    console.log(`[buildFirstPersonArm ${side}] shoulderDir:`, shoulderDir);
    console.log(`[buildFirstPersonArm ${side}] scale:`, scale);
  }

  const shoulder = new THREE.Bone();
  shoulder.name = `vm_bone_shoulder_${side}`;
  // 计算肩关节在 Viewmodel 空间的安置位置：
  // 肩落在「手掌目标 + shoulderDir × reach × shoulderFrac」上。fraction 越小，肩离手掌越近、
  // 手肘弯得越多（0.85 几乎伸直，看起来像一根棍子；0.78~0.82 是自然的持枪姿态）。
  const reach = (bindUpper.length() + bindLower.length()) * scale;
  const shoulderVM = restPalm.clone().addScaledVector(shoulderDir.clone().normalize(), reach * shoulderFrac);
  // 重要：手臂网格烘焙时以肩膀为局部原点 (0,0,0)，因此骨骼初始位置也必须为 (0,0,0)，
  // 从而使 bindMatrix 与 boneInverse 零偏移对齐，彻底消除杠杆旋转错位
  shoulder.position.set(0, 0, 0);

  const elbow = new THREE.Bone();
  elbow.name = `vm_bone_elbow_${side}`;
  elbow.position.copy(bindUpper);
  shoulder.add(elbow);

  const wrist = new THREE.Bone();
  wrist.name = `vm_bone_wrist_${side}`;
  wrist.position.copy(bindLower);
  // 绑定姿态必须是**零旋转**：腕骨的 bind 旋转会被 boneInverse 抵消，
  // 旧实现把 handEuler 写进 bind（wrist.quaternion.setFromEuler(handEuler)），
  // 于是每帧再设一次同一个 handEuler 等于什么都没做——手部朝向实际上被死死钉在
  // 「前臂方向」上，而 solveViewmodelArm 又拿这个不生效的旋转去反解腕骨位置，
  // 令掌心目标点算错了一个整手长（实测偏 9~10cm），左臂因此看起来悬在枪旁边。
  // 现在 bind 零旋转，handEuler 在 bind 之后写入，才真正是「手相对前臂」的朝向。
  elbow.add(wrist);

  // 2. 创建 Skeleton 骨架
  const bones = [shoulder, elbow, wrist];
  const skeleton = new THREE.Skeleton(bones);

  // 3. 创建 SkinnedMesh 蒙皮网格并绑定骨架
  const armMat = material ? material.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff });
  armMat.roughness = 1.0;
  armMat.metalness = 0.0;
  armMat.depthTest = true;
  armMat.depthWrite = true;
  armMat.side = THREE.DoubleSide;

  const skinnedMesh = new THREE.SkinnedMesh(armGeo, armMat);
  skinnedMesh.name = `vm_skinned_arm_${side}`;
  skinnedMesh.frustumCulled = false;
  skinnedMesh.castShadow = false;
  skinnedMesh.receiveShadow = false;

  const root = new THREE.Group();
  root.name = `vm_arm_root_${side}`;
  root.position.copy(shoulderVM);
  root.scale.setScalar(scale);

  // 蒙皮绑定
  skinnedMesh.add(shoulder);
  root.add(skinnedMesh);
  root.updateMatrixWorld(true);
  skinnedMesh.bind(skeleton);

  // bind 之后才写入手部朝向，boneInverse 才是「零旋转基线」，手才能相对前臂独立旋转
  wrist.quaternion.setFromEuler(handEuler);
  wrist.updateMatrixWorld(true);

  // pole 向量（在 shoulder.parent 局部空间中，肩关节为原点，故极向向量直接归一化即可）
  const pole = poleDir.clone().normalize();

  return {
    side,
    root,
    skinnedMesh,
    skeleton,
    shoulder,
    elbow,
    wrist,
    scale,
    // 掌心偏移优先用网格实测值（手部质心 − 腕关节），调用方传入的常数只作降级
    palmOffset: armData.palmOffset ? armData.palmOffset.clone() : (palmOffset ? palmOffset.clone() : new THREE.Vector3()),
    pole,
    restPalm: restPalm.clone(),
    smooth: restPalm.clone(),
    shoulderVM: shoulderVM.clone(),
    handEuler: handEuler.clone(),
  };
}

/**
 * 构建第三人称全身 16 骨骼蒙皮骨架系统（SkinnedMesh + Skeleton + Bone）
 */
export function buildThirdPersonSkinnedCharacter({
  model,
  bodyMesh,
  outlineMesh,
  targetHeight,
  rigHalfWidth,
  rigHalfDepth,
  bodyPositions,
  bodyIndices,
}) {
  const hipY = targetHeight * 0.375;
  const kneeY = targetHeight * 0.225;
  const ankleY = targetHeight * 0.061;
  const spineY = targetHeight * 0.52;
  const neckY = targetHeight * 0.65;
  const legX = 0.098;

  // 1. 创建 16 根层次标准人型骨骼（THREE.Bone）
  const rootBone = new THREE.Bone();
  rootBone.name = 'Root';

  const hipsBone = new THREE.Bone();
  hipsBone.name = 'Hip';
  hipsBone.position.set(0, hipY, 0);
  rootBone.add(hipsBone);

  const spineBone = new THREE.Bone();
  spineBone.name = 'Spine';
  spineBone.position.set(0, spineY - hipY, 0);
  hipsBone.add(spineBone);

  const neckBone = new THREE.Bone();
  neckBone.name = 'Neck';
  neckBone.position.set(0, neckY - spineY, 0);
  spineBone.add(neckBone);

  // 手臂绝对坐标
  const getBoneAbs = (name) => {
    const b = getBoneSpec(name);
    return new THREE.Vector3(b.x * rigHalfWidth, b.y * targetHeight, b.z * rigHalfDepth);
  };

  const shL = getBoneAbs('shoulderL'), elL = getBoneAbs('elbowL'), wrL = getBoneAbs('handL');
  const shR = getBoneAbs('shoulderR'), elR = getBoneAbs('elbowR'), wrR = getBoneAbs('handR');

  // 左臂
  const shoulderL = new THREE.Bone();
  shoulderL.name = 'shoulderL';
  shoulderL.position.set(shL.x, shL.y - spineY, shL.z);
  spineBone.add(shoulderL);

  const elbowL = new THREE.Bone();
  elbowL.name = 'elbowL';
  elbowL.position.copy(elL).sub(shL);
  shoulderL.add(elbowL);

  const wristL = new THREE.Bone();
  wristL.name = 'handL';
  wristL.position.copy(wrL).sub(elL);
  elbowL.add(wristL);

  // 右臂
  const shoulderR = new THREE.Bone();
  shoulderR.name = 'shoulderR';
  shoulderR.position.set(shR.x, shR.y - spineY, shR.z);
  spineBone.add(shoulderR);

  const elbowR = new THREE.Bone();
  elbowR.name = 'elbowR';
  elbowR.position.copy(elR).sub(shR);
  shoulderR.add(elbowR);

  const wristR = new THREE.Bone();
  wristR.name = 'handR';
  wristR.position.copy(wrR).sub(elR);
  elbowR.add(wristR);

  // 左腿
  const hipBoneL = new THREE.Bone();
  hipBoneL.name = 'HipL';
  hipBoneL.position.set(-legX, 0, 0);
  hipsBone.add(hipBoneL);

  const kneeBoneL = new THREE.Bone();
  kneeBoneL.name = 'KneeL';
  kneeBoneL.position.set(0, kneeY - hipY, 0);
  hipBoneL.add(kneeBoneL);

  const ankleBoneL = new THREE.Bone();
  ankleBoneL.name = 'AnkleL';
  ankleBoneL.position.set(0, ankleY - kneeY, 0);
  kneeBoneL.add(ankleBoneL);

  // 右腿
  const hipBoneR = new THREE.Bone();
  hipBoneR.name = 'HipR';
  hipBoneR.position.set(legX, 0, 0);
  hipsBone.add(hipBoneR);

  const kneeBoneR = new THREE.Bone();
  kneeBoneR.name = 'KneeR';
  kneeBoneR.position.set(0, kneeY - hipY, 0);
  hipBoneR.add(kneeBoneR);

  const ankleBoneR = new THREE.Bone();
  ankleBoneR.name = 'AnkleR';
  ankleBoneR.position.set(0, ankleY - kneeY, 0);
  kneeBoneR.add(ankleBoneR);

  const bones = [
    rootBone,   // 0
    hipsBone,   // 1
    spineBone,  // 2
    neckBone,   // 3
    shoulderL,  // 4
    elbowL,     // 5
    wristL,     // 6
    shoulderR,  // 7
    elbowR,     // 8
    wristR,     // 9
    hipBoneL,   // 10
    kneeBoneL,  // 11
    ankleBoneL, // 12
    hipBoneR,   // 13
    kneeBoneR,  // 14
    ankleBoneR, // 15
  ];

  // 2. 创建 Skeleton 骨架
  const skeleton = new THREE.Skeleton(bones);

  // 3. 几何顶点与骨骼的权重赋值函数
  const assignFullBodySkinWeights = (mesh) => {
    const geo = mesh.geometry;
    const pAttr = geo.attributes.position;
    const vCount = pAttr.count;
    const sIndices = new Uint16Array(vCount * 4);
    const sWeights = new Float32Array(vCount * 4);
    const pv = new THREE.Vector3();

    for (let i = 0; i < vCount; i++) {
      pv.fromBufferAttribute(pAttr, i).applyMatrix4(mesh.matrixWorld);
      const px = pv.x, py = pv.y, pz = pv.z;

      let b0 = 1, b1 = 2, w0 = 1.0, w1 = 0.0;

      // 手臂距离判定
      const dShL = pv.distanceTo(shL), dElL = pv.distanceTo(elL), dWrL = pv.distanceTo(wrL);
      const dShR = pv.distanceTo(shR), dElR = pv.distanceTo(elR), dWrR = pv.distanceTo(wrR);
      const isArmL = px < -0.14 && py > 0.42 && (dShL < 0.28 || dElL < 0.22 || dWrL < 0.18);
      const isArmR = px > 0.14 && py > 0.42 && (dShR < 0.28 || dElR < 0.22 || dWrR < 0.18);

      if (isArmL) {
        // 左臂：shoulderL(4), elbowL(5), wristL(6)
        const e = elL.clone().sub(shL), f = wrL.clone().sub(elL);
        const t1 = pv.clone().sub(shL).dot(e) / e.lengthSq();
        const t2 = pv.clone().sub(elL).dot(f) / f.lengthSq();
        if (t2 >= 0.92) {
          b0 = 6; w0 = 1;
        } else if (t2 >= 0.75) {
          const s = (t2 - 0.75) / 0.17;
          b0 = 5; b1 = 6; w1 = s * s * (3 - 2 * s); w0 = 1 - w1;
        } else if (t1 > 0.8) {
          const de = (t1 - 1.0) * e.length();
          const W = 0.045;
          if (de <= -W) {
            b0 = 4; w0 = 1;
          } else if (de >= W) {
            b0 = 5; w0 = 1;
          } else {
            const u = (de + W) / (2 * W);
            b0 = 4; b1 = 5; w1 = u * u * (3 - 2 * u); w0 = 1 - w1;
          }
        } else {
          b0 = 4; w0 = 1;
          // 上臂内侧贴躯干的布料：跟脊椎走，不跟肩甩（否则肩转时侧面撕出折痕）
          const dUp = distToSegment(pv, shL, elL);
          const s = smooth01((dUp - SLEEVE_D_IN) / (SLEEVE_D_OUT - SLEEVE_D_IN))
            * (1 - smooth01((Math.abs(px) - SLEEVE_X_IN) / (SLEEVE_X_OUT - SLEEVE_X_IN)));
          if (s > 0) { b1 = 2; w1 = s; w0 = 1 - s; }
        }
      } else if (isArmR) {
        // 右臂：shoulderR(7), elbowR(8), wristR(9)
        const e = elR.clone().sub(shR), f = wrR.clone().sub(elR);
        const t1 = pv.clone().sub(shR).dot(e) / e.lengthSq();
        const t2 = pv.clone().sub(elR).dot(f) / f.lengthSq();
        if (t2 >= 0.92) {
          b0 = 9; w0 = 1;
        } else if (t2 >= 0.75) {
          const s = (t2 - 0.75) / 0.17;
          b0 = 8; b1 = 9; w1 = s * s * (3 - 2 * s); w0 = 1 - w1;
        } else if (t1 > 0.8) {
          const de = (t1 - 1.0) * e.length();
          const W = 0.045;
          if (de <= -W) {
            b0 = 7; w0 = 1;
          } else if (de >= W) {
            b0 = 8; w0 = 1;
          } else {
            const u = (de + W) / (2 * W);
            b0 = 7; b1 = 8; w1 = u * u * (3 - 2 * u); w0 = 1 - w1;
          }
        } else {
          b0 = 7; w0 = 1;
          // 上臂内侧贴躯干的布料：跟脊椎走，不跟肩甩（否则肩转时侧面撕出折痕）
          const dUp = distToSegment(pv, shR, elR);
          const s = smooth01((dUp - SLEEVE_D_IN) / (SLEEVE_D_OUT - SLEEVE_D_IN))
            * (1 - smooth01((Math.abs(px) - SLEEVE_X_IN) / (SLEEVE_X_OUT - SLEEVE_X_IN)));
          if (s > 0) { b1 = 2; w1 = s; w0 = 1 - s; }
        }
      } else if (py < hipY) {
        // 双腿：Left(10,11,12) vs Right(13,14,15)
        const isL = px < 0;
        const bHip = isL ? 10 : 13;
        const bKnee = isL ? 11 : 14;
        const bAnkle = isL ? 12 : 15;

        if (py <= ankleY) {
          b0 = bAnkle; w0 = 1;
        } else if (py < kneeY) {
          const t = (py - ankleY) / (kneeY - ankleY);
          if (t < 0.22) {
            const s = t / 0.22;
            b0 = bAnkle; b1 = bKnee; w1 = s * s * (3 - 2 * s); w0 = 1 - w1;
          } else if (t > 0.78) {
            const s = (t - 0.78) / 0.22;
            b0 = bKnee; b1 = bHip; w1 = s * s * (3 - 2 * s); w0 = 1 - w1;
          } else {
            b0 = bKnee; w0 = 1;
          }
        } else {
          // 大腿
          const t = Math.min(1.0, (py - kneeY) / (hipY - kneeY));
          if (t < 0.25) {
            const s = t / 0.25;
            b0 = bKnee; b1 = bHip; w1 = s * s * (3 - 2 * s); w0 = 1 - w1;
          } else {
            b0 = bHip; w0 = 1;
          }
        }
      } else {
        // 躯干 / 头部
        if (py >= neckY) {
          b0 = 3; w0 = 1; // 颈与头部 (3)
        } else if (py >= spineY) {
          const t = (py - spineY) / (neckY - spineY);
          if (t > 0.75) {
            const s = (t - 0.75) / 0.25;
            b0 = 2; b1 = 3; w1 = s * s * (3 - 2 * s); w0 = 1 - w1;
          } else {
            b0 = 2; w0 = 1; // 上胸部脊椎 (2)
          }
        } else {
          // 下躯干与百褶裙摆：骨盆 Hips(1) 与 Spine(2) 平滑过渡
          const t = (py - hipY) / (spineY - hipY);
          b0 = 1; b1 = 2; w1 = t * t * (3 - 2 * t); w0 = 1 - w1;
        }
      }

      sIndices[i * 4] = b0;
      sIndices[i * 4 + 1] = b1;
      sIndices[i * 4 + 2] = 0;
      sIndices[i * 4 + 3] = 0;

      sWeights[i * 4] = w0;
      sWeights[i * 4 + 1] = w1;
      sWeights[i * 4 + 2] = 0;
      sWeights[i * 4 + 3] = 0;
    }

    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIndices, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sWeights, 4));
  };

  // 4. 创建 SkinnedMesh 并绑定骨架
  const newBodyGeo = bodyMesh.geometry.clone();
  newBodyGeo.applyMatrix4(bodyMesh.matrixWorld);
  const skinnedBodyMesh = new THREE.SkinnedMesh(newBodyGeo, bodyMesh.material);
  skinnedBodyMesh.name = 'SkinnedBody';
  skinnedBodyMesh.castShadow = true;
  skinnedBodyMesh.receiveShadow = true;
  skinnedBodyMesh.frustumCulled = false;
  assignFullBodySkinWeights(skinnedBodyMesh);
  skinnedBodyMesh.add(rootBone);
  skinnedBodyMesh.bind(skeleton);

  let skinnedOutlineMesh = null;
  if (outlineMesh) {
    const newOutlineGeo = outlineMesh.geometry.clone();
    newOutlineGeo.applyMatrix4(outlineMesh.matrixWorld);
    skinnedOutlineMesh = new THREE.SkinnedMesh(newOutlineGeo, outlineMesh.material);
    skinnedOutlineMesh.name = 'SkinnedOutline';
    skinnedOutlineMesh.castShadow = false;
    skinnedOutlineMesh.receiveShadow = false;
    skinnedOutlineMesh.frustumCulled = false;
    assignFullBodySkinWeights(skinnedOutlineMesh);
    skinnedOutlineMesh.bind(skeleton);
    skinnedBodyMesh.add(skinnedOutlineMesh);
  }

  return {
    skeleton,
    bones,
    rootBone,
    hipsBone,
    spineBone,
    neckBone,
    hipBoneL,
    kneeBoneL,
    ankleBoneL,
    hipBoneR,
    kneeBoneR,
    ankleBoneR,
    shoulderL,
    elbowL,
    wristL,
    shoulderR,
    elbowR,
    wristR,
    skinnedBodyMesh,
    skinnedOutlineMesh,
    armBones: {
      shoulderL,
      elbowL,
      handL: wristL,
      shoulderR,
      elbowR,
      handR: wristR,
    },
    boneAbs: {
      shoulderL: shL,
      elbowL: elL,
      handL: wrL,
      shoulderR: shR,
      elbowR: elR,
      handR: wrR,
    },
  };
}
