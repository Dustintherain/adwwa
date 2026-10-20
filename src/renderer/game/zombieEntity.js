import * as THREE from 'three';
import { soundEngine } from '../audio/soundFX.js';

export class ZombieEntity {
  constructor(scene, type = 'COMMON', spawnPos) {
    this.scene = scene;
    this.type = type; // 'COMMON', 'BOOMER', 'TANK'

    // Stats based on type
    if (type === 'TANK') {
      this.maxHealth = 1200;
      this.speed = 4.2;
      this.damage = 32;
      this.scale = 1.6;
    } else if (type === 'BOOMER') {
      this.maxHealth = 150;
      this.speed = 2.4;
      this.damage = 18;
      this.scale = 1.25;
    } else {
      // COMMON
      this.maxHealth = 80;
      this.speed = 4.5 + Math.random() * 1.5;
      this.damage = 10;
      this.scale = 1.0;
    }

    this.health = this.maxHealth;
    this.isDead = false;
    this.state = 'CHASE'; // 'IDLE', 'CHASE', 'ATTACK', 'STAGGERED', 'DEAD'

    this.staggerTimer = 0;
    this.attackCooldown = 0.8;
    this.lastAttackTime = 0;

    this.meshGroup = new THREE.Group();
    this.headMesh = null;
    this.bodyMesh = null;
    this.leftArm = null;
    this.rightArm = null;
    this.leftLeg = null;
    this.rightLeg = null;

    this.buildZombieMesh();
    this.meshGroup.position.copy(spawnPos);
    this.scene.add(this.meshGroup);

    this.animTimer = Math.random() * 10;
  }

