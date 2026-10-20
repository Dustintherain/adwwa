/**
 * limbRig.js — 数据驱动手臂骨骼构建（调用 limbExtract 切出手臂分段，建关节挂段）
 *
 * 职责：
 *   1. 从 rigSpec.js 读骨骼表与走廊参数
 *   2. 按 limbExtract.extractLimbSegments 切出上下肢三段（upper/fore/hand）的三角形索引
 *   3. 给每段构建 BufferGeometry（用 meshTools.buildSubGeometry 打包）
 *   4. 建立关节层级（THREE.Group），按 rigSpec 的关节位置摆放
 *   5. 把分段网格挂到对应关节
 *
 * 坐标系约定：
 *   - positions 是顶点在 **animGroup 空间**的位置（已应用 GLB 节点变换，米制）
 *   - modelMatrix 是 body 网格的 matrixWorld（= 模型→animGroup 变换）
 *   - hipJointPos 是 hipJoint 在 animGroup-local 空间的位置（用于计算关节在 animGroup 空间的绝对位置）
 *   - height 是 worldBox 高度（用于从比例换算绝对位置）
 *   - 分段网格的几何体被烘焙到 **所属关节的局部空间**（顶点减去关节绝对位置），
 *     因此关节旋转时网格正好绕关节原点转动。
 *
 * 返回：
 *   { ok: boolean, reason?: string, bones: object, boneAbs: object, segmentMeshes: object, takenTris: Set<number> }
 *   bones: { shoulderL, elbowL, handL, shoulderR, elbowR, handR } — THREE.Group（关节）
 *   boneAbs: 骨名 → 该关节在 animGroup 空间的绝对位置（THREE.Vector3）
 *   segmentMeshes: { R: { upper: THREE.Mesh, fore: THREE.Mesh, hand: THREE.Mesh }, L: {...} }
 *   takenTris: 已被切成手臂分段的**三角形序号**（调用方用它从躯干几何里排除这些三角形）
 */

import * as THREE from 'three';
import { BONES, ARM_SEGMENTS, ARM_CORRIDOR } from './rigSpec.js';
import { extractLimbSegments } from './limbExtract.js';
import { buildSubGeometry } from './meshTools.js';

const SIDES = ['R', 'L'];
const SEGMENT_KEYS = ['upper', 'fore', 'hand'];

/** 从 rigSpec 查骨的比例值 */
function boneSpec(name) {
  return BONES.find((b) => b.name === name);
}

/**
 * 提取一侧手臂的三角形序号。
 *
 * rigSpec 里 shoulderL / elbowL / handL 的 x 本来就是负值，所以左侧直接用负 x 的关节链，
 * **不能**再镜像顶点（镜像 + 负链会让走廊落到另一条胳膊上）。
 */
function extractSide(side, positions, indices, height, halfWidth, halfDepth) {
  const chain = ARM_SEGMENTS[side].chain.map((boneName) => {
    const bone = boneSpec(boneName);
    return {
      x: bone.x * halfWidth,
      y: bone.y * height,
      z: bone.z * halfDepth,
    };
  });

  const result = extractLimbSegments({
    positions,
    indices,
    chain,
    corridorHalfWidth: ARM_CORRIDOR.halfWidthRatio * halfWidth,
  });

  if (!result.ok) return null;
  return result;
}

/** 三角形序号 → 展平的顶点索引（buildSubGeometry 的输入契约） */
function flatTriangleIndices(triList, indices) {
  const out = [];
  for (const t of triList) {
    out.push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
  }
  return out;
}

/**
 * 把一侧手臂的三段打包成几何体并挂到对应关节上。
 * 几何体烘焙到关节局部空间（顶点减去关节在 animGroup 空间的绝对位置）。
 */
function attachSideSegments({ side, segments, geo, modelMatrix, indices, bones, boneAbs, material }) {
  const chain = ARM_SEGMENTS[side].chain;
  const meshes = {};
  const takenTris = new Set();

  for (let k = 0; k < SEGMENT_KEYS.length; k++) {
    const key = SEGMENT_KEYS[k];
    const triList = segments[key] || [];
    for (const t of triList) takenTris.add(t);

    const boneName = chain[k];
    const bone = bones[boneName];
    if (!bone || triList.length === 0) {
      meshes[key] = null;
      continue;
    }

    const abs = boneAbs[boneName];
    const toJointLocal = new THREE.Matrix4().makeTranslation(-abs.x, -abs.y, -abs.z);
    const subGeo = buildSubGeometry(
      geo,
      flatTriangleIndices(triList, indices),
      toJointLocal.multiply(modelMatrix),
      geo.attributes.normal,
    );
    if (!subGeo) {
      meshes[key] = null;
      continue;
    }

    const mesh = new THREE.Mesh(subGeo, material || null);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bone.add(mesh);
    meshes[key] = mesh;
  }

  return { meshes, takenTris };
}

