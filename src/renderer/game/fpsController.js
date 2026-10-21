import * as THREE from 'three';
import { soundEngine } from '../audio/soundFX.js';

/**
 * 眼位高度：角色模型（blue_archive_-koharu，1.48m）的眼睛实际在 ~1.30m。
 * 第一人称与第三人称共用一个模型后，相机必须落在模型自己的眼睛位置，
 * 否则从 1.65m 往下看会直接越过她的头顶。（角色侧同名常量必须保持一致。）
 */
export const EYE_HEIGHT = 1.30;

export class FPSController {
  constructor(camera, domElement, colliders) {
    this.camera = camera;
    this.domElement = domElement;
    this.colliders = colliders || [];

    // Movement state
    this.position = new THREE.Vector3(0, EYE_HEIGHT, 3);
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

    // Controls state
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      crouch: false,
      jump: false,
      interact: false,
    };

    // Gameplay params
    this.walkSpeed = 5.0;
    this.sprintSpeed = 8.5;
    this.crouchSpeed = 2.5;
    this.mouseSensitivity = 0.0022;
    this.isGrounded = true;
    this.gravity = -24;
    this.jumpForce = 8.0;
    this.playerRadius = 0.45;
    this.playerHeight = 1.65;

    // Head bob
    this.bobTimer = 0;
    this.bobAmount = 0.04;
    this.bobFreq = 10;
    this.currentBobOffset = new THREE.Vector3();

    // Player stats
    this.maxHealth = 100;
    this.health = 100;
    this.isDead = false;
    this.medkits = 1;
    this.isHealing = false;
    this.healProgress = 0;

    // Camera Recoil Springs (Independent physical spring-damper layer)
    this.camRecoilPitch = { x: 0, v: 0 };
    this.camRecoilYaw = { x: 0, v: 0 };

    // Pointer Lock
    this.isLocked = false;

    // Perspective Mode (First-Person vs Third-Person Over-the-Shoulder)
    this.isThirdPerson = false;
    this.thirdPersonDistance = 2.0;
    this.onPerspectiveChange = null;

