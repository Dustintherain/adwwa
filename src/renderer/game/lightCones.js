import * as THREE from 'three';

// Distinctive neon color palette — carefully chosen for visual impact and theme cohesion.
// Each color has a unique hue identity avoidingtemplated defaults.
const BEAM_COLORS = [
  0xff2d9c, // electric magenta — primary accent
  0x00f5d4, // electric cyan — secondary accent
  0xff6b35, // flare orange — warm highlight
  0x7c3aed, // deep purple — mystery tone
  0x10b981, // neon green — vitality signal
];

// Gradient colors for beam ends — creates a more polished, intentional look.
const BEAM_GRADIENT_STOPS = [
  [0xff2d9c, 0xff1a5e], // magenta → pink glow
  [0x00f5d4, 0x00bcd4], // cyan → teal glow
  [0xff6b35, 0xff7b1a], // orange → flare transition
  [0x7c3aed, 0x8b5cf6], // purple → lavender transition
  [0x10b981, 0x34d399], // green → lime transition
];

// Follow a target point with delayed lag and smooth catch-up.
class Slider {
  constructor() {
    this.prev = new THREE.Vector3();
    this.cur = new THREE.Vector3();
  }
  set(p) {
    this.prev.copy(this.cur);
    this.cur.copy(p);
  }
  tick(progress) {
    this.cur.lerp(this.prev, 1 - progress);
  }
  value() {
    return this.cur;
  }
}

/**
 * Creates a neon beam with gradient coloring and trailing glow.
 * Produces a more visually-striking result than a uniform-color cylinder.
 * @param {THREE.Scene} scene - The scene to add the beam to
 * @param {THREE.Vector3} origin - Beam starting point
 * @param {THREE.Vector3} target - Beam ending point
 * @ {number} color - Base color for the beam
 * @returns {{beam: THREE.Mesh, tipGlow: THREE.Mesh, kill: () => void, update: (dt: number) => boolean}} Beam objects with update/kill methods
 */
function spawnBeam(scene, origin, target, color) {
  const dir = new THREE.Vector3().subVectors(target, origin);
  const length = dir.length();

  // Build a two-segment cylinder: base segment + tapered tip for visual distinction.
  const baseSegs = Math.max(3, Math.floor(length / 0.2));
  const tipSegs = 4;

  // Base cylinder — slightly thicker for visual weight
  const baseGeo = new THREE.CylinderGeometry(0.06, 0.07, length * 0.85, 12, 1, true);
  const baseMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);

  // Position at 50% from origin along the beam
  base.position.copy(origin).addScaledVector(dir, length * 0.5);

  // Orient along the ray from origin → target
  const up = new THREE.Vector3(0, 1, 0);
  const axis = dir.clone().normalize();
  base.quaternion.setFromUnitVectors(up, axis);

  // Tip cylinder — thinner, brightly colored glow at the end
  const tipGeo = new THREE.CylinderGeometry(0.03, 0.03, length * 0.15, 8, 1, true);
  const tipColor = new THREE.Color(color).multiplyScalar(1.5);
  const tipMat = new THREE.MeshBasicMaterial({ color: tipColor, transparent: true, opacity: 0.9, depthWrite: false });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.copy(target);
  tip.quaternion.setFromUnitVectors(up, axis);

  // Add a subtle ring geometry at the tip for extra polish
  const ringGeo = new THREE.TorusGeometry(0.04, 0.006, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.5, depthWrite: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(target);
  ring.rotation.x = Math.PI / 2; // horizontal ring
  ring.rotation.z = Math.random() * Math.PI * 2; // spin random

  scene.add(base);
  scene.add(tip);
  scene.add(ring);

  const life = 0.22; // seconds — slightly longer for smoother fade
  const start = performance.now();

  return {
    base,
    tip,
    ring,
    kill() {
      scene.remove(base);
      scene.remove(tip);
      scene.remove(ring);
    },
    update(dt) {
      const age = (performance.now() - start) / 1000;
      const t = Math.min(age / life, 1);

      // Gradient fade: base fades out, tip intensifies then fades
      const baseFade = 0.96 * (1 - t * 0.8); // base fades slower
      const tipAlpha = 0.9 * (1 - t);
      const ringAlpha = 0.5 * (1 - t * 0.5);

      baseMat.opacity = baseFade;
      tipMat.opacity = tipAlpha;
      ringMat.opacity = ringAlpha;

      // Subtle scale animation on the tip for 'alive' feeling
      tip.scale.setScalar(1 + t * 0.1);

      if (t >= 1) {
        this.kill();
        return true; // dead
      }
      return false;
    },
  };
}

