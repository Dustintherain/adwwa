import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bakeGeometry, makeCapMaterial, segmentMesh } from './meshTools.js';
import { buildLimbBones, attachLimbShell } from './limbRig.js';
import { solveTwoBoneIK } from './armIK.js';
import { OpenSourceMotionController } from './openSourceWalkMotion.js';
import { buildThirdPersonSkinnedCharacter, extractArmData } from './skinnedMeshRig.js';
import { OfficialAnimationController } from './officialAnimationController.js';
import { GunGrip } from './GunGripIK.js';

/**
 * CharacterModel: Manages the 3D anime character (Koharu Shimoe - 下江小春)
 * - Loads the Blue Archive Koharu GLB model
 * - Handles anime cel-shading materials, glowing halo bloom & light
 * - Mounts the 3D Shiroko assault rifle in her hands for Third-Person view
 * - Implements procedural locomotion: idle breathing, walk/sprint stride, forward lean,
 *   banking into turns, tactical jump/crouch, aiming pitch, weapon firing recoil, and CS:GO reload
 * - Coordinates First-Person (body visible when looking down) and Third-Person (full character view)
 *
 * IMPORTANT: The character model itself is NEVER scaled or deformed. Crouch and jump
 * are expressed purely as joint rotations (hip / knee / ankle) of a procedural rig that
 * is re-segmented from the static mesh at load time (the GLB ships without a skeleton).
 */

const EYE_HEIGHT = 1.65;
const MAX_CROUCH_DEPTH = 0.24; // deepest natural joint-posed crouch (meters)
export class CharacterModel {
  constructor(scene) {
    this.scene = scene;

    // Root container in world space
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // Inner model container for procedural animation offsets (breathing, stride, recoil)
    this.animGroup = new THREE.Group();
    this.root.add(this.animGroup);

    // References to model meshes
    this.koharuModel = null;
    this.haloMesh = null;
    this.haloLight = null;
    this.headMeshes = [];
    this.bodyMeshes = [];

    // Third-person weapon instance
    this.tpWeaponGroup = new THREE.Group();
    this.tpMuzzleLight = null;
    this.tpMuzzleSprite = null;

    // Weapon mount: parented to the torso (hip joint) so the rifle follows the body
    this.weaponMount = new THREE.Group();
    this.weaponMount.add(this.tpWeaponGroup);
    this.animGroup.add(this.weaponMount);

    // Locomotion & Animation state
    this.walkPhase = 0;
    this.idleTimer = 0;
    this.recoilIntensity = 0;
    this.bodyRecoilPitch = 0;
    this.bodyRecoilZ = 0;
    this.forwardLean = 0;
    this.strafeRoll = 0;
    this.strafeYaw = 0;
    this.aimTransition = 0;
    this.landingTimer = 0;
    this.landingDepth = 0;
    this.wasGrounded = true;
    this.lastHealth = 100;
    this.damageFlinchTimer = 0;
    this.fidgetTimer = 0;
    this.fidgetSide = 1;
    this.isThirdPerson = false;
    this.isLoaded = false;

    // Smoothing state
    this.currentYaw = 0;
    this.currentPitch = 0;
    this.currentPos = new THREE.Vector3();

    // Procedural joint rig (rebuilt from the static mesh — no model editing)
    this.hipJoint = null;
    this.hipJointL = null;
    this.kneeJointL = null;
    this.ankleJointL = null;
    this.hipJointR = null;
    this.kneeJointR = null;
    this.ankleJointR = null;
    this.kneeJoint = null; // 向后兼容
    this.ankleJoint = null; // 向后兼容
    this.haloWrapper = null;
    this.hasJointRig = false;
    this.haloBaseY = 0;
    this.crouchDepth = 0;
    this.thighLen = 0.222;
    this.shinLen = 0.243;
    this.hipAnkleLen = 0.465;
    this.motionController = null;

    // Arm rig built from limbRig.js (data-driven from rigSpec.js)
    this.armBones = null;        // { shoulderL, elbowL, handL, shoulderR, elbowR, handR } — THREE.Group (joints)
    this.armSegmentMeshes = null; // { R: { upper, fore, hand }, L: { upper, fore, hand } } — { mesh: THREE.Mesh, cap?: THREE.Mesh }
    this.armRig = null;           // limbRig 构建结果（bones + boneAbs），供其它全身壳体复用
    this.hasArmRig = false;
    this.bodyMaterial = null;
    this.onArmsExtracted = null;

    // 模型系统（支持 Three.js 官方 Soldier 骨骼动画角色 与 碧蓝档案 Koharu）
    this.currentModelType = 'soldier'; // 默认启用官方标准骨骼动画角色
    this.officialAnim = null;
    this.soldierModel = null;
    this.soldierRightHand = null;
    this.soldierSpine = null;
    this.soldierHips = null;
    this.soldierScale = 1.0;
    this.soldierGunGrip = null;

    if (this.currentModelType === 'soldier') {
      this.loadSoldier();
    } else {
      this.loadKoharu();
    }
    this.loadThirdPersonWeapon();
  }

