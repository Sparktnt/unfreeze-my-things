import * as THREE from '../../vendor/three/three.module.js';
import { BackgroundPlane } from '../rendering/BackgroundPlane.js';
import { GameState } from '../engine/GameState.js';

const RESET_ARM_MS = 3000;

export class SettingsScreen {
    overlayId = 'settings-overlay';

    constructor(game) {
        this._game = game;
        this.group = new THREE.Group();
        this._bg = new BackgroundPlane('assets/images/ui/bg_menu.jpg', { opacity: 0.5 });
        this.group.add(this._bg.group);

        this._musicToggle = document.getElementById('toggle-music');
        this._soundToggle = document.getElementById('toggle-sound');
        this._hapticsToggle = document.getElementById('toggle-haptics');
        this._resetBtn = document.getElementById('btn-reset-progress');
        this._resetArmed = false;
        this._resetTimeout = null;

        this._musicToggle.addEventListener('click', () => {
            const next = !this._game.save.musicEnabled;
            this._game.save.setMusicEnabled(next);
            this._game.music.setEnabled(next);
            this._syncToggles();
        });

        this._soundToggle.addEventListener('click', () => {
            const next = !this._game.save.soundEnabled;
            this._game.save.setSoundEnabled(next);
            this._game.audio.setMuted(!next);
            this._syncToggles();
        });

        this._hapticsToggle.addEventListener('click', () => {
            const next = !this._game.save.hapticsEnabled;
            this._game.save.setHapticsEnabled(next);
            this._game.audio.setHapticsEnabled(next);
            this._syncToggles();
        });

        this._resetBtn.addEventListener('click', () => this._onResetClick());

        this._privacyOptionsBtn = document.getElementById('btn-privacy-options');
        this._privacyOptionsBtn.addEventListener('click', () => this._game.ads.showPrivacyOptions());

        document.getElementById('btn-settings-back').addEventListener('click', () => {
            this._game.goTo(GameState.MENU);
        });
    }

    _syncToggles() {
        const musicOn = this._game.save.musicEnabled;
        const soundOn = this._game.save.soundEnabled;
        const hapticsOn = this._game.save.hapticsEnabled;
        this._musicToggle.classList.toggle('on', musicOn);
        this._musicToggle.setAttribute('aria-checked', String(musicOn));
        this._soundToggle.classList.toggle('on', soundOn);
        this._soundToggle.setAttribute('aria-checked', String(soundOn));
        this._hapticsToggle.classList.toggle('on', hapticsOn);
        this._hapticsToggle.setAttribute('aria-checked', String(hapticsOn));
    }

    _onResetClick() {
        if (!this._resetArmed) {
            this._resetArmed = true;
            this._resetBtn.textContent = 'Tap Again to Confirm';
            this._resetBtn.classList.add('armed');
            this._resetTimeout = setTimeout(() => this._disarmReset(), RESET_ARM_MS);
            return;
        }

        clearTimeout(this._resetTimeout);
        this._game.save.resetProgress();
        this._game.audio.setMuted(!this._game.save.soundEnabled);
        this._game.audio.setHapticsEnabled(this._game.save.hapticsEnabled);
        this._syncToggles();
        this._disarmReset();
        this._resetBtn.textContent = 'Progress Reset!';
        setTimeout(() => { this._resetBtn.textContent = 'Reset Progress'; }, 1500);
    }

    _disarmReset() {
        this._resetArmed = false;
        this._resetTimeout = null;
        this._resetBtn.classList.remove('armed');
        if (this._resetBtn.textContent === 'Tap Again to Confirm') {
            this._resetBtn.textContent = 'Reset Progress';
        }
    }

    onEnter() {
        this._disarmReset();
        this._syncToggles();
        this._privacyOptionsBtn.classList.toggle('hidden', !this._game.ads.privacyOptionsRequired);
    }

    onResize(w, h) {
        this._bg.resize(w, h);
    }

    update() {}
}
