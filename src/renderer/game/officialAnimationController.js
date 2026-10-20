import * as THREE from 'three';

/**
 * officialAnimationController.js
 * 
 * 严格依据 Three.js 官方文档与官方骨骼动画混合示例 (https://threejs.org/examples/#webgl_animation_skinning_blending)
 * 实现的专业人物骨骼动画控制器。
 * 
 * 核心技术与官方 API 映射：
 * 1. THREE.AnimationMixer: 动画播放混合器调度核心 (mixer.clipAction, mixer.update)
 * 2. THREE.AnimationAction: 单项动作控制 (fadeIn, fadeOut, crossFadeTo, setEffectiveWeight, setEffectiveTimeScale)
 * 3. 官方双模式步态控制：
 *    - Continuous Blending (连续动态权重混合)：根据实时角色移动速度，在 Idle ⇄ Walk ⇄ Run 之间平滑分配权重并自适应步频。
 *    - Event Synchronized Crossfade (基于 'loop' 事件的循环同步交叉淡入淡出)：消除换步突变与滑步。
 */

export class OfficialAnimationController {
  constructor(rootObject, animationClips) {
    this.root = rootObject;
    this.clips = animationClips || [];
    this.mixer = new THREE.AnimationMixer(this.root);

    // 动作字典
    this.actions = {};
    this.activeAction = null;
    this.previousAction = null;

    // 关键核心动作指针
    this.idleAction = null;
    this.walkAction = null;
    this.runAction = null;
    this.tposeAction = null;

    // 官方参数配置 (可由 GUI / 调试器实时调节)
    this.settings = {
      timeScale: 1.0,
      crossFadeDuration: 0.35,
      modifyTimeScale: true,
      blendMode: 'continuous', // 'continuous' (速度混合) 或 'crossfade' (状态机淡入淡出)
      weightIdle: 1.0,
      weightWalk: 0.0,
      weightRun: 0.0,
      synchronizeCrossFade: true,
    };

    // 内部状态跟踪
    this.currentState = 'idle';
    this.isCrossFading = false;

    this.initActions();
  }

  /**
   * 初始化所有动画剪辑为 AnimationAction，并配置循环与权重
   */
  initActions() {
    this.clips.forEach((clip) => {
      const name = clip.name;
      const key = name.toLowerCase();
      const action = this.mixer.clipAction(clip);

      // 设置标准循环模式与边界限制
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;

      this.actions[key] = action;
      this.actions[name] = action;

      // 绑定关键动作
      if (key.includes('idle')) this.idleAction = action;
      else if (key.includes('walk')) this.walkAction = action;
      else if (key.includes('run')) this.runAction = action;
      else if (key.includes('tpose')) this.tposeAction = action;
    });

    // 按照官方 activateAllActions 范式激活所有动作
    this.activateAllActions();
  }

  /**
   * 官方范式：激活所有动作并初始化权重
   */
  activateAllActions() {
    this.setWeight(this.idleAction, 1.0);
    this.setWeight(this.walkAction, 0.0);
    this.setWeight(this.runAction, 0.0);

    const activeList = [this.idleAction, this.walkAction, this.runAction].filter(Boolean);
    activeList.forEach((action) => {
      action.enabled = true;
      action.setEffectiveTimeScale(1);
      action.play();
    });

    this.activeAction = this.idleAction;
  }

  /**
   * 官方 setEffectiveWeight 包装方法
   */
  setWeight(action, weight) {
    if (!action) return;
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(weight);
  }

  /**
   * 官方范式：fadeToAction
   * 平滑从当前动作淡入淡出过渡到目标动作
   */
  fadeToAction(name, duration = this.settings.crossFadeDuration) {
    const nextAction = this.actions[name.toLowerCase()];
    if (!nextAction || nextAction === this.activeAction) return;

    this.previousAction = this.activeAction;
    this.activeAction = nextAction;

    if (this.previousAction) {
      this.previousAction.fadeOut(duration);
    }

    this.activeAction
      .reset()
      .setEffectiveTimeScale(this.settings.timeScale)
      .setEffectiveWeight(1.0)
      .fadeIn(duration)
      .play();
  }

