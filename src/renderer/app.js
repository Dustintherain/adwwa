import { MenuScene } from './scene/menuScene.js';
import { MenuController } from './ui/menuController.js';
import { GameEngine } from './game/gameEngine.js';
import { soundEngine } from './audio/soundFX.js';

function initApp() {
  const container = document.getElementById('canvas-container');
  const loadingBanner = document.getElementById('loading-banner');
  const loadingProgress = document.getElementById('loading-progress');
  const uiRoot = document.getElementById('ui-root');

  let menuScene = null;
  let menuController = null;
  let gameEngine = null;

  function initMenu() {
    menuScene = new MenuScene(container);
    window.__menuScene = menuScene;

    menuScene.onLoadProgress = (percent) => {
      if (loadingProgress) {
        loadingProgress.textContent = `${percent}%`;
      }
      if (percent >= 100) {
        setTimeout(() => {
          if (loadingBanner) {
            loadingBanner.style.opacity = '0';
            setTimeout(() => loadingBanner.remove(), 400);
          }
        }, 300);
      }
    };

    if (!menuController) {
      menuController = new MenuController(menuScene);

      // Hook start game callback from campaign / survival modal
      menuController.onStartGame = (campaign, difficulty, launchOptions = {}) => {
        console.log('[App] Starting game with args:', { campaign, difficulty, launchOptions });
        launchFPSGame(campaign, difficulty, launchOptions);
      };
    } else {
      menuController.scene = menuScene;
    }
  }

  function launchFPSGame(campaign, difficulty, launchOptions = {}) {
    console.log(
      `[Game] Launching Left 4 Dead PvE FPS: ${campaign} [${difficulty}]`,
      launchOptions,
    );
    const useTrainingMap = campaign === 'TRAINING' || launchOptions.useTrainingMap;


    // 1. Clean up Menu Scene & Audio
    if (menuScene) {
      menuScene.destroy();
      menuScene = null;
    }
    soundEngine.stopAmbientDrone();

    // 2. Hide Main Menu UI
    if (uiRoot) {
      uiRoot.style.display = 'none';
    }

    // 3. Launch Game Engine
    gameEngine = new GameEngine(
      container,
      () => {
        // Callback to return to Main Menu
        returnToMainMenu();
      },
      { useTrainingMap },
    );
    window.__game = gameEngine;
  }

  function returnToMainMenu() {
    console.log('[Game] Returning to Safehouse Main Menu');
    if (gameEngine) {
      gameEngine.destroy();
      gameEngine = null;
    }

    // Show Main Menu UI
    if (uiRoot) {
      uiRoot.style.display = 'flex';
    }

    // Re-initialize Menu 3D scene
    initMenu();
    soundEngine.startAmbientDrone();
  }

  // Start with Main Menu
  initMenu();

  console.log('Valve Left 4 Dead Game Client initialized successfully.');
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
