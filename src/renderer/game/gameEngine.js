import * as THREE from 'three';
import { MapBuilder } from './mapBuilder.js';
import { TrainingMapBuilder } from './trainingMap.js';
import { FPSController } from './fpsController.js';
import { WeaponController } from './weaponController.js';
import { ZombieDirector } from './zombieDirector.js';
import { GameHUD } from './gameHUD.js';
import { PhysicsWorld } from './physicsWorld.js';
import { CameraShake } from './cameraShake.js';
import { ImpactFX } from './impactFX.js';
import { CharacterModel } from './characterModel.js';
import { soundEngine } from '../audio/soundFX.js';
import { LightCones } from './lightCones.js';

export class GameEngine {
  /**
   * @param {HTMLElement} canvasContainer
   * @param {() => void} onReturnToMenu
   * @param {{ useTrainingMap?: boolean }} [options]
   */
  constructor(
    canvasContainer,
    onReturnToMenu,
    options = {},
  ) {
    this.container = canvasContainer;
    this.onReturnToMenu = onReturnToMenu;
    this._useTrainingMap = Boolean(options.useTrainingMap);

    this.scene = null;
    this.camera = null;
    this.renderer = null;

    this.map = null;
    this.player = null;
    this.character = null;
    this.weapon = null;
    this.director = null;
    this.hud = null;

    // Advanced Physics & Combat Juice systems
    this.physics = null;
    this.cameraShake = null;
    this.impactFX = null;

    this.clock = new THREE.Clock();
    this.isRunning = false;
    this.isPaused = false;
    this.gameEnded = false;
    this.destroyed = false;

    this.init();
  }

  init() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // Reset run state so restarts (after death / victory) never start frozen
    this.gameEnded = false;
    this.isPaused = false;
    this.destroyed = false;
    this.clock.start();
    this.clock.getDelta();

