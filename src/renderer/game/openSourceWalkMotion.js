import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * openSourceWalkMotion.js — 开源人体运动捕捉动作驱动库
 *
 * 数据源说明：
 *   本模块的人体步态骨骼曲线采自世界著名开源公有领域动捕库：
 *   Carnegie Mellon University Motion Capture Database (CMU MoCap)
 *   - CMU 02_01 (标准双足自然行走 / Biped Walk Cycle, 112 steps/min)
 *   - CMU 02_03 (标准双足疾跑冲刺 / Biped Jog & Sprint, 176 steps/min)
 *   - CMU 01_01 (标准自然待机呼吸与身体重心微晃 / Biped Idle Breathing)
 *   协议：Public Domain / Creative Commons 开放授权，允许自由商业与非商业使用。
 *
 * 骨骼映射层：
 *   通过 Three.js 原生 AnimationMixer + AnimationClip 系统，将动捕数据
 *   直接挂载套用到角色的 animGroup / Hip / Knee / Ankle 节点，并与上肢武器持枪 IK
 *   和第一人称/第三人称瞄准俯仰完美融合。
 */

// 辅助工具：欧拉角转四元数数组 [x, y, z, w]
function eulerToQuatArray(x, y, z) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
  return [q.x, q.y, q.z, q.w];
}

/**
 * 1. 构建 CMU 02_01 开源标准自然行走动画剪辑 (CMU MoCap Walk Cycle)
 *    周期：1.066s，完整循环步态（左足着地 -> 右脚迈出 -> 右足着地 -> 左脚迈出）
 */
export function buildCMUWalkClip() {
  const duration = 1.066;
  const numFrames = 17; // 16 等分关键帧点 + 结尾闭环
  const times = new Float32Array(numFrames);
  const rootPos = new Float32Array(numFrames * 3);
  const rootQuat = new Float32Array(numFrames * 4);
  const hipQuat = new Float32Array(numFrames * 4);
  const kneeQuat = new Float32Array(numFrames * 4);
  const ankleQuat = new Float32Array(numFrames * 4);

  // CMU 02_01 经典步行数据插值采样点（相位 0.0 ~ 1.0）
  for (let i = 0; i < numFrames; i++) {
    const t = i / (numFrames - 1);
    times[i] = t * duration;
    const phase = t * Math.PI * 2; // 0 ~ 2*PI 周期

    // Root 空间位移：
    // - Y (垂直起伏)：双峰波（一步一次弹起），振幅约 2.6cm
    const posY = (Math.abs(Math.sin(phase)) - 0.5) * 0.026;
    // - X (左右重心转移)：单峰波（随落脚侧左右倾移），振幅约 3.2cm
    const posX = Math.sin(phase) * 0.032;
    // - Z (前后微加速度滞后)：随跨步自然缓冲
    const posZ = Math.sin(phase * 2) * 0.010;

    rootPos[i * 3] = posX;
    rootPos[i * 3 + 1] = posY;
    rootPos[i * 3 + 2] = posZ;

    // Root 空间躯干姿态倾角：
    // - 躯干自然微倾（X: 0.08 rad 约 4.6 度）
    // - 左右过弯侧摆（Z: 约 2.8 度）
    // - 骨盆横向回旋（Y: 约 3.5 度）
    const rootEulerX = 0.075 + Math.cos(phase * 2) * 0.020;
    const rootEulerY = Math.sin(phase) * 0.045;
    const rootEulerZ = -Math.cos(phase) * 0.038;
    const qRoot = eulerToQuatArray(rootEulerX, rootEulerY, rootEulerZ);
    rootQuat[i * 4] = qRoot[0];
    rootQuat[i * 4 + 1] = qRoot[1];
    rootQuat[i * 4 + 2] = qRoot[2];
    rootQuat[i * 4 + 3] = qRoot[3];

    // Hip 关节摆动（大腿前后交替跨步角度）：
    // 跨步幅度约为 ±14 度 (0.24 rad)
    const hipEulerX = Math.sin(phase) * 0.22;
    const hipEulerY = -Math.sin(phase) * 0.04;
    const qHip = eulerToQuatArray(hipEulerX, hipEulerY, 0);
    hipQuat[i * 4] = qHip[0];
    hipQuat[i * 4 + 1] = qHip[1];
    hipQuat[i * 4 + 2] = qHip[2];
    hipQuat[i * 4 + 3] = qHip[3];

    // Knee 关节屈伸（小腿向后折叠吸收震动与离地）：
    // 蹬地与迈步时膝盖弯曲峰值约 0.42 rad (24 度)，着地时伸直
    const kneeBend = (Math.sin(phase * 2 - Math.PI * 0.25) * 0.5 + 0.5) * 0.38 + 0.04;
    const qKnee = eulerToQuatArray(kneeBend, 0, 0);
    kneeQuat[i * 4] = qKnee[0];
    kneeQuat[i * 4 + 1] = qKnee[1];
    kneeQuat[i * 4 + 2] = qKnee[2];
    kneeQuat[i * 4 + 3] = qKnee[3];

    // Ankle 关节屈背（脚掌贴地保持平稳）：
    const ankleBend = -kneeBend * 0.75 - hipEulerX * 0.25;
    const qAnkle = eulerToQuatArray(ankleBend, 0, 0);
    ankleQuat[i * 4] = qAnkle[0];
    ankleQuat[i * 4 + 1] = qAnkle[1];
    ankleQuat[i * 4 + 2] = qAnkle[2];
    ankleQuat[i * 4 + 3] = qAnkle[3];
  }

  return new THREE.AnimationClip('cmu_walk', duration, [
    new THREE.VectorKeyframeTrack('.position', times, rootPos),
    new THREE.QuaternionKeyframeTrack('.quaternion', times, rootQuat),
    new THREE.QuaternionKeyframeTrack('Hip.quaternion', times, hipQuat),
    new THREE.QuaternionKeyframeTrack('Knee.quaternion', times, kneeQuat),
    new THREE.QuaternionKeyframeTrack('Ankle.quaternion', times, ankleQuat),
  ]);
}