    this.initEvents();
  }

  togglePerspective() {
    this.isThirdPerson = !this.isThirdPerson;
    soundEngine.playScopeZoom(this.isThirdPerson);
    if (this.onPerspectiveChange) {
      this.onPerspectiveChange(this.isThirdPerson);
    }
  }

  addCameraRecoil(pitchAmount, yawAmount = 0) {
    this.camRecoilPitch.v += pitchAmount;
    this.camRecoilYaw.v += yawAmount;
  }

  initEvents() {
    this.onKeyDown = (e) => this.handleKeyDown(e);
    this.onKeyUp = (e) => this.handleKeyUp(e);
    this.onMouseMove = (e) => this.handleMouseMove(e);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
    });
  }

  lockPointer() {
    this.domElement.requestPointerLock();
  }

  unlockPointer() {
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  handleMouseMove(event) {
    if (!this.isLocked || this.isDead) return;

    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    let sens = this.mouseSensitivity;
    if (this.weapon && this.weapon.isAiming) {
      sens *= 0.45; // Precise optical scope aiming sensitivity
    }

    this.euler.y -= movementX * sens;
    this.euler.x -= movementY * sens;

    // Clamp pitch
    const maxPitch = Math.PI / 2 - 0.05;
    this.euler.x = Math.max(-maxPitch, Math.min(maxPitch, this.euler.x));
  }

  handleKeyDown(event) {
    if (this.isDead) return;

    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.keys.forward = true; break;
      case 'KeyS': case 'ArrowDown': this.keys.backward = true; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = true; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = true; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = true; break;
      case 'KeyC': this.keys.crouch = true; break;
      case 'Space':
        if (this.isGrounded) {
          this.velocity.y = this.jumpForce;
          this.isGrounded = false;
        }
        break;
      case 'KeyE':
        this.keys.interact = true;
        this.tryInteract();
        break;
      case 'KeyT':
      case 'KeyV':
      case 'F5':
        this.togglePerspective();
        break;
      case 'KeyM':
        if (this.onModelSwitch) {
          this.onModelSwitch();
        }
        break;
      case 'Digit4':
        this.startHeal();
        break;
    }
  }

  handleKeyUp(event) {
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.keys.forward = false; break;
      case 'KeyS': case 'ArrowDown': this.keys.backward = false; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = false; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = false; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = false; break;
      case 'KeyC': this.keys.crouch = false; break;
      case 'KeyE': this.keys.interact = false; this.stopHeal(); break;
    }
  }

  startHeal() {
    if (this.medkits > 0 && this.health < this.maxHealth && !this.isHealing) {
      this.isHealing = true;
      this.healProgress = 0;
    }
  }

  stopHeal() {
    this.isHealing = false;
    this.healProgress = 0;
  }

  tryInteract() {
    // Check nearby interactables (medkits, ammo crates)
    if (this.onInteractCallback) {
      this.onInteractCallback(this.position);
    }
  }

  takeDamage(amount, sourcePos) {
    if (this.isDead) return;

    this.health = Math.max(0, this.health - amount);
    soundEngine.playPlayerHurt();

    // Damage shake
    this.euler.x += (Math.random() - 0.5) * 0.08;
    this.euler.y += (Math.random() - 0.5) * 0.08;
    this.camera.quaternion.setFromEuler(this.euler);

    if (this.onDamageCallback) {
      this.onDamageCallback(amount, sourcePos);
    }

    if (this.health <= 0) {
      this.isDead = true;
      if (this.onDeathCallback) this.onDeathCallback();
    }
  }

  update(delta) {
    if (this.isDead) return;

    // 1. Healing progress
    if (this.isHealing) {
      this.healProgress += delta / 2.5; // Takes 2.5 seconds to use medkit
      if (this.healProgress >= 1.0) {
        this.health = Math.min(this.maxHealth, this.health + 80);
        this.medkits--;
        this.isHealing = false;
        soundEngine.playMedkit();
      }
    }

    // 2. Movement vectors
    const currentSpeed = this.keys.crouch
      ? this.crouchSpeed
      : this.keys.sprint
      ? this.sprintSpeed
      : this.walkSpeed;

    this.direction.z = Number(this.keys.forward) - Number(this.keys.backward);
    this.direction.x = Number(this.keys.right) - Number(this.keys.left);
    this.direction.normalize();

    // Movement direction relative to camera yaw
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.euler.y);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.euler.y);

    const moveVector = new THREE.Vector3()
      .addScaledVector(forward, this.direction.z)
      .addScaledVector(right, this.direction.x)
      .normalize()
      .multiplyScalar(currentSpeed * delta);

    // Apply horizontal movement with collision resolution
    this.moveWithCollision(moveVector);

    // 3. Gravity and Vertical Movement
    this.velocity.y += this.gravity * delta;
    this.position.y += this.velocity.y * delta;

    // Floor collision
    const floorY = this.keys.crouch ? EYE_HEIGHT - 0.55 : EYE_HEIGHT;
    if (this.position.y <= floorY) {
      this.position.y = floorY;
      this.velocity.y = 0;
      this.isGrounded = true;
    }

    // 4. Head bobbing
    const isMoving = (this.keys.forward || this.keys.backward || this.keys.left || this.keys.right) && this.isGrounded;
    if (isMoving) {
      const freq = this.keys.sprint ? this.bobFreq * 1.4 : this.bobFreq;
      this.bobTimer += delta * freq;
      this.currentBobOffset.y = Math.sin(this.bobTimer) * this.bobAmount;
      this.currentBobOffset.x = Math.cos(this.bobTimer * 0.5) * (this.bobAmount * 0.5);
    } else {
      this.currentBobOffset.lerp(new THREE.Vector3(0, 0, 0), 0.1);
    }

    // 5. Update Camera Position and Mouse Rotation (Zero screen shake!)
    if (this.isThirdPerson) {
      // Third-Person Over-The-Shoulder Camera
      const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.euler.x * 0.75, this.euler.y, 0, 'YXZ'));
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.euler.y);
      const up = new THREE.Vector3(0, 1, 0);

      // Focus point around Koharu's upper body / shoulders
      const targetPos = this.position.clone().add(this.currentBobOffset);
      targetPos.y -= 0.15;

      const idealCamPos = targetPos.clone()
        .addScaledVector(right, 0.42)
        .addScaledVector(forward, -this.thirdPersonDistance)
        .addScaledVector(up, 0.12);

      // Camera obstacle collision raycast against walls
      const camRay = new THREE.Ray(targetPos, idealCamPos.clone().sub(targetPos).normalize());
      const maxDist = targetPos.distanceTo(idealCamPos);
      let safeDist = maxDist;
      for (const box of this.colliders) {
        const hit = camRay.intersectBox(box, new THREE.Vector3());
        if (hit) {
          const d = targetPos.distanceTo(hit);
          if (d < safeDist && d > 0.35) {
            safeDist = Math.max(0.35, d - 0.2);
          }
        }
      }
      const actualCamPos = targetPos.clone().addScaledVector(camRay.direction, safeDist);
      this.camera.position.copy(actualCamPos);
      this.camera.quaternion.setFromEuler(this.euler);
    } else {
      // First-Person Camera
      // 视线向前微移 0.08m，处于眼部正前上方，平视视野通透无阻，俯视时双手持枪与身体自然入画
      const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.euler.y);
      this.camera.position.copy(this.position)
        .addScaledVector(forwardDir, 0.08)
        .add(this.currentBobOffset);
      this.camera.quaternion.setFromEuler(this.euler);
    }
  }

  moveWithCollision(moveVector) {
    // Check X axis
    const nextPosX = this.position.clone();
    nextPosX.x += moveVector.x;
    if (!this.checkCollision(nextPosX)) {
      this.position.x = nextPosX.x;
    }

    // Check Z axis
    const nextPosZ = this.position.clone();
    nextPosZ.z += moveVector.z;
    if (!this.checkCollision(nextPosZ)) {
      this.position.z = nextPosZ.z;
    }
  }

  checkCollision(pos) {
    const playerBox = new THREE.Box3(
      new THREE.Vector3(pos.x - this.playerRadius, pos.y - 1.2, pos.z - this.playerRadius),
      new THREE.Vector3(pos.x + this.playerRadius, pos.y + 0.3, pos.z + this.playerRadius)
    );

    for (const box of this.colliders) {
      if (playerBox.intersectsBox(box)) {
        return true;
      }
    }
    return false;
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
  }
}
