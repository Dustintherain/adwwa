import * as THREE from 'three';

export class MapBuilder {
  constructor(scene) {
    this.scene = scene;
    this.colliders = []; // Array of THREE.Box3 for collision
    this.interactiveObjects = []; // Medkits, ammo crates, doors, explosive barrels
    this.spawnPoints = []; // Zombie spawn points
    this.playerSpawn = new THREE.Vector3(0, 1.65, 3);
    this.exitDoor = null;
    this.lights = [];
  }

  buildLevel() {
    this.setupBrightEnvironmentLighting();
    this.buildSafehouse();
    this.buildCorridor();
    this.buildMainCourtyard();
    this.buildDecorationsAndProps();
  }

  setupBrightEnvironmentLighting() {
    // 1. Bright Global Daylight Hemisphere Light (Sky: Soft Blue, Ground: Warm Concrete)
    const hemiLight = new THREE.HemisphereLight(0xe2e8f0, 0x94a3b8, 2.4);
    hemiLight.position.set(0, 20, 0);
    this.scene.add(hemiLight);

    // 2. High-intensity Sunlight casting crisp shadows across the map
    const sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
    sunLight.position.set(15, 25, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 100;
    sunLight.shadow.camera.left = -25;
    sunLight.shadow.camera.right = 25;
    sunLight.shadow.camera.top = 25;
    sunLight.shadow.camera.bottom = -45;
    sunLight.shadow.bias = -0.0005;
    this.scene.add(sunLight);

    // 3. Ambient Fill Light for high-clarity visibility
    const ambientLight = new THREE.AmbientLight(0xcfd8dc, 1.2);
    this.scene.add(ambientLight);
  }

  buildSafehouse() {
    // Starting Safe Room: Bright hospital quarantine room (-5 <= x <= 5, -2 <= z <= 6, height 4)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xdde3ea, // Clean off-white hospital wall
      roughness: 0.5,
      metalness: 0.1,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Light concrete floor
      roughness: 0.4,
      metalness: 0.2,
    });
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.7,
    });

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Ceiling
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 4, 2);
    this.scene.add(ceiling);

    // Back wall (z = 6)
    this.addWall(0, 2, 7, 12, 4, 0.4, wallMat);
    // Left wall (x = -5.5)
    this.addWall(-5.5, 2, 2, 0.4, 4, 10, wallMat);
    // Right wall (x = 5.5)
    this.addWall(5.5, 2, 2, 0.4, 4, 10, wallMat);

    // Front safehouse wall with doorway (z = -2)
    this.addWall(-3.2, 2, -2.5, 4.5, 4, 0.4, wallMat);
    this.addWall(3.2, 2, -2.5, 4.5, 4, 0.4, wallMat);
    // Lintel above door
    this.addWall(0, 3.4, -2.5, 2.2, 1.2, 0.4, wallMat);

    // Yellow Hazard Stripe along door border
    const hazardMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3 });
    const hazardTrimL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.8, 0.42), hazardMat);
    hazardTrimL.position.set(-1.0, 1.4, -2.5);
    this.scene.add(hazardTrimL);

    const hazardTrimR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.8, 0.42), hazardMat);
    hazardTrimR.position.set(1.0, 1.4, -2.5);
    this.scene.add(hazardTrimR);

    // Bright Safehouse Overhead Fluorescent Tube Lights
    const safeLight1 = new THREE.PointLight(0xffffff, 4.0, 14, 1.5);
    safeLight1.position.set(-1.5, 3.5, 2);
    this.scene.add(safeLight1);

    const safeLight2 = new THREE.PointLight(0xffffff, 4.0, 14, 1.5);
    safeLight2.position.set(1.5, 3.5, 2);
    this.scene.add(safeLight2);

    this.addSafehouseProps();
  }

  addSafehouseProps() {
    // Medical Table with First Aid Kit
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.3 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 0.8), tableMat);
    table.position.set(-3.5, 0.45, 4);
    table.castShadow = true;
    table.receiveShadow = true;
    this.scene.add(table);
    this.colliders.push(new THREE.Box3().setFromObject(table));

    // First Aid Kit (Vibrant Red Medkit)
    const medkitMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 });
    const medkit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.28), medkitMat);
    medkit.position.set(-3.5, 1.05, 4);
    medkit.castShadow = true;
    this.scene.add(medkit);

    // White Cross on medkit
    const crossMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.02), crossMat);
    cross1.position.set(-3.5, 1.05, 4.15);
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), crossMat);
    cross2.position.set(-3.5, 1.05, 4.15);
    this.scene.add(cross1);
    this.scene.add(cross2);

    this.interactiveObjects.push({
      type: 'medkit',
      mesh: medkit,
      position: medkit.position.clone(),
      extras: [cross1, cross2],
      used: false,
    });

    // Ammo Supply Crate (Military Olive)
    const ammoMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.5, metalness: 0.4 });
    const ammoCrate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.7), ammoMat);
    ammoCrate.position.set(3.5, 0.35, 4);
    ammoCrate.castShadow = true;
    this.scene.add(ammoCrate);
    this.colliders.push(new THREE.Box3().setFromObject(ammoCrate));

    this.interactiveObjects.push({
      type: 'ammo',
      mesh: ammoCrate,
      position: ammoCrate.position.clone(),
    });
  }

  buildCorridor() {
    // Hallway: bright transit corridor z from -3 to -24, width 5, height 3.8
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e3, roughness: 0.5, metalness: 0.1 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x8294a5, roughness: 0.4, metalness: 0.3 });

    const corridorFloor = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 22), floorMat);
    corridorFloor.rotation.x = -Math.PI / 2;
    corridorFloor.position.set(0, 0, -13.5);
    corridorFloor.receiveShadow = true;
    this.scene.add(corridorFloor);

    // Left corridor wall
    this.addWall(-2.7, 1.9, -13.5, 0.4, 3.8, 22, wallMat);
    // Right corridor wall
    this.addWall(2.7, 1.9, -13.5, 0.4, 3.8, 22, wallMat);

    // Hallway ceiling
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xd5dde5, roughness: 0.7 });
    const corridorCeiling = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 22), ceilingMat);
    corridorCeiling.rotation.x = Math.PI / 2;
    corridorCeiling.position.set(0, 3.8, -13.5);
    this.scene.add(corridorCeiling);

    // Bright Continuous Overhead LED Light Fixtures down the hallway
    [-7, -13, -19].forEach((zPos) => {
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const ledBar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.25), ledMat);
      ledBar.position.set(0, 3.75, zPos);
      this.scene.add(ledBar);

      const light = new THREE.PointLight(0xffffff, 4.5, 12, 1.5);
      light.position.set(0, 3.5, zPos);
      light.castShadow = true;
      this.scene.add(light);
    });

    // Barricade Crates in Corridor (Tactical Cover)
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6, metalness: 0.3 });
    const crate1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.2), crateMat);
    crate1.position.set(-1.2, 0.6, -9);
    crate1.castShadow = true;
    this.scene.add(crate1);
    this.colliders.push(new THREE.Box3().setFromObject(crate1));

    const crate2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.0), crateMat);
    crate2.position.set(1.2, 0.7, -17);
    crate2.castShadow = true;
    this.scene.add(crate2);
    this.colliders.push(new THREE.Box3().setFromObject(crate2));

    // Zombie spawn points
    this.spawnPoints.push(new THREE.Vector3(-1.2, 0, -12));
    this.spawnPoints.push(new THREE.Vector3(1.2, 0, -19));
  }

  buildMainCourtyard() {
    // Ruined outdoor evacuation plaza: z from -25 to -55, width 28
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x788896, // Bright paved plaza ground
      roughness: 0.6,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(32, 36), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -41);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const perimeterMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Light concrete barrier walls
      roughness: 0.7,
      metalness: 0.2,
    });

    // Left boundary wall
    this.addWall(-15.5, 4, -41, 0.8, 8, 36, perimeterMat);
    // Right boundary wall
    this.addWall(15.5, 4, -41, 0.8, 8, 36, perimeterMat);
    // Far extraction wall (z = -58)
    this.addWall(0, 4, -58.5, 32, 8, 0.8, perimeterMat);

    // Extraction Bunker / Rescue Door at z = -58
    const bunkerDoorMat = new THREE.MeshStandardMaterial({
      color: 0x16a34a, // Vibrant Green evac door
      metalness: 0.8,
      roughness: 0.2,
    });
    const bunkerDoor = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.6, 0.25), bunkerDoorMat);
    bunkerDoor.position.set(0, 1.8, -57.8);
    bunkerDoor.castShadow = true;
    this.scene.add(bunkerDoor);
    this.exitDoor = bunkerDoor;

    // Rescue Radio Antenna & Flashing Signal Beacon
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 7), poleMat);
    pole.position.set(2.4, 3.5, -57);
    this.scene.add(pole);

    const beaconLight = new THREE.PointLight(0x22c55e, 6.0, 25, 1.5);
    beaconLight.position.set(2.4, 7, -57);
    this.scene.add(beaconLight);
    this.lights.push({ light: beaconLight, type: 'beacon' });

    // Abandoned Military Transport Truck
    const truckMat = new THREE.MeshStandardMaterial({ color: 0x3f4f3f, roughness: 0.6, metalness: 0.4 });
    const truckBody = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 5.8), truckMat);
    truckBody.position.set(-3.5, 1.2, -37);
    truckBody.rotation.y = 0.4;
    truckBody.castShadow = true;
    truckBody.receiveShadow = true;
    this.scene.add(truckBody);
    this.colliders.push(new THREE.Box3().setFromObject(truckBody));

    // Police Cruiser with Flashing Lightbar
    const carMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.8 });
    const car = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.4, 4.6), carMat);
    car.position.set(5.2, 0.7, -45);
    car.rotation.y = -0.35;
    car.castShadow = true;
    this.scene.add(car);
    this.colliders.push(new THREE.Box3().setFromObject(car));

    const policeLightRed = new THREE.PointLight(0xef4444, 5, 15);
    policeLightRed.position.set(4.9, 1.6, -45);
    this.scene.add(policeLightRed);
    const policeLightBlue = new THREE.PointLight(0x3b82f6, 5, 15);
    policeLightBlue.position.set(5.5, 1.6, -45);
    this.scene.add(policeLightBlue);
    this.lights.push({ light: policeLightRed, type: 'police_red' });
    this.lights.push({ light: policeLightBlue, type: 'police_blue' });

    // Floodlight Tower in Courtyard
    const towerLight = new THREE.SpotLight(0xffffff, 8.0, 45, Math.PI / 3, 0.4, 1.2);
    towerLight.position.set(12, 10, -28);
    towerLight.target.position.set(0, 0, -42);
    towerLight.castShadow = true;
    towerLight.shadow.mapSize.width = 1024;
    towerLight.shadow.mapSize.height = 1024;
    this.scene.add(towerLight);
    this.scene.add(towerLight.target);

    // Zombie spawn points across courtyard
    this.spawnPoints.push(new THREE.Vector3(-9, 0, -32));
    this.spawnPoints.push(new THREE.Vector3(9, 0, -35));
    this.spawnPoints.push(new THREE.Vector3(-8, 0, -46));
    this.spawnPoints.push(new THREE.Vector3(8, 0, -48));
    this.spawnPoints.push(new THREE.Vector3(0, 0, -42));
    this.spawnPoints.push(new THREE.Vector3(-11, 0, -40));
    this.spawnPoints.push(new THREE.Vector3(11, 0, -40));
  }

  buildDecorationsAndProps() {
    // Red Explosive Barrels (Vivid, highly visible)
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      metalness: 0.6,
      roughness: 0.3,
    });
    const barrelPositions = [
      new THREE.Vector3(1.4, 0.6, -11),
      new THREE.Vector3(-1.4, 0.6, -21),
      new THREE.Vector3(-4.5, 0.6, -33),
      new THREE.Vector3(6.2, 0.6, -38),
      new THREE.Vector3(0.5, 0.6, -48),
    ];

    barrelPositions.forEach((pos) => {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.15, 14), barrelMat);
      barrel.position.copy(pos);
      barrel.castShadow = true;
      barrel.receiveShadow = true;
      this.scene.add(barrel);
      const box = new THREE.Box3().setFromObject(barrel);
      this.colliders.push(box);

      this.interactiveObjects.push({
        type: 'barrel',
        mesh: barrel,
        position: pos.clone(),
        health: 30,
        exploded: false,
      });
    });
  }

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

  update(delta, elapsed) {
    this.lights.forEach((item) => {
      if (item.type === 'police_red') {
        item.light.intensity = Math.sin(elapsed * 8) > 0 ? 5.5 : 0;
      } else if (item.type === 'police_blue') {
        item.light.intensity = Math.sin(elapsed * 8 + Math.PI) > 0 ? 5.5 : 0;
      } else if (item.type === 'beacon') {
        item.light.intensity = 4.0 + Math.sin(elapsed * 4) * 2.5;
      }
    });
  }
}