  loadSoldier() {
    const loader = new GLTFLoader();
    const modelPath = './models/Soldier.glb';

    loader.load(
      modelPath,
      (gltf) => {
        console.log('[CharacterModel] Three.js Official Soldier GLB loaded:', modelPath);
        const model = gltf.scene;

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // 标准特警成人身高 1.78m
        const targetHeight = 1.78;
        const scale = size.y > 0 ? targetHeight / size.y : 1.0;
        this.soldierScale = scale;
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
              child.material.roughness = 0.65;
              child.material.metalness = 0.2;
            }
          }
          if (child.isBone) {
            const clean = (child.name || '').toLowerCase();
            if (clean.includes('righthand')) this.soldierRightHand = child;
            if (clean.includes('spine1')) this.soldierSpine = child;
            if (clean.includes('hips')) this.soldierHips = child;
          }
        });

        // 依据 Three.js 官方文档与官方 skinning/blending 示例构建动画控制器
        this.officialAnim = new OfficialAnimationController(model, gltf.animations);

        this.soldierModel = model;
        this.animGroup.add(model);
        this.isLoaded = true;

        // 初始化战术双手 IK 握枪控制器 (GunGripIK)
        this.setupSoldierGunGrip();

        this.updateVisibility();
      },
      undefined,
      (err) => {
        console.warn('[CharacterModel] Failed to load Soldier model, fallback to Koharu:', err);
        this.loadKoharu();
      }
    );
  }

  /**
   * 初始化士兵双手持枪 IK 控制器
   * 枪挂载到 mixamorig:Spine2 骨骼下，随胸部动作自然晃动；双手双骨骼 IK 实时贴合枪械握把与护木
   */
  setupSoldierGunGrip() {
    if (!this.soldierModel || !this.tpWeaponMesh || this.soldierGunGrip) return;
    this.soldierGunGrip = new GunGrip(this.soldierModel, this.weaponMount, {
      prefix: 'mixamorig',
      mountBone: 'mixamorig:Spine2',
      gunOffset: [0.16, 0.08, 0.25],
      gunRotation: [-0.04, 0.06, -0.04],
      gripRPos: [0.014, -0.045, -0.095],
      gripLPos: [-0.015, -0.038, 0.085],
      poleRPos: [0.45, -0.35, -0.35],
      poleLPos: [-0.45, -0.35, -0.35],
      handEulerR: [-0.2, 0.15, -0.15],
      handEulerL: [0.15, -0.15, 0.25],
      compensateScale: true,
    });
    console.log('[CharacterModel] Soldier GunGripIK initialized successfully.');
  }

  switchCharacterModel() {
    if (this.currentModelType === 'soldier') {
      this.currentModelType = 'koharu';
      if (this.soldierModel) this.soldierModel.visible = false;
      if (this.hasJointRig && this.spineJoint) {
        this.spineJoint.add(this.weaponMount);
      }
      if (!this.koharuModel) {
        this.loadKoharu();
      } else {
        if (this.hasJointRig && this.hipJoint) this.animGroup.add(this.hipJoint);
      }
    } else {
      this.currentModelType = 'soldier';
      if (this.hasJointRig && this.hipJoint) this.animGroup.remove(this.hipJoint);
      if (!this.soldierModel) {
        this.loadSoldier();
      } else {
        this.soldierModel.visible = true;
        if (this.soldierGunGrip && this.soldierGunGrip.mount) {
          this.soldierGunGrip.mount.add(this.weaponMount);
        }
      }
    }
    this.updateVisibility();
    return this.currentModelType;
  }

  loadKoharu() {
    const loader = new GLTFLoader();
    const modelPath = './models/koharu.glb';

    loader.load(
      modelPath,
      (gltf) => {
        console.log('[CharacterModel] Koharu GLB loaded successfully:', modelPath);
        const model = gltf.scene;

        // Measure bounding box
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Normalize height to 1.48m (Koharu's canonical height in Blue Archive)
        const targetHeight = 1.48;
        const scale = size.y > 0 ? targetHeight / size.y : 0.0000261;
        this.scale = scale;

        // Center on X and Z, put soles of feet at Y = 0
        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        model.scale.setScalar(scale);

        // Enhance materials with MeshStandardMaterial so lighting, shadows & emissive work properly
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            const oldMat = child.material;
            const matName = oldMat ? oldMat.name : '';

            // Classify head vs body meshes for first-person camera clipping
            if (
              child.name === 'Object_4' ||
              child.name === 'Object_5' ||
              child.name === 'Object_6' ||
              child.name === 'Object_7' ||
              child.name === 'Object_8' ||
              matName === 'hair' ||
              matName === 'mouth' ||
              matName === 'eye_brow' ||
              matName === 'material' ||
              matName === 'halo_glow'
            ) {
              this.headMeshes.push(child);
            } else {
              this.bodyMeshes.push(child);
            }

            // Glowing Angel Halo
            if (child.name === 'Object_6' || matName === 'halo_glow') {
              this.haloMesh = child;
              child.material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(0xff4477),
                emissive: new THREE.Color(0xff4477),
                emissiveIntensity: 2.5,
                roughness: 1.0,
                metalness: 0.0,
              });
            } else if (oldMat) {
              const newMat = new THREE.MeshStandardMaterial({
                map: oldMat.map || null,
                color: oldMat.color ? oldMat.color.clone() : new THREE.Color(0xffffff),
                roughness: 1.0, // 100% 漫反射哑光，消除反光油腻质感
                metalness: 0.0, // 零金属度，还原二次元动漫纯净渲染
                transparent: oldMat.transparent || false,
                opacity: oldMat.opacity !== undefined ? oldMat.opacity : 1.0,
                depthTest: true,
                depthWrite: true,
              });
              // 保留材质名：buildJointRig 靠 material.name === 'body' 找手臂提取的输入网格
              newMat.name = matName;
              child.material = newMat;
            }
          }
        });

        this.koharuModel = model;

        // Build the procedural joint rig (legs + arms) from the static mesh.
        // A rig failure must never leave the character invisible: fall back to the raw model.
        let rigOk = false;
        try {
          rigOk = this.buildJointRig(model) === true;
        } catch (err) {
          console.error('[CharacterModel] 骨骼装配异常，回退到静态模型:', err);
        }
        if (!rigOk) {
          this.hasJointRig = false;
          this.hasArmRig = false;
          this.animGroup.add(model);
        }
        this.isLoaded = true;

        if (this.onArmsExtracted && (this.armSkinnedData || this.armSegmentMeshes) && this.armRig) {
          this.onArmsExtracted(this.armSkinnedData || this.armSegmentMeshes, this.armRig, this.bodyMaterial);
        }

        this.updateVisibility();
      },
      undefined,
      (err) => {
        console.error('[CharacterModel] Error loading Koharu model:', err);
      }
    );
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

      // Rotate so barrel points forward (+Z) along Koharu's front
      model.rotation.y = Math.PI / 2;

      // Scale to ~0.60m long for Koharu's proportions
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0 ? 0.60 / maxDim : 1;
      model.scale.setScalar(scale);

      const pivot = new THREE.Group();
      pivot.add(model);

      this.tpWeaponGroup.position.set(0, 0, 0);
      this.tpWeaponGroup.rotation.set(0, 0, 0);
      this.tpWeaponGroup.add(pivot);
      this.weaponMount.add(this.tpWeaponGroup);

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
      this.setupSoldierGunGrip();
      this.updateVisibility();
    });
  }

  setPerspective(isThirdPerson) {
    this.isThirdPerson = isThirdPerson;
    this.updateVisibility();
  }

  updateVisibility() {
    if (!this.isLoaded) return;

    if (this.isThirdPerson) {
      // 第三人称：完整角色 + 第三人称武器全部可见
      this.root.visible = true;
      this.animGroup.visible = true;

      if (this.currentModelType === 'soldier') {
        if (this.soldierModel) this.soldierModel.visible = true;
        this.headMeshes.forEach((m) => (m.visible = false));
        this.bodyMeshes.forEach((m) => (m.visible = false));
        if (this.haloMesh) this.haloMesh.visible = false;
        if (this.hasJointRig && this.hipJoint) this.hipJoint.visible = false;
      } else {
        if (this.soldierModel) this.soldierModel.visible = false;
        this.headMeshes.forEach((m) => (m.visible = true));
        this.bodyMeshes.forEach((m) => (m.visible = true));
        if (this.haloMesh) this.haloMesh.visible = true;
        if (this.hasJointRig && this.hipJoint) this.hipJoint.visible = true;
      }

      if (this.tpWeaponGroup) this.tpWeaponGroup.visible = true;
      if (this.tpWeaponMesh) this.tpWeaponMesh.visible = true;
    } else {
      // 第一人称：第一人称下严格限制只看手臂模型与枪械（由武器 Viewmodel 挂载渲染），隐藏第三人称全身模型
      this.root.visible = false;
    }
  }

  triggerFireFX() {
    // 枪口火光闪烁与光环能量跃动
    if (this.tpMuzzleLight && this.tpMuzzleSprite) {
      this.tpMuzzleLight.intensity = 5.5;
      this.tpMuzzleSprite.visible = true;
      this.tpMuzzleSprite.material.rotation = Math.random() * Math.PI * 2;

      setTimeout(() => {
        if (this.tpMuzzleLight) this.tpMuzzleLight.intensity = 0;
        if (this.tpMuzzleSprite) this.tpMuzzleSprite.visible = false;
      }, 45);
    }

    if (this.haloLight) {
      this.haloLight.intensity = 3.5;
      setTimeout(() => {
        if (this.haloLight) this.haloLight.intensity = 1.0;
      }, 60);
    }

    // 武器后坐力与全身受力冲击
    this.recoilIntensity = 1.0;
    this.bodyRecoilPitch = 0.075;
    this.bodyRecoilZ = 0.035;
  }

  // ------------------------------------------------------------------
  // Procedural joint rig construction (static mesh -> joint segments)
  // ------------------------------------------------------------------

  /**
   * 基于 Three.js 核心概念（Bone、Skeleton、SkinnedMesh）构建完整角色骨架与蒙皮网格。
   * 采用线性混合蒙皮（Linear Blend Skinning）进行动态关节屈伸与行走步态变形，
   * 彻底淘汰切割式刚性切片（segmentMesh），保留完整的模型几何连续性。
   */
  buildJointRig(model) {
    model.updateMatrixWorld(true);

    const savedPos = this.animGroup.position.clone();
    const savedRot = this.animGroup.rotation.clone();
    const savedScale = this.animGroup.scale.clone();
    this.animGroup.position.set(0, 0, 0);
    this.animGroup.rotation.set(0, 0, 0);
    this.animGroup.scale.set(1, 1, 1);
    this.root.updateMatrixWorld(true);

    const worldBox = new THREE.Box3().setFromObject(model);
    const height = worldBox.max.y - worldBox.min.y;
    if (height <= 0) {
      this.animGroup.position.copy(savedPos);
      this.animGroup.rotation.copy(savedRot);
      this.animGroup.scale.copy(savedScale);
      return false;
    }

    const hipY = height * 0.375;
    const kneeY = height * 0.225;
    const ankleY = height * 0.061;
    const neckY = height * 0.65;
    this.thighLen = (0.375 - 0.225) * height;
    this.shinLen = (0.225 - 0.061) * height;
    this.hipAnkleLen = (0.375 - 0.061) * height;

    const originalMeshes = [];
    model.traverse((c) => {
      if (c.isMesh) originalMeshes.push(c);
    });

    let bodyMesh = null;
    let outlineMesh = null;
    for (const child of originalMeshes) {
      if (child.material) {
        if (child.material.name === 'body' && !bodyMesh) bodyMesh = child;
        if (child.material.name === 'outline' && !outlineMesh) outlineMesh = child;
      }
    }
    if (bodyMesh) this.bodyMaterial = bodyMesh.material;

    if (!bodyMesh || !bodyMesh.geometry.index) {
      this.animGroup.position.copy(savedPos);
      this.animGroup.rotation.copy(savedRot);
      this.animGroup.scale.copy(savedScale);
      return false;
    }

    const posAttr = bodyMesh.geometry.attributes.position;
    const count = posAttr.count;
    const bodyPositions = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(bodyMesh.matrixWorld);
      bodyPositions[i * 3] = v.x;
      bodyPositions[i * 3 + 1] = v.y;
      bodyPositions[i * 3 + 2] = v.z;
    }
    const bodyIndices = Uint32Array.from(bodyMesh.geometry.index.array);

    const bbMin = [Infinity, Infinity, Infinity];
    const bbMax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < bodyPositions.length / 3; i++) {
      for (let k = 0; k < 3; k++) {
        const a = bodyPositions[i * 3 + k];
        if (a < bbMin[k]) bbMin[k] = a;
        if (a > bbMax[k]) bbMax[k] = a;
      }
    }
    const rigHalfWidth = (bbMax[0] - bbMin[0]) / 2;
    const rigHalfDepth = Math.max(Math.abs(bbMin[2]), Math.abs(bbMax[2]));

    // 1. 构建全人型 16 骨骼蒙皮骨架系统（Bone、Skeleton、SkinnedMesh）
    const charRig = buildThirdPersonSkinnedCharacter({
      model,
      bodyMesh,
      outlineMesh,
      targetHeight: height,
      rigHalfWidth,
      rigHalfDepth,
      bodyPositions,
      bodyIndices,
    });

    if (!charRig) {
      this.animGroup.position.copy(savedPos);
      this.animGroup.rotation.copy(savedRot);
      this.animGroup.scale.copy(savedScale);
      return false;
    }

    // 挂载骨骼树根节点与蒙皮主体网格
    this.animGroup.add(charRig.rootBone);
    this.animGroup.add(charRig.skinnedBodyMesh);

    // 映射角色各关节引用（保持与既有 locomotion / IK / 视角控制的完全兼容）
    this.hipJoint = charRig.hipsBone;
    this.hipJointL = charRig.hipBoneL;
    this.kneeJointL = charRig.kneeBoneL;
    this.ankleJointL = charRig.ankleBoneL;
    this.hipJointR = charRig.hipBoneR;
    this.kneeJointR = charRig.kneeBoneR;
    this.ankleJointR = charRig.ankleBoneR;
    this.kneeJoint = charRig.kneeBoneL; // 向后兼容
    this.ankleJoint = charRig.ankleBoneL; // 向后兼容
    this.spineJoint = charRig.spineBone;
    this.neckJoint = charRig.neckBone;
    this.armBones = charRig.armBones;
    this.armRig = charRig;
    this.skeleton = charRig.skeleton;
    this.hasJointRig = true;
    this.hasArmRig = true;

    // 挂载第三人称武器插槽到躯干脊椎骨骼（Spine），随躯干瞄准与后坐力联动
    this.weaponMount.position.set(0.06, 0.11, 0.25);
    charRig.spineBone.add(this.weaponMount);

    // Halo wrapper: 保持光环水平，抵消躯干前倾
    const haloWrapper = new THREE.Group();
    haloWrapper.name = 'HaloWrapper';
    charRig.hipsBone.add(haloWrapper);
    this.haloWrapper = haloWrapper;

    const newHeadMeshes = [];
    const newBodyMeshes = [charRig.skinnedBodyMesh];
    if (charRig.skinnedOutlineMesh) {
      newBodyMeshes.push(charRig.skinnedOutlineMesh);
    }

    // 挂载头部配件（脸部、头发、嘴巴、眉毛）到颈部骨骼 (neckBone)，光环挂到 haloWrapper
    for (const child of originalMeshes) {
      if (child === bodyMesh || (child.material && child.material.name === 'outline')) {
        continue;
      }
      const isHalo = this.haloMesh === child;
      const toAnim = child.matrixWorld.clone();
      if (isHalo) {
        const bakedHaloGeo = bakeGeometry(child, toAnim);
        const haloMeshInstance = new THREE.Mesh(bakedHaloGeo, child.material);
        haloMeshInstance.position.set(0, -hipY, 0);
        haloWrapper.add(haloMeshInstance);
        this.haloMesh = haloMeshInstance;
        this.haloBaseY = -hipY;
      } else {
        const bakedHeadGeo = bakeGeometry(child, toAnim);
        const headMeshInstance = new THREE.Mesh(bakedHeadGeo, child.material);
        headMeshInstance.position.set(0, -neckY, 0);
        headMeshInstance.castShadow = true;
        headMeshInstance.receiveShadow = true;
        charRig.neckBone.add(headMeshInstance);
        newHeadMeshes.push(headMeshInstance);
      }
    }

    this.headMeshes = newHeadMeshes;
    this.bodyMeshes = newBodyMeshes;

    // 2. 提取第一人称手臂数据（供 WeaponController 构建第一人称 SkinnedMesh 双臂）
    const armDataR = extractArmData('R', bodyPositions, bodyIndices, height, rigHalfWidth, rigHalfDepth);
    const armDataL = extractArmData('L', bodyPositions, bodyIndices, height, rigHalfWidth, rigHalfDepth);

    this.armSkinnedData = {
      R: armDataR,
      L: armDataL,
      bodyGeo: bodyMesh.geometry,
      bodyMatrixWorld: bodyMesh.matrixWorld,
    };

    if (this.onArmsExtracted) {
      this.onArmsExtracted(this.armSkinnedData, this.armRig, this.bodyMaterial);
    }

    // 移除原有静态模型容器
    this.animGroup.remove(model);

    this.animGroup.position.copy(savedPos);
    this.animGroup.rotation.copy(savedRot);
    this.animGroup.scale.copy(savedScale);

    // 绑定开源 CMU MoCap 双足人体步态动作控制器
    this.motionController = new OpenSourceMotionController(this.animGroup);

    return true;
  }

  update(delta, player, weapon) {
    if (!this.isLoaded || !player) return;

    this.idleTimer += delta;

    // 1. Follow Player World Position with Landing Impact Cushion
    const crouchLift = Math.max(0, EYE_HEIGHT - player.position.y);
    const targetDepth = player.isGrounded ? Math.min(crouchLift, MAX_CROUCH_DEPTH) : 0;
    this.crouchDepth += (targetDepth - this.crouchDepth) * Math.min(1, delta * 10);

    // Landing cushion impact detection
    if (player.isGrounded && !this.wasGrounded) {
      this.landingTimer = 0.28;
      this.landingDepth = Math.min(0.24, Math.max(0.08, Math.abs(player.velocity.y) * 0.025 || 0.14));
    }
    this.wasGrounded = player.isGrounded;

    let landingOffset = 0;
    if (this.landingTimer > 0) {
      this.landingTimer -= delta;
      landingOffset = Math.sin((this.landingTimer / 0.28) * Math.PI) * this.landingDepth;
    }

    const groundY = player.position.y - EYE_HEIGHT;
    const targetY = groundY - this.crouchDepth - landingOffset;
    this.root.position.set(player.position.x, targetY, player.position.z);
    this.root.visible = this.isThirdPerson;

    // ── Three.js 官方标准骨骼动画模式 (Soldier.glb / AnimationMixer) ────────────
    if (this.currentModelType === 'soldier' && this.officialAnim) {
      this.currentYaw = player.euler.y;
      this.currentPitch = player.euler.x;
      this.root.rotation.y = this.currentYaw + Math.PI;

      const keys = player.keys;
      const moveFwd = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0);
      const moveRgt = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const isMoving = (moveFwd !== 0 || moveRgt !== 0) && player.isGrounded;
      const isSprinting = keys.sprint && isMoving && moveFwd > 0;
      const isCrouching = keys.crouch && player.isGrounded;

      const horizVel = player.velocity ? Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z) : 0;
      this.officialAnim.updateLocomotion({
        isMoving,
        isSprinting,
        isCrouching,
        speed: horizVel,
        delta
      });
      this.officialAnim.update(delta);

      // 上半身脊椎瞄准仰俯联动 (mixamorigSpine1)
      if (this.soldierSpine) {
        this.soldierSpine.rotation.x = -this.currentPitch * 0.45;
      }

      // 武器后坐力冲击与回弹
      if (this.recoilIntensity > 0) {
        this.recoilIntensity = Math.max(0, this.recoilIntensity - delta * 12);
        this.tpWeaponGroup.position.z = -this.recoilIntensity * 0.065;
        this.tpWeaponGroup.rotation.x = this.recoilIntensity * 0.095;
      } else {
        this.tpWeaponGroup.position.set(0, 0, 0);
        this.tpWeaponGroup.rotation.set(0, 0, 0);
      }

      // 战术双臂 IK 贴合枪械握点 (GunGripIK)
      if (this.soldierGunGrip) {
        if (weapon && weapon.isReloading) {
          // 换弹动作响应：换弹时左手脱离护木，右手保持持枪
          this.soldierGunGrip.weightL = 0.0;
        } else {
          this.soldierGunGrip.weightL = 1.0;
        }
        this.soldierGunGrip.update();
      }

      return;
    }

    // ── Koharu 模型运动学与骨骼驱动 ──────────────────────────────────────────
    const keys = player.keys;
    const moveFwd = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0);
    const moveRgt = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const isMoving = (moveFwd !== 0 || moveRgt !== 0) && player.isGrounded;
    const isSprinting = keys.sprint && isMoving && moveFwd > 0;
    const isCrouching = keys.crouch && player.isGrounded;
    const isAiming = Boolean(weapon && weapon.isAiming);
    const isShoving = Boolean(weapon && weapon.isShoving);

    // 3. Smooth Yaw & Aim Pitch Alignment
    this.currentYaw = player.euler.y;
    this.currentPitch = player.euler.x;
    this.root.rotation.y = this.currentYaw + Math.PI;

    // 4. Directional Leaning & Strafe Banking
    let targetLean = 0;
    let targetRoll = 0;
    let targetYawOffset = 0;

    if (isMoving) {
      // Forward sprint/walk lean or backpedal tilt
      if (moveFwd > 0) {
        targetLean = isSprinting ? 0.24 : (isCrouching ? 0.15 : 0.09);
      } else if (moveFwd < 0) {
        targetLean = -0.07;
      }
      // Strafe banking roll and torso counter-yaw
      if (moveRgt > 0) {
        targetRoll = isSprinting ? 0.14 : 0.08;
        targetYawOffset = -0.06;
      } else if (moveRgt < 0) {
        targetRoll = isSprinting ? -0.14 : -0.08;
        targetYawOffset = 0.06;
      }
    }

    const smoothK = Math.min(1, delta * 10);
    this.forwardLean += (targetLean - this.forwardLean) * smoothK;
    this.strafeRoll += (targetRoll - this.strafeRoll) * smoothK;
    this.strafeYaw += (targetYawOffset - this.strafeYaw) * smoothK;

    // 5. Body Recoil & Damage Flinch Spring Damping
    if (this.bodyRecoilPitch > 0) {
      this.bodyRecoilPitch = Math.max(0, this.bodyRecoilPitch - delta * 9);
    }
    if (this.bodyRecoilZ > 0) {
      this.bodyRecoilZ = Math.max(0, this.bodyRecoilZ - delta * 9);
    }

    if (player.health < this.lastHealth) {
      this.damageFlinchTimer = 0.22;
    }
    this.lastHealth = player.health;

    let hurtFlinch = 0;
    if (this.damageFlinchTimer > 0) {
      this.damageFlinchTimer -= delta;
      hurtFlinch = Math.sin((this.damageFlinchTimer / 0.22) * Math.PI) * 0.08;
    }

    // 6. Melee Shove Forward Lunge
    let shoveOffsetZ = 0;
    let shoveLean = 0;
    if (isShoving) {
      const p = weapon.shoveTimer / weapon.shoveDuration;
      const shoveCurve = Math.sin(p * Math.PI);
      shoveOffsetZ = shoveCurve * 0.22;
      shoveLean = shoveCurve * 0.18;
    }

    // 7. Tactical ADS (Optical Scope / Aiming) Transition
    const targetAim = isAiming ? 1.0 : 0.0;
    this.aimTransition += (targetAim - this.aimTransition) * Math.min(1, delta * 12);

    // 8. 开源 CMU MoCap 动作捕捉动画驱动 (Biped Walk & Run Cycle)
    let motion = null;
    if (this.motionController) {
      this.fidgetTimer = 0;
      this.motionController.setLocomotionState(isMoving, isSprinting, player.isGrounded);
      motion = this.motionController.update(delta);

      // CMU MoCap 躯干自然位移与战术物理层叠加（落地缓冲、后坐力冲击、近战推击位移）
      this.animGroup.position.set(
        motion.strideX,
        motion.strideY - landingOffset,
        motion.strideZ - this.bodyRecoilZ + shoveOffsetZ
      );

      // 躯干姿态角绝对欧拉设定：前倾 + 瞄准俯仰 + 后坐硬直 - 突击俯身，消除任何累加发散
      const totalPitch = -this.forwardLean - motion.torsoLean - this.currentPitch * 0.35 + this.bodyRecoilPitch - hurtFlinch - shoveLean;
      const totalYaw = this.strafeYaw + motion.torsoYaw;
      const totalRoll = this.strafeRoll + motion.torsoRoll;
      this.animGroup.rotation.set(totalPitch, totalYaw, totalRoll);
    } else {
      // 降级回退：程序化平滑行走步态
      if (isMoving) {
        this.fidgetTimer = 0;
        const freq = isSprinting ? 12.5 : (isCrouching ? 6.5 : 8.5);
        this.walkPhase += delta * freq;

        const bounce = Math.abs(Math.sin(this.walkPhase)) * (isSprinting ? 0.055 : 0.028);
        const sway = Math.cos(this.walkPhase * 0.5) * (isSprinting ? 0.045 : 0.022);

        this.animGroup.position.set(
          -sway * 0.5,
          bounce - landingOffset,
          -this.bodyRecoilZ + shoveOffsetZ
        );
        this.animGroup.rotation.set(
          -this.forwardLean - this.currentPitch * 0.35 + this.bodyRecoilPitch - hurtFlinch - shoveLean,
          this.strafeYaw,
          sway * 0.5 + this.strafeRoll
        );
      } else {
        const breathe = Math.sin(this.idleTimer * 2.2) * 0.009;
        this.fidgetTimer += delta;

        let fidgetSwayZ = 0;
        if (this.fidgetTimer > 4.5) {
          const cycle = ((this.fidgetTimer - 4.5) % 6.0) / 6.0;
          if (cycle < 0.4) {
            fidgetSwayZ = Math.sin((cycle / 0.4) * Math.PI) * 0.025 * this.fidgetSide;
          } else if (cycle >= 0.98) {
            this.fidgetSide *= -1;
          }
        }

        this.animGroup.position.set(0, breathe - landingOffset, -this.bodyRecoilZ + shoveOffsetZ);
        this.animGroup.rotation.set(
          -this.currentPitch * 0.35 + this.bodyRecoilPitch - hurtFlinch - shoveLean,
          0,
          fidgetSwayZ
        );
      }
    }

    // 9. Leg Joint Articulation (CMU 动捕大腿/小腿/脚踝步态、跳跃蹬腿、深蹲与落地缓冲)
    this.updateJointPose(delta, player, isMoving, isSprinting, isCrouching, landingOffset, motion);

    // 10. Arm IK & Weapon Handling Pose
    this.updateArmPose(delta, player, weapon, isShoving, shoveOffsetZ);

    // 11. Angel Halo (keeps level in world space via haloWrapper, plus pulse & float)
    if (this.haloMesh) {
      const bobAmp = this.hasJointRig ? 0.025 : 0.025 / this.scale;
      this.haloMesh.position.y = this.haloBaseY + Math.sin(this.idleTimer * 3.0) * bobAmp;
      this.haloMesh.rotation.y = this.idleTimer * 0.6;
    }
    if (this.haloWrapper && this.hasJointRig) {
      this.haloWrapper.rotation.x = -this.hipJoint.rotation.x;
      this.haloWrapper.rotation.z = -this.animGroup.rotation.z;
    }
    if (this.haloLight) {
      this.haloLight.intensity = 1.0 + Math.sin(this.idleTimer * 4.0) * 0.35;
    }

    // 12. Third-Person Weapon Mount & Firing / CS:GO Reload Dynamics
    if (this.tpWeaponGroup) {
      // Recoil kickback on weapon
      if (this.recoilIntensity > 0) {
        this.recoilIntensity = Math.max(0, this.recoilIntensity - delta * 12);
        this.tpWeaponGroup.position.z = -this.recoilIntensity * 0.065;
        this.tpWeaponGroup.position.y = this.recoilIntensity * 0.025;
        this.tpWeaponGroup.rotation.x = this.recoilIntensity * 0.095;
      } else {
        this.tpWeaponGroup.position.set(0, 0, 0);
        this.tpWeaponGroup.rotation.set(0, 0, 0);
      }

      // Shove thrust on weapon
      if (isShoving) {
        this.tpWeaponGroup.position.z += shoveOffsetZ * 1.2;
      }

      // Aim Pitch & Tactical ADS alignment on weapon mount
      const pitchRot = -this.currentPitch * 0.75;
      this.weaponMount.rotation.x = pitchRot;
      this.weaponMount.rotation.y = -0.06;

      // Position: shifts towards eye-line when aiming (ADS)
      const baseMountX = 0.06 - this.aimTransition * 0.035;
      const baseMountY = 0.11 + this.aimTransition * 0.040;
      const baseMountZ = 0.25 + this.aimTransition * 0.025;
      this.weaponMount.position.set(baseMountX, baseMountY, baseMountZ);

      // CS:GO Multi-Stage Reload Weapon Shiver & Tilt
      if (weapon && weapon.isReloading) {
        const p = weapon.reloadTimer / weapon.reloadDuration;
        if (p < 0.22) {
          // Eject tilt
          const t = p / 0.22;
          this.tpWeaponGroup.rotation.z = Math.sin(t * Math.PI * 0.5) * 0.22;
          this.tpWeaponGroup.position.y -= Math.sin(t * Math.PI * 0.5) * 0.02;
        } else if (p < 0.55) {
          // Pouch reach tilt
          this.tpWeaponGroup.rotation.z = 0.22;
          this.tpWeaponGroup.position.y -= 0.02;
        } else if (p < 0.75) {
          // Mag slap impact shudder!
          const t = (p - 0.55) / 0.20;
          const slapShock = Math.sin(t * Math.PI * 3.0) * 0.04 * Math.exp(-t * 3.0);
          this.tpWeaponGroup.rotation.z = 0.22 * (1 - t) + slapShock;
          this.tpWeaponGroup.position.y = -0.02 * (1 - t) + slapShock * 0.5;
        } else if (p < 0.88) {
          // Bolt rack jerk
          const t = (p - 0.75) / 0.13;
          this.tpWeaponGroup.rotation.x = Math.sin(t * Math.PI) * 0.08;
          this.tpWeaponGroup.position.z -= Math.sin(t * Math.PI) * 0.03;
        }
      }
    }
  }

  /**
   * Express crouch, jump, and walking/running locomotion purely as joint rotations.
   * The character mesh itself is never scaled or deformed.
   */
  updateJointPose(delta, player, isMoving = false, isSprinting = false, isCrouching = false, landingOffset = 0, motion = null) {
    if (!this.hasJointRig) return;

    let targetTorsoRot = 0;
    let targetHipRotL = 0;
    let targetKneeRotL = 0;
    let targetAnkleRotL = 0;
    let targetHipRotR = 0;
    let targetKneeRotR = 0;
    let targetAnkleRotR = 0;

    if (!player.isGrounded) {
      // 空中：随垂直速度动态 tuck 双腿收缩
      const airVel = player.velocity ? player.velocity.y : 0;
      const tuckMod = Math.min(0.25, Math.max(-0.25, airVel * 0.03));
      targetTorsoRot = -0.06;
      targetHipRotL = targetHipRotR = -0.32 - tuckMod;
      targetKneeRotL = targetKneeRotR = 0.95 + tuckMod * 1.5;
      targetAnkleRotL = targetAnkleRotR = -0.65;
    } else if (this.crouchDepth > 0.001) {
      // 战术深蹲：双腿屈膝下压，双脚掌贴平地面
      const d = this.crouchDepth;
      const thetaH = Math.min(d * 3.6, 0.85);
      const cosGamma = (this.hipAnkleLen - d - this.thighLen * Math.cos(thetaH)) / this.shinLen;
      const gamma = Math.acos(THREE.MathUtils.clamp(cosGamma, -1, 1));
      targetTorsoRot = -thetaH * 0.35;
      targetHipRotL = -thetaH * 0.65;
      targetHipRotR = -thetaH * 0.65;
      targetKneeRotL = thetaH + gamma;
      targetKneeRotR = thetaH + gamma;
      targetAnkleRotL = -gamma;
      targetAnkleRotR = -gamma;

      // 静步蹲走交替步态节奏
      if (isMoving) {
        const crouchStride = Math.sin(this.walkPhase) * 0.08;
        targetHipRotL += crouchStride;
        targetHipRotR -= crouchStride;
        targetKneeRotL += Math.max(0, crouchStride) * 0.3;
        targetKneeRotR += Math.max(0, -crouchStride) * 0.3;
      }
    } else if (motion && motion.weightActive > 0.01) {
      // 开源 CMU MoCap 双足人体动捕步态曲线驱动左右大腿、小腿与脚掌交叉运动
      targetHipRotL = motion.legHipL !== undefined ? motion.legHipL : motion.legHip;
      targetKneeRotL = motion.legKneeL !== undefined ? motion.legKneeL : motion.legKnee;
      targetAnkleRotL = motion.legAnkleL !== undefined ? motion.legAnkleL : motion.legAnkle;

      targetHipRotR = motion.legHipR !== undefined ? motion.legHipR : -motion.legHip;
      targetKneeRotR = motion.legKneeR !== undefined ? motion.legKneeR : motion.legKnee;
      targetAnkleRotR = motion.legAnkleR !== undefined ? motion.legAnkleR : -motion.legAnkle;
    } else if (isMoving) {
      // 降级回退步态（左右腿反相 180 度交叉迈步与交替屈膝）
      const strideHip = Math.sin(this.walkPhase) * (isSprinting ? 0.35 : 0.22);
      targetHipRotL = strideHip;
      targetHipRotR = -strideHip;

      const swingL = Math.max(0, Math.cos(this.walkPhase));
      const swingR = Math.max(0, -Math.cos(this.walkPhase));
      targetKneeRotL = Math.pow(swingL, 1.2) * (isSprinting ? 0.65 : 0.44) + 0.04;
      targetKneeRotR = Math.pow(swingR, 1.2) * (isSprinting ? 0.65 : 0.44) + 0.04;

      targetAnkleRotL = -targetKneeRotL * 0.68 - targetHipRotL * 0.25;
      targetAnkleRotR = -targetKneeRotR * 0.68 - targetHipRotR * 0.25;
    }

    // 落地弹簧缓冲冲击
    if (landingOffset > 0.001) {
      const comp = (landingOffset / 0.24) * 0.45;
      targetTorsoRot -= comp * 0.25;
      targetHipRotL -= comp * 0.35;
      targetHipRotR -= comp * 0.35;
      targetKneeRotL += comp;
      targetKneeRotR += comp;
      targetAnkleRotL -= comp * 0.5;
      targetAnkleRotR -= comp * 0.5;
    }

    const k = Math.min(1, delta * 14);
    if (this.hipJoint) this.hipJoint.rotation.x += (targetTorsoRot - this.hipJoint.rotation.x) * k;
    if (this.hipJointL) this.hipJointL.rotation.x += (targetHipRotL - this.hipJointL.rotation.x) * k;
    if (this.kneeJointL) this.kneeJointL.rotation.x += (targetKneeRotL - this.kneeJointL.rotation.x) * k;
    if (this.ankleJointL) this.ankleJointL.rotation.x += (targetAnkleRotL - this.ankleJointL.rotation.x) * k;
    if (this.hipJointR) this.hipJointR.rotation.x += (targetHipRotR - this.hipJointR.rotation.x) * k;
    if (this.kneeJointR) this.kneeJointR.rotation.x += (targetKneeRotR - this.kneeJointR.rotation.x) * k;
    if (this.ankleJointR) this.ankleJointR.rotation.x += (targetAnkleRotR - this.ankleJointR.rotation.x) * k;
  }

  /**
   * 手臂姿态驱动：瞄准俯仰、走路双手持枪跟随、后坐冲击、近战推击、多阶段战术换弹。
   */
  updateArmPose(delta, player, weapon, isShoving = false, shoveOffsetZ = 0) {
    if (!this.hasArmRig || !this.armBones) return;

    this.weaponMount.updateMatrixWorld(true);
    this.tpWeaponGroup.updateMatrixWorld(true);
    if (this.hipJoint) this.hipJoint.updateMatrixWorld(true);

    const isReloading = weapon && weapon.isReloading;
    const reloadProgress = isReloading && weapon.reloadDuration ? (weapon.reloadTimer / weapon.reloadDuration) : 0;

    // 握把与扳机插槽（右手握持握把、食指扣入扳机护圈贴合扳机）
    const localGrip = new THREE.Vector3(0.014, -0.045, -0.095);
    // 护木托枪插槽（左手托扶护木下方，手心朝上托枪）
    const localGuard = new THREE.Vector3(-0.015, -0.038, 0.065);

    const gripWorld = new THREE.Vector3();
    const guardWorld = new THREE.Vector3();
    this.tpWeaponGroup.localToWorld(gripWorld.copy(localGrip));
    this.tpWeaponGroup.localToWorld(guardWorld.copy(localGuard));

    // IK 求解空间必须是 shoulder.parent 的局部空间（armIK 契约）：新骨架里肩挂在
    // spine 下，若按 hip 空间求解，目标会被动抬高一截脊柱偏移（~21cm），手臂伸直上指；
    // 一俯仰/前倾，目标还会绕 21cm 杠杆乱甩、手肘乱折。老 rig（肩直接挂 hip）才用 hip。
    const ikRef = this.spineJoint || this.hipJoint;
    const gripTarget = ikRef.worldToLocal(gripWorld.clone());
    const guardTarget = ikRef.worldToLocal(guardWorld.clone());

    // 换弹时左手完整多阶段战术运动轨迹（拔匣 -> 取新弹匣 -> 拍入井口 -> 拉拉机柄 -> 回位）
    const leftTarget = guardTarget.clone();
    if (isReloading) {
      if (reloadProgress < 0.22) {
        // Stage 1: 移至弹匣底板，拔出空弹匣
        const t = reloadProgress / 0.22;
        leftTarget.y -= Math.sin(t * Math.PI * 0.5) * 0.12;
        leftTarget.z -= Math.sin(t * Math.PI * 0.5) * 0.05;
      } else if (reloadProgress < 0.52) {
        // Stage 2: 探向战术腰包拔取新弹匣
        const t = (reloadProgress - 0.22) / 0.30;
        leftTarget.x -= 0.05;
        leftTarget.y = guardTarget.y - 0.22 - Math.sin(t * Math.PI) * 0.04;
        leftTarget.z = guardTarget.z + 0.05;
      } else if (reloadProgress < 0.74) {
        // Stage 3: 将新弹匣强力拍入弹匣井
        const t = (reloadProgress - 0.52) / 0.22;
        leftTarget.x = guardTarget.x - 0.05 * (1 - t);
        leftTarget.y = THREE.MathUtils.lerp(guardTarget.y - 0.22, guardTarget.y - 0.05, t);
        leftTarget.z = THREE.MathUtils.lerp(guardTarget.z + 0.05, guardTarget.z, t);
      } else if (reloadProgress < 0.88) {
        // Stage 4: 快速向上拉栓/拍击拉机柄上膛
        const t = (reloadProgress - 0.74) / 0.14;
        leftTarget.x -= 0.02;
        leftTarget.y = guardTarget.y + 0.02;
        leftTarget.z = guardTarget.z - 0.06 * Math.sin(t * Math.PI);
      } else {
        // Stage 5: 平稳回到护木下方稳固托枪
        const t = (reloadProgress - 0.88) / 0.12;
        leftTarget.lerpVectors(new THREE.Vector3(guardTarget.x - 0.02, guardTarget.y + 0.02, guardTarget.z), guardTarget, t);
      }
    }

    // pole 点同样要换算到 shoulder.parent 空间：只差一个脊柱偏移平移，相对几何保持不变
    const spineOff = this.spineJoint ? this.spineJoint.position.clone() : new THREE.Vector3();
    const poleR = new THREE.Vector3(0.32, -0.08, 0.08).sub(spineOff);
    const poleL = new THREE.Vector3(-0.28, -0.15, 0.12).sub(spineOff);

    // 两骨解析 IK 求解右臂与左臂
    solveTwoBoneIK({
      shoulder: this.armBones.shoulderR,
      elbow: this.armBones.elbowR,
      hand: this.armBones.handR,
      target: gripTarget,
      pole: poleR,
    });

    solveTwoBoneIK({
      shoulder: this.armBones.shoulderL,
      elbow: this.armBones.elbowL,
      hand: this.armBones.handL,
      target: leftTarget,
      pole: poleL,
    });

    // 手腕姿态微调：保持手腕与袖口自然衔接，避免手腕大幅翻转撕裂袖口
    if (this.armBones.handR) {
      this.armBones.handR.rotation.set(-0.18, 0.12, -0.15);
    }
    if (this.armBones.handL) {
      const wristRotZ = isReloading && reloadProgress < 0.74 ? 0.10 : 0.22;
      const wristRotX = isReloading && reloadProgress < 0.74 ? 0.08 : 0.16;
      this.armBones.handL.rotation.set(wristRotX, -0.15, wristRotZ);
    }
  }

  destroy() {
    if (this.motionController) {
      this.motionController.destroy();
      this.motionController = null;
    }
    if (this.root && this.root.parent) {
      this.root.parent.remove(this.root);
    }
  }
}
