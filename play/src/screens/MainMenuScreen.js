import * as THREE from '../../vendor/three/three.module.js';
import { BackgroundPlane } from '../rendering/BackgroundPlane.js';
import { SparkleField } from '../rendering/SparkleField.js';
import { GameState } from '../engine/GameState.js';
import { LEVELS, getDailyLevel, dayKey } from '../data/levels.js';

export class MainMenuScreen {
    overlayId = 'menu-overlay';

    constructor(game) {
        this._game = game;
        this.group = new THREE.Group();
        this._bg = new BackgroundPlane('assets/images/ui/bg_menu.jpg');
        this._sparkles = new SparkleField(34);
        this.group.add(this._bg.group, this._sparkles.points);

        this._coinEl = document.getElementById('menu-coin-count');
        this._tutorialPromptEl = document.getElementById('tutorial-prompt-overlay');

        document.getElementById('btn-start').addEventListener('click', () => {
            if (!this._game.save.tutorialSeen) {
                this._tutorialPromptEl.classList.remove('hidden');
            } else {
                this._game.goTo(GameState.LEVEL_MAP);
            }
        });

        document.getElementById('btn-tutorial-yes').addEventListener('click', () => {
            this._tutorialPromptEl.classList.add('hidden');
            this._game.goTo(GameState.LOADING, { levelDef: LEVELS[0] });
        });
        document.getElementById('btn-tutorial-no').addEventListener('click', () => {
            this._tutorialPromptEl.classList.add('hidden');
            this._game.save.setTutorialSeen(true);
            this._game.goTo(GameState.LEVEL_MAP);
        });
        this._dailyBtn = document.getElementById('btn-daily');
        this._dailySubEl = document.getElementById('daily-sub');
        this._dailyBtn.addEventListener('click', () => {
            this._game.goTo(GameState.LOADING, { levelDef: getDailyLevel(this._game.save.unlockedIndex) });
        });
        document.getElementById('btn-collection').addEventListener('click', () => {
            this._game.goTo(GameState.COLLECTION);
        });
        this._wheelBtn = document.getElementById('btn-wheel');
        this._wheelBtn.addEventListener('click', () => {
            this._game.goTo(GameState.WHEEL);
        });
        document.getElementById('btn-menu-shop').addEventListener('click', () => {
            this._game.goTo(GameState.SHOP, { returnTo: GameState.MENU });
        });
        document.getElementById('btn-howtoplay').addEventListener('click', () => {
            this._game.goTo(GameState.HOW_TO_PLAY);
        });
        document.getElementById('btn-settings').addEventListener('click', () => {
            this._game.goTo(GameState.SETTINGS);
        });
        document.getElementById('menu-coins').addEventListener('click', () => {
            this._game.goTo(GameState.SHOP, { returnTo: GameState.MENU });
        });
    }

    onEnter() {
        const save = this._game.save;
        this._coinEl.textContent = String(save.coins);

        // The Daily Thing opens once level 1 is cleared, so it never collides with the tutorial.
        const today = dayKey();
        const streak = save.dailyStreak(today, dayKey(new Date(Date.now() - 86400000)));
        const locked = save.unlockedIndex < 1;
        this._dailyBtn.disabled = locked;
        this._dailySubEl.textContent = locked ? 'Clear level 1 first'
            : save.isDailyDone(today) ? `Done today - ${streak} day streak`
                : streak > 0 ? `${streak} day streak - keep it going!`
                    : 'New thing every day';

        // The mini wheel turns and shows a dot while today's free spin is waiting.
        this._wheelBtn.classList.toggle('ready', save.canSpinWheel(today));
    }

    onResize(w, h) {
        this._bg.resize(w, h);
        this._sparkles.resize(w, h);
    }

    update(dt) {
        this._sparkles.update(dt);
    }
}
