import * as THREE from '../../vendor/three/three.module.js';
import { BackgroundPlane } from '../rendering/BackgroundPlane.js';
import { GameState } from '../engine/GameState.js';
import { easeOutSine, easeInSine } from '../engine/Easing.js';

const FADE_IN = 1.0;
const HOLD = 1.4;
const FADE_OUT = 0.7;
const TOTAL = FADE_IN + HOLD + FADE_OUT;

export class SplashScreen {
    overlayId = 'splash-overlay';

    constructor(game) {
        this._game = game;
        this.group = new THREE.Group();
        this._bg = new BackgroundPlane('assets/images/ui/bg_menu.jpg');
        this.group.add(this._bg.group);
        this._titleEl = document.querySelector('#splash-overlay .splash-title-wrap');
    }

    onEnter() {
        this._elapsed = 0;
        this._bg.setOpacity(0);
        this._titleEl.style.opacity = 0;
    }

    onResize(w, h) {
        this._bg.resize(w, h);
    }

    update(dt) {
        this._elapsed += dt;
        let alpha;
        if (this._elapsed < FADE_IN) {
            alpha = easeOutSine(this._elapsed / FADE_IN);
        } else if (this._elapsed < FADE_IN + HOLD) {
            alpha = 1;
        } else if (this._elapsed < TOTAL) {
            alpha = 1 - easeInSine((this._elapsed - FADE_IN - HOLD) / FADE_OUT);
        } else {
            alpha = 0;
            this._game.goTo(GameState.MENU);
            return;
        }
        this._bg.setOpacity(alpha);
        this._titleEl.style.opacity = String(alpha);
    }
}