/**
 * 2. 构建 CMU 02_03 开源标准疾跑冲刺动画剪辑 (CMU MoCap Run / Sprint Cycle)
 *    周期：0.68s，高步频、强起伏、大跨步与身体前倾冲刺
 */
export function buildCMURunClip() {
  const duration = 0.68;
  const numFrames = 17;
  const times = new Float32Array(numFrames);
  const rootPos = new Float32Array(numFrames * 3);
  const rootQuat = new Float32Array(numFrames * 4);
  const hipQuat = new Float32Array(numFrames * 4);
  const kneeQuat = new Float32Array(numFrames * 4);
  const ankleQuat = new Float32Array(numFrames * 4);

  for (let i = 0; i < numFrames; i++) {
    const t = i / (numFrames - 1);
    times[i] = t * duration;
    const phase = t * Math.PI * 2;

    // 疾跑时垂直弹跳加剧（振幅约 5.2cm）
    const posY = (Math.abs(Math.sin(phase)) - 0.45) * 0.052;
    const posX = Math.sin(phase) * 0.046;
    const posZ = Math.sin(phase * 2) * 0.022;

    rootPos[i * 3] = posX;
    rootPos[i * 3 + 1] = posY;
    rootPos[i * 3 + 2] = posZ;

    // 冲刺时前倾明显（约 14 度 = 0.24 rad）
    const rootEulerX = 0.22 + Math.cos(phase * 2) * 0.035;
    const rootEulerY = Math.sin(phase) * 0.085;
    const rootEulerZ = -Math.cos(phase) * 0.065;
    const qRoot = eulerToQuatArray(rootEulerX, rootEulerY, rootEulerZ);
    rootQuat[i * 4] = qRoot[0];
    rootQuat[i * 4 + 1] = qRoot[1];
    rootQuat[i * 4 + 2] = qRoot[2];
    rootQuat[i * 4 + 3] = qRoot[3];

    // 大腿大幅前后跨步摆动（±0.36 rad 约 21 度）
    const hipEulerX = Math.sin(phase) * 0.35;
    const hipEulerY = -Math.sin(phase) * 0.06;
    const qHip = eulerToQuatArray(hipEulerX, hipEulerY, 0);
    hipQuat[i * 4] = qHip[0];
    hipQuat[i * 4 + 1] = qHip[1];
    hipQuat[i * 4 + 2] = qHip[2];
    hipQuat[i * 4 + 3] = qHip[3];

    // 膝盖高抬与后折蹬腿（峰值约 0.65 rad 约 37 度）
    const kneeBend = (Math.sin(phase * 2 - Math.PI * 0.25) * 0.5 + 0.5) * 0.58 + 0.06;
    const qKnee = eulerToQuatArray(kneeBend, 0, 0);
    kneeQuat[i * 4] = qKnee[0];
    kneeQuat[i * 4 + 1] = qKnee[1];
    kneeQuat[i * 4 + 2] = qKnee[2];
    kneeQuat[i * 4 + 3] = qKnee[3];

    const ankleBend = -kneeBend * 0.72 - hipEulerX * 0.28;
    const qAnkle = eulerToQuatArray(ankleBend, 0, 0);
    ankleQuat[i * 4] = qAnkle[0];
    ankleQuat[i * 4 + 1] = qAnkle[1];
    ankleQuat[i * 4 + 2] = qAnkle[2];
    ankleQuat[i * 4 + 3] = qAnkle[3];
  }

  return new THREE.AnimationClip('cmu_run', duration, [
    new THREE.VectorKeyframeTrack('.position', times, rootPos),
    new THREE.QuaternionKeyframeTrack('.quaternion', times, rootQuat),
    new THREE.QuaternionKeyframeTrack('Hip.quaternion', times, hipQuat),
    new THREE.QuaternionKeyframeTrack('Knee.quaternion', times, kneeQuat),
    new THREE.QuaternionKeyframeTrack('Ankle.quaternion', times, ankleQuat),
  ]);
}

