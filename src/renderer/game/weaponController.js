import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { soundEngine } from '../audio/soundFX.js';
import { solveTwoBoneIK } from './armIK.js';
import { buildLimbBones } from './limbRig.js';
import { buildFirstPersonArm, extractArmData } from './skinnedMeshRig.js';

export class WeaponController {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;

    // 3-Tier Weapon Hierarchy (Section 2: Anchor -> Motion -> Model)
    // Tier 1: WeaponAnchor - Base mounting posture (Hipfire / ADS / Tactical Sprint)
    this.weaponAnchor = new THREE.Group();
    this.camera.add(this.weaponAnchor);

    // Tier 2: WeaponMotion - Second-order spring-damper physical recoil, inertia lag, and walking bob
    this.weaponMotion = new THREE.Group();
    this.weaponAnchor.add(this.weaponMotion);

    // Tier 3: ViewmodelRoot - Contains gun meshes, magazine, muzzle flash, flashlight
    this.viewmodelRoot = new THREE.Group();
    this.weaponMotion.add(this.viewmodelRoot);

    this.weaponMesh = null;
    this.muzzleLight = null;
    this.muzzleSprite = null;
    this.flashlight = null;

    // Weapon positions (Hipfire vs ADS vs Tactical Sprint - pulled back for clean view)
    this.hipPos = new THREE.Vector3(0.11, -0.12, -0.32);
    this.hipRot = new THREE.Euler(0.04, -0.05, 0.02);

    this.adsPos = new THREE.Vector3(0.0, -0.095, -0.28);
    this.adsRot = new THREE.Euler(0.0, 0.0, 0.0);

    this.sprintPos = new THREE.Vector3(0.13, -0.20, -0.26);
    this.sprintRot = new THREE.Euler(-0.25, -0.38, 0.32);

    this.currentPos = this.hipPos.clone();
    this.currentRot = this.hipRot.clone();

    // Weapon Weight & Recoil Spring Configuration (Enhanced for intense gun shake!)
    this.cfg = {
      recoilDistance: 0.125,    // 12.5 cm violent rearward kick on the gun
      recoilPitch: 0.08,        // ~4.6 deg snappy barrel climb
      recoilYaw: 0.024,         // ~1.4 deg random horizontal kick
      recoilRoll: 0.048,        // ~2.8 deg torque twist
      springStiffness: 220,     // Snappy restoration
      springDamping: 26,        // Crisp, punchy settling
      walkBobAmplitude: 0.012,  // Natural walking weight
      walkFrequency: 8.5,       // Stride rhythm
      movementLag: 0.035,       // Mass inertia lag
    };

    // Physics Recoil Springs: { x: displacement, v: velocity }
    this.springZ = { x: 0, v: 0 };      // Backward recoil kick
    this.springPitch = { x: 0, v: 0 };  // Vertical barrel climb
    this.springYaw = { x: 0, v: 0 };    // Horizontal kick
    this.springRoll = { x: 0, v: 0 };   // Torque twist

    // High-Frequency Mechanical Gun Shaking & Bolt Cycling Vibration
    this.gunVibeTimer = 0;
    this.gunVibeDuration = 0.085; // 85ms rapid cycling shake
    this.gunVibeIntensity = 0;
    this.gunVibeOffset = new THREE.Vector3();
    this.gunVibeRot = new THREE.Euler();

    // Movement Inertia Lag Springs (Weapon physical mass resisting sudden movement)
    this.lagX = { x: 0, v: 0 };
    this.lagY = { x: 0, v: 0 };
    this.lagZ = { x: 0, v: 0 };

    // Dynamic Step Bobbing Phase and Springs
    this.walkPhase = 0;
    this.bobX = { x: 0, v: 0 };
    this.bobY = { x: 0, v: 0 };

    // Skeletal Animation Support (for any pre-rigged animated GLBs)
    this.mixer = null;
    this.animations = {};

    // Stats
    this.damage = 45;
    this.headshotMultiplier = 3.0;
    this.fireRate = 0.095; // Seconds per shot (~630 RPM)
    this.lastShotTime = 0;
    this.maxMag = 30;
    this.currentAmmo = 30;
    this.reserveAmmo = 180;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 2.4;
    this.hasEjectedMag = false;
    this.hasInsertedMag = false;
    this.hasRackedBolt = false;

    // Aiming state
    this.isAiming = false;
    this.isFiring = false;
    this.isShoving = false;
    this.shoveTimer = 0;
    this.shoveDuration = 0.45;

    // Recoil state
    this.recoilOffset = new THREE.Vector3();
    this.recoilRot = new THREE.Euler();
    this.recoilSpread = 0;

    // Weapon sway
    this.swayTargetX = 0;
    this.swayTargetY = 0;
    this.swayCurrentX = 0;
    this.swayCurrentY = 0;

    // Callbacks
    this.player = null;
    this.onHitCallback = null;
    this.onShoveCallback = null;
    this.onFireCallback = null;
    this.onEjectMagazineCallback = null;
    this.onDisassembled = null;

    // Disassembled magazine and body parts
    this.weaponBodyMesh = null;
    this.magazineMesh = null;
    this.standaloneMagGeo = null;
    this.weaponMaterial = null;
    this.modelScale = 1;

    // Viewmodel Character Arms Rig (Extracted arms holding the rifle)
    this.viewmodelArms = null;
    this.vmArmBones = null;
    this.targetHandR = new THREE.Vector3(0.015, -0.055, 0.055);
    this.targetHandL = new THREE.Vector3(-0.038, -0.040, -0.210);
    this.poleR = new THREE.Vector3(0.6, -0.85, -0.1);
    this.poleL = new THREE.Vector3(-0.75, -0.85, -0.1);

    this.loadWeaponModel();
    this.initEvents();

