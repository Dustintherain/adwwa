import * as THREE from 'three';

export class CameraShake {
  constructor() {
    this.trauma = 0; // Current trauma level 0 - 1
    this.decay = 1.8; // How fast trauma drops per second
    this.maxYaw = 0.045; // Max horizontal angle
    this.maxPitch = 0.055; // Max vertical pitch angle
    this.maxRoll = 0.035; // Max camera roll
    this.maxOffset = 0.06; // Max camera translation offset

    this.time = 0;
    this.offset = new THREE.Vector3();
    this.rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  addTrauma(amount) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  update(delta) {
    if (this.trauma <= 0) {
      this.offset.set(0, 0, 0);
      this.rotation.set(0, 0, 0);
      return;
    }

    this.time += delta * 35; // Fast frequency for crisp punch
    this.trauma = Math.max(0, this.trauma - this.decay * delta);

    // Shake amount is trauma squared (gives much punchier, higher-quality response)
    const shake = this.trauma * this.trauma;

    // Pseudo-random noise using harmonized sine waves
    const noise1 = Math.sin(this.time * 1.1) * Math.cos(this.time * 2.3);
    const noise2 = Math.cos(this.time * 1.7) * Math.sin(this.time * 0.9);
    const noise3 = Math.sin(this.time * 2.1) * Math.cos(this.time * 1.5);

    this.offset.x = noise1 * this.maxOffset * shake;
    this.offset.y = noise2 * this.maxOffset * shake;
    this.offset.z = noise3 * (this.maxOffset * 0.4) * shake;

    this.rotation.x = noise2 * this.maxPitch * shake;
    this.rotation.y = noise1 * this.maxYaw * shake;
    this.rotation.z = noise3 * this.maxRoll * shake;
  }
}
