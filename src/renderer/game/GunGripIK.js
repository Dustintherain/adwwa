import * as THREE from 'three';

// 模块级复用缓存对象，彻底杜绝渲染帧内的垃圾回收（GC）开销
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _want = new THREE.Vector3();
const _targetClamped = new THREE.Vector3();
const _armTarget = new THREE.Vector3();
const _armPoleW = new THREE.Vector3();
const _tempScale = new THREE.Vector3();

const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _deltaQ = new THREE.Quaternion();
const _gq = new THREE.Quaternion();
const _invParentScale = new THREE.Vector3(1, 1, 1);

/**
 * 把骨骼 bone 的世界旋转设为 worldQuat（自动转为父级局部空间的本地旋转）
 * @param {THREE.Bone|THREE.Object3D} bone
 * @param {THREE.Quaternion} worldQuat
 */
export function setWorldQuaternion(bone, worldQuat) {
  if (bone.parent) {
    bone.parent.getWorldQuaternion(_pq).invert();
    bone.quaternion.copy(_pq.multiply(worldQuat));
  } else {
    bone.quaternion.copy(worldQuat);
  }
  bone.updateMatrixWorld(true);
}

/**
 * 让 bone 指向 from→to 的方向发生最短旋转：使 (child - bone) 对准 targetPos
 * @param {THREE.Bone|THREE.Object3D} bone  当前骨骼（如上臂、前臂）
 * @param {THREE.Bone|THREE.Object3D} child 子骨骼（如下臂、手腕）
 * @param {THREE.Vector3} targetPos         世界坐标目标位置
 */
export function aimBone(bone, child, targetPos) {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _cur.subVectors(_b, _a).normalize();
  _want.subVectors(targetPos, _a).normalize();

  // 若当前朝向与目标朝向几乎重合，则无需旋转
  if (_cur.dot(_want) > 0.99999) return;

  _deltaQ.setFromUnitVectors(_cur, _want);
  bone.getWorldQuaternion(_q);
  setWorldQuaternion(bone, _deltaQ.multiply(_q));
}

/**
 * 解析式双骨骼 IK（上臂 - 前臂 - 手部）
 * 基于余弦定理直接在世界坐标系下求出绝对收敛解，不依赖骨骼内部 DCC 轴向。
 *
 * @param {THREE.Bone|THREE.Object3D} upper     上臂骨骼（如 mixamorigRightArm / mixamorig:RightArm）
 * @param {THREE.Bone|THREE.Object3D} lower     前臂骨骼（如 mixamorigRightForeArm）
 * @param {THREE.Bone|THREE.Object3D} hand      手掌骨骼（如 mixamorigRightHand）
 * @param {THREE.Vector3} target                世界坐标目标点（枪械握把或护木握持点）
 * @param {THREE.Vector3} poleWorld             肘部弯曲提示点（世界坐标）
 */
export function solveTwoBoneIK(upper, lower, hand, target, poleWorld) {
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  hand.getWorldPosition(_c);

  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  const eps = 1e-4;

  if (l1 < eps || l2 < eps) return;

  // 目标超出最大臂长时夹紧，手够不到时自动伸直手臂
  _dir.subVectors(target, _a);
  const dist = THREE.MathUtils.clamp(_dir.length(), eps, l1 + l2 - eps);
  _dir.normalize();

  // 余弦定理：求解上臂与 (a -> target) 连线之间的夹角 A
  const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

  // 肘部位置 = 沿目标方向的分量 + 沿 pole 方向在垂直平面的法向分量
  _pole.subVectors(poleWorld, _a);
  _perp.copy(_pole).addScaledVector(_dir, -_pole.dot(_dir));

  // 退化奇异点保护：若 pole 与 dir 共线，取正交轴兜底，避免除以零或产生 NaN 导致模型撕裂
  if (_perp.lengthSq() < eps) {
    const fallbackAxis = Math.abs(_dir.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, -1, 0);
    _perp.copy(fallbackAxis).addScaledVector(_dir, -fallbackAxis.dot(_dir));
    if (_perp.lengthSq() < eps) _perp.set(1, 0, 0);
  }
  _perp.normalize();

  _elbow.copy(_a)
    .addScaledVector(_dir, l1 * cosA)
    .addScaledVector(_perp, l1 * sinA);

  _targetClamped.copy(_a).addScaledVector(_dir, dist);

  aimBone(upper, lower, _elbow);         // 1. 上臂对准肘尖位置
  aimBone(lower, hand, _targetClamped); // 2. 前臂对准握持点
}