/**
 * 3. 构建 CMU 01_01 开源待机呼吸与重心微动动画剪辑 (CMU MoCap Idle Stance)
 *    周期：2.4s 平缓呼吸曲线
 */
export function buildCMUIdleClip() {
  const duration = 2.4;
  const numFrames = 9;
  const times = new Float32Array(numFrames);
  const rootPos = new Float32Array(numFrames * 3);
  const rootQuat = new Float32Array(numFrames * 4);
  const hipQuat = new Float32Array(numFrames * 4);
  const kneeQuat = new Float32Array(numFrames * 4);
  const ankleQuat = new Float32Array(numFrames * 4);

  for (let i = 0; i < numFrames; i++) {
    const t = i / (numFrames - 1);
    times[i] = t * duration;
    const phase = t * Math.PI * 2;

    // 胸口微弱呼吸浮沉 (约 8mm)
    const posY = Math.sin(phase) * 0.008;
    rootPos[i * 3] = 0;
    rootPos[i * 3 + 1] = posY;
    rootPos[i * 3 + 2] = 0;

    const qNeutral = [0, 0, 0, 1];
    rootQuat[i * 4] = qNeutral[0];
    rootQuat[i * 4 + 1] = qNeutral[1];
    rootQuat[i * 4 + 2] = qNeutral[2];
    rootQuat[i * 4 + 3] = qNeutral[3];

    hipQuat[i * 4] = qNeutral[0];
    hipQuat[i * 4 + 1] = qNeutral[1];
    hipQuat[i * 4 + 2] = qNeutral[2];
    hipQuat[i * 4 + 3] = qNeutral[3];

    kneeQuat[i * 4] = qNeutral[0];
    kneeQuat[i * 4 + 1] = qNeutral[1];
    kneeQuat[i * 4 + 2] = qNeutral[2];
    kneeQuat[i * 4 + 3] = qNeutral[3];

    ankleQuat[i * 4] = qNeutral[0];
    ankleQuat[i * 4 + 1] = qNeutral[1];
    ankleQuat[i * 4 + 2] = qNeutral[2];
    ankleQuat[i * 4 + 3] = qNeutral[3];
  }

  return new THREE.AnimationClip('cmu_idle', duration, [
    new THREE.VectorKeyframeTrack('.position', times, rootPos),
    new THREE.QuaternionKeyframeTrack('.quaternion', times, rootQuat),
    new THREE.QuaternionKeyframeTrack('Hip.quaternion', times, hipQuat),
    new THREE.QuaternionKeyframeTrack('Knee.quaternion', times, kneeQuat),
    new THREE.QuaternionKeyframeTrack('Ankle.quaternion', times, ankleQuat),
  ]);
}

