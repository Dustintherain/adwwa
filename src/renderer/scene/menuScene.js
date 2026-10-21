import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class MenuScene {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.gunModel = null;
    this.gunGroup = null;
    this.dustParticles = null;
    this.emergencyLight = null;
    this.tacticalSpot = null;
    this.weaponFlashlight = null;
    this.koharuModel = null;
    this.koharuGroup = null;
    this.koharuHalo = null;

    // Camera states
    this.mode = 'menu'; // 'menu' or 'inspect'
    this.mouseX = 0;
    this.mouseY = 0;
    this.targetCameraPos = new THREE.Vector3(0, 1.2, 3.8);
    this.targetCameraLook = new THREE.Vector3(0, 0.2, 0);

    // Inspection drag rotation
    this.isDragging = false;
    this.prevMousePos = { x: 0, y: 0 };
    this.inspectRotation = { x: 0.2, y: -0.6 };
    this.inspectZoom = 2.4;

    this.clock = new THREE.Clock();
    this.isLoaded = false;
    this.onLoadProgress = null;

    this.init();
  }

  init() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // 1. Scene & Atmosphere (Brightened for clear weapon viewing)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x18202c);
    this.scene.fog = new THREE.FogExp2(0x18202c, 0.025);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    this.camera.position.set(0, 1.2, 3.8);
    this.camera.lookAt(0, 0.25, 0);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.container.appendChild(this.renderer.domElement);

    // 4. Lights
    this.setupLighting();

    // 5. Environment (Table, Room, Props)
    this.setupEnvironment();

    // 6. Floating atmospheric dust
    this.setupAtmosphericParticles();

    // 7. Load weapon GLB
    this.loadWeapon();

    // 8. Load Koharu character model
    this.loadCharacter();

    // 9. Event listeners
    this.setupEvents();

    // 10. Start loop
    this.animate();
  }

  setupLighting() {
    // Ambient light - bright daylight fill
    const ambientLight = new THREE.AmbientLight(0x94a3b8, 2.2);
    this.scene.add(ambientLight);

    // Main tactical overhead spotlight (bright white, illuminating table and weapon)
    this.tacticalSpot = new THREE.SpotLight(0xffffff, 8.5);
    this.tacticalSpot.position.set(0.6, 4.5, 2.0);
    this.tacticalSpot.angle = Math.PI / 4.0;
    this.tacticalSpot.penumbra = 0.5;
    this.tacticalSpot.decay = 1.5;
    this.tacticalSpot.distance = 18;
    this.tacticalSpot.castShadow = true;
    this.tacticalSpot.shadow.mapSize.width = 2048;
    this.tacticalSpot.shadow.mapSize.height = 2048;
    this.tacticalSpot.shadow.bias = -0.0005;
    this.scene.add(this.tacticalSpot);
    this.scene.add(this.tacticalSpot.target);
    this.tacticalSpot.target.position.set(0, 0.3, 0);

    // Dedicated Keylight aimed straight at the gun model
    const gunKey = new THREE.DirectionalLight(0xffffff, 2.5);
    gunKey.position.set(0, 3, 3);
    this.scene.add(gunKey);

    // Cool rim light for tactical edge highlights
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 2.8);
    rimLight.position.set(-4, 3.0, -2.5);
    this.scene.add(rimLight);

    // Emergency hazard beacon (revolving red/amber pulse)
    this.emergencyLight = new THREE.PointLight(0xef4444, 4.5, 14, 2);
    this.emergencyLight.position.set(-3.5, 3.0, -1.5);
    this.scene.add(this.emergencyLight);

    // Warm backlight
    const warmBack = new THREE.PointLight(0xf59e0b, 1.8, 10, 2);
    warmBack.position.set(3.5, 2.0, -2);
    this.scene.add(warmBack);
  }

  setupEnvironment() {
    // Military Safehouse Armory Table
    const tableGeo = new THREE.BoxGeometry(4.2, 0.15, 2.2);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x1a1d22,
      roughness: 0.45,
      metalness: 0.65,
    });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.set(0, -0.08, 0);
    table.receiveShadow = true;
    this.scene.add(table);

    // Table steel border
    const borderGeo = new THREE.BoxGeometry(4.26, 0.18, 2.26);
    const borderMat = new THREE.MeshStandardMaterial({
      color: 0x0f1115,
      roughness: 0.3,
      metalness: 0.85,
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.set(0, -0.1, 0);
    border.receiveShadow = true;
    this.scene.add(border);

    // Background concrete wall with quarantine markings
    const wallGeo = new THREE.PlaneGeometry(16, 9);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x111419,
      roughness: 0.9,
      metalness: 0.1,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 3, -3.8);
    wall.receiveShadow = true;
    this.scene.add(wall);

    // Supply ammo crate on table side
    const crateGeo = new THREE.BoxGeometry(0.7, 0.4, 0.5);
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x272e27, // Olive military green
      roughness: 0.7,
      metalness: 0.2,
    });
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(1.5, 0.2, -0.4);
    crate.rotation.y = -0.3;
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.scene.add(crate);

    // Gun stand rests
    const standMat = new THREE.MeshStandardMaterial({ color: 0x1f232b, metalness: 0.8, roughness: 0.3 });
    const standL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.18), standMat);
    standL.position.set(-0.55, 0.11, 0);
    standL.castShadow = true;
    standL.receiveShadow = true;
    this.scene.add(standL);

    const standR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.18), standMat);
    standR.position.set(0.65, 0.11, 0);
    standR.castShadow = true;
    standR.receiveShadow = true;
    this.scene.add(standR);
  }

  setupAtmosphericParticles() {
    const particleCount = 350;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 1] = Math.random() * 4 - 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6;
      speeds[i] = 0.2 + Math.random() * 0.4;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(200,225,255,0.4)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 16);

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      color: 0x94a3b8,
      size: 0.05,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.dustParticles = new THREE.Points(geometry, material);
    this.dustParticles.userData = { speeds };
    this.scene.add(this.dustParticles);
  }

  loadWeapon() {
    const loader = new GLTFLoader();
    this.gunGroup = new THREE.Group();
    this.scene.add(this.gunGroup);

    const modelPath = './models/blue_archive_weapon_-_sunaookami_shiroko.glb';

    loader.load(
      modelPath,
      (gltf) => {
        console.log('Successfully loaded weapon model:', modelPath);
        const model = gltf.scene;
        this.gunModel = model;

        // Compute model bounding box to automatically normalize and center it
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Center weapon at origin
        model.position.sub(center);

        // Scale weapon nicely for standard viewing (target size approx 1.6 units long)
        const maxDim = Math.max(size.x, size.y, size.z);
        const desiredScale = maxDim > 0 ? 1.6 / maxDim : 1;
        model.scale.setScalar(desiredScale);

        // Enhance materials with PBR reflection
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
              child.material.roughness = 0.35;
              child.material.metalness = 0.55;
              child.material.needsUpdate = true;
            }
          }
        });

        // Add model to gunGroup
        this.gunGroup.add(model);

        // Prominent menu display pose on the armory table
        this.gunGroup.position.set(0.25, 0.36, 0.15);
        this.gunGroup.rotation.set(0.15, -0.6, 0.08);

        // Add tactical weapon flashlight
        this.weaponFlashlight = new THREE.SpotLight(0xe0f2fe, 8, 10, Math.PI / 8, 0.4, 2);
        this.weaponFlashlight.position.set(1.1, 0.15, 0.1);
        this.weaponFlashlight.target.position.set(4, 0, 0);
        this.gunGroup.add(this.weaponFlashlight);
        this.gunGroup.add(this.weaponFlashlight.target);

        this.isLoaded = true;
        if (this.onLoadProgress) this.onLoadProgress(100);
      },
      (xhr) => {
        if (xhr.lengthComputable && this.onLoadProgress) {
          const percent = Math.round((xhr.loaded / xhr.total) * 100);
          this.onLoadProgress(percent);
        }
      },
      (error) => {
        console.error('Error loading weapon model:', error);
      }
    );
  }

  loadCharacter() {
    const loader = new GLTFLoader();
    this.koharuGroup = new THREE.Group();
    this.scene.add(this.koharuGroup);

    // 与战场内完全一致：只加载这一个文件，并保持文件自带的网格/材质（不重建、不改材质）
    const modelPath = './models/blue_archive_-koharu-__cb_default_emotion.glb';
    loader.load(
      modelPath,
      (gltf) => {
        console.log('[MenuScene] Successfully loaded Koharu in menu:', modelPath);
        const model = gltf.scene;

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Normalize height to 1.48m
        const targetHeight = 1.48;
        const scale = size.y > 0 ? targetHeight / size.y : 0.0000261;

        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        model.scale.setScalar(scale);

        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            // 材质/贴图保持 GLB 原样（不再替换 MeshStandardMaterial）
            if (child.name === 'Object_6' || (child.material && child.material.name === 'halo_glow')) {
              this.koharuHalo = child;
            }
          }
        });

        this.koharuModel = model;
        this.koharuGroup.add(model);

        // Position standing gracefully beside the tactical armory table
        this.koharuGroup.position.set(-0.95, -0.08, 0.15);
        this.koharuGroup.rotation.y = 0.45;

        // 在主菜单中让人物模型右手拿起白子突击步枪（战术持枪警戒姿势）
        const weaponLoader = new GLTFLoader();
        weaponLoader.load('./models/blue_archive_weapon_-_sunaookami_shiroko.glb', (wGltf) => {
          const wModel = wGltf.scene;
          wModel.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (child.material) {
                child.material.roughness = 0.35;
                child.material.metalness = 0.55;
              }
            }
          });

          const wBox = new THREE.Box3().setFromObject(wModel);
          const wSize = new THREE.Vector3();
          wBox.getSize(wSize);
          const wCenter = new THREE.Vector3();
          wBox.getCenter(wCenter);
          wModel.position.sub(wCenter);

          // 枪口朝向人物正面 (+Z)
          wModel.rotation.y = Math.PI / 2;

          // 比例适配小春体型 (~0.56m)
          const maxDim = Math.max(wSize.x, wSize.y, wSize.z);
          const wScale = maxDim > 0 ? 0.56 / maxDim : 1;
          wModel.scale.setScalar(wScale);

          const gunMount = new THREE.Group();
          gunMount.add(wModel);

          // 放置在小春右手位置（枪身斜向下前倾，枪托收于后肘侧）
          gunMount.position.set(0.24, 0.52, 0.16);
          gunMount.rotation.set(0.60, -0.15, -0.20);

          this.koharuGroup.add(gunMount);
        });
      },
      undefined,
      (err) => {
        console.error('[MenuScene] Error loading Koharu model:', err);
      }
    );
  }

  setupEvents() {
    window.addEventListener('resize', () => this.onWindowResize());

    // Mouse move for parallax tilt
    window.addEventListener('mousemove', (e) => {
      this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseY = -(e.clientY / window.innerHeight) * 2 + 1;

      if (this.isDragging && this.mode === 'inspect') {
        const deltaX = e.clientX - this.prevMousePos.x;
        const deltaY = e.clientY - this.prevMousePos.y;

        this.inspectRotation.y += deltaX * 0.008;
        this.inspectRotation.x += deltaY * 0.008;
        this.inspectRotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.inspectRotation.x));

        this.prevMousePos = { x: e.clientX, y: e.clientY };
      }
    });

    // Drag to rotate in Inspect Mode
    this.container.addEventListener('mousedown', (e) => {
      if (this.mode === 'inspect') {
        this.isDragging = true;
        this.prevMousePos = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Mouse wheel zoom in Inspect Mode
    this.container.addEventListener('wheel', (e) => {
      if (this.mode === 'inspect') {
        e.preventDefault();
        this.inspectZoom += e.deltaY * 0.002;
        this.inspectZoom = Math.max(1.2, Math.min(4.5, this.inspectZoom));
      }
    }, { passive: false });
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'inspect') {
      // Transition to inspect view
      this.targetCameraLook.set(0, 0.35, 0);
      this.inspectRotation.y = -0.5;
      this.inspectRotation.x = 0.15;
    } else {
      // Reset to main menu cinematic view
      this.targetCameraPos.set(0, 1.2, 3.8);
      this.targetCameraLook.set(0, 0.2, 0);
      if (this.gunGroup) {
        this.gunGroup.position.set(0.1, 0.28, 0);
        this.gunGroup.rotation.set(0.08, -0.45, 0.04);
      }
    }
  }

  toggleWeaponFlashlight() {
    if (this.weaponFlashlight) {
      this.weaponFlashlight.visible = !this.weaponFlashlight.visible;
      return this.weaponFlashlight.visible;
    }
    return false;
  }

  onWindowResize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    if (this.isActive === false) return;
    this.animId = requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // 1. Emergency red hazard light rotation
    if (this.emergencyLight) {
      const angle = elapsed * 1.5;
      this.emergencyLight.position.x = Math.sin(angle) * 3 - 1.5;
      this.emergencyLight.position.z = Math.cos(angle) * 2 - 1.5;
      this.emergencyLight.intensity = 2.5 + Math.sin(elapsed * 4) * 1.8;
    }

    // 2. Animate dust particles
    if (this.dustParticles) {
      const positions = this.dustParticles.geometry.attributes.position.array;
      const speeds = this.dustParticles.userData.speeds;
      for (let i = 0; i < speeds.length; i++) {
        positions[i * 3 + 1] -= speeds[i] * delta * 0.15;
        positions[i * 3] += Math.sin(elapsed + i) * 0.001;
        if (positions[i * 3 + 1] < -0.5) {
          positions[i * 3 + 1] = 3.5;
        }
      }
      this.dustParticles.geometry.attributes.position.needsUpdate = true;
    }

    // 3. Camera & Gun handling per mode
    if (this.mode === 'menu') {
      // Subtle cinematic idle breathing
      const idleSwayX = Math.sin(elapsed * 0.4) * 0.08;
      const idleSwayY = Math.cos(elapsed * 0.3) * 0.05;

      // Mouse parallax
      const targetX = idleSwayX + this.mouseX * 0.45;
      const targetY = 1.2 + idleSwayY + this.mouseY * 0.25;

      this.camera.position.x += (targetX - this.camera.position.x) * 0.04;
      this.camera.position.y += (targetY - this.camera.position.y) * 0.04;
      this.camera.position.z += (3.8 - this.camera.position.z) * 0.04;

      this.camera.lookAt(0, 0.2, 0);

      // Subtle gun breathing float
      if (this.gunGroup) {
        this.gunGroup.position.y = 0.28 + Math.sin(elapsed * 1.2) * 0.01;
      }
    } else if (this.mode === 'inspect') {
      // 3D Orbital inspection mode
      if (!this.isDragging) {
        // Slow auto rotation when idle
        this.inspectRotation.y += delta * 0.15;
      }

      if (this.gunGroup) {
        this.gunGroup.position.set(0, 0.35, 0);
        // Smoothly interpolate rotation
        this.gunGroup.rotation.x += (this.inspectRotation.x - this.gunGroup.rotation.x) * 0.1;
        this.gunGroup.rotation.y += (this.inspectRotation.y - this.gunGroup.rotation.y) * 0.1;
      }

      // Camera position based on zoom
      const camZTarget = this.inspectZoom;
      this.camera.position.x += (0 - this.camera.position.x) * 0.08;
      this.camera.position.y += (0.4 - this.camera.position.y) * 0.08;
      this.camera.position.z += (camZTarget - this.camera.position.z) * 0.08;
      this.camera.lookAt(0, 0.35, 0);
    }

    // 4. Animate Koharu character in menu
    if (this.koharuGroup) {
      this.koharuGroup.position.y = -0.08 + Math.sin(elapsed * 2.0) * 0.006;
      // 完全原样静态渲染：光环也不做位移/旋转动画
    }

    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.isActive = false;
    if (this.animId) cancelAnimationFrame(this.animId);
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.remove();
    }
  }
}