/**
 * 枪械握持控制器
 * 
 * 约定与工作流：
 * 1. 枪模型作为胸/脊柱骨骼（如 mixamorigSpine2 / mixamorig:Spine2）的子物体跟随身体晃动。
 * 2. 枪上带有 "grip_R"（主握把/扳机位）与 "grip_L"（护木托扶位）两个锚点。若模型未自带，则自动生成。
 * 3. 每帧动画播放完毕后（mixer.update()），调用 gunGrip.update() 驱动双臂贴合。
 */
export class GunGrip {
  /**
   * @param {THREE.Object3D} character 人物模型根节点
   * @param {THREE.Object3D} gun       枪械模型根节点
   * @param {object} opt               配置项
   */
  constructor(character, gun, opt = {}) {
    this.character = character;
    this.gun = gun;

    // 弹性骨骼名称查找器：兼容标准 Mixamo、带冒号的 Mixamo（mixamorig:RightArm）以及大小写变体
    const findBone = (baseName) => {
      // 1. 直接名称匹配
      let obj = character.getObjectByName(baseName);
      if (obj) return obj;

      // 2. 带冒号名称匹配（如 mixamorig:RightArm）
      const colonName = baseName.replace(/^mixamorig([A-Z])/, 'mixamorig:$1');
      obj = character.getObjectByName(colonName);
      if (obj) return obj;

      // 3. 去掉冒号名称匹配
      const noColon = baseName.replace(':', '');
      obj = character.getObjectByName(noColon);
      if (obj) return obj;

      // 4. 忽略标点与大小写深度匹配
      const cleanTarget = baseName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      character.traverse((child) => {
        if (!obj && child.name) {
          const cName = child.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          if (cName === cleanTarget) {
            obj = child;
          }
        }
      });

      if (!obj) {
        console.warn(`[GunGrip] 未找到指定骨骼: ${baseName}`);
      }
      return obj;
    };

    const p = opt.prefix ?? 'mixamorig';

    // 权重系统：支持整体权重与左右手独立解耦权重（换弹时左手脱离、右手持枪）
    this.weight = opt.weight ?? 1.0;
    this.weightR = 1.0;
    this.weightL = 1.0;

    // 左右臂双骨骼链绑定
    this.R = {
      upper: findBone(opt.boneRightUpper ?? `${p}RightArm`),
      lower: findBone(opt.boneRightLower ?? `${p}RightForeArm`),
      hand:  findBone(opt.boneRightHand  ?? `${p}RightHand`),
      savedQ: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()],
    };