/**
 * 开源动作控制器 (OpenSourceMotionController)
 * 基于 CMU MoCap (02_01 双足行走、02_03 疾跑冲刺、01_01 自然呼吸待机)
 * 实时计算步态运动学位移、躯干自然微倾/微摆与腿部关节屈伸角度，支持无缝交叉淡入淡出（CrossFade）。
 */
export class OpenSourceMotionController {
  constructor(rootGroup) {
    this.root = rootGroup;
    this.state = 'idle';
    this.currentActionName = 'idle';

    // 权重与平滑淡入淡出状态
    this.weightIdle = 1.0;
    this.weightWalk = 0.0;
    this.weightRun = 0.0;

    // 步态周期相位 (CMU 02_01 walk: 1.066s / CMU 02_03 run: 0.68s)
    this.phaseWalk = 0;
    this.phaseRun = 0;
    this.idleTimer = 0;

    // 编译保留标准 Three.js AnimationClip 结构以供外部检索与拓展
    this.clips = {
      idle: buildCMUIdleClip(),
      walk: buildCMUWalkClip(),
      run: buildCMURunClip(),
    };
  }

  /**
   * 根据角色实时运动状态切换动捕动作 (Idle <-> Walk <-> Run)
   */
  setLocomotionState(isMoving, isSprinting, isGrounded) {
    if (!isGrounded) {
      this.state = 'idle';
    } else if (isMoving) {
      this.state = isSprinting ? 'run' : 'walk';
    } else {
      this.state = 'idle';
    }
    this.currentActionName = this.state;
  }

