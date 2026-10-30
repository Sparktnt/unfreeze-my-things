import * as THREE from '../../vendor/three/three.module.js';
import { BackgroundPlane } from '../rendering/BackgroundPlane.js';
import { GameState } from '../engine/GameState.js';
import { dayKey } from '../data/levels.js';
import { SKINS } from '../data/skins.js';
import { easeOutCubic } from '../engine/Easing.js';

// Daily Spin: one free spin per calendar day (dayKey), plus one extra per day for watching a
// rewarded ad. Never sold for coins or money - a paid spin would make it a loot box.
// `weight` is the relative odds; most slices are small so the wheel can't flood the economy.
const SLICES = [
    { label: '25', coins: 25, weight: 22, color: '#5fd3ff' },
    { label: '1 Hint', hints: 1, weight: 16, color: '#ff7ab8' },
    { label: '50', coins: 50, weight: 18, color: '#a06bff' },
    { label: 'Skin!', skin: true, weight: 4, color: '#ffcf4d' },
    { label: '75', coins: 75, weight: 12, color: '#5fd3ff' },
    { label: '2 Hints', hints: 2, weight: 10, color: '#ff7ab8' },
    { label: '150', coins: 150, weight: 8, color: '#a06bff' },
    { label: '300', coins: 300, weight: 5, color: '#ffcf4d' },
];
const SKIN_FALLBACK_COINS = 500; // the Skin slice pays this once every skin is owned

const SPIN_SECONDS = 4.2;
const SPIN_TURNS = 5; // full turns before it settles
const SLICE_ANGLE = (Math.PI * 2) / SLICES.length;

function pickSlice() {
    const total = SLICES.reduce((sum, s) => sum + s.weight, 0);
    let r = Math.random() * total;
    return SLICES.findIndex((s) => (r -= s.weight) < 0);
}

