import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// 第一人称与第三人称共用同一个视点常量：角色脚底高度 = 相机高度 - EYE_HEIGHT。
import { EYE_HEIGHT } from './fpsController.js';
import { extractArmData } from './skinnedMeshRig.js';

/**
 * CharacterModel — 完全原样的静态角色。
 * （注意：模型不参与蹲下/落地等任何形态变化，相机下沉时角色保持站立原样。）
 *
 * 模型方案（user request）：只加载 blue_archive_-koharu-__cb_default_emotion.glb，
 * 并且**原封不动**地渲染它：
 *   - 不重建骨骼：GLB 是纯静态网格（无 armature、无 animation），出厂姿态就是唯一姿态；
 *   - 不裁切、不重建手臂、不烘焙/搬移任何子网格；
 *   - 不替换材质：保留文件自带的 MeshBasicMaterial + 贴图（赛璐璐观感就是原样）；
 *   - 不做 IK / 步态 / 关节变形：网格顶点永不改变，角色只随玩家整体平移与转向。
 *
 * 第一人称不渲染角色：第三人称相机与角色头部在同一个网格里（Object_3 同时包含头与身体），
 * 站在眼位时相机位于头骨内部；在不修改模型（裁头/换材质/双面剔除）的前提下无法得到干净视野。
 * 所以第一人称改用独立的 viewmodel（开源 FPS 模版的 viewmodel pass，见 WeaponController）：
 *   手臂几何只“读取”自这个 GLB（extractArmSkinnedData），构建成 SkinnedMesh 由 IK 持枪，
 * 模型本体依旧一个顶点都不改；第三人称（T / F5）继续展示原样静态模型。
 */

/**
 * 静态姿态下她右手的位置（模型空间，单位米；身高 1.48m，面朝 +Z）。
 * 由模型几何实测：手臂在 y≈0.50 处伸到 |x|≈0.40，右手在 -X 侧。
 * 步枪就挂在这个点上——模型本身不动，枪静置于手中。
 */
const HAND_REST = new THREE.Vector3(-0.40, 0.50, 0.10);
/** 枪身中心相对手心的偏移：让手心落在握把/机匣后端，枪口朝 +Z（身体正前方）。 */
const GUN_CENTER_OFFSET = new THREE.Vector3(0.0, 0.045, 0.085);

export class CharacterModel {
  constructor(scene) {
    this.scene = scene;

    // Root container in world space
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // 角色容器：只承载整体位移/转向，内部网格永远保持文件原样
    this.animGroup = new THREE.Group();
    this.root.add(this.animGroup);

    this.koharuModel = null;
    this.isLoaded = false;
    this.isThirdPerson = false;

    // 第三人称步枪：静置在右手，不参与任何肢体变形
    this.tpWeaponGroup = new THREE.Group();
    this.tpWeaponGroup.position.copy(GUN_CENTER_OFFSET);
    this.tpMuzzleLight = null;
    this.tpMuzzleSprite = null;

    this.weaponMount = new THREE.Group();
    this.weaponMount.position.copy(HAND_REST);
    this.weaponMount.add(this.tpWeaponGroup);
    this.animGroup.add(this.weaponMount);

    // 第一人称手臂数据（由 loadKoharu 从原始几何提取后回调交付，模型本体不受影响）
    // 交付给 GameEngine → WeaponController.attachCharacterArms，挂进 viewmodel
    this.armSkinnedData = null;
    this.onArmsExtracted = null;

    // 状态（只用于枪口火花/后坐这些独立于角色的效果）
    this.recoilIntensity = 0;

    this.loadKoharu();
    this.loadThirdPersonWeapon();
  }

