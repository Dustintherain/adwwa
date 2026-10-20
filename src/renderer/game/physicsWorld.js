import RAPIER from '@dimforge/rapier3d';
import * as THREE from 'three';

export class PhysicsWorld {
  constructor() {
    // Rust/WASM Rapier 3D World initialization with realistic -22m/s^2 gravity
    const gravity = { x: 0.0, y: -22.0, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // List of dynamic tracked objects: { mesh, body, collider, type }
    this.dynamicBodies = [];

    // Static scene colliders (walls, floors)
    this.staticBodies = [];

    // Register primary ground plane at Y = 0 to prevent falling
    this.initGroundPlane();
  }

  initGroundPlane() {
    // Solid base ground collider spanning the entire map (140m x 200m)
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, -40);
    const groundBody = this.world.createRigidBody(groundBodyDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(70, 0.5, 100)
      .setFriction(0.65)
      .setRestitution(0.2);
    this.world.createCollider(groundColliderDesc, groundBody);
    this.staticBodies.push(groundBody);
  }

  addStaticBox(pos, size) {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5)
      .setFriction(0.5)
      .setRestitution(0.25);
    this.world.createCollider(colliderDesc, body);
    this.staticBodies.push(body);
    return body;
  }

  addDynamicBox(mesh, mass = 15) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
      .setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w })
      .setLinearDamping(0.2)
      .setAngularDamping(0.4)
      .setCcdEnabled(true); // Continuous Collision Detection prevents high-speed clipping

    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5)
      .setRestitution(0.3)
      .setFriction(0.5)
      .setDensity(mass / Math.max(0.01, size.x * size.y * size.z));

    const collider = this.world.createCollider(colliderDesc, body);
    const entry = { mesh, body, collider, type: 'box' };
    this.dynamicBodies.push(entry);
    return body;
  }

  addDynamicCylinder(mesh, radius = 0.38, height = 1.15, mass = 20) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
      .setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w })
      .setLinearDamping(0.18)
      .setAngularDamping(0.35)
      .setCcdEnabled(true); // Continuous Collision Detection!

    const body = this.world.createRigidBody(bodyDesc);
    // In Rapier3D: cylinder(halfHeight, radius) along Y axis
    const colliderDesc = RAPIER.ColliderDesc.cylinder(height * 0.5, radius)
      .setRestitution(0.32)
      .setFriction(0.48)
      .setDensity(mass / (Math.PI * radius * radius * height));

    const collider = this.world.createCollider(colliderDesc, body);
    const entry = { mesh, body, collider, type: 'barrel' };
    this.dynamicBodies.push(entry);
    return body;
  }

  applyExplosionImpulse(epicenter, radius, force) {
    const epiVec = new THREE.Vector3(epicenter.x, epicenter.y, epicenter.z);

    this.dynamicBodies.forEach(({ body }) => {
      const pos = body.translation();
      const bodyPos = new THREE.Vector3(pos.x, pos.y, pos.z);
      const dist = bodyPos.distanceTo(epiVec);

      if (dist < radius && dist > 0.05) {
        const dir = new THREE.Vector3().subVectors(bodyPos, epiVec).normalize();
        // Add violent upward lift to simulate shockwave popping upward from floor
        dir.y += 0.55;
        dir.normalize();

        const falloff = Math.pow(1 - dist / radius, 1.4);
        const impulseMag = force * falloff;
        const impulse = dir.multiplyScalar(impulseMag);

        // Apply linear impulse
        body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

        // Apply angular torque impulse for tumbling cinematic motion
        const torque = {
          x: (Math.random() - 0.5) * impulseMag * 0.45,
          y: (Math.random() - 0.5) * impulseMag * 0.45,
          z: (Math.random() - 0.5) * impulseMag * 0.45,
        };
        body.applyTorqueImpulse(torque, true);
      }
    });
  }

  applyBulletHitImpulse(mesh, hitPoint, rayDirection, force = 8.5) {
    const entry = this.dynamicBodies.find(b => b.mesh === mesh);
    if (entry && entry.body) {
      const impulse = rayDirection.clone().multiplyScalar(force);
      entry.body.applyImpulse({ x: impulse.x, y: impulse.y + 0.5, z: impulse.z }, true);
      const torque = {
        x: (Math.random() - 0.5) * force * 0.2,
        y: (Math.random() - 0.5) * force * 0.2,
        z: (Math.random() - 0.5) * force * 0.2,
      };
      entry.body.applyTorqueImpulse(torque, true);
    }
  }

  update(delta) {
    if (!this.world) return;
    // Step Rapier WASM physics simulation
    this.world.step();

    // Synchronize Three.js visual objects with Rapier WASM rigid bodies
    for (let i = 0; i < this.dynamicBodies.length; i++) {
      const { mesh, body } = this.dynamicBodies[i];
      if (mesh && body) {
        const t = body.translation();
        const r = body.rotation();
        mesh.position.set(t.x, t.y, t.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
  }

  destroy() {
    // Idempotent: freeing an already-freed Rapier world throws
    // ("Cannot read properties of undefined (reading 'free')")
    if (!this.world) return;
    this.dynamicBodies.forEach(({ body }) => {
      this.world.removeRigidBody(body);
    });
    this.staticBodies.forEach((body) => {
      this.world.removeRigidBody(body);
    });
    this.dynamicBodies = [];
    this.staticBodies = [];
    if (this.world.free) {
      this.world.free();
    }
    this.world = null;
  }
}