  /**
   * 官方范式：crossFadeTo
   * @param {THREE.AnimationAction} fromAction 
   * @param {THREE.AnimationAction} toAction 
   * @param {number} duration 
   * @param {boolean} warp 是否按节奏缩放时间尺度 (warping)
   */
  executeCrossFade(fromAction, toAction, duration = this.settings.crossFadeDuration, warp = true) {
    if (!fromAction || !toAction) return;

    toAction.enabled = true;
    toAction.setEffectiveTimeScale(this.settings.timeScale);
    toAction.setEffectiveWeight(1.0);
    toAction.time = 0;

    fromAction.crossFadeTo(toAction, duration, warp);
    this.activeAction = toAction;
  }

  /**
   * 官方范式：基于 loop 事件的循环节律同步交叉淡入淡出 (synchronizeCrossFade)
   * 确保两段步态在同一足底着地点平滑交接，消除滑步
   */
  synchronizeCrossFade(startAction, endAction, duration = this.settings.crossFadeDuration) {
    if (!startAction || !endAction) return;

    const onLoopFinished = (event) => {
      if (event.action === startAction) {
        this.mixer.removeEventListener('loop', onLoopFinished);
        this.executeCrossFade(startAction, endAction, duration, true);
      }
    };

    this.mixer.addEventListener('loop', onLoopFinished);
  }

  /**
   * 实时步态动力学权重混合 (Continuous Multi-Track Blending)
   * 依据物理速度与操作按键动态分配 Idle / Walk / Run 影响因子
   */
  updateLocomotion({ isMoving, isSprinting, isCrouching, speed = 0, delta }) {
    let targetIdle = 0;
    let targetWalk = 0;
    let targetRun = 0;

    if (!isMoving) {
      targetIdle = 1.0;
      targetWalk = 0.0;
      targetRun = 0.0;
      this.currentState = 'idle';
    } else if (isSprinting) {
      targetIdle = 0.0;
      targetWalk = 0.15;
      targetRun = 0.85;
      this.currentState = 'run';
    } else {
      targetIdle = 0.0;
      targetWalk = 1.0;
      targetRun = 0.0;
      this.currentState = 'walk';
    }

    if (isCrouching && isMoving) {
      // 蹲走步频减缓，权重以行走为主
      targetWalk = 0.9;
      targetRun = 0.0;
      targetIdle = 0.1;
      this.currentState = 'crouchWalk';
    }

    // 平滑插值动作权重 (消除硬切突变)
    const blendRate = 8.5;
    const k = Math.min(1.0, delta * blendRate);

    this.settings.weightIdle += (targetIdle - this.settings.weightIdle) * k;
    this.settings.weightWalk += (targetWalk - this.settings.weightWalk) * k;
    this.settings.weightRun += (targetRun - this.settings.weightRun) * k;

    // 归一化各动作权重和为 1.0
    const total = this.settings.weightIdle + this.settings.weightWalk + this.settings.weightRun;
    const wIdle = total > 0 ? this.settings.weightIdle / total : 1.0;
    const wWalk = total > 0 ? this.settings.weightWalk / total : 0.0;
    const wRun = total > 0 ? this.settings.weightRun / total : 0.0;

    if (this.idleAction) this.idleAction.setEffectiveWeight(wIdle);
    if (this.walkAction) this.walkAction.setEffectiveWeight(wWalk);
    if (this.runAction) this.runAction.setEffectiveWeight(wRun);

    // 官方 modifyTimeScale 机制：速度自适应步频调节
    if (this.settings.modifyTimeScale) {
      if (this.walkAction && wWalk > 0.05) {
        const walkScale = isCrouching ? 0.75 : 1.05;
        this.walkAction.setEffectiveTimeScale(walkScale * this.settings.timeScale);
      }
      if (this.runAction && wRun > 0.05) {
        const runScale = 1.15;
        this.runAction.setEffectiveTimeScale(runScale * this.settings.timeScale);
      }
    }
  }

  /**
   * 帧更新循环 (渲染主循环调用)
   */
  update(delta) {
    if (this.mixer) {
      this.mixer.update(delta * this.settings.timeScale);
    }
  }

  /**
   * 停止所有动作并释放资源
   */
  destroy() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.root);
    }
  }
}
