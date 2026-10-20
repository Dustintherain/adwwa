import * as THREE from 'three';

/**
 * armIK.js — 两骨解析 IK（肩 → 肘 → 手），用于让角色的手臂**追随枪械**。
 *
 * 坐标系约定：所有参数（骨骼局部位置、目标点、pole 点）都在 **shoulder.parent 的空间**里。
 * 对第三人称是 hip 关节局部空间，对第一人称是相机空间的手臂根节点空间。
 *
 * 骨骼链必须是「位置固定 + 只改旋转」的 Group 链：
 *   shoulder (parent = 角色 / 相机)
 *     └─ elbow   position = 肩→肘的 bind 向量
 *          └─ hand  position = 肘→手的 bind 向量
 * 分段网格以各自关节原点烘焙（limbRig 的做法），所以旋转关节即可摆出手臂。
 *
 * 算法：
 *   1. 目标距离 d 钳在 [|L1−L2|+ε, L1+L2−ε]，超出可达范围时手臂伸直，不抖不 NaN。
 *   2. 由余弦定理求肘部位置：沿目标方向 a、垂直目标方向 h。
 *   3. 肩关节把 bind 的「肩→肘」方向旋到求出的方向。
 *   4. 肘关节再把手掌方向旋到「肘→目标」，合成局部旋转 q2 = q1⁻¹ · q_align · q1。
 *
 * 不改变手的朝向（手网格是静态 A-pose 手型，强行对齐枪身会让手掌翻转）。
 */

const EPS = 1e-5;

/**
 * @param {object} opts
 * @param {THREE.Object3D} opts.shoulder 肩关节（parent 空间即求解空间）
 * @param {THREE.Object3D} opts.elbow    肘关节（shoulder 的子级）
 * @param {THREE.Object3D} opts.hand     手关节（elbow 的子级）
 * @param {THREE.Vector3} opts.target    手掌要到达的位置（shoulder.parent 空间）
 * @param {THREE.Vector3} opts.pole      肘尖朝向参考点（同一空间，决定手肘向哪边弯）
 * @returns {boolean} 求解成功返回 true；参数退化时返回 false，不抛异常
 */
export function solveTwoBoneIK({ shoulder, elbow, hand, target, pole }) {
  if (!shoulder || !elbow || !hand || !target || !pole) return false;

  const S = shoulder.position;          // 肩在 parent 空间的位置
  const L1 = elbow.position.length();   // 肩→肘
  const L2 = hand.position.length();    // 肘→手
  if (L1 < EPS || L2 < EPS) return false;

  // 目标方向与距离（钳进可达区间）
  const toTarget = new THREE.Vector3().subVectors(target, S);
  const rawDist = toTarget.length();
  if (rawDist < EPS) return false;
  const minD = Math.abs(L1 - L2) + 1e-3;
  const maxD = L1 + L2 - 1e-3;
  const d = Math.min(maxD, Math.max(minD, rawDist));
  const axis = toTarget.divideScalar(rawDist);

  // 弯曲平面：pole 方向在垂直于 axis 的平面上的分量
  const poleDir = new THREE.Vector3().subVectors(pole, S);
  poleDir.addScaledVector(axis, -poleDir.dot(axis));
  if (poleDir.lengthSq() < 1e-8) {
    // pole 与目标方向近似共线：取任意垂直方向兜底，避免 NaN
    poleDir.set(0, -1, 0);
    poleDir.addScaledVector(axis, -poleDir.dot(axis));
    if (poleDir.lengthSq() < 1e-8) poleDir.set(1, 0, 0);
  }
  poleDir.normalize();

  // 余弦定理：肘部沿 axis 距离 a、沿 poleDir 高度 h
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const elbowTarget = new THREE.Vector3()
    .copy(S)
    .addScaledVector(axis, a)
    .addScaledVector(poleDir, h);

  // 肩：把 bind 的肩→肘方向旋到期望方向
  const bindUpper = new THREE.Vector3().copy(elbow.position).normalize();
  const desiredUpper = new THREE.Vector3().subVectors(elbowTarget, S).normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(bindUpper, desiredUpper);
  shoulder.quaternion.copy(q1);

  // 肘：肩旋转后手掌方向 → 「肘→目标」方向
  const elbowWorld = new THREE.Vector3().copy(S).addScaledVector(desiredUpper, L1);
  const handTarget = new THREE.Vector3().copy(S).addScaledVector(axis, d);
  const lowerDir = new THREE.Vector3().copy(hand.position).normalize().applyQuaternion(q1);
  const desiredLower = new THREE.Vector3().subVectors(handTarget, elbowWorld).normalize();
  const qAlign = new THREE.Quaternion().setFromUnitVectors(lowerDir, desiredLower);
  const q1Inv = new THREE.Quaternion().copy(q1).invert();
  elbow.quaternion.copy(q1Inv).multiply(qAlign).multiply(q1);

  return true;
}
