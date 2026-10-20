import * as THREE from 'three';
import { ZombieEntity } from './zombieEntity.js';
import { soundEngine } from '../audio/soundFX.js';

export class ZombieDirector {
  constructor(scene, spawnPoints) {
    this.scene = scene;
    this.spawnPoints = spawnPoints || [];
    this.zombies = [];

    // Director Pacing
    this.hordeTimer = 0;
    this.hordeInterval = 28; // Horde rush every 28 seconds
    this.stragglerTimer = 0;
    this.tankSpawned = false;
    this.enabled = true; // Set false in Training Mode to prevent all monster spawns

    // Stats
    this.totalKills = 0;
    this.headshots = 0;

    // Callbacks
    this.onHordeAlert = null;
    this.onTankAlert = null;
  }

  spawnZombie(type = 'COMMON', specificPos = null) {
    if (!this.enabled) return null;
    let pos = specificPos;
    if (!pos && this.spawnPoints.length > 0) {
      const idx = Math.floor(Math.random() * this.spawnPoints.length);
      pos = this.spawnPoints[idx].clone();
      // Add slight random offset
      pos.x += (Math.random() - 0.5) * 3;
      pos.z += (Math.random() - 0.5) * 3;
    }
    if (!pos) pos = new THREE.Vector3(0, 0, -20);

    const zombie = new ZombieEntity(this.scene, type, pos);

    // Boomer explosion handler
    zombie.onExplodeCallback = (boomPos, radius, damage) => {
      this.handleAreaExplosion(boomPos, radius, damage);
    };

    this.zombies.push(zombie);
    return zombie;
  }

  triggerHordeRush() {
    if (!this.enabled) return;
    soundEngine.playHordeStinger();
    if (this.onHordeAlert) {
      this.onHordeAlert('THE HORDE IS COMING! // 尸潮来袭！');
    }

    // Spawn 8-12 sprinting common infected
    const hordeCount = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < hordeCount; i++) {
      setTimeout(() => {
        this.spawnZombie('COMMON');
        if (Math.random() < 0.3) {
          soundEngine.playZombieAlert();
        }
      }, i * 250);
    }

    // Chance to spawn Boomer with horde
    if (Math.random() < 0.6) {
      setTimeout(() => {
        this.spawnZombie('BOOMER');
      }, 1500);
    }
  }

  triggerTankEncounter() {
    if (!this.enabled) return;
    this.tankSpawned = true;
    soundEngine.playTankTheme();
    if (this.onTankAlert) {
      this.onTankAlert('WARNING: TANK DETECTED! // 警告：重型TANK突袭！');
    }

    // Spawn Tank in courtyard area (e.g. z = -45)
    const tankPos = new THREE.Vector3(0, 0, -45);
    this.spawnZombie('TANK', tankPos);
  }

  handleRaycast(raycaster, damage, onHitCallback) {
    // Gather all meshes from active zombies
    const targetMeshes = [];
    this.zombies.forEach((z) => {
      if (!z.isDead) {
        z.meshGroup.traverse((child) => {
          if (child.isMesh && child.userData && child.userData.zombie) {
            targetMeshes.push(child);
          }
        });
      }
    });

    const intersects = raycaster.intersectObjects(targetMeshes, false);
    if (intersects.length > 0) {
      const hit = intersects[0];
      const mesh = hit.object;
      const zombie = mesh.userData.zombie;
      const isHead = mesh.userData.isHead || false;

      soundEngine.playHitmarker(isHead);
      zombie.takeDamage(damage, isHead, hit.face ? hit.face.normal : null);

      if (zombie.isDead) {
        this.totalKills++;
        if (isHead) this.headshots++;
      }

      if (onHitCallback) {
        onHitCallback({
          hitPoint: hit.point,
          isHeadshot: isHead,
          killed: zombie.isDead,
        });
      }
      return true;
    }
    return false;
  }

  handleShove(playerPos, playerForward) {
    // Shove all zombies in front of player within 3.5m and 90 degree cone
    const shoveRadius = 3.5;
    let hitAny = false;

    this.zombies.forEach((z) => {
      if (z.isDead) return;
      const toZombie = new THREE.Vector3().subVectors(z.meshGroup.position, playerPos);
      toZombie.y = 0;
      const dist = toZombie.length();

      if (dist <= shoveRadius) {
        toZombie.normalize();
        const dot = playerForward.dot(toZombie);
        if (dot > 0.4) {
          // In front cone
          z.stagger(playerForward);
          hitAny = true;
        }
      }
    });

    if (hitAny) {
      soundEngine.playMeleeShove(true);
    }
  }

  handleAreaExplosion(center, radius, maxDamage) {
    this.zombies.forEach((z) => {
      if (z.isDead) return;
      const dist = z.meshGroup.position.distanceTo(center);
      if (dist <= radius) {
        const falloff = 1 - dist / radius;
        const dmg = maxDamage * falloff;
        z.takeDamage(dmg, false);
        z.stagger(new THREE.Vector3().subVectors(z.meshGroup.position, center).normalize());
        if (z.isDead) this.totalKills++;
      }
    });
  }

  update(delta, playerPos, onAttackPlayer) {
    if (!this.enabled) return;

    // 1. Horde pacing timer
    this.hordeTimer += delta;
    if (this.hordeTimer >= this.hordeInterval) {
      this.hordeTimer = 0;
      this.triggerHordeRush();
    }

    // 2. Straggler ambient spawning
    this.stragglerTimer += delta;
    if (this.stragglerTimer > 6.0 && this.zombies.filter(z => !z.isDead).length < 15) {
      this.stragglerTimer = 0;
      this.spawnZombie('COMMON');
    }

    // 3. Tank trigger when player enters courtyard (z <= -28)
    if (!this.tankSpawned && playerPos.z <= -28) {
      this.triggerTankEncounter();
    }

    // 4. Update all active zombies
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      z.update(delta, playerPos, onAttackPlayer);
    }

    // Clean up dead zombies removed from scene
    this.zombies = this.zombies.filter((z) => z.meshGroup.parent !== null);
  }

  destroy() {
    this.zombies.forEach((z) => z.destroy());
    this.zombies = [];
  }
}
