import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import { soundEngine } from '../audio/soundFX.js';

export class ImpactFX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    this.tracers = [];
    this.particles = [];
    this.shells = [];
    this.droppedMagazines = [];
    this.damageNumbersContainer = document.getElementById('damage-numbers-layer');

    if (!this.damageNumbersContainer) {
      this.damageNumbersContainer = document.createElement('div');
      this.damageNumbersContainer.id = 'damage-numbers-layer';
      document.body.appendChild(this.damageNumbersContainer);
    }
  }

  // 1. High-Velocity Bullet Tracer Beam
  createBulletTracer(startPos, endPos) {
    const dir = new THREE.Vector3().subVectors(endPos, startPos);
    const length = dir.length();

    // Beam line
    const geo = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xfff0aa,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);

    this.tracers.push({
      mesh: line,
      life: 0.08,
      maxLife: 0.08,
    });
  }

  // 2. Concrete/Metal Sparks on Wall Impact
  createSparkBurst(pos, normal) {
    const count = 16;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];

    const norm = normal ? normal.clone() : new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;

      // Cone bounce around normal
      const randDir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize();

      const vel = new THREE.Vector3()
        .copy(norm)
        .addScaledVector(randDir, 0.8)
        .normalize()
        .multiplyScalar(4 + Math.random() * 6);

      velocities.push(vel);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffe066,
      size: 0.09,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    this.particles.push({
      mesh: points,
      velocities: velocities,
      life: 0.35,
      maxLife: 0.35,
      gravity: -16,
    });
  }

  // 3. Zombie Flesh / Blood Splatter Spray
  createBloodSpray(pos, isHeadshot = false) {
    const count = isHeadshot ? 38 : 20;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;

      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * (isHeadshot ? 6.5 : 4.0),
        Math.random() * (isHeadshot ? 5.5 : 3.0) + 1.0,
        (Math.random() - 0.5) * (isHeadshot ? 6.5 : 4.0)
      ));
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: isHeadshot ? 0xb91c1c : 0x880000,
      size: isHeadshot ? 0.16 : 0.11,
      transparent: true,
      opacity: 0.95,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    this.particles.push({
      mesh: points,
      velocities: velocities,
      life: 0.55,
      maxLife: 0.55,
      gravity: -20,
    });
  }

  // 4. Physical Brass Shell Casing Ejection
  ejectShellCasing(startPos, playerYaw) {
    const geo = new THREE.CylinderGeometry(0.015, 0.015, 0.06, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.85,
      roughness: 0.25,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(startPos);
    this.scene.add(mesh);

    // Eject to the right and slightly back relative to player yaw
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerYaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerYaw);

    const vel = new THREE.Vector3()
      .addScaledVector(right, 2.2 + Math.random() * 0.8)
      .addScaledVector(forward, -0.6)
      .add(new THREE.Vector3(0, 2.8 + Math.random() * 0.6, 0));

    const rotVel = new THREE.Vector3(
      Math.random() * 20 - 10,
      Math.random() * 20 - 10,
      Math.random() * 20 - 10
    );

    this.shells.push({
      mesh: mesh,
      vel: vel,
      rotVel: rotVel,
      life: 2.5,
      bounced: false,
    });
  }

  setMagazineModel(geo, mat, scale = 1.0) {
    this.customMagGeo = geo;
    this.customMagMat = mat;
    this.customMagScale = scale;
  }

  // 5. Physical Dropped Magazine Ejection on Reload
  ejectPhysicalMagazine(startPos, playerYaw) {
    let magMesh;

    if (this.customMagGeo && this.customMagMat) {
      // Authentic Shiroko 3D Magazine disassembled from weapon GLB
      magMesh = new THREE.Mesh(this.customMagGeo, this.customMagMat);
      magMesh.scale.setScalar(this.customMagScale || 1.0);
      magMesh.castShadow = false;
      magMesh.receiveShadow = false;
    } else {
      // Fallback procedural tactical magazine
      const magGroup = new THREE.Group();
      const mGeo = new THREE.BoxGeometry(0.026, 0.16, 0.065);
      const mMat = new THREE.MeshStandardMaterial({
        color: 0x1e2430,
        roughness: 0.55,
        metalness: 0.25,
      });
      magGroup.add(new THREE.Mesh(mGeo, mMat));

      const plateGeo = new THREE.BoxGeometry(0.03, 0.015, 0.07);
      const plateMat = new THREE.MeshStandardMaterial({
        color: 0x111317,
        roughness: 0.35,
        metalness: 0.5,
      });
      const plateMesh = new THREE.Mesh(plateGeo, plateMat);
      plateMesh.position.set(0, -0.08, 0);
      magGroup.add(plateMesh);

      const bandGeo = new THREE.BoxGeometry(0.027, 0.018, 0.066);
      const bandMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        roughness: 0.4,
        metalness: 0.3,
      });
      const bandMesh = new THREE.Mesh(bandGeo, bandMat);
      bandMesh.position.set(0, 0.02, 0);
      magGroup.add(bandMesh);

      magMesh = magGroup;
    }

    magMesh.position.copy(startPos);
    this.scene.add(magMesh);

    // Initial drop velocity: slight downward nudge + forward/left tumble
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerYaw);
    const left = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerYaw);

    const vel = new THREE.Vector3()
      .addScaledVector(left, 0.35 + Math.random() * 0.25)
      .addScaledVector(forward, 0.25 + Math.random() * 0.2)
      .add(new THREE.Vector3(0, -0.8 - Math.random() * 0.3, 0));

    const rotVel = new THREE.Vector3(
      Math.random() * 6 - 3,
      Math.random() * 4 - 2,
      Math.random() * 8 - 4
    );

    this.droppedMagazines.push({
      mesh: magMesh,
      vel: vel,
      rotVel: rotVel,
      life: 8.0,
      bounced: false,
    });
  }

  // 6. Floating RPG / Arcade Damage Numbers
  spawnDamageNumber(worldPos, damage, isHeadshot = false) {
    const elem = document.createElement('div');
    elem.className = `dmg-number ${isHeadshot ? 'dmg-crit' : 'dmg-normal'}`;
    elem.textContent = isHeadshot ? `-${Math.round(damage)} CRIT!` : `-${Math.round(damage)}`;
    this.damageNumbersContainer.appendChild(elem);

    const pos = worldPos.clone();
    pos.x += (Math.random() - 0.5) * 0.4;
    pos.y += Math.random() * 0.3;

    const animData = { yOffset: 0, opacity: 1, scale: isHeadshot ? 1.4 : 1.0 };

    new TWEEN.Tween(animData)
      .to({ yOffset: 0.8, opacity: 0, scale: isHeadshot ? 1.8 : 1.2 }, 750)
      .easing(TWEEN.Easing.Back.Out)
      .onUpdate(() => {
        // Project 3D world coord to 2D screen coordinate
        const screenPos = pos.clone().add(new THREE.Vector3(0, animData.yOffset, 0)).project(this.camera);
        const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;

        elem.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${animData.scale})`;
        elem.style.opacity = animData.opacity;
      })
      .onComplete(() => {
        elem.remove();
      })
      .start();
  }

  update(delta) {
    TWEEN.update();

    // 1. Update Tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= delta;
      t.mesh.material.opacity = t.life / t.maxLife;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        this.tracers.splice(i, 1);
      }
    }

    // 2. Update Particles (Sparks & Blood)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta;
      const progress = p.life / p.maxLife;

      p.mesh.material.opacity = progress;
      const posArr = p.mesh.geometry.attributes.position.array;

      for (let j = 0; j < p.velocities.length; j++) {
        const vel = p.velocities[j];
        posArr[j * 3] += vel.x * delta;
        posArr[j * 3 + 1] += vel.y * delta;
        posArr[j * 3 + 2] += vel.z * delta;
        vel.y += p.gravity * delta; // apply gravity
      }
      p.mesh.geometry.attributes.position.needsUpdate = true;

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }

    // 3. Update Shell Casings
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= delta;

      s.vel.y -= 18 * delta; // Gravity
      s.mesh.position.addScaledVector(s.vel, delta);
      s.mesh.rotation.x += s.rotVel.x * delta;
      s.mesh.rotation.y += s.rotVel.y * delta;
      s.mesh.rotation.z += s.rotVel.z * delta;

      // Floor bounce check
      if (s.mesh.position.y <= 0.05) {
        s.mesh.position.y = 0.05;
        s.vel.y = -s.vel.y * 0.45; // Bounce
        s.vel.x *= 0.6;
        s.vel.z *= 0.6;
        s.rotVel.multiplyScalar(0.5);
      }

      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.shells.splice(i, 1);
      }
    }

    // 4. Update Dropped Magazines
    for (let i = this.droppedMagazines.length - 1; i >= 0; i--) {
      const m = this.droppedMagazines[i];
      m.life -= delta;

      m.vel.y -= 19 * delta; // Gravity
      m.mesh.position.addScaledVector(m.vel, delta);
      m.mesh.rotation.x += m.rotVel.x * delta;
      m.mesh.rotation.y += m.rotVel.y * delta;
      m.mesh.rotation.z += m.rotVel.z * delta;

      // Floor bounce check (tactical magazine bouncing on concrete)
      if (m.mesh.position.y <= 0.08) {
        m.mesh.position.y = 0.08;
        if (!m.bounced) {
          m.bounced = true;
          soundEngine.playMagDropGround();
        }
        m.vel.y = -m.vel.y * 0.35; // Dull bounce
        m.vel.x *= 0.55;
        m.vel.z *= 0.55;
        m.rotVel.multiplyScalar(0.4);
      }

      if (m.life <= 0) {
        this.scene.remove(m.mesh);
        this.droppedMagazines.splice(i, 1);
      }
    }
  }

  destroy() {
    this.tracers.forEach(t => this.scene.remove(t.mesh));
    this.particles.forEach(p => this.scene.remove(p.mesh));
    this.shells.forEach(s => this.scene.remove(s.mesh));
    this.droppedMagazines.forEach(m => this.scene.remove(m.mesh));
    this.tracers = [];
    this.particles = [];
    this.shells = [];
    this.droppedMagazines = [];
    if (this.damageNumbersContainer) {
      this.damageNumbersContainer.innerHTML = '';
    }
  }
}