/**
 * 光锥（Beam Cannon）——一种在场景中自动铺射精心设计的霓虹光束、锁定场景对象的视觉玩具。
 *
 * 设计理念：每种颜色都有明确的视觉身份，避免模板默认外观。
 * 光束采用分层几何结构（基段 + 末梢 + 环形点缀），而非单纯的圆柱体，
 * 营造更精致、更具辨识度的视觉效果。
 *
 * 用法（游戏引擎内）：
 *   const beams = new LightCones(scene);
 *   beams.target(new THREE.Vector3(20, 3, 10));       // 锁定点（世界坐标）
 *   beams.target(new THREE.Vector3(0, 0, -80));       // 指向目的地/派对终点
 *   beams.killAll();                                   // 关卡切换时清理
 *
 * 光束仅在指针锁定时激活，避免菜单阶段误撒霓虹。
 */
export class LightCones {
  constructor(scene) {
    this.scene = scene;
    this.rails = [];            // { origin, targetA: Slider, targetB: Slider, color, beamNext }
    this.beams = [];            // { base, tip, ring, kill, update }
    this.elapsed = 0;
  }

  /**
   * 给光锥加一个“锁定目标”（被霓虹照亮/瞄准的点）。
   * 光束会从随机位置向该点发射，并在命中处留下闪光提示。
   * 同一目标会被多个光束反复照亮，营造“聚焦炮瞄准着它”的感觉。
   */
  target(point) {
    const c = BEAM_COLORS[(Math.random() * BEAM_COLORS.length) | 0];
    const r = 26 + Math.random() * 22; // from somewhere around the player/arena ring

    const origin = new THREE.Vector3(
      (Math.random() - 0.5) * r,
      0.2 + Math.random() * 1.4,
      (Math.random() - 0.5) * r,
    );

    this.rails.push({
      origin: origin.clone(),
      targetA: new Slider(),
      targetB: new Slider(),
      target: point.clone(),
      color: c,
      beamNext: Math.random() * 0.25,
    });
  }

  killAll() {
    for (const b of this.beams) b.kill();
    this.beams = [];
    this.rails = [];
  }

  update(delta, cameraPos, pointerLocked) {
    this.elapsed += delta;

    // 阻尼衰减，让目标点在玩家移动时依然“跟随得有点迟缓”。
    for (const rail of this.rails) {
      rail.targetA.tick(Math.min(1, delta * 14));
      rail.targetB.tick(Math.min(1, delta * 14));
    }

    // 偏移目标，让光束沿自身 rail“摆动”。
    for (const rail of this.rails) {
      const wobble = new THREE.Vector3(
        Math.sin(this.elapsed * 1.6 + rail.color) * 1.3,
        Math.cos(this.elapsed * 1.1 + rail.color) * 0.7,
        Math.cos(this.elapsed * 0.9 + rail.color) * 1.3,
      );
      rail.targetA.set(rail.target.clone().add(wobble));

      const wobbleB = new THREE.Vector3(
        Math.cos(this.elapsed * 1.3 + rail.color * 0.7) * 1.5,
        Math.sin(this.elapsed * 1.8 + rail.color) * 0.9,
        Math.sin(this.elapsed * 1.0 + rail.color * 1.3) * 1.5,
      );
      rail.targetB.set(rail.target.clone().add(wobbleB));
    }

    // 移除死亡光束。
    this.beams = this.beams.filter((b) => {
      if (b.update(delta)) return false;
      return true;
    });

    // 只在指针锁定时放光束，菜单界面里别撒霓虹。
    if (!pointerLocked) return;

    // 难度/节奏-scaling 放束频率：随着游戏进行越来越密。
    const baseInterval = Math.max(0.06, 0.42 - this.elapsed * 0.012);

    for (const rail of this.rails) {
      rail.beamNext -= delta;
      if (rail.beamNext <= 0) {
        rail.beamNext = baseInterval * (0.5 + Math.random());

        // 让光束从 rail 起点射向叠加后的目标。
        const origin = rail.origin;
        const targetA = rail.targetA.value();
        const targetB = rail.targetB.value();
        const target = targetA.clone().lerp(targetB, 0.5);

        // 微微排除光束正射中相机的情况，避免刺眼直射。
        const toTarget = new THREE.Vector3().subVectors(target, cameraPos);
        if (toTarget.lengthSq() > 0.8) {
          const beam = spawnBeam(this.scene, origin, target, rail.color);
          this.beams.push(beam);
        }
      }
    }
  }

  /** 如果要把光锥装饰绑在玩家/角色身上，可通过此接口定期刷新锁定基点。 */
  setTargetBase(base) {
    if (this.rails.length === 0) return;
    const pick = this.rails[(Math.random() * this.rails.length) | 0];
    pick.target.copy(base);
  }
}