function formatWait(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.ceil((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Milliseconds until local midnight, when the next free spin opens. */
function msUntilNextSpin() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
}

export class WheelScreen {
    overlayId = 'wheel-overlay';

    constructor(game) {
        this._game = game;
        this.group = new THREE.Group();
        this._bg = new BackgroundPlane('assets/images/ui/bg_menu.jpg', { opacity: 0.5 });
        this.group.add(this._bg.group);

        this._canvas = document.getElementById('wheel-canvas');
        this._ctx = this._canvas.getContext('2d');
        this._spinBtn = document.getElementById('btn-wheel-spin');
        this._adBtn = document.getElementById('btn-wheel-ad');
        this._resultEl = document.getElementById('wheel-result');
        this._coinEl = document.getElementById('wheel-coin-count');

        this._angle = 0; // wheel rotation, radians; slice i is centred at i*SLICE_ANGLE under the top pointer when angle = -i*SLICE_ANGLE
        this._spin = null; // { from, to, t, slice }
        this._lastTickSlice = 0;

        this._spinBtn.addEventListener('click', () => {
            const today = dayKey();
            if (this._spin || !this._game.save.canSpinWheel(today)) return;
            this._game.save.useWheelSpin(today);
            this._startSpin();
        });
        this._adBtn.addEventListener('click', async () => {
            const today = dayKey();
            if (this._spin || !this._game.save.canAdSpinWheel(today)) return;
            if (!(await this._game.ads.showRewarded())) {
                this._resultEl.textContent = 'No ad available right now - try again later.';
                return;
            }
            this._game.save.useWheelAdSpin(today);
            this._startSpin();
        });
        document.getElementById('btn-wheel-back').addEventListener('click', () => {
            if (!this._spin) this._game.goTo(GameState.MENU);
        });
    }

    _startSpin() {
        const slice = pickSlice();
        const jitter = (Math.random() - 0.5) * SLICE_ANGLE * 0.6; // don't always stop dead centre
        const base = this._angle - (this._angle % (Math.PI * 2));
        const to = base - SPIN_TURNS * Math.PI * 2 - slice * SLICE_ANGLE + jitter;
        this._spin = { from: this._angle, to, t: 0, slice };
        this._resultEl.textContent = '';
        this._refreshButtons();
    }

    _finishSpin(index) {
        const save = this._game.save;
        const slice = SLICES[index];
        let text;
        if (slice.coins) {
            save.addCoins(slice.coins);
            text = `You won ${slice.coins} Snowflakes!`;
        } else if (slice.hints) {
            save.addHearts(slice.hints);
            text = `You won ${slice.hints} hint${slice.hints > 1 ? 's' : ''}!`;
        } else {
            const unowned = SKINS.filter((s) => !save.ownsSkin(s.id));
            if (unowned.length) {
                const skin = unowned[Math.floor(Math.random() * unowned.length)];
                save.buySkin(skin.id, 0); // free - and equipped straight away
                text = `New ice skin: ${skin.name}! It's equipped.`;
            } else {
                save.addCoins(SKIN_FALLBACK_COINS);
                text = `You own every skin, so here are ${SKIN_FALLBACK_COINS} Snowflakes!`;
            }
        }
        this._game.audio.playReveal();
        this._game.audio.playPurchase();
        this._resultEl.textContent = text;
        this._refreshButtons();
    }

    _refreshButtons() {
        const save = this._game.save;
        const today = dayKey();
        const spinning = !!this._spin;
        const free = save.canSpinWheel(today);
        const ad = save.canAdSpinWheel(today);
        this._coinEl.textContent = String(save.coins);
        this._spinBtn.disabled = spinning || !free;
        this._spinBtn.textContent = free ? 'Spin!' : `Next free spin in ${formatWait(msUntilNextSpin())}`;
        // The ad spin is offered only after today's free spin is used.
        this._adBtn.classList.toggle('hidden', free || !ad);
        this._adBtn.disabled = spinning;
    }

    _draw() {
        const c = this._canvas;
        const g = this._ctx;
        const size = c.width;
        const r = size / 2 - size * 0.03;
        g.clearRect(0, 0, size, size);
        g.save();
        g.translate(size / 2, size / 2);
        g.rotate(this._angle);
        SLICES.forEach((s, i) => {
            // slice i is centred straight up (-PI/2) at rotation 0
            const a0 = -Math.PI / 2 + i * SLICE_ANGLE - SLICE_ANGLE / 2;
            g.beginPath();
            g.moveTo(0, 0);
            g.arc(0, 0, r, a0, a0 + SLICE_ANGLE);
            g.closePath();
            g.fillStyle = s.color;
            g.fill();
            g.lineWidth = size * 0.008;
            g.strokeStyle = 'rgba(255,255,255,0.85)';
            g.stroke();

            g.save();
            g.rotate(a0 + SLICE_ANGLE / 2);
            g.translate(r * 0.66, 0);
            g.rotate(Math.PI / 2);
            g.fillStyle = '#2a1a40';
            g.font = `800 ${Math.round(size * 0.058)}px Baloo2, sans-serif`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(s.label, 0, 0);
            if (s.coins) {
                g.font = `700 ${Math.round(size * 0.04)}px Baloo2, sans-serif`;
                g.fillText('❄', 0, size * 0.055);
            }
            g.restore();
        });
        g.restore();

        // rim and hub
        g.beginPath();
        g.arc(size / 2, size / 2, r, 0, Math.PI * 2);
        g.lineWidth = size * 0.025;
        g.strokeStyle = '#ffffff';
        g.stroke();
        g.beginPath();
        g.arc(size / 2, size / 2, size * 0.07, 0, Math.PI * 2);
        g.fillStyle = '#ffffff';
        g.fill();
        g.beginPath();
        g.arc(size / 2, size / 2, size * 0.045, 0, Math.PI * 2);
        g.fillStyle = '#5fd3ff';
        g.fill();
    }

    onEnter() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const css = this._canvas.clientWidth || 280;
        this._canvas.width = this._canvas.height = Math.round(css * dpr);
        this._resultEl.textContent = '';
        this._refreshButtons();
        this._draw();
    }

    onResize(w, h) {
        this._bg.resize(w, h);
    }

    update(dt) {
        if (!this._spin) {
            // keep the countdown fresh while waiting
            this._waitTimer = (this._waitTimer || 0) + dt;
            if (this._waitTimer > 20) { this._waitTimer = 0; this._refreshButtons(); }
            return;
        }
        const s = this._spin;
        s.t = Math.min(1, s.t + dt / SPIN_SECONDS);
        this._angle = s.from + (s.to - s.from) * easeOutCubic(s.t);

        // tick each time a slice boundary passes the pointer
        const passed = Math.floor((s.from - this._angle) / SLICE_ANGLE + 0.5);
        if (passed !== this._lastTickSlice) {
            this._lastTickSlice = passed;
            this._game.audio.playWheelTick();
        }
        this._draw();
        if (s.t >= 1) {
            this._spin = null;
            this._lastTickSlice = 0;
            this._angle %= Math.PI * 2;
            this._finishSpin(s.slice);
        }
    }
}