  buildZombieMesh() {
    const s = this.scale;
    // Materials
    let skinColor = 0x4a5d4e; // Infected grey-green
    if (this.type === 'TANK') skinColor = 0x3d434d;
    if (this.type === 'BOOMER') skinColor = 0x5a6344;

    const skinMat = new THREE.MeshStandardMaterial({
      color: skinColor,
      roughness: 0.85,
      metalness: 0.1,
    });
    const clothesMat = new THREE.MeshStandardMaterial({
      color: this.type === 'TANK' ? 0x1f2421 : 0x27303f,
      roughness: 0.9,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 }); // Glowing infected red eyes

    // 1. Torso
    const torsoW = (this.type === 'BOOMER' ? 0.8 : (this.type === 'TANK' ? 0.9 : 0.5)) * s;
    const torsoH = 0.75 * s;
    const torsoD = (this.type === 'BOOMER' ? 0.75 : 0.35) * s;
    this.bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoD), clothesMat);
    this.bodyMesh.position.y = 1.05 * s;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyMesh.userData = { zombie: this, isHead: false };
    this.meshGroup.add(this.bodyMesh);

    // 2. Head (Critical Hit Zone)
    const headSize = (this.type === 'TANK' ? 0.45 : 0.35) * s;
    this.headMesh = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), skinMat);
    this.headMesh.position.set(0, 1.62 * s, 0);
    this.headMesh.castShadow = true;
    this.headMesh.userData = { zombie: this, isHead: true };
    this.meshGroup.add(this.headMesh);

    // Glowing Eyes
    const eye1 = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.04 * s, 0.04 * s), eyeMat);
    eye1.position.set(-0.08 * s, 0.04 * s, 0.18 * s);
    const eye2 = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.04 * s, 0.04 * s), eyeMat);
    eye2.position.set(0.08 * s, 0.04 * s, 0.18 * s);
    this.headMesh.add(eye1);
    this.headMesh.add(eye2);

    // 3. Arms (Claws outstretched forward in sprint)
    const armW = 0.16 * s;
    const armH = 0.7 * s;
    this.leftArm = new THREE.Mesh(new THREE.BoxGeometry(armW, armH, armW), skinMat);
    this.leftArm.position.set(-(torsoW * 0.5 + armW * 0.5), 1.25 * s, 0.25 * s);
    this.leftArm.rotation.x = -Math.PI / 2.5; // Raised forward to attack
    this.leftArm.castShadow = true;
    this.leftArm.userData = { zombie: this, isHead: false };
    this.meshGroup.add(this.leftArm);

    this.rightArm = new THREE.Mesh(new THREE.BoxGeometry(armW, armH, armW), skinMat);
    this.rightArm.position.set(torsoW * 0.5 + armW * 0.5, 1.25 * s, 0.25 * s);
    this.rightArm.rotation.x = -Math.PI / 2.3;
    this.rightArm.castShadow = true;
    this.rightArm.userData = { zombie: this, isHead: false };
    this.meshGroup.add(this.rightArm);

    // 4. Legs
    const legW = 0.18 * s;
    const legH = 0.75 * s;
    this.leftLeg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), clothesMat);
    this.leftLeg.position.set(-0.16 * s, 0.38 * s, 0);
    this.leftLeg.castShadow = true;
    this.meshGroup.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), clothesMat);
    this.rightLeg.position.set(0.16 * s, 0.38 * s, 0);
    this.rightLeg.castShadow = true;
    this.meshGroup.add(this.rightLeg);
  }

  takeDamage(amount, isHeadshot = false, hitNormal) {
    if (this.isDead) return;

    const actualDamage = isHeadshot ? amount * 3.0 : amount;
    this.health -= actualDamage;

    // Flash white/red on hit
    this.flashHit();

    if (this.health <= 0) {
      this.die(isHeadshot);
    } else {
      // Small flinch
      this.meshGroup.position.y += 0.05;
      if (Math.random() < 0.25) {
        soundEngine.playZombieGroan(this.type === 'TANK' ? 0.6 : 1.2);
      }
    }
  }

  flashHit() {
    this.meshGroup.traverse((child) => {
      if (child.isMesh && child.material && child.material.color) {
        const orig = child.material.color.clone();
        child.material.color.setHex(0xff3333);
        setTimeout(() => {
          if (child && child.material && child.material.color) {
            child.material.color.copy(orig);
          }
        }, 60);
      }
    });
  }

  stagger(dir) {
    if (this.isDead || this.type === 'TANK') return; // Tank cannot be shoved easily
    this.state = 'STAGGERED';
    this.staggerTimer = 1.2;
    this.staggerDir = dir.clone().normalize();
  }

  die(isHeadshot) {
    this.isDead = true;
    this.state = 'DEAD';

    soundEngine.playFleshImpact(true);

    if (isHeadshot && this.headMesh) {
      // Pop head off into blood particles
      this.headMesh.visible = false;
      this.createBloodBurst(this.headMesh.getWorldPosition(new THREE.Vector3()));
    }

    if (this.type === 'BOOMER') {
      // Explode toxic AoE
      this.explodeBoomer();
    } else {
      // Collapse ragdoll animation: tip over backward
      const tipOver = () => {
        if (!this.meshGroup) return;
        this.meshGroup.rotation.x = -Math.PI / 2;
        this.meshGroup.position.y = 0.2 * this.scale;
      };
      tipOver();
    }

    // Fade out and remove after 4 seconds
    setTimeout(() => {
      this.destroy();
    }, 4000);
  }

  createBloodBurst(pos) {
    const particleCount = 20;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const vels = [];

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      vels.push(new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 4
      ));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0x990000, size: 0.12 });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    let frames = 0;
    const animBurst = () => {
      frames++;
      const posArr = points.geometry.attributes.position.array;
      for (let i = 0; i < particleCount; i++) {
        posArr[i * 3] += vels[i].x * 0.016;
        posArr[i * 3 + 1] += vels[i].y * 0.016;
        posArr[i * 3 + 2] += vels[i].z * 0.016;
        vels[i].y -= 9.8 * 0.016; // gravity
      }
      points.geometry.attributes.position.needsUpdate = true;
      if (frames < 40) {
        requestAnimationFrame(animBurst);
      } else {
        this.scene.remove(points);
      }
    };
    animBurst();
  }

  explodeBoomer() {
    this.createBloodBurst(this.meshGroup.position);
    soundEngine.playFleshImpact(true);

    if (this.onExplodeCallback) {
      this.onExplodeCallback(this.meshGroup.position, 6.0, 45); // 6m radius, 45 damage
    }
  }

  update(delta, playerPos, onAttackPlayer) {
    if (this.isDead) return;

    this.animTimer += delta * 12;

    // 1. Staggered State (from weapon shove)
    if (this.state === 'STAGGERED') {
      this.staggerTimer -= delta;
      this.meshGroup.position.addScaledVector(this.staggerDir, delta * 3.5);
      this.meshGroup.rotation.x = 0.35; // Reeling backward

      if (this.staggerTimer <= 0) {
        this.state = 'CHASE';
        this.meshGroup.rotation.x = 0;
      }
      return;
    }

    // 2. Navigation & Chase player
    const distToPlayer = this.meshGroup.position.distanceTo(playerPos);

    // Look at player (Y axis only)
    const targetDir = new THREE.Vector3().subVectors(playerPos, this.meshGroup.position);
    targetDir.y = 0;
    const angle = Math.atan2(targetDir.x, targetDir.z);
    this.meshGroup.rotation.y = angle;

    // 3. Attack or Chase
    const attackRange = 1.7 * this.scale;
    if (distToPlayer <= attackRange) {
      // Melee attack range
      this.state = 'ATTACK';
      const now = performance.now() / 1000;
      if (now - this.lastAttackTime > this.attackCooldown) {
        this.lastAttackTime = now;
        // Claw swipe animation
        if (this.leftArm && this.rightArm) {
          this.leftArm.rotation.x = -Math.PI / 1.8;
          setTimeout(() => {
            if (this.leftArm) this.leftArm.rotation.x = -Math.PI / 2.5;
          }, 200);
        }
        if (onAttackPlayer) {
          onAttackPlayer(this.damage, this.meshGroup.position);
        }
      }
    } else {
      // Sprint chase
      this.state = 'CHASE';
      targetDir.normalize();
      this.meshGroup.position.addScaledVector(targetDir, this.speed * delta);

      // Running animation (swinging arms and legs)
      const legSwing = Math.sin(this.animTimer) * 0.7;
      if (this.leftLeg) this.leftLeg.rotation.x = legSwing;
      if (this.rightLeg) this.rightLeg.rotation.x = -legSwing;

      const armSwing = Math.cos(this.animTimer) * 0.4;
      if (this.leftArm) this.leftArm.rotation.x = -Math.PI / 2.5 + armSwing;
      if (this.rightArm) this.rightArm.rotation.x = -Math.PI / 2.3 - armSwing;
    }
  }

  destroy() {
    this.scene.remove(this.meshGroup);
  }
}
