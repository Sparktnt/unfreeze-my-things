import * as THREE from '../../vendor/three/three.module.js';
import { BackgroundPlane } from '../rendering/BackgroundPlane.js';
import { GameState } from '../engine/GameState.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Mirrors the staged progress bar from Core/ScreenManager.cs's loading state
 * (load image -> slice pieces -> ready), but drives the new async IceLevel build.
 */
export class LoadingScreen {
    overlayId = 'loading-overlay';

    constructor(game, gameplayScreen) {
        this._game = game;
        this._gameplayScreen = gameplayScreen;
        this.group = new THREE.Group();
        this._bg = new BackgroundPlane('assets/images/ui/bg_loading.jpg');
        this.group.add(this._bg.group);
        this._fill = document.getElementById('loading-bar-fill');
    }

    onResize(w, h) {
        this._bg.resize(w, h);
    }

    async onEnter({ levelDef }) {
        this._fill.style.width = '8%';
        await nextFrame();

        this._fill.style.width = '40%';
        await this._gameplayScreen.prepareLevel(levelDef);

        this._fill.style.width = '100%';
        await delay(200);

        if (this._game.currentName === GameState.LOADING) {
            this._game.goTo(GameState.GAMEPLAY, { levelDef });
        }
    }

    update() {}
}
