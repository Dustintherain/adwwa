import * as THREE from 'three';

// ----------------------------------------------------------------------------
// 现代化战术实弹射击场 (Tactical Live-Fire Proving Grounds)
// 专为枪械弹道校准、后坐力控枪练习、远近距离打靶与 CQB 战术清房设计。
// 核心特性：
//   1. 彻底禁用怪物刷新（纯粹靶场，零感染者打扰）
//   2. 阶梯靶道系统：10M、25M、45M、65M、75M 多组可击倒/受击回弹钢靶
//   3. 靶子受击真实物理反馈（弹痕、火花、爆头暴击跳字、钢板被击中后仰摆动与回正）
//   4. 弹药无限补给箱、急救箱、靶位一键复位操作终端
//   5. 左侧 CQB 战术突击房 (Killhouse) + 右侧战术障碍与高台观察掩体
//   6. 坚固防弹墙与远端橡胶轮胎吸弹护堤，全场地无跌落出界风险
// ----------------------------------------------------------------------------

export class TrainingMapBuilder {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.interactiveObjects = [];
    this.spawnPoints = []; // 训练场严格不刷新怪物，刷怪点恒空
    this.playerSpawn = new THREE.Vector3(0, 1.65, 5.0);
    this.exitDoor = null;
    this.lights = [];
    this.targets = []; // 记录全部反应靶以便执行物理回弹和复位
  }

  buildLevel() {
    this.setupLighting();
    this.buildRangeHall();
    this.buildFiringPavilion();
    this.buildShootingLanes();
    this.buildTargetArray();
    this.buildCQBKillhouse();
    this.buildObstacleCourse();
    this.buildBallisticBerm();
    this.buildArmoryAndInteractiveStations();
  }

  // --------------------------------------------------------------------------
  // 1. 照明与环境天光 (清晰明亮、无多余刺眼镜面反光)
  // --------------------------------------------------------------------------
  setupLighting() {
    // 漫反射天空半球光
    const hemiLight = new THREE.HemisphereLight(0xd9e5f0, 0x3d4954, 1.8);
    hemiLight.position.set(0, 25, 0);
    this.scene.add(hemiLight);

    // 主太阳直射光（产生柔和阴影，角度微斜以便看清靶位轮廓）
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
    sunLight.position.set(15, 28, 12);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 1.0;
    sunLight.shadow.camera.far = 130;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 20;
    sunLight.shadow.camera.bottom = -95;
    sunLight.shadow.bias = -0.0004;
    this.scene.add(sunLight);

    // 基础环境补光
    const amb = new THREE.AmbientLight(0xbfcad4, 0.9);
    this.scene.add(amb);
  }

  // --------------------------------------------------------------------------
  // 2. 射击场主场馆与防弹外围墙 (宽 44m，深 100m，高 7.5m)
  // --------------------------------------------------------------------------
  buildRangeHall() {
    // 靶场主地面 (暗色吸音碎石/沥青地面)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x242a30,
      roughness: 0.95,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(44, 105), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -40);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 外围高大防弹墙材 (工业吸音穿孔板风格)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x38434c,
      roughness: 0.9,
      metalness: 0.1,
    });
    const wallTrimMat = new THREE.MeshStandardMaterial({
      color: 0x222a30,
      roughness: 0.85,
    });

    const wallHeight = 7.5;
    // 左外墙 (x = -22)
    this.addWall(-22, wallHeight / 2, -40, 0.6, wallHeight, 105, wallMat);
    // 右外墙 (x = +22)
    this.addWall(22, wallHeight / 2, -40, 0.6, wallHeight, 105, wallMat);
    // 后方封闭墙 (z = +12.5)
    this.addWall(0, wallHeight / 2, 12.5, 44, wallHeight, 0.6, wallMat);
    // 前方远端防弹底墙 (z = -92.5)
    this.addWall(0, wallHeight / 2, -92.5, 44, wallHeight, 0.6, wallMat);

    // 墙裙装饰条
    const trimL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 105), wallTrimMat);
    trimL.position.set(-21.8, 0.15, -40);
    this.scene.add(trimL);
    const trimR = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 105), wallTrimMat);
    trimR.position.set(21.8, 0.15, -40);
    this.scene.add(trimR);
  }

  // --------------------------------------------------------------------------
  // 3. 起射凉亭与军械整备台 (Firing Pavilion & Firing Line)
  // --------------------------------------------------------------------------
  buildFiringPavilion() {
    // 射击地线地坪 (防滑金刚砂混凝土地坪)
    const pavFloorMat = new THREE.MeshStandardMaterial({
      color: 0x353f47,
      roughness: 0.85,
      metalness: 0.1,
    });
    const pavFloor = new THREE.Mesh(new THREE.PlaneGeometry(36, 16), pavFloorMat);
    pavFloor.rotation.x = -Math.PI / 2;
    pavFloor.position.set(0, 0.01, 4);
    pavFloor.receiveShadow = true;
    this.scene.add(pavFloor);

    // 红色起射警戒地线 (z = -0.5)
    const redLineMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.6,
    });
    const redLine = new THREE.Mesh(new THREE.BoxGeometry(32, 0.03, 0.3), redLineMat);
    redLine.position.set(0, 0.02, -0.5);
    this.scene.add(redLine);

    // 黄色缓冲警戒带 (z = +1.0)
    const yellowStripeMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.5,
    });
    const yLine = new THREE.Mesh(new THREE.BoxGeometry(32, 0.03, 0.18), yellowStripeMat);
    yLine.position.set(0, 0.02, 1.2);
    this.scene.add(yLine);

    // 遮阳与防雨钢结构顶棚
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x2d3740,
      roughness: 0.7,
      metalness: 0.3,
    });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(36, 0.4, 16), roofMat);
    roof.position.set(0, 5.2, 4);
    this.scene.add(roof);

    // 顶棚承重钢柱
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.5,
      metalness: 0.5,
    });
    for (const x of [-16, -6, 6, 16]) {
      for (const z of [-3, 10]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.2, 0.5), pillarMat);
        pillar.position.set(x, 2.6, z);
        pillar.castShadow = true;
        this.scene.add(pillar);
        this.colliders.push(new THREE.Box3().setFromObject(pillar));
      }
    }

    // 靶位隔断挡板 (4个专属射击靶位 Lane 01 ~ 04)
    const dividerMat = new THREE.MeshStandardMaterial({
      color: 0x4a5864,
      roughness: 0.7,
      metalness: 0.2,
    });
    for (const x of [-9, -3, 3, 9]) {
      const divider = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 3.2), dividerMat);
      divider.position.set(x, 0.8, 1.2);
      divider.castShadow = true;
      this.scene.add(divider);
      this.colliders.push(new THREE.Box3().setFromObject(divider));

      // 靶位号指示板
      const plateMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.6), plateMat);
      plate.position.set(x, 1.4, -0.2);
      this.scene.add(plate);
    }

    // 射击台顶棚明亮射灯
    for (const x of [-12, -6, 0, 6, 12]) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.08, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      lamp.position.set(x, 5.0, 1.0);
      this.scene.add(lamp);

      const pl = new THREE.PointLight(0xfff8ee, 3.5, 14, 1.2);
      pl.position.set(x, 4.6, 1.0);
      pl.castShadow = true;
      this.scene.add(pl);
    }
  }

  // --------------------------------------------------------------------------
  // 4. 靶道距离标志与分道线 (10M / 25M / 50M / 75M)
  // --------------------------------------------------------------------------
  buildShootingLanes() {
    const laneDashMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8 });
    // 纵向靶道延伸虚线
    for (const x of [-6, 0, 6]) {
      for (let z = -2; z > -75; z -= 3.5) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 1.8), laneDashMat);
        dash.position.set(x, 0.015, z);
        this.scene.add(dash);
      }
    }

    // 距离刻度指示线与立牌
    const distances = [
      { dist: 10, z: -10.5, label: '10M CLOSE-RANGE // 近距速射' },
      { dist: 25, z: -25.5, label: '25M RIFLE ZERO // 步枪归零' },
      { dist: 50, z: -50.5, label: '50M COMBAT ACCURACY // 战术精度' },
      { dist: 75, z: -75.5, label: '75M EXTREME RANGE // 极限射程' },
    ];

    const markLineMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.6 });
    const signMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });
    const signPostMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.6, roughness: 0.4 });

    for (const d of distances) {
      // 地面横向标线
      const line = new THREE.Mesh(new THREE.BoxGeometry(28, 0.02, 0.22), markLineMat);
      line.position.set(0, 0.02, d.z);
      this.scene.add(line);

      // 两侧地面立式距离指示柱
      for (const sideX of [-14.5, 14.5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4), signPostMat);
        post.position.set(sideX, 0.7, d.z);
        this.scene.add(post);

        const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.08), signMat);
        board.position.set(sideX, 1.2, d.z);
        board.rotation.y = sideX > 0 ? -0.2 : 0.2;
        this.scene.add(board);

        // 亮橙色距离边框
        const bTrim = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.54, 0.04), markLineMat);
        bTrim.position.set(sideX, 1.2, d.z - 0.02);
        bTrim.rotation.y = board.rotation.y;
        this.scene.add(bTrim);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. 交互式多距离反应钢靶矩阵 (Reactive Steel Targets)
  // --------------------------------------------------------------------------
  buildTargetArray() {
    // 10M 近距离人形速射钢靶 (4 个)
    const targets10m = [-4.5, -1.5, 1.5, 4.5];
    for (const x of targets10m) {
      this.createReactiveSilhouetteTarget(x, -10.5, 10);
    }

    // 25M 标准战术步枪钢靶 (5 个带圆环胸靶)
    const targets25m = [-6.0, -3.0, 0.0, 3.0, 6.0];
    for (const x of targets25m) {
      this.createReactiveTorsoTarget(x, -25.5, 25);
    }

    // 45M 摆动圆形悬挂大钢靶 (4 个)
    const targets45m = [-5.0, -1.8, 1.8, 5.0];
    for (const x of targets45m) {
      this.createSwingingGongTarget(x, -45.5, 45);
    }

    // 65M 远距离精度靶 (3 个双圆心狙击靶)
    const targets65m = [-3.8, 0.0, 3.8];
    for (const x of targets65m) {
      this.createPrecisionSniperTarget(x, -65.5, 65);
    }

    // 75M 极限距离护堤钢板靶 (3 个)
    const targets75m = [-4.0, 0.0, 4.0];
    for (const x of targets75m) {
      this.createExtremeBermTarget(x, -75.5, 75);
    }
  }

  // 构建人形立靶 (头胸双判定区)
  createReactiveSilhouetteTarget(x, z, dist) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);

    // 铸铁底座 (立在地面上)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7, metalness: 0.4 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.8), baseMat);
    base.position.set(0, 0.06, 0);
    base.receiveShadow = true;
    root.add(base);
    this.colliders.push(new THREE.Box3().setFromObject(base));

    // 支撑立柱
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.08), postMat);
    post.position.set(0, 0.5, 0);
    root.add(post);

    // 枢轴旋转组件 (受击后仰并回弹)
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.85, 0);
    root.add(pivot);

    // 人形躯干板
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.45,
      metalness: 0.4,
    });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.65, 0.04), steelMat);
    torso.position.set(0, 0.35, 0);
    torso.castShadow = true;
    pivot.add(torso);

    // 头部判定钢板
    const headMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.045), headMat);
    head.position.set(0, 0.75, 0);
    head.castShadow = true;
    pivot.add(head);

    // 胸部中心 10 环红心圆
    const bullseyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.12, 24), bullseyeMat);
    ring.position.set(0, 0.35, 0.022);
    pivot.add(ring);

    const centerDot = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    centerDot.position.set(0, 0.35, 0.024);
    pivot.add(centerDot);

    this.scene.add(root);

    // 注册靶子实体与碰撞判定
    const targetObj = {
      type: 'target',
      mesh: pivot,
      root: root,
      position: new THREE.Vector3(x, 1.2, z),
      dist: dist,
      recoilVel: 0,
      currentAngle: 0,
      isKnockedDown: false,
      resetTimer: 0,
      onHit: (isHeadshot) => {
        // 受击产生物理后仰脉冲
        targetObj.recoilVel = isHeadshot ? -14.0 : -9.0;
        targetObj.currentAngle = Math.max(-Math.PI * 0.45, targetObj.currentAngle - 0.35);
      },
    };

    this.targets.push(targetObj);
    this.interactiveObjects.push(targetObj);
  }

  // 构建带同心圆环的 25M 战术胸靶
  createReactiveTorsoTarget(x, z, dist) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);

    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.7), baseMat);
    base.position.set(0, 0.05, 0);
    root.add(base);

    const pivot = new THREE.Group();
    pivot.position.set(0, 0.75, 0);
    root.add(pivot);

    // 绿色特训靶板
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.5 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.75, 0.04), plateMat);
    plate.position.set(0, 0.4, 0);
    plate.castShadow = true;
    pivot.add(plate);

    // 头部区域
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.045), headMat);
    head.position.set(0, 0.85, 0);
    pivot.add(head);

    // 靶纸同心圆环
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
    const outerRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.18, 28), whiteMat);
    outerRing.position.set(0, 0.4, 0.022);
    pivot.add(outerRing);

    const bullseye = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), new THREE.MeshBasicMaterial({ color: 0xdc2626 }));
    bullseye.position.set(0, 0.4, 0.024);
    pivot.add(bullseye);

    this.scene.add(root);

    const targetObj = {
      type: 'target',
      mesh: pivot,
      root: root,
      position: new THREE.Vector3(x, 1.25, z),
      dist: dist,
      recoilVel: 0,
      currentAngle: 0,
      onHit: (isHeadshot) => {
        targetObj.recoilVel = isHeadshot ? -15.0 : -10.0;
        targetObj.currentAngle = Math.max(-Math.PI * 0.45, targetObj.currentAngle - 0.4);
      },
    };
    this.targets.push(targetObj);
    this.interactiveObjects.push(targetObj);
  }

  // 构建 45M 悬挂圆形大铜锣靶 (Swinging Gong)
  createSwingingGongTarget(x, z, dist) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);

    // A字型钢架
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.3 });
    const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4), frameMat);
    topBar.rotation.z = Math.PI / 2;
    topBar.position.set(0, 1.8, 0);
    root.add(topBar);

    for (const sx of [-0.65, 0.65]) {
      const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9), frameMat);
      legL.rotation.z = sx > 0 ? 0.2 : -0.2;
      legL.position.set(sx, 0.9, 0.2);
      root.add(legL);

      const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9), frameMat);
      legR.rotation.z = sx > 0 ? 0.2 : -0.2;
      legR.position.set(sx, 0.9, -0.2);
      root.add(legR);
    }

    // 摆动大圆盘
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.8, 0);
    root.add(pivot);

    // 铁链挂绳
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9 });
    for (const cx of [-0.2, 0.2]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45), chainMat);
      c.position.set(cx, -0.22, 0);
      pivot.add(c);
    }

    // 重型白钢圆板
    const gongMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.5 });
    const gong = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 32), gongMat);
    gong.rotation.x = Math.PI / 2;
    gong.position.set(0, -0.5, 0);
    gong.castShadow = true;
    pivot.add(gong);

    const bull = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    bull.position.set(0, -0.5, 0.022);
    pivot.add(bull);

    this.scene.add(root);

    const targetObj = {
      type: 'target',
      mesh: pivot,
      root: root,
      position: new THREE.Vector3(x, 1.3, z),
      dist: dist,
      recoilVel: 0,
      currentAngle: 0,
      onHit: (isHeadshot) => {
        targetObj.recoilVel = -18.0;
        targetObj.currentAngle = Math.max(-Math.PI * 0.6, targetObj.currentAngle - 0.55);
      },
    };
    this.targets.push(targetObj);
    this.interactiveObjects.push(targetObj);
  }

  // 构建 65M 狙击精度靶
  createPrecisionSniperTarget(x, z, dist) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);

    const pivot = new THREE.Group();
    pivot.position.set(0, 0.8, 0);
    root.add(pivot);

    // 细长高靶板
    const mat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.9, 0.04), mat);
    plate.position.set(0, 0.45, 0);
    plate.castShadow = true;
    pivot.add(plate);

    // 头部狙击十环
    const headRing = new THREE.Mesh(new THREE.CircleGeometry(0.08, 20), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    headRing.position.set(0, 0.78, 0.022);
    pivot.add(headRing);

    // 胸口狙击十环
    const chestRing = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshBasicMaterial({ color: 0x2563eb }));
    chestRing.position.set(0, 0.38, 0.022);
    pivot.add(chestRing);

    this.scene.add(root);

    const targetObj = {
      type: 'target',
      mesh: pivot,
      root: root,
      position: new THREE.Vector3(x, 1.3, z),
      dist: dist,
      recoilVel: 0,
      currentAngle: 0,
      onHit: (isHeadshot) => {
        targetObj.recoilVel = -12.0;
        targetObj.currentAngle = Math.max(-Math.PI * 0.4, targetObj.currentAngle - 0.3);
      },
    };
    this.targets.push(targetObj);
    this.interactiveObjects.push(targetObj);
  }

  // 构建 75M 远端大钢板靶
  createExtremeBermTarget(x, z, dist) {
    const root = new THREE.Group();
    root.position.set(x, 1.2, z);

    const pivot = new THREE.Group();
    root.add(pivot);

    const steelMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35, metalness: 0.6 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.06), steelMat);
    plate.castShadow = true;
    pivot.add(plate);

    const blackCenter = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), new THREE.MeshBasicMaterial({ color: 0x0f172a }));
    blackCenter.position.set(0, 0.15, 0.032);
    pivot.add(blackCenter);

    const redCenter = new THREE.Mesh(new THREE.CircleGeometry(0.08, 20), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    redCenter.position.set(0, 0.15, 0.034);
    pivot.add(redCenter);

    this.scene.add(root);

    const targetObj = {
      type: 'target',
      mesh: pivot,
      root: root,
      position: new THREE.Vector3(x, 1.5, z),
      dist: dist,
      recoilVel: 0,
      currentAngle: 0,
      onHit: (isHeadshot) => {
        targetObj.recoilVel = -20.0;
        targetObj.currentAngle = Math.max(-Math.PI * 0.5, targetObj.currentAngle - 0.5);
      },
    };
    this.targets.push(targetObj);
    this.interactiveObjects.push(targetObj);
  }

  // --------------------------------------------------------------------------
  // 6. 左翼：CQB 战术清房突击演练区 (Killhouse, x: -12 ~ -21, z: -12 ~ -46)
  // --------------------------------------------------------------------------
  buildCQBKillhouse() {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.85,
      metalness: 0.1,
    });
    const doorFrameMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.6,
    });

    const houseFloorMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.9,
    });
    const houseFloor = new THREE.Mesh(new THREE.PlaneGeometry(10, 36), houseFloorMat);
    houseFloor.rotation.x = -Math.PI / 2;
    houseFloor.position.set(-16.5, 0.015, -29);
    houseFloor.receiveShadow = true;
    this.scene.add(houseFloor);

    // 外围隔墙
    this.addWall(-11.5, 1.5, -29, 0.3, 3.0, 36, wallMat); // 靠主靶道侧内墙
    this.addWall(-21.5, 1.5, -29, 0.3, 3.0, 36, wallMat); // 靠外围墙侧外墙
    this.addWall(-16.5, 1.5, -11, 10, 3.0, 0.3, wallMat);  // 入口端墙
    this.addWall(-16.5, 1.5, -47, 10, 3.0, 0.3, wallMat);  // 出口端墙

    // 房间 1 门洞 (z = -11)
    const door1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.35), doorFrameMat);
    door1.position.set(-16.5, 1.1, -11);

    // 内部隔断墙 (创建拐角与切角搜查点)
    this.addWall(-18, 1.5, -20, 6.8, 3.0, 0.25, wallMat);
    this.addWall(-13.5, 1.5, -28, 4.0, 3.0, 0.25, wallMat);
    this.addWall(-17.5, 1.5, -36, 6.0, 3.0, 0.25, wallMat);

    // CQB 房内角落突击靶子 (练习拐角预瞄与快速反应)
    this.createReactiveSilhouetteTarget(-14.2, -18.5, 8);
    this.createReactiveSilhouetteTarget(-19.5, -25.0, 15);
    this.createReactiveSilhouetteTarget(-13.0, -33.5, 22);
    this.createReactiveTorsoTarget(-18.8, -42.0, 30);

    // CQB 室内柔和战术警示顶灯
    for (const z of [-16, -26, -36]) {
      const light = new THREE.PointLight(0xfef08a, 2.0, 10, 1.4);
      light.position.set(-16.5, 2.8, z);
      this.scene.add(light);
    }
  }

  // --------------------------------------------------------------------------
  // 7. 右翼：战术翻越障碍区与狙击射击台 (x: +12 ~ +20, z: -10 ~ -50)
  // --------------------------------------------------------------------------
  buildObstacleCourse() {
    // 泽西混凝土防撞路障 (Waist-high Jersey Barriers，供练习卧姿/半蹲射击)
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.9,
    });

    const barrierPositions = [
      { x: 14.5, z: -15 },
      { x: 17.5, z: -20 },
      { x: 13.5, z: -27 },
      { x: 18.0, z: -35 },
      { x: 14.0, z: -43 },
    ];

    for (const b of barrierPositions) {
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.95, 0.6), barrierMat);
      barrier.position.set(b.x, 0.475, b.z);
      barrier.castShadow = true;
      barrier.receiveShadow = true;
      this.scene.add(barrier);
      this.colliders.push(new THREE.Box3().setFromObject(barrier));
    }

    // 战术沙袋掩体地堡
    const sandMat = new THREE.MeshStandardMaterial({
      color: 0xca8a04,
      roughness: 0.95,
    });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.8, 0.9), sandMat);
      s.position.set(16.5, 0.4 + i * 0.35, -31);
      s.castShadow = true;
      this.scene.add(s);
      this.colliders.push(new THREE.Box3().setFromObject(s));
    }

    // 军用重型木板包装箱堆
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      roughness: 0.85,
    });
    const crates = [
      { x: 18.5, y: 0.6, z: -16, s: 1.2 },
      { x: 18.5, y: 1.8, z: -16, s: 1.0 },
      { x: 13.0, y: 0.6, z: -38, s: 1.2 },
      { x: 17.5, y: 0.7, z: -48, s: 1.4 },
    ];
    for (const c of crates) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(c.s, c.s, c.s), crateMat);
      box.position.set(c.x, c.y, c.z);
      box.castShadow = true;
      this.scene.add(box);
      this.colliders.push(new THREE.Box3().setFromObject(box));
    }
  }

  // --------------------------------------------------------------------------
  // 8. 远端橡胶吸弹防跳护堤 (Ballistic Berm & Backstop, z: -80 ~ -90)
  // --------------------------------------------------------------------------
  buildBallisticBerm() {
    // 倾斜吸弹泥土堤防
    const bermMat = new THREE.MeshStandardMaterial({
      color: 0x1c1917,
      roughness: 0.98,
    });
    const berm = new THREE.Mesh(new THREE.BoxGeometry(44, 5.0, 8.0), bermMat);
    berm.position.set(0, 2.5, -86);
    this.scene.add(berm);
    this.colliders.push(new THREE.Box3().setFromObject(berm));

    // 堆叠废弃防弹橡胶轮胎排
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.9,
    });
    for (let x = -18; x <= 18; x += 2.2) {
      for (let y = 0.5; y <= 3.5; y += 1.0) {
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 18), tireMat);
        tire.rotation.x = Math.PI / 2;
        tire.position.set(x + (y % 2 === 0 ? 0.3 : 0), y, -81.5);
        tire.castShadow = true;
        this.scene.add(tire);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 9. 军械补给岛、弹药箱与靶位复位终端
  // --------------------------------------------------------------------------
  buildArmoryAndInteractiveStations() {
    // 中央整备主桌台 (z = +2.5)
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.6,
      roughness: 0.4,
    });
    const table = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.9, 1.2), tableMat);
    table.position.set(0, 0.45, 2.5);
    table.castShadow = true;
    table.receiveShadow = true;
    this.scene.add(table);
    this.colliders.push(new THREE.Box3().setFromObject(table));

    // 1) 无限弹药补给箱 (Ammo Crate)
    const ammoMat = new THREE.MeshStandardMaterial({
      color: 0x14532d,
      roughness: 0.5,
      metalness: 0.3,
    });
    const ammoCrate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), ammoMat);
    ammoCrate.position.set(-1.1, 1.15, 2.5);
    ammoCrate.castShadow = true;
    this.scene.add(ammoCrate);

    // 弹药黄色铭牌
    const ammoDecal = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.02), new THREE.MeshStandardMaterial({ color: 0xfacc15 }));
    ammoDecal.position.set(-1.1, 1.15, 2.81);
    this.scene.add(ammoDecal);

    this.interactiveObjects.push({
      type: 'ammo',
      mesh: ammoCrate,
      position: ammoCrate.position.clone(),
      used: false,
    });

    // 2) 急救医疗箱 (Medkit)
    const medMat = new THREE.MeshStandardMaterial({
      color: 0xb91c1c,
      roughness: 0.35,
    });
    const medkit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.32), medMat);
    medkit.position.set(1.1, 1.05, 2.5);
    medkit.castShadow = true;
    this.scene.add(medkit);

    const crossMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.02), crossMat);
    c1.position.set(1.1, 1.05, 2.67);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), crossMat);
    c2.position.set(1.1, 1.05, 2.67);
    this.scene.add(c1);
    this.scene.add(c2);

    this.interactiveObjects.push({
      type: 'medkit',
      mesh: medkit,
      position: medkit.position.clone(),
      extras: [c1, c2],
      used: false,
    });

    // 3) 靶位复位终端 (Target Reset Terminal)
    const termMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3, metalness: 0.5 });
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), termMat);
    terminal.position.set(0, 1.05, 2.5);
    this.scene.add(terminal);

    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.2), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
    screen.rotation.x = -Math.PI / 4;
    screen.position.set(0, 1.2, 2.6);
    this.scene.add(screen);

    this.interactiveObjects.push({
      type: 'reset_targets',
      mesh: terminal,
      position: terminal.position.clone(),
      onUse: () => {
        this.resetAllTargets();
      },
    });

    // 训令大屏 (吊挂在起射台横梁上方)
    this.addInstructionBanner(
      new THREE.Vector3(0, 4.3, 3.5),
      'KIVOTOS LIVE-FIRE TACTICAL RANGE // 战术实弹靶场',
      'LANE 01: 10M | LANE 02: 25M | LANE 03: 45M | LANE 04: 65M-75M'
    );
  }

  // 吊挂战术训令横幅
  addInstructionBanner(pos, title, sub) {
    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.6,
      metalness: 0.2,
    });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.4, 0.15), bannerMat);
    banner.position.copy(pos);
    this.scene.add(banner);

    const borderMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 0.6 });
    const border = new THREE.Mesh(new THREE.BoxGeometry(9.7, 1.48, 0.08), borderMat);
    border.position.copy(pos);
    this.scene.add(border);
  }

  // 添加物理实体阻挡墙
  addWall(x, y, z, w, h, d, mat) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.colliders.push(new THREE.Box3().setFromObject(mesh));
    return mesh;
  }

  // 一键复位全部钢靶
  resetAllTargets() {
    for (const t of this.targets) {
      t.currentAngle = 0;
      t.recoilVel = 0;
      t.isKnockedDown = false;
      if (t.mesh) t.mesh.rotation.x = 0;
    }
  }

  // 每帧更新：反应钢靶物理回弹弹簧模拟
  update(delta) {
    if (delta <= 0) return;
    const clampedDelta = Math.min(delta, 0.05);

    // 靶子受击物理摆动弹簧回归
    for (const t of this.targets) {
      if (t.mesh) {
        // 速度恢复
        t.currentAngle += t.recoilVel * clampedDelta;
        // 强弹簧拉力将靶子拉回垂直原位 (angle = 0)
        const springForce = (0 - t.currentAngle) * 38.0;
        const damping = -t.recoilVel * 7.5;
        t.recoilVel += (springForce + damping) * clampedDelta;

        // 限制在合理旋转区间
        t.currentAngle = Math.max(-Math.PI * 0.65, Math.min(0.08, t.currentAngle));
        t.mesh.rotation.x = t.currentAngle;
      }
    }
  }

  /**
   * 确保 Director 绝不在训练场刷怪
   */
  syncSpawnPointsToDirector(director) {
    if (director) {
      director.enabled = false;
      director.spawnPoints = [];
      director.zombies.forEach((z) => z.destroy());
      director.zombies = [];
    }
  }
}