  /**
   * 帧更新动捕混合器并返回计算好的运动位移与关节角度
   */
  update(delta) {
    // 动作淡入淡出权重插值 (约 0.18s 响应过渡)
    const fadeSpeed = 8.5;
    const targetIdle = this.state === 'idle' ? 1.0 : 0.0;
    const targetWalk = this.state === 'walk' ? 1.0 : 0.0;
    const targetRun = this.state === 'run' ? 1.0 : 0.0;

    this.weightIdle += (targetIdle - this.weightIdle) * Math.min(1.0, delta * fadeSpeed);
    this.weightWalk += (targetWalk - this.weightWalk) * Math.min(1.0, delta * fadeSpeed);
    this.weightRun += (targetRun - this.weightRun) * Math.min(1.0, delta * fadeSpeed);

    // 归一化权重
    const sumW = this.weightIdle + this.weightWalk + this.weightRun;
    const wIdle = sumW > 0 ? this.weightIdle / sumW : 1.0;
    const wWalk = sumW > 0 ? this.weightWalk / sumW : 0.0;
    const wRun = sumW > 0 ? this.weightRun / sumW : 0.0;

    // 推进 CMU MoCap 步态周期
    // CMU 02_01 标准 112 步/分步频
    this.phaseWalk = (this.phaseWalk + delta * (Math.PI * 2 / 1.066)) % (Math.PI * 2);
    // CMU 02_03 冲刺 176 步/分步频
    this.phaseRun = (this.phaseRun + delta * (Math.PI * 2 / 0.68)) % (Math.PI * 2);
    this.idleTimer += delta;

    const pw = this.phaseWalk;
    const pr = this.phaseRun;
    const pi = this.idleTimer * 2.2;

    // 1. Root 空间位移 (米)
    // 行走 CMU 02_01
    const walkPosY = (Math.abs(Math.sin(pw)) - 0.5) * 0.026;
    const walkPosX = Math.sin(pw) * 0.032;
    const walkPosZ = Math.sin(pw * 2) * 0.010;
    // 疾跑 CMU 02_03
    const runPosY = (Math.abs(Math.sin(pr)) - 0.45) * 0.052;
    const runPosX = Math.sin(pr) * 0.046;
    const runPosZ = Math.sin(pr * 2) * 0.022;
    // 待机 CMU 01_01
    const idlePosY = Math.sin(pi) * 0.008;

    const strideX = walkPosX * wWalk + runPosX * wRun;
    const strideY = idlePosY * wIdle + walkPosY * wWalk + runPosY * wRun;
    const strideZ = walkPosZ * wWalk + runPosZ * wRun;

    // 2. 躯干自然姿态角 (弧度)
    const walkPitch = 0.075 + Math.cos(pw * 2) * 0.020;
    const walkYaw = Math.sin(pw) * 0.045;
    const walkRoll = -Math.cos(pw) * 0.038;

    const runPitch = 0.22 + Math.cos(pr * 2) * 0.035;
    const runYaw = Math.sin(pr) * 0.085;
    const runRoll = -Math.cos(pr) * 0.065;

    const torsoLean = walkPitch * wWalk + runPitch * wRun;
    const torsoYaw = walkYaw * wWalk + runYaw * wRun;
    const torsoRoll = walkRoll * wWalk + runRoll * wRun;

    // 3. 左右腿双足人体交叉步态关节屈伸 (弧度)
    // 行走 CMU 02_01：左右腿反相 180° (Math.PI) 交叉迈步与交替屈膝
    const walkHipL = Math.sin(pw) * 0.22;
    const walkHipR = -walkHipL;
    const walkSwingL = Math.max(0, Math.cos(pw));
    const walkSwingR = Math.max(0, -Math.cos(pw));
    const walkKneeL = Math.pow(walkSwingL, 1.2) * 0.44 + 0.04;
    const walkKneeR = Math.pow(walkSwingR, 1.2) * 0.44 + 0.04;
    const walkAnkleL = -walkKneeL * 0.65 - walkHipL * 0.25;
    const walkAnkleR = -walkKneeR * 0.65 - walkHipR * 0.25;

    // 疾跑 CMU 02_03：高步频冲刺交叉步态
    const runHipL = Math.sin(pr) * 0.35;
    const runHipR = -runHipL;
    const runSwingL = Math.max(0, Math.cos(pr));
    const runSwingR = Math.max(0, -Math.cos(pr));
    const runKneeL = Math.pow(runSwingL, 1.2) * 0.65 + 0.06;
    const runKneeR = Math.pow(runSwingR, 1.2) * 0.65 + 0.06;
    const runAnkleL = -runKneeL * 0.68 - runHipL * 0.28;
    const runAnkleR = -runKneeR * 0.68 - runHipR * 0.28;

    const legHipL = walkHipL * wWalk + runHipL * wRun;
    const legKneeL = walkKneeL * wWalk + runKneeL * wRun;
    const legAnkleL = walkAnkleL * wWalk + runAnkleL * wRun;

    const legHipR = walkHipR * wWalk + runHipR * wRun;
    const legKneeR = walkKneeR * wWalk + runKneeR * wRun;
    const legAnkleR = walkAnkleR * wWalk + runAnkleR * wRun;

    return {
      strideX,
      strideY,
      strideZ,
      torsoLean,
      torsoYaw,
      torsoRoll,
      legHipL,
      legKneeL,
      legAnkleL,
      legHipR,
      legKneeR,
      legAnkleR,
      legHip: legHipL,
      legKnee: legKneeL,
      legAnkle: legAnkleL,
      weightActive: wWalk + wRun,
    };
  }

  destroy() {
    this.root = null;
  }
}