    this.L = {
      upper: findBone(opt.boneLeftUpper  ?? `${p}LeftArm`),
      lower: findBone(opt.boneLeftLower  ?? `${p}LeftForeArm`),
      hand:  findBone(opt.boneLeftHand   ?? `${p}LeftHand`),
      savedQ: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()],
    };

    // 查找枪械挂载骨骼（优先 Spine2，其次 Spine1 或 Spine）
    let mount = findBone(opt.mountBone ?? `${p}Spine2`);
    if (!mount) mount = findBone(`${p}Spine1`) || findBone(`${p}Spine`) || character;
    this.mount = mount;

    // 枪挂载到脊柱骨骼下
    if (this.gun.parent !== mount) {
      mount.add(this.gun);
    }

    // 挂载点几何位移与旋转微调
    this.gunOffset = opt.gunOffset ?? [0.18, 0.10, 0.26];
    this.gunRotation = opt.gunRotation ?? [-0.05, 0.08, -0.05];
    this.gun.rotation.set(...this.gunRotation);

    // 自动适配父级骨骼缩放（避免人物整体非 1.0 缩放导致枪械变巨或变微型）
    this.compensateScale = opt.compensateScale ?? true;
    if (this.compensateScale) {
      mount.updateWorldMatrix(true, false);
      mount.getWorldScale(_tempScale);
      if (_tempScale.x > 0 && _tempScale.y > 0 && _tempScale.z > 0) {
        this.gun.scale.set(1 / _tempScale.x, 1 / _tempScale.y, 1 / _tempScale.z);
        this.gun.position.set(
          this.gunOffset[0] / _tempScale.x,
          this.gunOffset[1] / _tempScale.y,
          this.gunOffset[2] / _tempScale.z
        );
      } else {
        this.gun.position.set(...this.gunOffset);
      }
    } else {
      this.gun.position.set(...this.gunOffset);
    }

    // 查找或自动创建枪械握点 grip_R 与 grip_L
    let gripR = gun.getObjectByName('grip_R');
    if (!gripR) {
      gripR = new THREE.Object3D();
      gripR.name = 'grip_R';
      // 默认握把位置：紧贴扳机护圈后方
      const rPos = opt.gripRPos ?? [0.014, -0.045, -0.095];
      gripR.position.set(...rPos);
      if (opt.gripRRot) gripR.rotation.set(...opt.gripRRot);
      gun.add(gripR);
    }
    this.gripR = gripR;

    let gripL = gun.getObjectByName('grip_L');
    if (!gripL) {
      gripL = new THREE.Object3D();
      gripL.name = 'grip_L';
      // 默认护木握点位置：枪身中前段护木下方托扶
      const lPos = opt.gripLPos ?? [-0.015, -0.038, 0.085];
      gripL.position.set(...lPos);
      if (opt.gripLRot) gripL.rotation.set(...opt.gripLRot);
      gun.add(gripL);
    }
    this.gripL = gripL;

    // 肘部提示点（挂载在 mount 上，当角色身体俯仰或倾斜瞄准时，肘部朝向自然跟随胸部）
    this.poleR = new THREE.Object3D();
    this.poleL = new THREE.Object3D();
    const pRPos = opt.poleRPos ?? [0.45, -0.35, -0.35];
    const pLPos = opt.poleLPos ?? [-0.45, -0.35, -0.35];
    if (this.compensateScale && _tempScale.x > 0 && _tempScale.y > 0 && _tempScale.z > 0) {
      this.poleR.position.set(pRPos[0] / _tempScale.x, pRPos[1] / _tempScale.y, pRPos[2] / _tempScale.z);
      this.poleL.position.set(pLPos[0] / _tempScale.x, pLPos[1] / _tempScale.y, pLPos[2] / _tempScale.z);
    } else {
      this.poleR.position.set(...pRPos);
      this.poleL.position.set(...pLPos);
    }
    mount.add(this.poleR);
    mount.add(this.poleL);

    // 手腕旋转偏移量微调（各模型 Rest Pose 绑骨 Roll 轴不同，通过 Euler 调整手心对准握把）
    const rEuler = new THREE.Euler(...(opt.handEulerR ?? [-0.2, 0.15, -0.15]));
    const lEuler = new THREE.Euler(...(opt.handEulerL ?? [0.15, -0.15, 0.25]));
    this.handOffsetR = new THREE.Quaternion().setFromEuler(rEuler);
    this.handOffsetL = new THREE.Quaternion().setFromEuler(lEuler);
  }

  /**
   * 求解单侧手臂 IK 并融合手掌旋转
   */
  _solveArm(arm, grip, pole, offset, armWeight) {
    if (!arm.upper || !arm.lower || !arm.hand || !grip || !pole) return;

    const finalWeight = this.weight * armWeight;
    if (finalWeight <= 0) return; // 权重为 0 直接跳过，保持纯原生动画

    grip.getWorldPosition(_armTarget);
    pole.getWorldPosition(_armPoleW);

    // 暂存当前帧原生动画骨骼姿态，用于与 IK 结果做平滑 slerp 混合
    arm.savedQ[0].copy(arm.upper.quaternion);
    arm.savedQ[1].copy(arm.lower.quaternion);
    arm.savedQ[2].copy(arm.hand.quaternion);

    // 1. 求解上臂与前臂朝向
    solveTwoBoneIK(arm.upper, arm.lower, arm.hand, _armTarget, _armPoleW);

    // 2. 将手掌世界旋转贴合枪械握点并应用偏转微调
    grip.getWorldQuaternion(_gq);
    setWorldQuaternion(arm.hand, _gq.multiply(offset));

    // 3. 权重加权平滑插值（开枪/收枪/换弹姿态切换）
    if (finalWeight < 1) {
      arm.upper.quaternion.copy(arm.savedQ[0]).slerp(arm.upper.quaternion, finalWeight);
      arm.lower.quaternion.copy(arm.savedQ[1]).slerp(arm.lower.quaternion, finalWeight);
      arm.hand.quaternion.copy(arm.savedQ[2]).slerp(arm.hand.quaternion, finalWeight);
      arm.upper.updateWorldMatrix(true, true);
    }
  }

  /**
   * 每帧在 mixer.update() 之后、render() 之前调用
   */
  update() {
    if (this.weight <= 0 && this.weightR <= 0 && this.weightL <= 0) return;

    this.character.updateMatrixWorld(true);
    if (this.compensateScale && this.mount) {
      this.mount.getWorldScale(_tempScale);
      if (_tempScale.x > 0 && _tempScale.y > 0 && _tempScale.z > 0) {
        this.gun.scale.set(1 / _tempScale.x, 1 / _tempScale.y, 1 / _tempScale.z);
      }
    }

    this._solveArm(this.R, this.gripR, this.poleR, this.handOffsetR, this.weightR);
    this._solveArm(this.L, this.gripL, this.poleL, this.handOffsetL, this.weightL);
  }
}