    // Fallback: If arms are not passed by characterModel within 1.2s, extract directly
    setTimeout(() => {
      if (!this.viewmodelArms) {
        this.loadFallbackArms();
      }
    }, 1200);
  }

  disassembleWeapon(mesh) {
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    const normAttr = geo.attributes.normal;
    const uvAttr = geo.attributes.uv;
    const idxAttr = geo.index;
    const triCount = idxAttr.count / 3;

    // 1. Find triangle with lowest vertex (baseplate of magazine)
    let lowestTri = -1;
    let minZ = Infinity;
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const v = idxAttr.getX(t * 3 + k);
        const z = posAttr.getZ(v);
        if (z < minZ) {
          minZ = z;
          lowestTri = t;
        }
      }
    }

    // 2. Build coincident vertex mapping across UV seams
    const vertToCoincident = new Int32Array(posAttr.count);
    const posKeyToFirstVert = new Map();
    for (let i = 0; i < posAttr.count; i++) {
      const kx = Math.round(posAttr.getX(i) * 10000);
      const ky = Math.round(posAttr.getY(i) * 10000);
      const kz = Math.round(posAttr.getZ(i) * 10000);
      const key = `${kx},${ky},${kz}`;
      if (posKeyToFirstVert.has(key)) {
        vertToCoincident[i] = posKeyToFirstVert.get(key);
      } else {
        posKeyToFirstVert.set(key, i);
        vertToCoincident[i] = i;
      }
    }

    // 3. Map coincident vertices to triangles
    const vertToTriangles = new Map();
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const v = vertToCoincident[idxAttr.getX(t * 3 + k)];
        if (!vertToTriangles.has(v)) vertToTriangles.set(v, []);
        vertToTriangles.get(v).push(t);
      }
    }

    // 4. Flood fill to find all connected magazine triangles
    const magTriSet = new Set();
    const queue = [lowestTri];
    magTriSet.add(lowestTri);
    while (queue.length > 0) {
      const curr = queue.pop();
      for (let k = 0; k < 3; k++) {
        const v = vertToCoincident[idxAttr.getX(curr * 3 + k)];
        const neighbors = vertToTriangles.get(v) || [];
        for (const nb of neighbors) {
          if (!magTriSet.has(nb)) {
            magTriSet.add(nb);
            queue.push(nb);
          }
        }
      }
    }

    console.log(`[WeaponController] Disassembled weapon: Mag triangles = ${magTriSet.size}, Body triangles = ${triCount - magTriSet.size}`);

    // 5. Build separate index buffers
    const bodyIndices = [];
    const magIndices = [];
    for (let t = 0; t < triCount; t++) {
      const i0 = idxAttr.getX(t * 3);
      const i1 = idxAttr.getX(t * 3 + 1);
      const i2 = idxAttr.getX(t * 3 + 2);
      if (magTriSet.has(t)) {
        magIndices.push(i0, i1, i2);
      } else {
        bodyIndices.push(i0, i1, i2);
      }
    }

    // 6. Create Rifle Body Geometry
    const bodyGeo = geo.clone();
    bodyGeo.setIndex(bodyIndices);

    // 7. Create In-Gun Magazine Geometry (sits exactly in magwell)
    const inGunMagGeo = geo.clone();
    inGunMagGeo.setIndex(magIndices);

    // 8. Create Standalone Centered Magazine Geometry (for hands & physics floor drops)
    const standaloneMagGeo = new THREE.BufferGeometry();
    const oldToNewVert = new Map();
    const newPositions = [];
    const newNormals = [];
    const newUvs = [];
    const newIndices = [];

    for (let i = 0; i < magIndices.length; i++) {
      const oldIdx = magIndices[i];
      let newIdx = oldToNewVert.get(oldIdx);
      if (newIdx === undefined) {
        newIdx = newPositions.length / 3;
        oldToNewVert.set(oldIdx, newIdx);
        newPositions.push(posAttr.getX(oldIdx), posAttr.getY(oldIdx), posAttr.getZ(oldIdx));
        if (normAttr) newNormals.push(normAttr.getX(oldIdx), normAttr.getY(oldIdx), normAttr.getZ(oldIdx));
        if (uvAttr) newUvs.push(uvAttr.getX(oldIdx), uvAttr.getY(oldIdx));
      }
      newIndices.push(newIdx);
    }

    standaloneMagGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    if (newNormals.length > 0) standaloneMagGeo.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
    if (newUvs.length > 0) standaloneMagGeo.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
    standaloneMagGeo.setIndex(newIndices);
    standaloneMagGeo.center();
    standaloneMagGeo.rotateX(Math.PI / 2); // Orient so Y is height

    const bodyMesh = new THREE.Mesh(bodyGeo, mesh.material);
    const magMesh = new THREE.Mesh(inGunMagGeo, mesh.material);

    bodyMesh.castShadow = false;
    bodyMesh.receiveShadow = false;
    magMesh.castShadow = false;
    magMesh.receiveShadow = false;

    return {
      bodyMesh,
      magMesh,
      standaloneMagGeo,
      material: mesh.material,
    };
  }

  loadWeaponModel() {
    const loader = new GLTFLoader();
    const tryPaths = [
      './models/weapon.glb',
      './models/blue_archive_weapon_-_sunaookami_shiroko.glb',
    ];

    const tryLoad = (idx) => {
      if (idx >= tryPaths.length) {
        console.error('[WeaponController] All weapon model paths failed to load!');
        return;
      }
      const modelPath = tryPaths[idx];
      loader.load(
        modelPath,
        (gltf) => {
          console.log('[WeaponController] Gun model loaded successfully:', modelPath);
          this.initWeaponMesh(gltf);
        },
        undefined,
        (err) => {
          console.warn(`[WeaponController] Failed loading ${modelPath}, trying next...`, err);
          tryLoad(idx + 1);
        }
      );
    };

    tryLoad(0);
  }

  initWeaponMesh(gltf) {
    const model = gltf.scene;

    // Enhance materials for bright, crisp rendering in hands
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        if (child.material) {
          child.material.roughness = 0.85;
          child.material.metalness = 0.15;
          child.material.depthTest = true;
          child.material.depthWrite = true;
          child.material.needsUpdate = true;
        }
      }
    });

    // Find original weapon mesh
    let originalMesh = null;
    model.traverse((child) => {
      if (child.isMesh && !originalMesh) {
        originalMesh = child;
      }
    });

    // Disassemble weapon: separate the 30-round magazine from the rifle body!
    if (originalMesh) {
      const disassembled = this.disassembleWeapon(originalMesh);
      const parent = originalMesh.parent;
      parent.remove(originalMesh);
      parent.add(disassembled.bodyMesh);
      parent.add(disassembled.magMesh);

      this.weaponBodyMesh = disassembled.bodyMesh;
      this.magazineMesh = disassembled.magMesh;
      this.standaloneMagGeo = disassembled.standaloneMagGeo;
      this.weaponMaterial = disassembled.material;
    }

    // Compute bounding box
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Center model around its origin
    model.position.sub(center);

    // Container pivot for proper orientation
    const weaponPivot = new THREE.Group();
    weaponPivot.add(model);

    // Orient weapon: raw model has muzzle at -X.
    // Rotate by -90 deg around Y so barrel points directly forward along -Z!
    model.rotation.y = -Math.PI / 2;

    // Scale weapon nicely so it fits the FPS view (~0.72m long)
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 0.72 / maxDim : 1;
    model.scale.setScalar(scale);
    this.modelScale = scale;

    // Notify external handlers (impactFX)
    if (this.onDisassembled && this.standaloneMagGeo && this.weaponMaterial) {
      this.onDisassembled(this.standaloneMagGeo, this.weaponMaterial, scale);
    }

    // Check for skeletal animations inside GLB (auto-support for rigged weapon/hands packs)
    if (gltf.animations && gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => {
        const action = this.mixer.clipAction(clip);
        this.animations[clip.name.toLowerCase()] = action;
      });
      console.log(`[WeaponController] Loaded ${gltf.animations.length} skeletal animations:`, Object.keys(this.animations));
      const idleAction = this.animations['idle'] || Object.values(this.animations)[0];
      if (idleAction) idleAction.play();
    }

    this.weaponMesh = weaponPivot;
    this.viewmodelRoot.add(weaponPivot);

    this.viewmodelRoot.position.set(0, 0, 0);
    this.viewmodelRoot.rotation.set(0, 0, 0);
    this.weaponAnchor.position.copy(this.hipPos);
    this.weaponAnchor.rotation.copy(this.hipRot);

    // Dedicated viewmodel lights: soft diffuse lighting without harsh specular glare
    const gunKeyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    gunKeyLight.position.set(0.6, 1.2, 0.4);
    this.viewmodelRoot.add(gunKeyLight);

    const gunAmbient = new THREE.AmbientLight(0xffffff, 1.6);
    this.viewmodelRoot.add(gunAmbient);

    // Setup Muzzle Flash
    this.setupMuzzleFlash();

    // Setup Tactical Flashlight
    this.setupFlashlight();

    if (this.viewmodelArms) {
      this.updateViewmodelArms(0);
    }
  }

  attachCharacterArms(armSource, armRig, material) {
    if (!armSource || !armRig) return;
    if (this.viewmodelArms) {
      this.viewmodelRoot.remove(this.viewmodelArms);
      this.viewmodelArms = null;
    }

    const armGroup = new THREE.Group();
    armGroup.name = 'ViewmodelArms';

    const armMat = material ? material.clone() : new THREE.MeshStandardMaterial({
      color: 0xffffff,
    });
    armMat.roughness = 1.0; // 100% 漫反射哑光，消除手臂反光
    armMat.metalness = 0.0; // 零金属度，纯净二次元动漫渲染
    armMat.depthTest = true;
    armMat.depthWrite = true;
    armMat.side = THREE.DoubleSide;

    const armScaleR = 0.84;
    const armScaleL = 0.88;

    // Palm centroids relative to the wrist joint, in model units (anatomically calibrated)
    const palmOffsetR = new THREE.Vector3(0.025, -0.018, 0.010);
    const palmOffsetL = new THREE.Vector3(-0.035, -0.018, -0.012);

    // ── 优先使用 SkinnedMesh + Skeleton + Bone 连续蒙皮双臂架构 ─────────────────
    if (armSource.R && armSource.R.flatIndices && armSource.bodyGeo) {
      this.armR = buildFirstPersonArm({
        side: 'R',
        bodyGeo: armSource.bodyGeo,
        bodyMatrixWorld: armSource.bodyMatrixWorld,
        armData: armSource.R,
        material: armMat,
        scale: armScaleR,
        palmOffset: palmOffsetR,
        restPalm: this.targetHandR,
        shoulderDir: new THREE.Vector3(0.38, -0.52, 0.38),
        poleDir: this.poleR,
        handEuler: new THREE.Euler(2.86, 0.16, 2.96),
      });

      this.armL = buildFirstPersonArm({
        side: 'L',
        bodyGeo: armSource.bodyGeo,
        bodyMatrixWorld: armSource.bodyMatrixWorld,
        armData: armSource.L,
        material: armMat,
        scale: armScaleL,
        palmOffset: palmOffsetL,
        restPalm: this.targetHandL,
        shoulderDir: new THREE.Vector3(-0.48, -0.62, 0.55),
        poleDir: this.poleL,
        handEuler: new THREE.Euler(1.46, -0.34, 2.36),
      });

      if (this.armR && this.armR.root) armGroup.add(this.armR.root);
      if (this.armL && this.armL.root) armGroup.add(this.armL.root);

      this.viewmodelArms = armGroup;
      this.viewmodelRoot.add(this.viewmodelArms);

      this.updateViewmodelArms(0);
      console.log('[WeaponController] Viewmodel SkinnedMesh arms mounted with Bone/Skeleton/SkinnedMesh!');
      return;
    }

    // ── 降级兼容：分段刚性网格 ──────────────────────────────────────────────
    const armSegmentMeshes = armSource;
    const buildIKArm = ({ side, scale, palmOffset, restPalm, shoulderDir, poleDir, handEuler, upper, fore, hand }) => {
      const bindUpper = new THREE.Vector3().subVectors(armRig.boneAbs[`elbow${side}`], armRig.boneAbs[`shoulder${side}`]);
      const bindLower = new THREE.Vector3().subVectors(armRig.boneAbs[`hand${side}`], armRig.boneAbs[`elbow${side}`]);
      const reach = (bindUpper.length() + bindLower.length()) * scale;

      const shoulderVM = restPalm.clone().addScaledVector(shoulderDir.clone().normalize(), reach * 0.85);

      const root = new THREE.Group();
      root.name = `vm_arm_${side}`;
      root.position.copy(shoulderVM);
      root.scale.setScalar(scale);

      const shoulder = new THREE.Group();
      shoulder.name = `vm_shoulder_${side}`;
      shoulder.position.set(0, 0, 0);

      const elbow = new THREE.Group();
      elbow.name = `vm_elbow_${side}`;
      elbow.position.copy(bindUpper);

      const wrist = new THREE.Group();
      wrist.name = `vm_wrist_${side}`;
      wrist.position.copy(bindLower);
      wrist.quaternion.setFromEuler(handEuler);

      shoulder.add(elbow);
      elbow.add(wrist);
      root.add(shoulder);

      const pole = poleDir.clone().normalize();

      if (upper) {
        const upperMesh = new THREE.Mesh(upper.geometry.clone(), armMat);
        upperMesh.frustumCulled = false;
        shoulder.add(upperMesh);
      }
      const foreMesh = new THREE.Mesh(fore.geometry.clone(), armMat);
      foreMesh.frustumCulled = false;
      elbow.add(foreMesh);
      const handMesh = new THREE.Mesh(hand.geometry.clone(), armMat);
      handMesh.frustumCulled = false;
      wrist.add(handMesh);

      armGroup.add(root);
      return {
        scale,
        palmOffset: palmOffset.clone(),
        pole,
        shoulder,
        elbow,
        wrist,
        smooth: restPalm.clone(),
        shoulderVM: shoulderVM.clone(),
        handEuler: handEuler.clone(),
      };
    };

    this.armR = buildIKArm({
      side: 'R',
      scale: armScaleR,
      palmOffset: palmOffsetR,
      restPalm: this.targetHandR,
      shoulderDir: new THREE.Vector3(0.38, -0.52, 0.38),
      poleDir: this.poleR,
      handEuler: new THREE.Euler(2.86, 0.16, 2.96),
      upper: null,
      fore: armSegmentMeshes.R ? armSegmentMeshes.R.fore : null,
      hand: armSegmentMeshes.R ? armSegmentMeshes.R.hand : null,
    });

    this.armL = buildIKArm({
      side: 'L',
      scale: armScaleL,
      palmOffset: palmOffsetL,
      restPalm: this.targetHandL,
      shoulderDir: new THREE.Vector3(-0.48, -0.62, 0.55),
      poleDir: this.poleL,
      handEuler: new THREE.Euler(1.46, -0.34, 2.36),
      upper: null,
      fore: armSegmentMeshes.L ? armSegmentMeshes.L.fore : null,
      hand: armSegmentMeshes.L ? armSegmentMeshes.L.hand : null,
    });

    this.viewmodelArms = armGroup;
    this.viewmodelRoot.add(this.viewmodelArms);

    this.updateViewmodelArms(0);
  }

  loadFallbackArms() {
    if (this.viewmodelArms) return;
    const loader = new GLTFLoader();
    const tryPaths = [
      './models/koharu.glb',
      './models/blue_archive_-koharu-__cb_default_emotion.glb',
    ];

    const tryLoad = (idx) => {
      if (idx >= tryPaths.length || this.viewmodelArms) return;
      const modelPath = tryPaths[idx];
      loader.load(
        modelPath,
        (gltf) => {
          if (this.viewmodelArms) return;
          console.log('[WeaponController] Fallback Koharu model loaded for arms:', modelPath);
          const model = gltf.scene;

          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          box.getSize(size);
          const center = new THREE.Vector3();
          box.getCenter(center);
          const targetHeight = 1.48;
          const scale = size.y > 0 ? targetHeight / size.y : 1;
          model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
          model.scale.setScalar(scale);
          model.updateMatrixWorld(true);

          let bodyMesh = null;
          model.traverse((c) => {
            if (c.isMesh && c.material && c.material.name === 'body' && !bodyMesh) {
              bodyMesh = c;
            }
          });

          if (bodyMesh && bodyMesh.geometry.index) {
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

            const armDataR = extractArmData('R', bodyPositions, bodyIndices, targetHeight, rigHalfWidth, rigHalfDepth);
            const armDataL = extractArmData('L', bodyPositions, bodyIndices, targetHeight, rigHalfWidth, rigHalfDepth);

            if (armDataR && armDataL) {
              this.attachCharacterArms({
                R: armDataR,
                L: armDataL,
                bodyGeo: bodyMesh.geometry,
                bodyMatrixWorld: bodyMesh.matrixWorld,
              }, { ok: true }, bodyMesh.material);
            } else {
              const dummyHip = new THREE.Group();
              const armRig = buildLimbBones(
                bodyMesh.geometry,
                bodyMesh.matrixWorld,
                dummyHip,
                new THREE.Vector3(0, targetHeight * 0.375, 0),
                targetHeight,
                rigHalfWidth,
                rigHalfDepth,
                bodyPositions,
                bodyIndices,
                bodyMesh.material
              );

              if (armRig && armRig.ok) {
                this.attachCharacterArms(armRig.segmentMeshes, armRig, bodyMesh.material);
              }
            }
          }
        },
        undefined,
        () => tryLoad(idx + 1)
      );
    };

    tryLoad(0);
  }

  updateViewmodelArms(delta) {
    if (!this.armR || !this.armL) return;

    // Right palm stays on the pistol grip
    const targetR = this.targetHandR.clone();

    // Left palm rests on the handguard, or follows the reload / shove overrides
    const targetL = this.targetHandL.clone();

    if (this.isReloading && this.reloadDuration > 0) {
      const progress = this.reloadTimer / this.reloadDuration;
      if (progress < 0.16) {
        // Slide left hand from handguard to magazine base
        const t = progress / 0.16;
        targetL.lerp(new THREE.Vector3(-0.018, -0.095, 0.01), t);
      } else if (progress < 0.34) {
        // Pulling out magazine downward
        const s = (progress - 0.16) / 0.18;
        targetL.set(-0.018, -0.095 - s * 0.12, 0.01);
      } else if (progress < 0.65) {
        // Reaching down to pouch
        const s = (progress - 0.34) / 0.31;
        targetL.set(-0.06, -0.22 - Math.sin(s * Math.PI) * 0.04, 0.05);
      } else if (progress < 0.72) {
        // Slamming fresh mag into magwell
        const s = (progress - 0.65) / 0.07;
        targetL.lerpVectors(new THREE.Vector3(-0.06, -0.22, 0.05), new THREE.Vector3(-0.018, -0.095, 0.01), s);
      } else if (progress < 0.82) {
        // Bolt release slap (along left side of receiver without clipping through it)
        const s = (progress - 0.72) / 0.10;
        targetL.lerpVectors(new THREE.Vector3(-0.018, -0.095, 0.01), new THREE.Vector3(-0.036, -0.018, -0.04), s);
      } else {
        // Returning to handguard
        const s = (progress - 0.82) / 0.18;
        targetL.lerpVectors(new THREE.Vector3(-0.036, -0.018, -0.04), this.targetHandL, s);
      }
    } else if (this.isShoving) {
      targetL.set(-0.038, -0.030, -0.220);
    }

    // Ease the palm targets so state changes blend instead of snapping (first call snaps: delta = 0)
    const followRate = 14;
    const k = delta > 0 ? 1 - Math.exp(-followRate * Math.min(delta, 0.05)) : 1;
    this.armR.smooth.lerp(targetR, k);
    this.armL.smooth.lerp(targetL, k);

    this.solveViewmodelArm(this.armR, this.armR.smooth);
    this.solveViewmodelArm(this.armL, this.armL.smooth);
  }

  solveViewmodelArm(arm, palmTarget) {
    if (!arm || !arm.shoulder || !arm.elbow || !arm.wrist) return;

    // 维持手部朝向，防止解析过程中累积漂移
    if (arm.handEuler) {
      arm.wrist.quaternion.setFromEuler(arm.handEuler);
    }

    // 将 viewmodel 空间的 palmTarget 转换到 arm root 局部空间（肩关节位于局部原点 (0,0,0)）
    const grip = (arm.shoulderVM ? palmTarget.clone().sub(arm.shoulderVM) : palmTarget.clone()).divideScalar(arm.scale);
    const qHand = new THREE.Quaternion()
      .copy(arm.shoulder.quaternion)
      .multiply(arm.elbow.quaternion)
      .multiply(arm.wrist.quaternion);

    // DEBUG (一次性输出)
    if (!arm._debugOnce) {
      arm._debugOnce = true;
      const L1 = arm.elbow.position.length();
      const L2 = arm.wrist.position.length();
      console.log(`[solveViewmodelArm ${arm.side}] palmTarget:`, palmTarget);
      console.log(`[solveViewmodelArm ${arm.side}] shoulderVM:`, arm.shoulderVM);
      console.log(`[solveViewmodelArm ${arm.side}] grip (in root):`, grip);
      console.log(`[solveViewmodelArm ${arm.side}] shoulder.pos:`, arm.shoulder.position);
      console.log(`[solveViewmodelArm ${arm.side}] elbow.pos:`, arm.elbow.position, 'L1:', L1.toFixed(4));
      console.log(`[solveViewmodelArm ${arm.side}] wrist.pos:`, arm.wrist.position, 'L2:', L2.toFixed(4));
      console.log(`[solveViewmodelArm ${arm.side}] palmOffset:`, arm.palmOffset);
      console.log(`[solveViewmodelArm ${arm.side}] pole:`, arm.pole);
      console.log(`[solveViewmodelArm ${arm.side}] scale:`, arm.scale);
      console.log(`[solveViewmodelArm ${arm.side}] |grip|:`, grip.length().toFixed(4), 'reach:', ((L1 + L2)).toFixed(4));
    }

    // 两次迭代收敛手腕姿态与手掌触点的耦合
    for (let pass = 0; pass < 2; pass++) {
      const wristTarget = grip.clone().sub(arm.palmOffset.clone().applyQuaternion(qHand));
      solveTwoBoneIK({
        shoulder: arm.shoulder,
        elbow: arm.elbow,
        hand: arm.wrist,
        target: wristTarget,
        pole: arm.pole,
      });
      qHand.copy(arm.shoulder.quaternion).multiply(arm.elbow.quaternion).multiply(arm.wrist.quaternion);
    }
  }

  setupMuzzleFlash() {
    // Dynamic omni flash light
    this.muzzleLight = new THREE.PointLight(0xffa500, 0, 8, 2);
    this.muzzleLight.position.set(0, 0.05, -0.65);
    this.viewmodelRoot.add(this.muzzleLight);

    // Muzzle flash billboard sprite
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.3, 'rgba(255, 180, 50, 0.8)');
    grad.addColorStop(1, 'rgba(255, 100, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      color: 0xfff4e0,
      depthTest: false,
    });
    this.muzzleSprite = new THREE.Sprite(spriteMat);
    this.muzzleSprite.scale.set(0.28, 0.28, 0.28);
    this.muzzleSprite.position.set(0, 0.05, -0.68);
    this.muzzleSprite.visible = false;
    this.viewmodelRoot.add(this.muzzleSprite);
  }

  setupFlashlight() {
    this.flashlight = new THREE.SpotLight(0xf0f9ff, 6.0, 25, Math.PI / 6, 0.35, 1.5);
    this.flashlight.position.set(0.1, 0, -0.3);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.width = 512;
    this.flashlight.shadow.mapSize.height = 512;
    this.flashlight.shadow.bias = -0.001;

    const target = new THREE.Object3D();
    target.position.set(0, 0, -10);
    this.camera.add(target);
    this.camera.add(this.flashlight);
    this.flashlight.target = target;
  }

  initEvents() {
    this.onMouseDown = (e) => {
      if (e.button === 0) {
        this.isFiring = true;
        this.tryShoot();
      } else if (e.button === 2) {
        if (!this.isAiming) {
          this.isAiming = true;
          soundEngine.playScopeZoom(true);
        }
      }
    };

    this.onMouseUp = (e) => {
      if (e.button === 0) {
        this.isFiring = false;
      } else if (e.button === 2) {
        if (this.isAiming) {
          this.isAiming = false;
          soundEngine.playScopeZoom(false);
        }
      }
    };

    this.onKeyDown = (e) => {
      if (e.code === 'KeyR') {
        this.tryReload();
      } else if (e.code === 'KeyF') {
        this.toggleFlashlight();
      } else if (e.code === 'KeyV' || e.code === 'KeyQ') {
        this.tryMeleeShove();
      }
    };

    this.onMouseMove = (e) => {
      // Weapon sway calculation
      const movementX = e.movementX || 0;
      const movementY = e.movementY || 0;
      this.swayTargetX = Math.max(-0.06, Math.min(0.06, -movementX * 0.0008));
      this.swayTargetY = Math.max(-0.04, Math.min(0.04, movementY * 0.0008));
    };

    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousemove', this.onMouseMove);

    // Prevent right click context menu in game
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  toggleFlashlight() {
    if (this.flashlight) {
      this.flashlight.visible = !this.flashlight.visible;
      soundEngine.playHover();
    }
  }

  tryReload() {
    if (this.isReloading || this.currentAmmo === this.maxMag || this.reserveAmmo <= 0 || this.isShoving) {
      return;
    }
    this.isReloading = true;
    this.reloadTimer = 0;
    this.hasEjectedMag = false;
    this.hasInsertedMag = false;
    this.hasRackedBolt = false;
    if (this.isAiming) {
      this.isAiming = false;
    }
  }

  tryMeleeShove() {
    if (this.isShoving || this.isReloading) return;
    this.isShoving = true;
    this.shoveTimer = 0;
    soundEngine.playMeleeShove();

    if (this.onShoveCallback) {
      this.onShoveCallback();
    }
  }

  tryShoot() {
    const now = performance.now() / 1000;
    if (now - this.lastShotTime < this.fireRate) return;
    if (this.isReloading || this.isShoving) return;

    if (this.currentAmmo <= 0) {
      soundEngine.playDryFire();
      this.tryReload();
      this.lastShotTime = now;
      return;
    }

    // Fire bullet
    this.lastShotTime = now;
    this.currentAmmo--;

    soundEngine.playGunshot(this.isAiming);

    // Muzzle flash
    this.triggerMuzzleFlash();

    // Apply Recoil Kick
    this.applyRecoil();

    // Raycast hitscan
    this.performHitscan();
  }

  triggerMuzzleFlash() {
    if (this.muzzleLight && this.muzzleSprite) {
      this.muzzleLight.intensity = 5.0;
      this.muzzleSprite.visible = true;
      this.muzzleSprite.material.rotation = Math.random() * Math.PI * 2;

      setTimeout(() => {
        if (this.muzzleLight) this.muzzleLight.intensity = 0;
        if (this.muzzleSprite) this.muzzleSprite.visible = false;
      }, 45);
    }
  }

  updateSpring(spring, dt, stiffness, damping) {
    spring.v += (-stiffness * spring.x - damping * spring.v) * dt;
    spring.x += spring.v * dt;
  }

  applyRecoil() {
    const scale = this.isAiming ? 0.45 : 1.0;

    // 1. Violent mechanical spring recoil kick on the weapon
    this.springZ.v += this.cfg.recoilDistance * scale;
    this.springPitch.v -= this.cfg.recoilPitch * scale;
    this.springYaw.v += (Math.random() - 0.5) * this.cfg.recoilYaw * scale;
    this.springRoll.v += (Math.random() - 0.5) * this.cfg.recoilRoll * scale;

    // 2. High-frequency gun body shudder & bolt cycling vibration
    this.gunVibeTimer = this.gunVibeDuration;
    this.gunVibeIntensity = scale;

    // 3. Dynamic reticle spread bloom
    this.recoilSpread = Math.min(26, this.recoilSpread + (this.isAiming ? 2.5 : 7.0));

    // Zero camera screen shake! Screen remains steady and clean.
  }

  onHitImpactFeedback(isHeadshot = false) {
    // Tactile mechanical hit-stop & shudder directly on the gun when bullet hits a target
    const boost = isHeadshot ? 1.6 : 1.0;
    this.gunVibeTimer = Math.max(this.gunVibeTimer, 0.065);
    this.gunVibeIntensity = boost;

    // Tactile weapon bite & recoil impulse on hit
    this.springZ.v += 0.045 * boost;
    this.springPitch.v -= 0.02 * boost;
    this.springRoll.v += (Math.random() - 0.5) * 0.035 * boost;
  }

  performHitscan() {
    // Bullet raycast straight from camera through center of screen
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

    const muzzlePos = new THREE.Vector3(0, 0.05, -0.65);
    this.viewmodelRoot.localToWorld(muzzlePos);

    if (this.onFireCallback) {
      this.onFireCallback(muzzlePos);
    }

    if (this.onHitCallback) {
      this.onHitCallback(raycaster, this.damage, muzzlePos);
    }
  }

  update(delta, player = null) {
    this.recoilSpread = Math.max(0, this.recoilSpread - 28 * delta);

    // Continuous automatic fire when left click held
    if (this.isFiring && !this.isReloading && !this.isShoving) {
      this.tryShoot();
    }

    // 1. Tactical Multi-Stage Reloading logic
    if (this.isReloading) {
      this.reloadTimer += delta;
      const progress = this.reloadTimer / this.reloadDuration;

      // Coordinate magazine mesh on the gun:
      // Stage 1 (0.00 -> 0.16): In battery, visible
      // Stage 2 (0.16 -> 0.34): Sliding DOWN out of magwell with left hand
      // Stage 3 & 4a (0.34 -> 0.70): Detached from gun, magwell is visibly EMPTY!
      // Stage 4b, 5, 6 (0.70 -> 1.00): New mag slammed home into battery, visible!
      if (this.magazineMesh) {
        if (progress < 0.16) {
          this.magazineMesh.visible = true;
          this.magazineMesh.position.set(0, 0, 0);
        } else if (progress < 0.34) {
          // Visibly pulled down and out of the receiver along with the left hand
          this.magazineMesh.visible = true;
          const s = (progress - 0.16) / 0.18;
          this.magazineMesh.position.set(0, 0, -0.13 * s);
        } else if (progress < 0.70) {
          // Empty magwell on the rifle!
          this.magazineMesh.visible = false;
          this.magazineMesh.position.set(0, 0, 0);
        } else {
          // Slapped home into battery!
          this.magazineMesh.visible = true;
          this.magazineMesh.position.set(0, 0, 0);
        }
      }

      // Stage 2 Event: Magazine fully detached & dropped at 0.34
      if (progress >= 0.34 && !this.hasEjectedMag) {
        this.hasEjectedMag = true;
        soundEngine.playMagOut();
        if (this.onEjectMagazineCallback) {
          const dropPos = new THREE.Vector3(0.015, -0.22, 0.035);
          this.viewmodelRoot.localToWorld(dropPos);
          this.onEjectMagazineCallback(dropPos);
        }
      }

      // Stage 4 Event: Fresh magazine slammed into battery at 0.70
      if (progress >= 0.70 && !this.hasInsertedMag) {
        this.hasInsertedMag = true;
        soundEngine.playMagIn();
        // Powerful mechanical impact on gun from palm strike
        this.springPitch.v -= 0.16;
        this.springYaw.v += 0.04;
        this.recoilOffset.y += 0.045;
      }

      // Stage 5 Event: CS:GO bolt slap at 0.77
      if (progress >= 0.77 && !this.hasRackedBolt) {
        this.hasRackedBolt = true;
        soundEngine.playBoltRelease();
        this.springZ.v -= 0.08;
        this.recoilOffset.z -= 0.028;
        this.gunVibeTimer = 0.10;
        this.gunVibeIntensity = 1.0;
      }

      // Procedural CS:GO weapon roll & pitch exposing receiver/magwell
      if (progress < 0.16) {
        const p = progress / 0.16;
        this.recoilOffset.y = -0.035 * p;
        this.recoilRot.z = 0.26 * p; // 15 deg roll left
        this.recoilRot.x = -0.08 * p; // 5 deg muzzle up
      } else if (progress < 0.70) {
        // Held tilted while mag is pulled, pouch reached, and new mag inserted
        this.recoilOffset.y = -0.035 - Math.sin((progress - 0.16) / 0.54 * Math.PI) * 0.02;
        this.recoilRot.z = 0.26;
        this.recoilRot.x = -0.08;
      } else if (progress < 0.84) {
        // Leveling slightly during bolt slap
        const p = (progress - 0.70) / 0.14;
        this.recoilOffset.y = -0.025;
        this.recoilRot.z = 0.26 - p * 0.14;
        this.recoilRot.x = -0.08 + p * 0.04;
      } else {
        // Returning to ready stance
        const p = (progress - 0.84) / 0.16;
        this.recoilOffset.y = -0.025 * (1 - p);
        this.recoilRot.z = 0.12 * (1 - p);
        this.recoilRot.x = -0.04 * (1 - p);
      }

      if (this.reloadTimer >= this.reloadDuration) {
        const needed = this.maxMag - this.currentAmmo;
        const toAdd = Math.min(needed, this.reserveAmmo);
        this.currentAmmo += toAdd;
        this.reserveAmmo -= toAdd;
        this.isReloading = false;
        this.recoilOffset.set(0, 0, 0);
        this.recoilRot.set(0, 0, 0);
        if (this.magazineMesh) {
          this.magazineMesh.visible = true;
          this.magazineMesh.position.set(0, 0, 0);
        }
      }
    } else {
      if (this.magazineMesh) {
        this.magazineMesh.visible = true;
        this.magazineMesh.position.set(0, 0, 0);
      }
    }

    // 2. Melee Shove logic
    if (this.isShoving) {
      this.shoveTimer += delta;
      const progress = this.shoveTimer / this.shoveDuration;
      // Gun pushes forward violently then returns
      if (progress < 0.35) {
        this.recoilOffset.z = -0.25;
        this.recoilOffset.y = 0.08;
        this.recoilRot.z = -0.4;
      } else {
        this.recoilOffset.lerp(new THREE.Vector3(0, 0, 0), 0.15);
        this.recoilRot.z *= 0.8;
      }

      if (this.shoveTimer >= this.shoveDuration) {
        this.isShoving = false;
        this.recoilOffset.set(0, 0, 0);
      }
    }

    // Step skeletal animation mixer if present
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // Determine locomotion state from player controller
    let isMoving = false;
    let isSprinting = false;
    let isGrounded = true;

    const targetPlayer = player || this.player;
    const keys = targetPlayer ? targetPlayer.keys : null;
    if (keys) {
      isMoving = (keys.forward || keys.backward || keys.left || keys.right) && (targetPlayer.isGrounded !== false);
      isSprinting = keys.sprint && isMoving && !this.isAiming;
      isGrounded = targetPlayer.isGrounded !== false;
    }

    const dt = Math.min(delta, 1 / 30);

    // 1. Update Physical Recoil Springs (Second-order ODE: acceleration -> velocity -> displacement)
    this.updateSpring(this.springZ, dt, this.cfg.springStiffness, this.cfg.springDamping);
    this.updateSpring(this.springPitch, dt, this.cfg.springStiffness, this.cfg.springDamping);
    this.updateSpring(this.springYaw, dt, this.cfg.springStiffness, this.cfg.springDamping);
    this.updateSpring(this.springRoll, dt, this.cfg.springStiffness, this.cfg.springDamping);

    // 2. Weapon Physical Mass & Inertia Lag (Responds to player acceleration / direction change)
    const moveInputX = keys ? (Number(keys.right) - Number(keys.left)) : 0;
    const moveInputZ = keys ? (Number(keys.forward) - Number(keys.backward)) : 0;

    const lagStiffness = 130;
    const lagDamping = 18;
    this.lagX.v += (-moveInputX * this.cfg.movementLag * 50 - lagStiffness * this.lagX.x - lagDamping * this.lagX.v) * dt;
    this.lagX.x += this.lagX.v * dt;

    this.lagZ.v += (moveInputZ * this.cfg.movementLag * 40 - lagStiffness * this.lagZ.x - lagDamping * this.lagZ.v) * dt;
    this.lagZ.x += this.lagZ.v * dt;

    // 3. Dynamic Step Bobbing Rhythm & Natural Settling (Section 4)
    if (isMoving) {
      const freq = isSprinting ? this.cfg.walkFrequency * 1.35 : this.cfg.walkFrequency;
      const amp = isSprinting ? this.cfg.walkBobAmplitude * 2.0 : (this.isAiming ? this.cfg.walkBobAmplitude * 0.15 : this.cfg.walkBobAmplitude);
      this.walkPhase += dt * freq;
      this.bobX.x = Math.sin(this.walkPhase) * amp;
      this.bobY.x = Math.abs(Math.cos(this.walkPhase)) * amp - (amp * 0.4);
    } else {
      // Natural idle breathing and smooth dampening to equilibrium
      this.walkPhase += dt * 2.0;
      const breathAmp = this.isAiming ? 0.0006 : 0.0022;
      this.bobX.x = THREE.MathUtils.damp(this.bobX.x, 0, 10, dt);
      this.bobY.x = THREE.MathUtils.damp(this.bobY.x, Math.sin(this.walkPhase) * breathAmp, 8, dt);
    }

    // 4. Update WeaponAnchor (Tier 1: Base Posture Hipfire vs ADS vs Sprint)
    let targetBasePos = this.hipPos;
    let targetBaseRot = this.hipRot;
    let lerpSpeed = 14 * dt;

    if (this.isAiming) {
      targetBasePos = this.adsPos;
      targetBaseRot = this.adsRot;
      lerpSpeed = 18 * dt;
    } else if (isSprinting && !this.isReloading && !this.isShoving) {
      targetBasePos = this.sprintPos;
      targetBaseRot = this.sprintRot;
      lerpSpeed = 10 * dt;
    }

    this.currentPos.lerp(targetBasePos, lerpSpeed);
    this.currentRot.x += (targetBaseRot.x - this.currentRot.x) * lerpSpeed;
    this.currentRot.y += (targetBaseRot.y - this.currentRot.y) * lerpSpeed;
    this.currentRot.z += (targetBaseRot.z - this.currentRot.z) * lerpSpeed;

    this.weaponAnchor.position.copy(this.currentPos);
    this.weaponAnchor.rotation.copy(this.currentRot);

    // Smooth optical scope FOV zoom when aiming (28 FOV for scope, 80 FOV for sprint rush)
    const targetFOV = this.isAiming ? 28 : (isSprinting ? 80 : 75);
    this.camera.fov += (targetFOV - this.camera.fov) * lerpSpeed;
    this.camera.updateProjectionMatrix();

    // 5. Update High-Frequency Gun Body Vibration & Bolt Cycle Shudder (Intense gun shake!)
    if (this.gunVibeTimer > 0) {
      this.gunVibeTimer -= dt;
      const decay = Math.max(0, this.gunVibeTimer / this.gunVibeDuration);
      const vibeFreq = 50; // 50 Hz rapid mechanical oscillation
      const wave = Math.sin(this.gunVibeTimer * vibeFreq * Math.PI * 2);

      // Sharp mechanical vibration offsets directly on the gun body
      this.gunVibeOffset.set(
        (Math.sin(this.gunVibeTimer * 300) * 0.007 + (Math.random() - 0.5) * 0.006) * decay * this.gunVibeIntensity,
        (wave * 0.008 + (Math.random() - 0.5) * 0.005) * decay * this.gunVibeIntensity,
        (-Math.abs(wave) * 0.015) * decay * this.gunVibeIntensity
      );

      this.gunVibeRot.set(
        (-Math.abs(wave) * 0.045 + (Math.random() - 0.5) * 0.02) * decay * this.gunVibeIntensity,
        ((Math.random() - 0.5) * 0.035) * decay * this.gunVibeIntensity,
        ((Math.sin(this.gunVibeTimer * 200) * 0.05) + (Math.random() - 0.5) * 0.03) * decay * this.gunVibeIntensity
      );
    } else {
      this.gunVibeOffset.set(0, 0, 0);
      this.gunVibeRot.set(0, 0, 0);
    }

    // 6. Update WeaponMotion (Tier 2: Physical Springs, Bolt Vibration, Inertia, Sway & Bobbing)
    this.swayCurrentX += (this.swayTargetX - this.swayCurrentX) * 0.12;
    this.swayCurrentY += (this.swayTargetY - this.swayCurrentY) * 0.12;
    this.swayTargetX *= 0.85;
    this.swayTargetY *= 0.85;

    this.weaponMotion.position.set(
      this.swayCurrentX + this.bobX.x + this.lagX.x + this.gunVibeOffset.x,
      this.swayCurrentY + this.bobY.x + this.gunVibeOffset.y,
      this.springZ.x + this.lagZ.x + this.gunVibeOffset.z
    );

    this.weaponMotion.rotation.set(
      this.springPitch.x + this.gunVibeRot.x + (isMoving ? Math.sin(this.walkPhase) * 0.008 : 0),
      this.springYaw.x + this.gunVibeRot.y + this.swayCurrentX * 1.2,
      this.springRoll.x + this.gunVibeRot.z + (isMoving ? this.bobX.x * 0.5 : 0)
    );

    // 7. Update ViewmodelRoot (Tier 3: Local Reload / Shove / Weapon Models)
    this.viewmodelRoot.position.copy(this.recoilOffset);
    this.viewmodelRoot.rotation.copy(this.recoilRot);

    // 8. Update Viewmodel Arms (Two-Bone IK procedural arms holding the rifle)
    this.updateViewmodelArms(delta);
  }

  destroy() {
    if (this.weaponAnchor && this.weaponAnchor.parent) {
      this.weaponAnchor.parent.remove(this.weaponAnchor);
    }
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('mousemove', this.onMouseMove);
  }
}