/** 建立一条手臂的骨骼链，返回骨与骨在 animGroup 空间的绝对位置。 */
function buildBoneChain(side, hipJoint, hipJointPos, height, halfWidth, halfDepth, bones, boneAbs) {
  const chain = ARM_SEGMENTS[side].chain;
  let parent = hipJoint;

  for (let i = 0; i < chain.length; i++) {
    const boneName = chain[i];
    const spec = boneSpec(boneName);
    const joint = new THREE.Group();
    joint.name = boneName;

    const absX = spec.x * halfWidth;
    const absY = spec.y * height;
    const absZ = spec.z * halfDepth;
    boneAbs[boneName] = new THREE.Vector3(absX, absY, absZ);

    if (i === 0) {
      joint.position.set(absX - hipJointPos.x, absY - hipJointPos.y, absZ - hipJointPos.z);
    } else {
      const prevAbs = boneAbs[chain[i - 1]];
      joint.position.set(absX - prevAbs.x, absY - prevAbs.y, absZ - prevAbs.z);
    }

    parent.add(joint);
    bones[boneName] = joint;
    parent = joint;
  }
}

/**
 * 构建手臂骨骼层级 + 分段网格（挂到关节上）。
 *
 * @param {BufferGeometry} bodyGeo — body 网格的几何体
 * @param {Matrix4} modelMatrix — body 网格的 matrixWorld（模型→animGroup 变换）
 * @param {THREE.Group} hipJoint — hip 关节（手臂的共同父节点 anchor）
 * @param {THREE.Vector3} hipJointPos — hipJoint 在 animGroup-local 空间中的位置
 * @param {number} height — 角色身高（米）
 * @param {number} halfWidth — 半宽（米）
 * @param {number} halfDepth — 半深（米）
 * @param {Float32Array} positions — 顶点位置（animGroup 空间，米）
 * @param {Uint32Array} indices — 三角形顶点索引
 * @param {Material} [material] — 分段网格材质
 * @returns {{ ok: boolean, reason?: string, bones: object, boneAbs: object, segmentMeshes: object, takenTris: Set<number> }}
 */
export function buildLimbBones(
  bodyGeo,
  modelMatrix,
  hipJoint,
  hipJointPos,
  height,
  halfWidth,
  halfDepth,
  positions,
  indices,
  material = null,
) {
  const empty = { ok: false, bones: {}, boneAbs: {}, segmentMeshes: {}, takenTris: new Set() };

  if (!bodyGeo || !bodyGeo.index) return { ...empty, reason: 'bodyGeo 无索引' };
  if (!positions || !indices) return { ...empty, reason: '缺少手臂提取所需的顶点/索引数据' };

  const R = extractSide('R', positions, indices, height, halfWidth, halfDepth);
  if (!R) return { ...empty, reason: '右侧手臂提取失败' };

  const L = extractSide('L', positions, indices, height, halfWidth, halfDepth);
  if (!L) return { ...empty, reason: '左侧手臂提取失败' };

  // ── 关节层级（肩→肘→手，嵌套）─────────────────────────────────────────────────

  const bones = {};
  const boneAbs = {};
  for (const side of SIDES) {
    buildBoneChain(side, hipJoint, hipJointPos, height, halfWidth, halfDepth, bones, boneAbs);
  }

  // ── 分段网格并挂到关节 ────────────────────────────────────────────────────────

  const segmentMeshes = { R: {}, L: {} };
  const takenTris = new Set();
  for (const side of SIDES) {
    const res = attachSideSegments({
      side,
      segments: side === 'R' ? R : L,
      geo: bodyGeo,
      modelMatrix,
      indices,
      bones,
      boneAbs,
      material,
    });
    segmentMeshes[side] = res.meshes;
    for (const t of res.takenTris) takenTris.add(t);
  }

  return { ok: true, bones, boneAbs, segmentMeshes, takenTris };
}

/**
 * 给「另一个全身壳体」（如描边壳）切出同样的手臂分段，挂到既有骨架上。
 *
 * 角色模型不只有 body 一个全身壳体；只把 body 的手臂切出来、却把其它壳体的手臂留在躯干里，
 * 摆臂时就会出现「两套手臂」。这个入口让调用方对每个全身壳体复用同一套骨与走廊。
 *
 * @returns {{ ok: boolean, takenTris: Set<number>, meshes: THREE.Mesh[] }}
 */
export function attachLimbShell(bodyGeo, modelMatrix, positions, indices, rig, height, halfWidth, halfDepth, material = null) {
  const empty = { ok: false, takenTris: new Set(), meshes: [] };
  if (!rig || !rig.ok || !bodyGeo || !bodyGeo.index || !positions || !indices) return empty;

  const R = extractSide('R', positions, indices, height, halfWidth, halfDepth);
  const L = extractSide('L', positions, indices, height, halfWidth, halfDepth);
  if (!R || !L) return empty;

  const takenTris = new Set();
  const meshes = [];
  for (const side of SIDES) {
    const res = attachSideSegments({
      side,
      segments: side === 'R' ? R : L,
      geo: bodyGeo,
      modelMatrix,
      indices,
      bones: rig.bones,
      boneAbs: rig.boneAbs,
      material,
    });
    for (const t of res.takenTris) takenTris.add(t);
    for (const key of SEGMENT_KEYS) {
      const mesh = res.meshes[key];
      if (mesh) meshes.push(mesh);
    }
  }

  return { ok: true, takenTris, meshes };
}