  loadKoharu() {
    const loader = new GLTFLoader();
    // 用户指定的角色模型源：只此一份，不使用任何修改版
    const modelPath = './models/blue_archive_-koharu-__cb_default_emotion.glb';

    loader.load(
      modelPath,
      (gltf) => {
        console.log('[CharacterModel] Koharu GLB loaded (as-is, static):', modelPath);
        const model = gltf.scene;

        // 只做摆放：缩放到 1.48m 身高、脚底贴地、水平居中。不触碰任何顶点/材质/层级。
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const targetHeight = 1.48;
        const scale = size.y > 0 ? targetHeight / size.y : 1;
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            // 材质、贴图、正反面全部保持 GLB 里的设定
          }
        });

        // 第一人称手臂的数据源：**只读取**原模型几何从中提取双臂，模型本体一个顶点都不改。
        // 必须在把 model 挂到跟随玩家的 animGroup 之前量取，这样烘焙出来的坐标是模型局部坐标。
        let armData = null;
        try {
          armData = this.extractArmSkinnedData(model);
        } catch (err) {
          console.warn('[CharacterModel] 第一人称手臂数据提取失败:', err);
        }

        this.koharuModel = model;
        this.animGroup.add(model);
        this.isLoaded = true;
        this.updateVisibility();

