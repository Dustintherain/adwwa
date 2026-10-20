import { soundEngine } from '../audio/soundFX.js';

export class MenuController {
  constructor(menuScene) {
    this.scene = menuScene;

    // Modals
    this.campaignModal = document.getElementById('campaign-modal');
    this.survivalModal = document.getElementById('survival-modal');
    this.trainingModal = document.getElementById('training-modal');
    this.optionsModal = document.getElementById('options-modal');
    this.inspectHud = document.getElementById('inspect-hud');
    this.mainUi = document.getElementById('ui-root');
    this.loadingScreen = document.getElementById('loading-screen');

    // State
    this.currentDifficulty = 'NORMAL';
    this.selectedCampaign = 'NO MERCY';
    this.selectedTraining = 'TACTICAL RANGE';
    this.flashlightOn = true;

    this.bindEvents();
  }

  loadSettings() {
    try {
      const stored = localStorage.getItem('fps-survivor-settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.masterVol !== undefined) {
          this.masterVolume = parsed.masterVol;
          soundEngine.setMasterVolume(this.masterVolume);
          document.getElementById('val-master-vol').textContent = `${Math.round(this.masterVolume * 100)}%`;
        }
        if (parsed.vignetteShadow !== undefined) {
          document.getElementById('setting-vignette-shadow').checked = parsed.vignetteShadow;
        }
        if (parsed.aaQuality !== undefined) {
          document.querySelector('#options-modal select').value = parsed.aaQuality;
        }
      }
    } catch (e) {
      console.warn('[MenuController] Failed to load settings:', e);
    }
  }

  saveSettings() {
    try {
      const settings = {
        masterVol: this.masterVolume,
        vignetteShadow: document.getElementById('setting-vignette-shadow')?.checked,
        aaQuality: document.querySelector('#options-modal select')?.value,
      };
      localStorage.setItem('fps-survivor-settings', JSON.stringify(settings));
    } catch (e) {
      console.warn('[MenuController] Failed to save settings:', e);
    }
  }

  bindEvents() {
    // Sound on hover for all interactive elements
    const interactiveElements = document.querySelectorAll(
      '.nav-item, .action-btn, .campaign-card, .diff-btn, .btn-primary, .btn-secondary, .modal-close-btn'
    );
    interactiveElements.forEach((el) => {
      el.addEventListener('mouseenter', () => {
        soundEngine.playHover();
      });
    });

    // Start background ambient drone on first user interaction
    const startAudio = () => {
      soundEngine.startAmbientDrone();
      window.removeEventListener('click', startAudio);
      window.removeEventListener('keydown', startAudio);
    };
    window.addEventListener('click', startAudio);
    window.addEventListener('keydown', startAudio);

    // Close modal when clicking on the dark backdrop outside the dialog
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          soundEngine.playBack();
          this.closeModal(overlay);
        }
      });
    });

    // Main Menu Nav Buttons
    document.getElementById('btn-campaign')?.addEventListener('click', () => {
      soundEngine.playSelect();
      this.openModal(this.campaignModal);
    });

    document.getElementById('btn-survival')?.addEventListener('click', () => {
      soundEngine.playSelect();
      this.openModal(this.survivalModal);
    });

    document.getElementById('btn-training')?.addEventListener('click', () => {
      soundEngine.playSelect();
      this.openTrainingModal();
    });

    document.getElementById('btn-armory')?.addEventListener('click', () => {
      soundEngine.playSelect();
      soundEngine.playWeaponAction();
      this.enterInspectMode();
    });

    document.getElementById('btn-options')?.addEventListener('click', () => {
      soundEngine.playSelect();
      this.openModal(this.optionsModal);
    });

    document.getElementById('btn-quit')?.addEventListener('click', () => {
      soundEngine.playSelect();
      if (window.electronAPI && window.electronAPI.quitGame) {
        window.electronAPI.quitGame();
      } else {
        alert('退出游戏 (在桌面应用中将直接关闭客户端)');
      }
    });

    // Top action buttons
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      soundEngine.playSelect();
      if (window.electronAPI && window.electronAPI.toggleFullscreen) {
        window.electronAPI.toggleFullscreen();
      } else {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      }
    });

    // Modal Close Buttons
    document.querySelectorAll('.modal-close-btn, .btn-close-modal').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        soundEngine.playBack();
        const modal = e.target.closest('.modal-overlay');
        if (modal) this.closeModal(modal);
      });
    });

    // Escape closes the top modal if any (except the training modal keeps its own close button)
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        const topModal = document.querySelector('.modal-overlay.active');
        if (topModal && topModal.id !== 'training-modal') {
          soundEngine.playBack();
          this.closeModal(topModal);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // Campaign selection cards
    document.querySelectorAll('.campaign-card').forEach((card) => {
      card.addEventListener('click', () => {
        soundEngine.playSelect();
        document.querySelectorAll('.campaign-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedCampaign = card.dataset.campaign || 'NO MERCY';
      });
    });

    // Difficulty buttons (shared between campaign and training)
    document.querySelectorAll('.diff-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        soundEngine.playSelect();
        document.querySelectorAll('.diff-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.currentDifficulty = btn.dataset.diff || 'NORMAL';
      });
    });

    // Training cards
    document.querySelectorAll('.training-card').forEach((card) => {
      card.addEventListener('click', () => {
        soundEngine.playSelect();
        document.querySelectorAll('.training-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedTraining = card.dataset.training || 'TACTICAL RANGE';
      });
    });

    // Training difficulty toggle (same difficulty controls, re-labeled per context)
    const trainingDiffButtons = document.querySelectorAll('#training-modal .diff-btn');
    trainingDiffButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        soundEngine.playSelect();
        trainingDiffButtons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.currentDifficulty = btn.dataset.diff || 'NORMAL';
      });
    });

    // Launch Campaign / Start Game
    document.getElementById('btn-start-campaign')?.addEventListener('click', () => {
      soundEngine.playSelect();
      this.closeModal(this.campaignModal);
      if (this.selectedCampaign === 'TRAINING') {
        this.triggerLoadingScreen(`战术实弹靶场 // 弹道校准与自由射击 [${this.currentDifficulty}]`, {
          campaign: 'TRAINING',
          difficulty: this.currentDifficulty,
          useTrainingMap: true,
        });
      } else {
        this.triggerLoadingScreen(`战役：${this.selectedCampaign} [${this.currentDifficulty}]`, {
          campaign: this.selectedCampaign,
          difficulty: this.currentDifficulty,
          useTrainingMap: false,
        });
      }
    });

    // Quick direct enter training from Campaign modal
    document.getElementById('btn-direct-training-from-modal')?.addEventListener('click', () => {
      soundEngine.playSelect();
      this.closeModal(this.campaignModal);
      this.triggerLoadingScreen(`战术实弹靶场 // 弹道校准与自由射击 [${this.currentDifficulty}]`, {
        campaign: 'TRAINING',
        difficulty: this.currentDifficulty,
        useTrainingMap: true,
      });
    });

    document.getElementById('btn-start-survival')?.addEventListener('click', () => {
      soundEngine.playSelect();
      this.closeModal(this.survivalModal);
      this.triggerLoadingScreen(`生存模式：无尽感染者尸潮 [${this.currentDifficulty}]`, {
        campaign: 'SURVIVAL',
        difficulty: this.currentDifficulty,
        useTrainingMap: false,
      });
    });

    // Training Mode
    document.getElementById('btn-start-training')?.addEventListener('click', () => {
      soundEngine.playSelect();
      this.closeModal(this.trainingModal);
      this.triggerLoadingScreen(`战术实弹靶场：${this.selectedTraining} [${this.currentDifficulty}]`, {
        campaign: 'TRAINING',
        difficulty: this.currentDifficulty,
        useTrainingMap: true,
      });
    });

    // Inspect Mode HUD Controls
    document.getElementById('btn-exit-inspect')?.addEventListener('click', () => {
      soundEngine.playBack();
      this.exitInspectMode();
    });

    document.getElementById('btn-toggle-flashlight')?.addEventListener('click', (e) => {
      soundEngine.playSelect();
      const state = this.scene.toggleWeaponFlashlight();
      e.target.textContent = state ? '战术手电: 开启 [ON]' : '战术手电: 关闭 [OFF]';
    });

    document.getElementById('btn-cock-weapon')?.addEventListener('click', () => {
      soundEngine.playWeaponAction();
    });

    // Settings adjustments
    const masterVol = document.getElementById('setting-master-vol');
    masterVol?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      soundEngine.setMasterVolume(val);
      document.getElementById('val-master-vol').textContent = `${Math.round(val * 100)}%`;
    });

    // Ambient drone toggle - start/stop based on checkbox state
    const ambientDroneToggle = document.querySelector(
      '#options-modal input[type="checkbox"]:nth-of-type(1)'
    );
    if (ambientDroneToggle) {
      ambientDroneToggle.addEventListener('change', (e) => {
        soundEngine.playHover();
        if (e.target.checked) {
          soundEngine.startAmbientDrone();
        } else {
          soundEngine.stopAmbientDrone();
        }
      });
    }

    const filmGrainToggle = document.getElementById('setting-film-grain');
    filmGrainToggle?.addEventListener('change', (e) => {
      soundEngine.playHover();
      const overlay = document.querySelector('.film-grain-overlay');
      if (overlay) overlay.style.display = e.target.checked ? 'block' : 'none';
    });

    // Vignette shadow toggle
    const vignetteToggle = document.getElementById('setting-vignette-shadow');
    if (vignetteToggle) {
      vignetteToggle.addEventListener('change', (e) => {
        soundEngine.playHover();
        const overlay = document.querySelector('.vignette-overlay');
        if (overlay) {
          overlay.style.display = e.target.checked ? 'block' : 'none';
        }
        // Also update renderer fog intensity for vignette feel
        if (window.gameEngine) {
          window.gameEngine.scene.fog = e.target.checked
            ? new THREE.FogExp2(0x738a9c, 0.015)
            : new THREE.FogExp2(0x738a9c, 0.010);
        }
      });
    }

    // Antialiasing quality selector
    const aaSelect = document.querySelector('#options-modal select');
    if (aaSelect && window.gameEngine) {
      aaSelect.addEventListener('change', (e) => {
        soundEngine.playHover();
        const selected = e.target.value;
        window.gameEngine.renderer.setAttribute('antialias', selected !== 'DISABLED');
        if (selected === 'MSAA 4X (HIGH)') {
          window.gameEngine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        } else if (selected === 'FXAA FAST') {
          // FXAA is applied post-processing; disable MSAA
          window.gameEngine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        } else {
          // DISABLED - restore default
          window.gameEngine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        }
        window.gameEngine.renderer.antialias = selected !== 'DISABLED';
        window.gameEngine.renderer.setSize(
          window.gameEngine.renderer.domElement.clientWidth,
          window.gameEngine.renderer.domElement.clientHeight
        );
      });
    }
  }

  openModal(modal) {
    if (modal) {
      modal.style.display = 'flex';
      modal.style.visibility = 'visible';
      requestAnimationFrame(() => modal.classList.add('active'));
    }
  }

  closeModal(modal) {
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
      modal.style.visibility = 'hidden';
    }
  }

  enterInspectMode() {
    this.mainUi.style.display = 'none';
    this.inspectHud.style.display = 'flex';
    this.inspectHud.style.visibility = 'visible';
    requestAnimationFrame(() => this.inspectHud.classList.add('active'));
    this.scene.setMode('inspect');
  }

  exitInspectMode() {
    this.inspectHud.classList.remove('active');
    this.inspectHud.style.display = 'none';
    this.inspectHud.style.visibility = 'hidden';
    this.mainUi.style.display = 'flex';
    this.scene.setMode('menu');
  }

  triggerLoadingScreen(title, customLaunchArgs = null) {
    if (!this.loadingScreen) return;
    this.loadingScreen.style.display = 'flex';
    this.loadingScreen.style.visibility = 'visible';
    this.loadingScreen.classList.add('active');
    const titleEl = document.getElementById('loading-title');
    if (titleEl) titleEl.textContent = title;

    if (customLaunchArgs) {
      this._launchArgs = customLaunchArgs;
    } else {
      const isTraining = this.selectedCampaign === 'TRAINING';
      this._launchArgs = isTraining
        ? { campaign: 'TRAINING', difficulty: this.currentDifficulty, useTrainingMap: true }
        : { campaign: this.selectedCampaign, difficulty: this.currentDifficulty, useTrainingMap: false };
    }

    let progress = 0;
    const progressFill = document.getElementById('loading-bar-fill');
    const statusText = document.getElementById('loading-status-text');

    const tips = [
      '提示: 爆头能够造成三倍伤害，并有效节省弹药。',
      '提示: 砂狼白子的高精度突击步枪适合中远距离点射。',
      '提示: 面对尸潮冲击时，保持背靠坚固掩体并与队友协同射击。',
      '提示: 战术手电在暗处会激怒特殊感染者，必要时请关闭。',
      '提示: 拾取急救包前优先确保周围环境安全。',
    ];
    document.getElementById('loading-tip').textContent =
      tips[Math.floor(Math.random() * tips.length)];

    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 15) + 5;
      if (progress > 100) progress = 100;
      if (progressFill) progressFill.style.width = `${progress}%`;

      if (progress < 40) {
        if (statusText) statusText.textContent = '正在初始化 HAVOK 物理引擎与实体数据...';
      } else if (progress < 80) {
        if (statusText) statusText.textContent = '加载武器网格与幸存者着色器...';
      } else {
        if (statusText) statusText.textContent = '建立安全室防线并生成感染者巡逻路径...';
      }

      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          if (statusText) statusText.textContent = '按任意键或点击开始战斗...';
          const clickToStart = () => {
            soundEngine.playSelect();
            this.loadingScreen.classList.remove('active');
            this.loadingScreen.style.display = 'none';
            this.loadingScreen.style.visibility = 'hidden';
            window.removeEventListener('click', clickToStart);
            window.removeEventListener('keydown', clickToStart);

            if (this.onStartGame && this._launchArgs) {
              this.onStartGame(
                this._launchArgs.campaign,
                this._launchArgs.difficulty,
                this._launchArgs,
              );
            }
          };
          window.addEventListener('click', clickToStart);
          window.addEventListener('keydown', clickToStart);
        }, 500);
      }
    }, 120);
  }

  openTrainingModal() {
    if (this.trainingModal) {
      this.openModal(this.trainingModal);
    }
  }
}
