export class GameHUD {
  constructor() {
    this.container = null;
    this.crosshair = null;
    this.hitmarker = null;
    this.healthFill = null;
    this.healthText = null;
    this.ammoText = null;
    this.medkitCount = null;
    this.hordeBanner = null;
    this.interactPrompt = null;
    this.damageOverlay = null;
    this.healProgressContainer = null;
    this.healProgressBar = null;
    this.pauseMenu = null;
    this.endGameModal = null;

    this.onRestart = null;
    this.onQuitToMenu = null;

    this.createHUD();
  }

  createHUD() {
    this.container = document.createElement('div');
    this.container.id = 'game-hud';
    this.container.innerHTML = `
      <!-- Crosshair -->
      <div id="hud-crosshair">
        <div class="ch-bar ch-top"></div>
        <div class="ch-bar ch-bottom"></div>
        <div class="ch-bar ch-left"></div>
        <div class="ch-bar ch-right"></div>
        <div class="ch-dot"></div>
      </div>

      <!-- Optical Scope Overlay (开镜瞄准镜) -->
      <div id="hud-scope-overlay">
        <div class="scope-aperture">
          <div class="scope-crosshair-v"></div>
          <div class="scope-crosshair-h"></div>
          <div class="scope-mil-dot dot-1"></div>
          <div class="scope-mil-dot dot-2"></div>
          <div class="scope-mil-dot dot-3"></div>
          <div class="scope-range-tag tag-1">100M</div>
          <div class="scope-range-tag tag-2">200M</div>
          <div class="scope-range-tag tag-3">300M</div>
          <div class="scope-center-dot"></div>
          <div class="scope-info-left">MAG: 3.5X OPTICAL<br>ELEV: +0.02 MIL</div>
          <div class="scope-info-right">RANGE: 120M<br>STATUS: LOCKED</div>
        </div>
      </div>

      <!-- Hitmarker -->
      <div id="hud-hitmarker">
        <div class="hm-line hm-tl"></div>
        <div class="hm-line hm-tr"></div>
        <div class="hm-line hm-bl"></div>
        <div class="hm-line hm-br"></div>
      </div>

      <!-- Damage Blood Flash -->
      <div id="hud-damage-flash"></div>

      <!-- Low Health Vignette Pulse -->
      <div id="hud-low-health-vignette"></div>

      <!-- Top Objective & Horde Alerts -->
      <div id="hud-top-bar">
        <div id="hud-objective">OBJECTIVE: REACH THE EXTRACTION SAFEHOUSE // 突破尸潮前往撤离点</div>
        <div id="hud-horde-banner">THE HORDE IS COMING! // 尸潮爆发！</div>
      </div>

      <!-- Center Interact & Healing Prompt -->
      <div id="hud-interact-prompt">[E] 交互</div>
      <div id="hud-heal-progress">
        <div class="heal-label">正在包扎急救中...</div>
        <div class="heal-bar-bg"><div id="heal-bar-fill"></div></div>
      </div>

      <!-- Bottom HUD Layer -->
      <div id="hud-bottom-bar">
        <!-- Survivor Status (Left) -->
        <div class="survivor-card">
          <div class="avatar-box avatar-box-koharu">
            <div class="avatar-koharu">小春</div>
          </div>
          <div class="health-container">
            <div class="survivor-name">KOHARU // 下江小春 (Trinity)</div>
            <div class="hp-bar-bg">
              <div id="hud-hp-fill" style="width: 100%;"></div>
            </div>
            <div class="hp-text"><span id="hud-hp-num">100</span> HP</div>
          </div>
          <div class="item-slot" id="slot-medkit">
            <div class="item-tag">[4] MEDKIT</div>
            <div class="item-icon">✚</div>
            <div class="item-num" id="hud-medkit-num">x1</div>
          </div>
        </div>

        <!-- Weapon Ammo Status (Right) -->
        <div class="weapon-card">
          <div class="weapon-info">
            <div class="weapon-label">WHITE FANG 465 // AR</div>
            <div class="ammo-counter"><span id="hud-mag-ammo">30</span> <small>/ <span id="hud-res-ammo">180</span></small></div>
          </div>
          <div class="controls-hint">
            <span>[左键] 开火</span>
            <span>[右键] 机瞄</span>
            <span>[R] CS:GO换弹</span>
            <span style="color: #f43f5e; font-weight: bold;">[T / F5] 切换第三人称/第一人称</span>
            <span>[Q] 枪托推搡</span>
            <span>[F] 手电筒</span>
          </div>
        </div>
      </div>

      <!-- In-Game Pause Menu (ESC) -->
      <div id="game-pause-menu" class="game-modal-overlay">
        <div class="valve-dialog">
          <div class="dialog-header">SURVIVOR PROTOCOL // 战术暂停</div>
          <div class="dialog-body">
            <button class="dialog-btn" id="btn-resume-game">继续游戏 [ESC]</button>
            <button class="dialog-btn" id="btn-restart-game">重新开始关卡</button>
            <button class="dialog-btn dialog-danger" id="btn-exit-to-menu">返回主菜单</button>
          </div>
        </div>
      </div>

      <!-- Game Over / Victory Modal -->
      <div id="game-end-modal" class="game-modal-overlay">
        <div class="valve-dialog">
          <div class="dialog-header" id="end-modal-header">MISSION RESULT</div>
          <div class="dialog-body">
            <div class="end-stat-row"><span>击杀感染者 (ZOMBIES KILLED):</span> <strong id="end-stat-kills">0</strong></div>
            <div class="end-stat-row"><span>精准爆头数 (HEADSHOTS):</span> <strong id="end-stat-headshots">0</strong></div>
            <div class="end-stat-row"><span>作战评级 (SURVIVAL RATING):</span> <strong id="end-stat-rating" style="color: #22c55e;">S</strong></div>
            <button class="dialog-btn" id="btn-end-restart" style="margin-top: 14px;">再次挑战</button>
            <button class="dialog-btn dialog-danger" id="btn-end-menu">返回安全室主菜单</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    // Elements
    this.crosshair = document.getElementById('hud-crosshair');
    this.hitmarker = document.getElementById('hud-hitmarker');
    this.damageOverlay = document.getElementById('hud-damage-flash');
    this.lowHealthVignette = document.getElementById('hud-low-health-vignette');
    this.hordeBanner = document.getElementById('hud-horde-banner');
    this.interactPrompt = document.getElementById('hud-interact-prompt');
    this.healthFill = document.getElementById('hud-hp-fill');
    this.healthText = document.getElementById('hud-hp-num');
    this.magAmmoText = document.getElementById('hud-mag-ammo');
    this.resAmmoText = document.getElementById('hud-res-ammo');
    this.medkitNumText = document.getElementById('hud-medkit-num');
    this.healProgressContainer = document.getElementById('hud-heal-progress');
    this.healProgressBar = document.getElementById('heal-bar-fill');
    this.scopeOverlay = document.getElementById('hud-scope-overlay');
    this.pauseMenu = document.getElementById('game-pause-menu');
    this.endGameModal = document.getElementById('game-end-modal');

    this.bindPauseEvents();
  }

  bindPauseEvents() {
    document.getElementById('btn-resume-game')?.addEventListener('click', () => {
      this.hidePauseMenu();
      if (this.onResume) this.onResume();
    });

    document.getElementById('btn-restart-game')?.addEventListener('click', () => {
      this.hidePauseMenu();
      if (this.onRestart) this.onRestart();
    });

    document.getElementById('btn-exit-to-menu')?.addEventListener('click', () => {
      this.hidePauseMenu();
      if (this.onQuitToMenu) this.onQuitToMenu();
    });

    document.getElementById('btn-end-restart')?.addEventListener('click', () => {
      this.hideEndModal();
      if (this.onRestart) this.onRestart();
    });

    document.getElementById('btn-end-menu')?.addEventListener('click', () => {
      this.hideEndModal();
      if (this.onQuitToMenu) this.onQuitToMenu();
    });
  }

  showHitmarker(isHeadshot = false) {
    if (!this.hitmarker) return;
    this.hitmarker.classList.remove('active', 'headshot');
    void this.hitmarker.offsetWidth; // Trigger reflow
    this.hitmarker.classList.add('active');
    if (isHeadshot) this.hitmarker.classList.add('headshot');

    setTimeout(() => {
      if (this.hitmarker) this.hitmarker.classList.remove('active', 'headshot');
    }, 120);
  }

  showDamageFlash() {
    if (!this.damageOverlay) return;
    this.damageOverlay.classList.remove('flash');
    void this.damageOverlay.offsetWidth;
    this.damageOverlay.classList.add('flash');
  }

  showHordeBanner(text) {
    if (!this.hordeBanner) return;
    this.hordeBanner.textContent = text;
    this.hordeBanner.classList.add('show');
    setTimeout(() => {
      if (this.hordeBanner) this.hordeBanner.classList.remove('show');
    }, 4000);
  }

  setInteractPrompt(text) {
    if (!this.interactPrompt) return;
    if (text) {
      this.interactPrompt.textContent = text;
      this.interactPrompt.style.display = 'block';
    } else {
      this.interactPrompt.style.display = 'none';
    }
  }

  update(player, weapon, isTargetZombie = false) {
    // 1. Health Bar
    if (this.healthFill && this.healthText) {
      const hp = Math.max(0, Math.round(player.health));
      this.healthText.textContent = hp;
      this.healthFill.style.width = `${hp}%`;

      if (hp > 50) {
        this.healthFill.style.background = '#22c55e'; // Green
      } else if (hp > 25) {
        this.healthFill.style.background = '#eab308'; // Yellow
      } else {
        this.healthFill.style.background = '#dc2626'; // Critical Red
      }

      // Low health pulsing vignette
      if (this.lowHealthVignette) {
        this.lowHealthVignette.style.opacity = hp <= 30 ? (1 - hp / 30).toString() : '0';
      }
    }

    // 2. Ammo Count
    if (this.magAmmoText && this.resAmmoText) {
      this.magAmmoText.textContent = weapon.currentAmmo;
      this.resAmmoText.textContent = weapon.reserveAmmo;
    }

    // 3. Medkits
    if (this.medkitNumText) {
      this.medkitNumText.textContent = `x${player.medkits}`;
    }

    // 4. Healing Progress Bar
    if (this.healProgressContainer && this.healProgressBar) {
      if (player.isHealing) {
        this.healProgressContainer.style.display = 'flex';
        this.healProgressBar.style.width = `${Math.round(player.healProgress * 100)}%`;
      } else {
        this.healProgressContainer.style.display = 'none';
      }
    }

    // 5. Optical Scope Overlay & Dynamic Crosshair
    if (this.scopeOverlay) {
      if (weapon.isAiming) {
        this.scopeOverlay.classList.add('active');
      } else {
        this.scopeOverlay.classList.remove('active');
      }
    }

    if (this.crosshair) {
      if (weapon.isAiming) {
        this.crosshair.style.opacity = '0';
      } else {
        this.crosshair.style.opacity = '1';
        this.crosshair.classList.remove('ads');
        let targetSpread = 12;
        if (player.keys.sprint) targetSpread += 16;
        else if (player.keys.forward || player.keys.backward || player.keys.left || player.keys.right) targetSpread += 6;
        if (!player.isGrounded) targetSpread += 20;
        if (player.keys.crouch) targetSpread -= 4;
        if (weapon.recoilSpread) targetSpread += weapon.recoilSpread;

        this.currentSpread = this.currentSpread || 12;
        this.currentSpread += (targetSpread - this.currentSpread) * 0.28;

        const size = Math.round(this.currentSpread * 2);
        this.crosshair.style.width = `${size}px`;
        this.crosshair.style.height = `${size}px`;
      }

      if (isTargetZombie) {
        this.crosshair.classList.add('target-locked');
      } else {
        this.crosshair.classList.remove('target-locked');
      }
    }
  }

  showPauseMenu() {
    if (this.pauseMenu) this.pauseMenu.classList.add('active');
  }

  hidePauseMenu() {
    if (this.pauseMenu) this.pauseMenu.classList.remove('active');
  }

  showEndModal(victory, kills, headshots) {
    if (!this.endGameModal) return;
    const header = document.getElementById('end-modal-header');
    if (header) {
      header.textContent = victory
        ? 'MISSION ACCOMPLISHED // 成功突围安全撤离'
        : 'SQUAD WIPED // 全队阵亡';
      header.style.color = victory ? '#22c55e' : '#dc2626';
    }

    document.getElementById('end-stat-kills').textContent = kills;
    document.getElementById('end-stat-headshots').textContent = headshots;

    const ratingEl = document.getElementById('end-stat-rating');
    if (ratingEl) {
      if (!victory) ratingEl.textContent = 'F';
      else if (headshots >= 10) ratingEl.textContent = 'S+';
      else ratingEl.textContent = 'A';
    }

    this.endGameModal.classList.add('active');
  }

  hideEndModal() {
    if (this.endGameModal) this.endGameModal.classList.remove('active');
  }

  setVisible(visible) {
    if (this.container) {
      this.container.style.display = visible ? 'block' : 'none';
    }
  }

  /**
   * Apply training-mode styling overrides (text and objective line) when the
   * running game is the dedicated training arena.
   */
  applyTrainingTheme() {
    this._isTraining = true;
    const objective = document.getElementById('hud-objective');
    if (objective) {
      objective.textContent =
        '战术实弹靶场 // 自由射击与弹道校准 (零感染者刷新)';
    }
    const hordeBanner = document.getElementById('hud-horde-banner');
    if (hordeBanner) {
      hordeBanner.textContent = 'PROVING GROUND DRILL // 实弹射击练习进行中';
    }
  }

  destroy() {
    if (this.container) {
      this.container.remove();
    }
  }
}
