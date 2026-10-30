import * as THREE from '../../vendor/three/three.module.js';
import { GameState } from './GameState.js';
import { InputHandler } from './InputHandler.js';
import { DeviceTilt } from './DeviceTilt.js';
import { AudioManager } from './AudioManager.js';
import { Music } from './Music.js';
import { SaveManager } from './SaveManager.js';
import { BreakManager } from './BreakManager.js';

/**
 * Orchestrates the state machine, the shared three.js renderer/scene/camera, and the
 * DOM overlay for whichever screen is active. Mirrors Core/ScreenManager.cs from the
 * original C# prototype, but each "screen" here also owns a THREE.Group it can populate.
 */
export class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x0f1d3a); // matches the page background (css/style.css)

        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 1000);
        this.camera.position.z = 100;

        this.clock = new THREE.Clock();
        this.input = new InputHandler(this.canvas);
        this.tilt = new DeviceTilt();
        this.tilt.start();
        this.audio = new AudioManager();
        this.save = new SaveManager();
        this.audio.setMuted(!this.save.soundEnabled);
        this.audio.setHapticsEnabled(this.save.hapticsEnabled);
        this.music = new Music();
        this.music.setEnabled(this.save.musicEnabled);
        this.ads = new BreakManager();
        this.ads.init();

        this.width = 0;
        this.height = 0;

        this._screens = {};
        this._current = null;
        this._currentName = null;

        this._shakeMag = 0;
        this._shakeDuration = 0;
        this._shakeTime = 0;

        window.addEventListener('resize', () => this._onResize());
        window.addEventListener('orientationchange', () => this._onResize());
    }

    registerScreen(name, screen) {
        this._screens[name] = screen;
        if (screen.overlayId) {
            screen.overlayEl = document.getElementById(screen.overlayId);
        }
    }

    /** Convert container-relative screen px (origin top-left, y-down) to world units (origin center, y-up). */
    screenToWorld(pos) {
        return { x: pos.x - this.width / 2, y: this.height / 2 - pos.y };
    }

    start(initialState = GameState.SPLASH, params) {
        this._onResize();
        this.goTo(initialState, params);
        this._loop();
    }

    goTo(name, params) {
        if (this._current) {
            this._current.onExit?.();
            if (this._current.group) this.scene.remove(this._current.group);
            if (this._current.overlayEl) this._current.overlayEl.classList.add('hidden');
        }

        const next = this._screens[name];
        if (!next) throw new Error(`Unknown screen: ${name}`);

        this._current = next;
        this._currentName = name;

        if (next.group) this.scene.add(next.group);
        if (next.overlayEl) next.overlayEl.classList.remove('hidden');

        next.onResize?.(this.width, this.height);
        next.onEnter?.(params);
    }

    get currentName() {
        return this._currentName;
    }

    /** Brief, decaying camera-position jitter - e.g. the punch of a pickaxe hit landing.
     *  Magnitude is in world/screen px (1:1 at this camera's zoom); duration in seconds. */
    shake(magnitude = 5, duration = 0.12) {
        this._shakeMag = magnitude;
        this._shakeDuration = duration;
        this._shakeTime = 0;
    }

    _updateShake(dt) {
        if (this._shakeDuration <= 0) return;
        this._shakeTime += dt;
        const t = Math.min(this._shakeTime / this._shakeDuration, 1);
        const falloff = (1 - t) * (1 - t);
        const mag = this._shakeMag * falloff;
        this.camera.position.x = (Math.random() - 0.5) * 2 * mag;
        this.camera.position.y = (Math.random() - 0.5) * 2 * mag;
        if (t >= 1) {
            this._shakeDuration = 0;
            this.camera.position.x = 0;
            this.camera.position.y = 0;
        }
    }

    _onResize() {
        const container = document.getElementById('game-container');
        const w = container.clientWidth;
        const h = container.clientHeight;
        this.width = w;
        this.height = h;

        this.renderer.setSize(w, h, true);

        this.camera.left = -w / 2;
        this.camera.right = w / 2;
        this.camera.top = h / 2;
        this.camera.bottom = -h / 2;
        this.camera.updateProjectionMatrix();

        this._current?.onResize?.(w, h);
    }

    _loop = () => {
        const dt = Math.min(this.clock.getDelta(), 1 / 20);
        this.input.update();
        this.tilt.update(dt);
        this._current?.update?.(dt);
        this._updateShake(dt);
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(this._loop);
    };
}
