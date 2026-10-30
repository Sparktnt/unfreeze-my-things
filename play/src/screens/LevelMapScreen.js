import * as THREE from '../../vendor/three/three.module.js';
import { BackgroundPlane } from '../rendering/BackgroundPlane.js';
import { SparkleField } from '../rendering/SparkleField.js';
import { GameState } from '../engine/GameState.js';
import { LEVELS, isToolUnlocked, DEMO_LEVELS, TOTAL_LEVELS } from '../data/levels.js';

export class LevelMapScreen {
    overlayId = 'levelmap-overlay';

    constructor(game) {
        this._game = game;
        this.group = new THREE.Group();
        this._bg = new BackgroundPlane('assets/images/ui/bg_map.jpg', { opacity: 0.8 });
        this._sparkles = new SparkleField(26);
        this.group.add(this._bg.group, this._sparkles.points);

        this._pathEl = document.getElementById('levelmap-path');
        this._heartsEl = document.getElementById('map-hearts');
        this._starsEl = document.getElementById('map-stars');
        this._coinsEl = document.getElementById('map-coins');
        this._shopHintEl = document.getElementById('map-shop-hint');

        document.getElementById('btn-map-menu').addEventListener('click', () => {
            this._game.goTo(GameState.MENU);
        });
        document.getElementById('btn-map-shop').addEventListener('click', () => {
            this._game.save.setMapShopHintSeen(true);
            this._game.goTo(GameState.SHOP, { returnTo: GameState.LEVEL_MAP });
        });

        this._buildNodes();
    }

    _totalStars() {
        let total = 0;
        for (const level of LEVELS) total += this._game.save.getLevelRecord(level.id).stars;
        return total;
    }

    _buildNodes() {
        this._pathEl.innerHTML = '';
        const unlockedIndex = this._game.save.unlockedIndex;
        const totalStars = this._totalStars();

        LEVELS.forEach((level) => {
            const record = this._game.save.getLevelRecord(level.id);
            const node = document.createElement('div');

            let status = 'locked';
            if (record.cleared) status = 'cleared';
            else if (level.index === unlockedIndex) status = 'current';

            const starLocked = status !== 'locked' && !record.cleared && level.starGate > 0 && totalStars < level.starGate;
            if (starLocked) status = 'star-locked';

            node.className = `level-node ${status}`;
            node.dataset.levelId = level.id;

            if (starLocked) {
                node.innerHTML = `<span class="star-lock-icon">&#10052;</span><span class="star-lock-req">${level.starGate}<span class="star-icon"></span></span>`;
            } else {
                node.textContent = String(level.number);
            }

            if (status === 'cleared' && record.stars > 0) {
                const starRow = document.createElement('div');
                starRow.className = 'star-row';
                for (let i = 0; i < record.stars; i++) {
                    const s = document.createElement('span');
                    s.className = 'star-icon';
                    starRow.appendChild(s);
                }
                node.appendChild(starRow);
            }

            if (status !== 'locked' && status !== 'star-locked') {
                node.addEventListener('click', () => {
                    this._game.goTo(GameState.LOADING, { levelDef: level });
                });
            }

            this._pathEl.appendChild(node);
        });

        // The path is laid out bottom-up (column-reverse), so the last child sits at the top.
        if (DEMO_LEVELS) {
            const more = document.createElement('a');
            more.className = 'levelmap-more';
            more.href = '../#download';
            more.textContent = `Demo: ${DEMO_LEVELS} of ${TOTAL_LEVELS} levels. Get the full game on Android!`;
            this._pathEl.appendChild(more);
        } else if (LEVELS.every((level) => this._game.save.getLevelRecord(level.id).cleared)) {
            const done = document.createElement('div');
            done.className = 'levelmap-more';
            done.textContent = 'More levels coming soon!';
            this._pathEl.appendChild(done);
        }
    }

    onEnter() {
        this._buildNodes();
        this._heartsEl.textContent = String(this._game.save.hearts);
        this._coinsEl.textContent = String(this._game.save.coins);
        this._starsEl.textContent = String(this._totalStars());

        // Nudges the player toward the Shop once the Hairdryer is unlocked and there are
        // tool upgrades to buy. Dismissed for good the first time they tap it (see the
        // btn-map-shop click handler above).
        const showHint = !this._game.save.mapShopHintSeen && isToolUnlocked('hairdryer', this._game.save.unlockedIndex);
        this._shopHintEl.classList.toggle('hidden', !showHint);

        requestAnimationFrame(() => {
            const cleared = this._pathEl.querySelectorAll('.level-node.cleared');
            const current = this._pathEl.querySelector('.level-node.current')
                || this._pathEl.querySelector('.level-node.star-locked')
                || cleared[cleared.length - 1];
            current?.scrollIntoView({ block: 'center' });
        });
    }

    onResize(w, h) {
        this._bg.resize(w, h);
        this._sparkles.resize(w, h);
    }

    update(dt) {
        this._sparkles.update(dt);
    }
}
