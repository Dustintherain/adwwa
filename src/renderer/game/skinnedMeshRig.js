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

  return {
    allTris,
    flatIndices,
    shAbs,
    elAbs,
    wrAbs,
    upperTris: res.upper || [],
    foreTris: res.fore || [],
    handTris: res.hand || [],
  };
}

const ZERO_VEC = new THREE.Vector3();

/** 点 p 到线段 [a, b] 的距离 */
function distToSegment(p, a, b) {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  const t = lenSq > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / lenSq, 0, 1) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * 为单侧手臂几何体生成连续平滑的蒙皮权重
 * (Bone 0: Shoulder, Bone 1: Elbow, Bone 2: Wrist, Bone 3: SleeveAnchor)
 *
 * SleeveAnchor 是“静止袖口”骨：bind 姿态与肩重合、之后永远不动。上臂内侧与躯干侧面
 * 在 A-pose 里是贴在一起的，走廊提取不可避免地把一部分躯干侧面/内袖口划进上臂段；
 * 若把这些顶点刚性绑到肩骨上，肩部转动 ~85° 持枪时它们会像一块板子一样甩起来，
 * 与前臂交叠成“对折”外观。判据：上臂区 (t1<0.8) 、偏离臂轴 (>5cm) 、靠身体中线
 * (|x|<0.165m) 的顶点视为袖口/侧面布料，绑到静止骨上（权重连续过渡，不断裂、不破洞）。
 */
const SLEEVE_D_IN = 0.05;
const SLEEVE_D_OUT = 0.065;
const SLEEVE_X_IN = 0.155;
const SLEEVE_X_OUT = 0.175;

function smooth01(x) {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
}

function assignArmSkinWeights(armGeo, shAbs, elAbs, wrAbs) {
  const pos = armGeo.attributes.position;
  const count = pos.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);

  const e = elAbs.clone().sub(shAbs);
  const f = wrAbs.clone().sub(elAbs);
  const L1 = e.length();
  const L2 = f.length();

  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const t1 = p.dot(e) / (L1 * L1);
    const t2 = p.clone().sub(e).dot(f) / (L2 * L2);

    let w0 = 0, w1 = 0, w2 = 0, w3 = 0;

    if (t2 >= 0.95) {
      // 手掌及手指：纯腕骨控制
      w2 = 1.0;
    } else if (t2 >= 0.75) {
      // 手腕关节平滑过渡区：前臂与手掌三次 Hermite 平滑过渡
      const s = (t2 - 0.75) / 0.20;
      const k = s * s * (3 - 2 * s);
      w2 = k;
      w1 = 1 - k;
    } else {
      // 先按最近骨段划分：更靠近前臂的顶点完全由肘骨控制，避免被错误绑到肩骨
      const dUp = distToSegment(p, ZERO_VEC, e);
      const dFore = distToSegment(p, e, e.clone().add(f));
      if (dFore < dUp) {
        w1 = 1.0;
      } else {
        // 上臂区域：肩 / 肘之间平滑过渡
        const de = (t1 - 1.0) * L1;
        const W = 0.045; // 4.5cm 肘弯平滑过渡半径
        if (de <= -W) {
          w0 = 1.0;
        } else if (de >= W) {
          w1 = 1.0;
        } else {
          const u = (de + W) / (2 * W);
          const k = u * u * (3 - 2 * u);
          w0 = 1 - k;
          w1 = k;
        }
      }
      // 袖口/躯干侧面：静止骨吸收，避免肩转时甩成对折状硬板
      // p 是肩局部坐标，模型空间 x = p.x + shAbs.x；前臂/手在外侧 (|x| 大) 不受影响
      if (t1 < 0.85) {
        const modelX = Math.abs(p.x + shAbs.x);
        const s = smooth01((dUp - SLEEVE_D_IN) / (SLEEVE_D_OUT - SLEEVE_D_IN))
          * (1 - smooth01((modelX - SLEEVE_X_IN) / (SLEEVE_X_OUT - SLEEVE_X_IN)))
          * (1 - smooth01((t1 - 0.7) / 0.15));
        if (s > 0) {
          w3 = s;
          w0 *= 1 - s;
          w1 *= 1 - s;
        }
      }
    }

    skinIndices[i * 4] = 0;
    skinIndices[i * 4 + 1] = 1;
    skinIndices[i * 4 + 2] = 2;
    skinIndices[i * 4 + 3] = 3;

    skinWeights[i * 4] = w0;
    skinWeights[i * 4 + 1] = w1;
    skinWeights[i * 4 + 2] = w2;
    skinWeights[i * 4 + 3] = w3;
  }

  armGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  armGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
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
}) {
  const { flatIndices, shAbs, elAbs, wrAbs } = armData;

  // 将手臂顶点烘焙到以肩膀为原点 (0,0,0) 的局部空间
  const toShoulderLocal = new THREE.Matrix4()
    .makeTranslation(-shAbs.x, -shAbs.y, -shAbs.z)
    .multiply(bodyMatrixWorld);

  const armGeo = buildSubGeometry(bodyGeo, flatIndices, toShoulderLocal, bodyGeo.attributes.normal);
  if (!armGeo) return null;

  // 计算连续蒙皮权重
  assignArmSkinWeights(armGeo, shAbs, elAbs, wrAbs);

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
  // 计算肩关节在 Viewmodel 空间的安置位置
  const reach = (bindUpper.length() + bindLower.length()) * scale;
  const shoulderVM = restPalm.clone().addScaledVector(shoulderDir.clone().normalize(), reach * 0.85);
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
  wrist.quaternion.setFromEuler(handEuler);
  elbow.add(wrist);

  // 静止袖口骨：bind 姿态与肩重合，之后永远不转动；上臂内侧布料顶点绑到它上面
  // （见 assignArmSkinWeights）。必须是 root 的子级——若挂在 shoulder 下会继承肩旋转。
  const sleeve = new THREE.Bone();
  sleeve.name = `vm_bone_sleeve_${side}`;
  sleeve.position.set(0, 0, 0);

  // 2. 创建 Skeleton 骨架
  const bones = [shoulder, elbow, wrist, sleeve];
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
  root.add(sleeve);
  root.add(skinnedMesh);
  root.updateMatrixWorld(true);
  skinnedMesh.bind(skeleton);

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
    sleeve,
    scale,
    palmOffset: palmOffset.clone(),
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