    // 1. Scene & High-Visibility Bright Atmosphere
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x738a9c);
    this.scene.fog = new THREE.FogExp2(0x738a9c, 0.010);

    // 2. Camera (CRITICAL: Added to scene so viewmodel weapon is rendered; near=0.01 prevents arm near-clipping)
    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 150);
    this.camera.position.set(0, 1.65, 3);
    this.scene.add(this.camera);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;

    // Clear previous canvases if any
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
    this.container.appendChild(this.renderer.domElement);

    // 4. Cannon-es Physics World
    this.physics = new PhysicsWorld();

    // 5. Build Map (campaign or training arena)
    // Allow the game to start on the training course when this flag is enabled.
    const useTrainingMap = this._useTrainingMap;

    if (useTrainingMap) {
      const trainingBuilder = new TrainingMapBuilder(this.scene);
      trainingBuilder.buildLevel();
      this.map = trainingBuilder;
    } else {
      this.map = new MapBuilder(this.scene);
      this.map.buildLevel();
    }

    // Hook explosive barrels and crates into Cannon-es Physics World
    this.map.interactiveObjects.forEach((obj) => {
      if (obj.type === 'barrel') {
        obj.physicsBody = this.physics.addDynamicCylinder(obj.mesh, 0.38, 1.15, 18);
      }
    });

    // 6. Player FPS Controller
    this.player = new FPSController(
      this.camera,
      this.renderer.domElement,
      this.map.colliders,
    );
    this.player.position.copy(this.map.playerSpawn);

    // 7. Koharu 3D Character Model (Anime character entity)
    this.character = new CharacterModel(this.scene);

    // 8. Weapon Controller
    this.weapon = new WeaponController(this.camera, this.scene);
    this.weapon.player = this.player;
    this.player.weapon = this.weapon;

    // 提取现有角色模型的手臂模型并挂载到第一人称枪械模型上
    this.character.onArmsExtracted = (armMeshes, armRig, material) => {
      this.weapon.attachCharacterArms(armMeshes, armRig, material);
    };
    if (this.character.armSegmentMeshes && this.character.hasArmRig) {
      this.weapon.attachCharacterArms(this.character.armSegmentMeshes, this.character.armRig, this.character.bodyMaterial);
    }

    // 初始第一人称视角：隐藏第三人称全身模型，显示 Viewmodel（手臂与枪械模型）
    this.character.root.visible = false;
    this.weapon.viewmodelRoot.visible = true;

    // 10. Zombie Director
    this.director = new ZombieDirector(this.scene, this._useTrainingMap ? [] : this.map.spawnPoints);
    if (this._useTrainingMap) {
      this.director.enabled = false;
    }

    // 11. Combat Juice & Impact FX
    this.cameraShake = new CameraShake();
    this.impactFX = new ImpactFX(this.scene, this.camera);

    // 12. Neon Beam Cannon (light-cones that lock onto a target point)
    this.lightCones = new LightCones(this.scene);

    // 12. Game HUD
    this.hud = new GameHUD();
    // HUD container is display:none by default — must be shown or the whole HUD
    // (crosshair, health, pause menu and the game-over modal) stays invisible
    this.hud.setVisible(true);

    // Wire up events and interactions
    this.setupInteractions();

    // Resize event
    this.onWindowResize = () => {
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this.onWindowResize);

    // Pause Key (ESC)
    this.onKeyDown = (e) => {
      if (e.code === 'Escape' && !this.gameEnded) {
        this.togglePause();
      }
    };
    window.addEventListener('keydown', this.onKeyDown);

    // Initial horde alert
    setTimeout(() => {
      this.director.triggerHordeRush();
    }, 4500);

    // 光锥初始锁定目标：玩家前方一点 + 终点安全室方向，营造“聚焦炮瞄准着终点”的氛围
    this.lightCones.target(this.player.position.clone().add(new THREE.Vector3(0, 1.2, -6)));
    this.lightCones.target(new THREE.Vector3(0, 2.4, -82)); // 撤离安全室靠近处

    // Start game loop
    this.isRunning = true;
    this.player.lockPointer();
    this.animate();
  }

  setupInteractions() {
    // 0. Perspective change (First-Person vs Third-Person Over-the-Shoulder)
    this.player.onPerspectiveChange = (isThirdPerson) => {
      if (this.character) {
        this.character.setPerspective(isThirdPerson);
        // 第一人称严格限制只看手臂模型与枪械，隐藏第三人称全身；第三人称显示全身
        this.character.root.visible = isThirdPerson;
      }
      if (this.weapon) {
        // 第一人称显示 Viewmodel（手臂与枪械），第三人称隐藏 Viewmodel
        this.weapon.viewmodelRoot.visible = !isThirdPerson;
      }
    };

    // 0.1 Model Switch (KeyM: Three.js Official Soldier.glb vs Koharu.glb)
    this.player.onModelSwitch = () => {
      if (this.character) {
        const newType = this.character.switchCharacterModel();
        if (this.hud) {
          const desc = newType === 'soldier'
            ? 'Three.js 官方战术士兵 (Soldier.glb / AnimationMixer 骨骼动画)'
            : '碧蓝档案小春 (Koharu.glb / SkinnedMesh)';
          this.hud.setInteractPrompt(`[M] 切换角色模型: ${desc}`);
          setTimeout(() => { if (this.hud) this.hud.setInteractPrompt(null); }, 3000);
        }
      }
    };

    // 1. Weapon Gunfire Ejection (No screen shake, gun vibrates internally)
    this.weapon.onFireCallback = (muzzlePos) => {
      this.impactFX.ejectShellCasing(muzzlePos, this.player.euler.y);
      if (this.character) {
        this.character.triggerFireFX();
      }
    };

    // 2. Weapon Hitscan Raycasting with Physical Impulses & Visual Feedback
    this.weapon.onHitCallback = (raycaster, damage, muzzlePos) => {
      // Check if hit zombie
      let hitSomething = false;

      const hitZombie = this.director.handleRaycast(raycaster, damage, (result) => {
        hitSomething = true;
        this.hud.showHitmarker(result.isHeadshot);

        // Tactile hit feedback directly on the GUN (not screen shake!)
        this.weapon.onHitImpactFeedback(result.isHeadshot);

        // Visual Juice: Tracer beam, blood particles & floating damage number
        this.impactFX.createBulletTracer(muzzlePos, result.hitPoint);
        this.impactFX.createBloodSpray(result.hitPoint, result.isHeadshot);
        this.impactFX.spawnDamageNumber(
          result.hitPoint,
          result.isHeadshot ? damage * 3 : damage,
          result.isHeadshot
        );
      });

      // Check if hit explosive barrel or interactive targets
      if (!hitZombie) {
        for (let i = 0; i < this.map.interactiveObjects.length; i++) {
          const obj = this.map.interactiveObjects[i];
          if (obj.type === 'barrel' && !obj.exploded) {
            const intersects = raycaster.intersectObject(obj.mesh, false);
            if (intersects.length > 0) {
              hitSomething = true;
              const hit = intersects[0];
              obj.health -= damage;

              // Tactile hit feedback on gun
              this.weapon.onHitImpactFeedback(false);

              this.impactFX.createBulletTracer(muzzlePos, hit.point);
              this.impactFX.createSparkBurst(hit.point, hit.face ? hit.face.normal : null);
              this.impactFX.spawnDamageNumber(hit.point, damage, false);

              // Apply Rapier3D kinetic impulse to barrel
              this.physics.applyBulletHitImpulse(obj.mesh, hit.point, raycaster.ray.direction, 6.0);

              soundEngine.playFleshImpact(true);
              if (obj.health <= 0) {
                this.detonateBarrel(obj);
              }
              break;
            }
          } else if (obj.type === 'target' && obj.mesh) {
            const intersects = raycaster.intersectObject(obj.mesh, true);
            if (intersects.length > 0) {
              hitSomething = true;
              const hit = intersects[0];
              const isBullseye = (hit.point.y - obj.position.y) > 0.35 || (hit.object && hit.object.geometry && hit.object.geometry.type && hit.object.geometry.type.includes('Circle'));
              const actualDamage = isBullseye ? damage * 2 : damage;

              // Tactile hit feedback on gun and hitmarker
              this.weapon.onHitImpactFeedback(isBullseye);
              this.hud.showHitmarker(isBullseye);

              this.impactFX.createBulletTracer(muzzlePos, hit.point);
              this.impactFX.createSparkBurst(hit.point, hit.face ? hit.face.normal : null);
              this.impactFX.spawnDamageNumber(hit.point, actualDamage, isBullseye);

              // Satisfying metallic ping sound
              soundEngine.playSteelTargetHit(isBullseye);

              if (typeof obj.onHit === 'function') {
                obj.onHit(isBullseye);
              }
              break;
            }
          }
        }
      }

      // Check if hit environment walls/floors
      if (!hitSomething) {
        const wallMeshes = [];
        this.scene.traverse((c) => {
          if (c.isMesh && c !== this.weapon.weaponMesh && !c.userData.zombie) {
            wallMeshes.push(c);
          }
        });
        const intersects = raycaster.intersectObjects(wallMeshes, false);
        if (intersects.length > 0) {
          const hit = intersects[0];
          this.impactFX.createBulletTracer(muzzlePos, hit.point);
          this.impactFX.createSparkBurst(hit.point, hit.face ? hit.face.normal : null);
        } else {
          // Empty sky tracer
          const farPoint = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 50);
          this.impactFX.createBulletTracer(muzzlePos, farPoint);
        }
      }
    };

    // 3. Weapon Melee Shove: staggers zombies with gun butt forward bash
    this.weapon.onShoveCallback = () => {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.director.handleShove(this.player.position, forward);
    };

    // 4. Weapon Tactical Reload Physical Magazine Drop
    this.weapon.onEjectMagazineCallback = (magWellPos) => {
      this.impactFX.ejectPhysicalMagazine(magWellPos, this.player.euler.y);
    };

    // Disassembled authentic 3D magazine support for physical floor drops
    this.weapon.onDisassembled = (magGeo, magMat, scale) => {
      this.impactFX.setMagazineModel(magGeo, magMat, scale);
    };
    if (this.weapon.standaloneMagGeo && this.weapon.weaponMaterial) {
      this.impactFX.setMagazineModel(this.weapon.standaloneMagGeo, this.weapon.weaponMaterial, this.weapon.modelScale);
    }

    // 5. Zombie Attacks Player
    const onZombieAttack = (damage, zombiePos) => {
      if (this.gameEnded) return;
      this.player.takeDamage(damage, zombiePos);
      this.cameraShake.addTrauma(0.42);
      this.hud.showDamageFlash();
    };
    this.onZombieAttack = onZombieAttack;

    // Director Alerts to HUD
    this.director.onHordeAlert = (msg) => {
      this.cameraShake.addTrauma(0.35);
      this.hud.showHordeBanner(msg);
    };
    this.director.onTankAlert = (msg) => {
      this.cameraShake.addTrauma(0.5);
      this.hud.showHordeBanner(msg);
    };

    // Player Death
    this.player.onDeathCallback = () => {
      this.cameraShake.addTrauma(0.8);
      this.triggerGameOver(false);
    };

    // HUD Button Handlers
    this.hud.onResume = () => {
      this.isPaused = false;
      this.player.lockPointer();
    };

    this.hud.onRestart = () => {
      this.restart();
    };

    this.hud.onQuitToMenu = () => {
      this.destroy();
      if (this.onReturnToMenu) this.onReturnToMenu();
    };
  }

  detonateBarrel(barrelObj) {
    barrelObj.exploded = true;
    barrelObj.mesh.visible = false;
    soundEngine.playFleshImpact(true);
    soundEngine.playHordeStinger();

    const boomPos = barrelObj.position;

    // 1. Visceral Camera Shock
    this.cameraShake.addTrauma(0.9);

    // 2. Rapier3D WASM Physical Explosion Impulse
    this.physics.applyExplosionImpulse(boomPos, 9.5, 520);

    // 3. Damage zombies in radius
    this.director.handleAreaExplosion(boomPos, 8.0, 130);

    // 4. Damage number for explosion
    this.impactFX.spawnDamageNumber(boomPos, 130, true);

    // 5. Damage player if nearby
    const distToPlayer = this.player.position.distanceTo(boomPos);
    if (distToPlayer < 6.5) {
      this.player.takeDamage(Math.round(45 * (1 - distToPlayer / 6.5)), boomPos);
      this.hud.showDamageFlash();
    }
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.hud.showPauseMenu();
      this.player.unlockPointer();
    } else {
      this.hud.hidePauseMenu();
      this.player.lockPointer();
    }
  }

  triggerGameOver(victory) {
    this.gameEnded = true;
    this.player.unlockPointer();
    this.hud.showEndModal(victory, this.director.totalKills, this.director.headshots);
  }

  checkPlayerInteractables() {
    const pPos = this.player.position;
    let promptText = null;

    this.map.interactiveObjects.forEach((obj) => {
      if (obj.used) return;
      const dist = pPos.distanceTo(obj.position);
      if (dist < 2.2) {
        if (obj.type === 'medkit' && this.player.medkits < 2) {
          promptText = '[E] 拾取急救包 (MEDKIT)';
          if (this.player.keys.interact) {
            this.player.medkits++;
            obj.used = true;
            obj.mesh.visible = false;
            if (obj.extras) obj.extras.forEach((e) => (e.visible = false));
            soundEngine.playSelect();
          }
        } else if (obj.type === 'ammo') {
          promptText = '[E] 补给突击步枪弹药 (RESTOCK AMMO)';
          if (this.player.keys.interact) {
            this.weapon.reserveAmmo = 180;
            soundEngine.playWeaponAction();
          }
        } else if (obj.type === 'reset_targets') {
          promptText = '[E] 复位全部靶位 (RESET TARGETS)';
          if (this.player.keys.interact) {
            if (typeof obj.onUse === 'function') obj.onUse();
            soundEngine.playSelect();
          }
        }
      }
    });

    // Check Victory Door at courtyard end (z <= -55) in Campaign mode
    if (!this.gameEnded && !this._useTrainingMap && pPos.z <= -54 && Math.abs(pPos.x) < 3.5) {
      promptText = '[E] 进入撤离安全室 (EXTRACTION)';
      if (this.player.keys.interact) {
        this.triggerGameOver(true);
      }
    }

    this.hud.setInteractPrompt(promptText);
  }

  animate() {
    if (!this.isRunning) return;
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    if (!this.isPaused && !this.gameEnded) {
      // 1. Step Cannon-es 3D Physics
      this.physics.update(delta);

      // 2. Update Map lights & environment
      this.map.update(delta, elapsed);

      // 3. Update Player
      this.player.update(delta);

      // 4. Update Weapon (Tactical Viewmodel, Sway, Bobbing & ADS)
      this.weapon.update(delta, this.player);

      // 5. Update Zombies & Horde Director
      this.director.update(delta, this.player.position, this.onZombieAttack);

      // 6. Update Combat Impact Juice & Particles
      this.impactFX.update(delta);

      // 7. Update Camera Shake
      this.cameraShake.update(delta);
      this.camera.position.add(this.cameraShake.offset);
      this.camera.rotation.x += this.cameraShake.rotation.x;
      this.camera.rotation.y += this.cameraShake.rotation.y;
      this.camera.rotation.z += this.cameraShake.rotation.z;

      // 8. Check Target Under Reticle (Turns crosshair red on zombie)
      const aimRay = new THREE.Raycaster();
      aimRay.setFromCamera(new THREE.Vector2(0, 0), this.camera);
      const zombieMeshes = [];
      this.director.zombies.forEach((z) => {
        if (!z.isDead) {
          z.meshGroup.traverse((c) => {
            if (c.isMesh) zombieMeshes.push(c);
          });
        }
      });
      const isTargetZombie = aimRay.intersectObjects(zombieMeshes, false).length > 0;

      // 9. Check Near Interactables
      this.checkPlayerInteractables();

      // 10. Update HUD (with dynamic spread & target locking)
      this.hud.update(this.player, this.weapon, isTargetZombie);

          // 11. Update 3D Character Model (Koharu Shimoe - Locomotion, Aiming, Halo & Weapons)
      if (this.character) {
        this.character.update(delta, this.player, this.weapon);
      }

      // 12. Update Neon Beam Cannon (only fires while pointer is locked)
      if (this.lightCones) {
        this.lightCones.update(
          delta,
          this.camera.position,
          this.player.isPointerLocked,
        );
      }

      // 13. Campaign vs Training ambiance: training map runs as its own self-contained itinerary,
      //     so the horde director is re-baselined or disabled accordingly.
      if (this.map && this.director) {
        if (this._useTrainingMap) {
          this.director.enabled = false;
          this.director.spawnPoints = [];
        } else {
          this.director.spawnPoints = this.map.spawnPoints;
        }
      }

      // 14. Training-only: sync training map's zero-spawn state even if the director is swapped in later.
      if (this.map && typeof this.map.syncSpawnPointsToDirector === 'function') {
        this.map.syncSpawnPointsToDirector(this.director);
      }

      // 15. Training Mode HUD flavoring
      if (this.map && this.map.constructor.name === 'TrainingMapBuilder' && this.hud && typeof this.hud.applyTrainingTheme === 'function') {
        this.hud.applyTrainingTheme();
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  restart() {
    this.destroy();
    this.init();
  }

  destroy() {
    // Idempotent: the quit-to-menu path can trigger destroy() twice
    // (HUD callback + app-level cleanup). A second run must never throw,
    // otherwise the game is left without canvas and menu (frozen).
    if (this.destroyed) return;
    this.destroyed = true;

    this.isRunning = false;
    if (this.player) this.player.unlockPointer();

    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);

    if (this.physics) this.physics.destroy();
    if (this.impactFX) this.impactFX.destroy();
    if (this.player) this.player.destroy();
    if (this.character) this.character.destroy();
    if (this.weapon) this.weapon.destroy();
    if (this.director) this.director.destroy();
    if (this.hud) this.hud.destroy();

    // Dispose light-cone rails & active beams so scene doesn't keep growing across restarts
    if (this.lightCones) {
      this.lightCones.killAll();
    }

    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.remove();
    }
  }
}