        if (armData) {
          this.armSkinnedData = armData;
          if (this.onArmsExtracted) this.onArmsExtracted(armData);
        }
      },
      undefined,
      (err) => {
        console.error('[CharacterModel] Error loading Koharu model:', err);
      }
    );
  }

  /**
   * 从原始 GLB 的 body 网格读取双臂数据，供第一人称手臂 viewmodel 使用（只读，不修改模型）。
   * 坐标系：调用时 model 尚未挂到跟随玩家的 animGroup 上，所以这里得到的是模型局部坐标；
   * bodyMatrixWorld 必须 clone，否则模型开始跟随玩家移动后手臂会被带跑。
   */
  extractArmSkinnedData(model) {
    model.updateMatrixWorld(true);
    let bodyMesh = null;
    model.traverse((c) => {
      if (c.isMesh && c.material && c.material.name === 'body' && !bodyMesh) bodyMesh = c;
    });
    if (!bodyMesh || !bodyMesh.geometry.index) return null;

    const posAttr = bodyMesh.geometry.attributes.position;
    const count = posAttr.count;
    const bodyPositions = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    const bbMin = [Infinity, Infinity, Infinity];
    const bbMax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(bodyMesh.matrixWorld);
      bodyPositions[i * 3] = v.x;
      bodyPositions[i * 3 + 1] = v.y;
      bodyPositions[i * 3 + 2] = v.z;
      for (let k = 0; k < 3; k++) {
        const a = v.getComponent(k);
        if (a < bbMin[k]) bbMin[k] = a;
        if (a > bbMax[k]) bbMax[k] = a;
      }
    }
    const bodyIndices = Uint32Array.from(bodyMesh.geometry.index.array);
    const height = bbMax[1] - bbMin[1];
    const halfWidth = (bbMax[0] - bbMin[0]) / 2;
    const halfDepth = Math.max(Math.abs(bbMin[2]), Math.abs(bbMax[2]));

    return {
      R: extractArmData('R', bodyPositions, bodyIndices, height, halfWidth, halfDepth),
      L: extractArmData('L', bodyPositions, bodyIndices, height, halfWidth, halfDepth),
      bodyGeo: bodyMesh.geometry,
      bodyMatrixWorld: bodyMesh.matrixWorld.clone(),
      material: bodyMesh.material,
    };
  }

  loadThirdPersonWeapon() {
    const loader = new GLTFLoader();
    const weaponPath = './models/blue_archive_weapon_-_sunaookami_shiroko.glb';

    loader.load(weaponPath, (gltf) => {
      const model = gltf.scene;

      // Enhance material
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            child.material.roughness = 0.85;
            child.material.metalness = 0.1;
          }
        }
      });

      // Compute bounding box & center
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.sub(center);

      // Rotate so barrel points forward (+Z) along the character's front
      model.rotation.y = Math.PI / 2;

      // Scale to ~0.60m long for Koharu's proportions
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0 ? 0.60 / maxDim : 1;
      model.scale.setScalar(scale);

      const pivot = new THREE.Group();
      pivot.add(model);
      this.tpWeaponGroup.add(pivot);

      // Third-person Muzzle Flash Light & Sprite at forward barrel (+Z = 0.38m)
      this.tpMuzzleLight = new THREE.PointLight(0xffaa33, 0, 8.0);
      this.tpMuzzleLight.position.set(0, 0.04, 0.38);
      this.tpWeaponGroup.add(this.tpMuzzleLight);

      // Flash sprite canvas
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#ffaa44');
      grad.addColorStop(0.8, '#ff4400');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);

      const flashTex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({
        map: flashTex,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.tpMuzzleSprite = new THREE.Sprite(spriteMat);
      this.tpMuzzleSprite.scale.set(0.4, 0.4, 0.4);
      this.tpMuzzleSprite.position.set(0, 0.04, 0.38);
      this.tpMuzzleSprite.visible = false;
      this.tpWeaponGroup.add(this.tpMuzzleSprite);

      this.tpWeaponMesh = pivot;
      this.updateVisibility();
    });
  }

  setPerspective(isThirdPerson) {
    this.isThirdPerson = isThirdPerson;
    this.updateVisibility();
  }

  /**
   * 第三人称：原样模型 + 右手步枪。
   * 第一人称：整个角色不渲染（相机在头骨内部，模型头部与身体同网格，无法在不改动模型的前提下去头）。
   */
  updateVisibility() {
    if (!this.isLoaded) return;
    this.root.visible = this.isThirdPerson;
    this.animGroup.visible = this.isThirdPerson;
    if (this.koharuModel) this.koharuModel.visible = this.isThirdPerson;
    if (this.weaponMount) this.weaponMount.visible = this.isThirdPerson;
    if (this.tpWeaponGroup) this.tpWeaponGroup.visible = this.isThirdPerson;
    if (this.tpWeaponMesh) this.tpWeaponMesh.visible = this.isThirdPerson;
  }

  triggerFireFX() {
    // 枪口火光（枪是独立物体，可以动；角色网格不动）
    if (this.tpMuzzleLight && this.tpMuzzleSprite) {
      this.tpMuzzleLight.intensity = 5.5;
      this.tpMuzzleSprite.visible = true;
      this.tpMuzzleSprite.material.rotation = Math.random() * Math.PI * 2;

      setTimeout(() => {
        if (this.tpMuzzleLight) this.tpMuzzleLight.intensity = 0;
        if (this.tpMuzzleSprite) this.tpMuzzleSprite.visible = false;
      }, 45);
    }

    this.recoilIntensity = 1.0;
  }

  update(delta, player, weapon) {
    if (!this.isLoaded || !player) return;

    // 1. 整体跟随玩家。静态模型不能弯腿，所以蹲下时只让相机下降，角色留在原地站立
    // （max(0, ...) 保证脚底不穿进地板）；跳跃时相机高于站立眼高，模型整体跟着升起。
    this.root.position.set(
      player.position.x,
      Math.max(0, player.position.y - EYE_HEIGHT),
      player.position.z
    );
    this.root.rotation.y = player.euler.y + Math.PI;

    // 2. 步枪后坐：只动枪这个独立节点（角色网格完全不受影响）
    if (this.tpWeaponGroup) {
      if (this.recoilIntensity > 0) {
        this.recoilIntensity = Math.max(0, this.recoilIntensity - delta * 12);
        this.tpWeaponGroup.position.set(
          GUN_CENTER_OFFSET.x,
          GUN_CENTER_OFFSET.y + this.recoilIntensity * 0.02,
          GUN_CENTER_OFFSET.z - this.recoilIntensity * 0.05
        );
        this.tpWeaponGroup.rotation.x = this.recoilIntensity * 0.08;
      } else {
        this.tpWeaponGroup.position.copy(GUN_CENTER_OFFSET);
        this.tpWeaponGroup.rotation.set(0, 0, 0);
      }
    }
  }

  destroy() {
    if (this.root && this.root.parent) {
      this.root.parent.remove(this.root);
    }
  }
}
