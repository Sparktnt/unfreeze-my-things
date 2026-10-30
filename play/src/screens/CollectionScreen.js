import * as THREE from '../../vendor/three/three.module.js';
import { BackgroundPlane } from '../rendering/BackgroundPlane.js';
import { GameState } from '../engine/GameState.js';
import { LEVELS } from '../data/levels.js';

/**
 * "My Things": every level's object as a tile - the photo once it's been unfrozen, a frosted
 * placeholder until then. Tapping an unfrozen thing replays its level. Reads straight from
 * the per-level save records, so there's no separate collection state to keep in sync.
 */
export class CollectionScreen {
    overlayId = 'collection-overlay';

    constructor(game) {
        this._game = game;
        this.group = new THREE.Group();
        this._bg = new BackgroundPlane('assets/images/ui/bg_menu.jpg', { opacity: 0.5 });
        this.group.add(this._bg.group);

        this._countEl = document.getElementById('collection-count');
        this._gridEl = document.getElementById('collection-grid');

        document.getElementById('btn-collection-back').addEventListener('click', () => {
            this._game.goTo(GameState.MENU);
        });
    }

    onEnter() {
        const save = this._game.save;
        let unfrozen = 0;
        this._gridEl.innerHTML = '';

        for (const level of LEVELS) {
            const record = save.getLevelRecord(level.id);
            const tile = document.createElement('button');
            tile.className = `collection-tile ${record.cleared ? 'unfrozen' : 'frozen'}`;

            if (record.cleared) {
                unfrozen += 1;
                const stars = '<span class="star-icon"></span>'.repeat(record.stars);
                tile.innerHTML = `<img src="${level.thumb}" alt="" loading="lazy">
                    <span class="collection-name">${level.name}</span>
                    <span class="collection-stars">${stars}</span>`;
                tile.addEventListener('click', () => this._game.goTo(GameState.LOADING, { levelDef: level }));
            } else {
                tile.disabled = true;
                tile.innerHTML = `<span class="collection-frost">?</span>
                    <span class="collection-name">Level ${level.number}</span>`;
            }
            this._gridEl.appendChild(tile);
        }

        this._countEl.textContent = `${unfrozen} of ${LEVELS.length} unfrozen`;
    }

    onResize(w, h) {
        this._bg.resize(w, h);
    }

    update() {}
}
