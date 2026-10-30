import * as THREE from '../../vendor/three/three.module.js';
import { BackgroundPlane } from '../rendering/BackgroundPlane.js';
import { GameState } from '../engine/GameState.js';
import { REWARD_AD_COINS } from '../engine/BreakManager.js';
import { TOOL_UNLOCK_LEVEL, isToolUnlocked } from '../data/levels.js';
import { SKINS } from '../data/skins.js';

const UPGRADES = {
    hairdryer: {
        label: 'Hairdryer Upgrades',
        rows: [
            {
                key: 'meltRadius',
                label: 'Hairdryer Radius',
                desc: 'Widens the melt brush at full ramp, clearing more ice per hold.',
            },
            {
                key: 'meltRate',
                label: 'Hairdryer Speed',
                desc: 'Melts ice faster the longer you hold in one place.',
            },
        ],
    },
    scraper: {
        label: 'Ice Scraper Upgrades',
        rows: [
            {
                key: 'scrapeRadius',
                label: 'Scraper Width',
                desc: 'Widens the scrape brush, clearing a wider swath per swipe.',
            },
            {
                key: 'scrapeRate',
                label: 'Scraper Power',
                desc: 'Scrapes ice away faster on a fast swipe.',
            },
        ],
    },
};

// First-time walkthrough shown the first time the Shop is opened once the Hairdryer is
// unlocked (see onEnter's gating). Purely informational - taps through on click, nothing to perform.
const SHOP_TUTORIAL_STEPS = [
    'Snowflakes, earned by clearing levels, can be spent here to upgrade your tools.',
    'Tap a tool\'s picture to browse its upgrades. More tools appear here as you unlock them.',
    'Each upgrade has several levels. Buying one makes that tool melt or scrape ice wider and faster.',
    'Out of hints? You can also buy extra ones here with your Snowflakes.',
];

function formatMs(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export class ShopScreen {
    overlayId = 'shop-overlay';

    constructor(game) {
        this._game = game;
        this.group = new THREE.Group();
        this._bg = new BackgroundPlane('assets/images/ui/bg_menu.jpg', { opacity: 0.5 });
        this.group.add(this._bg.group);

        this._coinEl = document.getElementById('shop-coin-count');
        this._rowsEl = document.getElementById('shop-upgrade-rows');
        this._labelEl = document.getElementById('shop-upgrade-label');
        this._tabsEl = document.getElementById('shop-tool-tabs');
        this._heartCountEl = document.getElementById('shop-heart-count');
        this._heartMaxEl = document.getElementById('shop-heart-max');
        this._heartTimerEl = document.getElementById('shop-heart-timer');
        this._buyHeartBtn = document.getElementById('btn-buy-heart');
        this._skinsEl = document.getElementById('shop-skins');

        this._shopTutorialEl = document.getElementById('shop-tutorial-overlay');
        this._shopTutorialTextEl = document.getElementById('shop-tutorial-text');
        this._shopTutorialNextBtn = document.getElementById('btn-shop-tutorial-next');
        this._shopTutorialNextBtn.addEventListener('click', () => this._advanceShopTutorial());

        this._adConfirmEl = document.getElementById('shop-ad-confirm-overlay');
        document.getElementById('shop-ad-confirm-text').textContent =
            `Watch a short ad to earn ${REWARD_AD_COINS} Snowflakes?`;
        document.getElementById('btn-shop-watch-ad').addEventListener('click', () => {
            this._adConfirmEl.classList.remove('hidden');
        });
        document.getElementById('btn-shop-ad-no').addEventListener('click', () => {
            this._adConfirmEl.classList.add('hidden');
        });
        document.getElementById('btn-shop-ad-yes').addEventListener('click', () => this._watchAdForCoins());

        this._activeTool = 'hairdryer';
        this._tabsEl.querySelectorAll('.shop-tool-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._activeTool = btn.dataset.tool;
                this._refresh();
            });
        });

        this._buyHeartBtn.addEventListener('click', () => {
            if (this._game.save.buyHeart()) {
                this._game.audio.playPurchase();
                this._refresh();
            }
        });

        document.getElementById('btn-shop-back').addEventListener('click', () => {
            this._game.goTo(this._returnTo || GameState.LEVEL_MAP);
        });
    }

    _buyUpgrade(key) {
        if (this._game.save.purchaseUpgrade(key)) {
            this._game.audio.playPurchase();
            this._refresh();
        }
    }

    /** Owned skin: equip it. Otherwise buy it (which also equips it) if affordable. */
    _onSkinTap(skin) {
        const save = this._game.save;
        if (save.ownsSkin(skin.id)) save.equipSkin(skin.id);
        else if (save.buySkin(skin.id, skin.price)) this._game.audio.playPurchase();
        else return;
        this._refresh();
    }

    _renderSkins() {
        const save = this._game.save;
        const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
        this._skinsEl.innerHTML = '';
        for (const skin of SKINS) {
            const owned = save.ownsSkin(skin.id);
            const equipped = save.equippedSkin === skin.id;
            const tile = document.createElement('button');
            tile.className = `shop-skin${equipped ? ' equipped' : ''}`;
            tile.disabled = !owned && save.coins < skin.price;
            tile.innerHTML = `
                <span class="shop-skin-swatch" style="background: radial-gradient(circle at 35% 30%, #fff 0%, ${rgb(skin.body)} 40%, ${rgb(skin.deep)} 100%)"></span>
                <span class="shop-skin-name">${skin.name}</span>
                <span class="shop-skin-state">${equipped ? 'Equipped' : owned ? 'Equip' : `<span class="coin-icon shop-btn-coin"></span>${skin.price}`}</span>
            `;
            tile.addEventListener('click', () => this._onSkinTap(skin));
            this._skinsEl.appendChild(tile);
        }
    }

    async _watchAdForCoins() {
        this._adConfirmEl.classList.add('hidden');
        const earned = await this._game.ads.showRewarded();
        if (earned) {
            this._game.save.addCoins(REWARD_AD_COINS);
            this._game.audio.playPurchase();
            this._refresh();
        }
    }

    _refresh() {
        const save = this._game.save;
        this._coinEl.textContent = String(save.coins);

        // Only tools the player has reached get a tab (see TOOL_UNLOCK_LEVEL).
        const unlocked = Object.keys(UPGRADES).filter((tool) => isToolUnlocked(tool, save.unlockedIndex));
        if (!unlocked.includes(this._activeTool)) this._activeTool = unlocked[0];
        this._tabsEl.querySelectorAll('.shop-tool-tab').forEach((btn) => {
            btn.classList.toggle('tool-locked', !unlocked.includes(btn.dataset.tool));
            btn.classList.toggle('active', btn.dataset.tool === this._activeTool);
        });

        const page = UPGRADES[this._activeTool];
        this._labelEl.textContent = page ? page.label : `Tool upgrades unlock at level ${TOOL_UNLOCK_LEVEL.hairdryer}`;

        this._rowsEl.innerHTML = '';
        for (const upg of page ? page.rows : []) {
            const level = save.getUpgradeLevel(upg.key);
            const maxLevel = save.upgradeMaxLevel;
            const cost = save.getUpgradeCost(upg.key);
            const maxed = cost === null;

            const row = document.createElement('div');
            row.className = 'shop-row';

            const dots = Array.from({ length: maxLevel }, (_, i) =>
                `<span class="shop-dot ${i < level ? 'filled' : ''}"></span>`,
            ).join('');

            const btnLabel = maxed ? 'MAX' : `${cost}`;
            const btnDisabled = maxed || save.coins < cost;

            row.innerHTML = `
                <div class="shop-row-info">
                    <div class="shop-row-title">${upg.label}</div>
                    <div class="shop-row-desc">${upg.desc}</div>
                    <div class="shop-dots">${dots}</div>
                </div>
                <button class="candy-btn candy-btn-secondary shop-buy-btn" ${btnDisabled ? 'disabled' : ''}>
                    ${maxed ? btnLabel : `<span class="coin-icon shop-btn-coin"></span>${btnLabel}`}
                </button>
            `;
            row.querySelector('button').addEventListener('click', () => this._buyUpgrade(upg.key));
            this._rowsEl.appendChild(row);
        }

        this._renderSkins();

        const hearts = save.hearts;
        const maxHearts = save.maxHearts;
        this._heartCountEl.textContent = String(hearts);
        this._heartMaxEl.textContent = String(maxHearts);
        this._heartTimerEl.textContent = hearts >= maxHearts ? 'Full' : `Next in ${formatMs(save.msUntilNextHeart)}`;

        const buyDisabled = hearts >= maxHearts || save.coins < save.buyHeartCost;
        this._buyHeartBtn.disabled = buyDisabled;
        this._buyHeartBtn.innerHTML = hearts >= maxHearts ? 'Full' : `Buy 1 <span class="coin-icon shop-btn-coin"></span>${save.buyHeartCost}`;
    }

    onEnter(params) {
        this._returnTo = params?.returnTo || GameState.LEVEL_MAP;
        this._refresh();

        // Shown once, the first time the Shop is opened with the Hairdryer unlocked - before
        // that there are no tool upgrades to explain.
        if (!this._game.save.shopTutorialSeen && isToolUnlocked('hairdryer', this._game.save.unlockedIndex)) {
            this._shopTutorialStepIndex = 0;
            this._showShopTutorialStep();
            this._shopTutorialEl.classList.remove('hidden');
        }
    }

    _showShopTutorialStep() {
        const isLast = this._shopTutorialStepIndex === SHOP_TUTORIAL_STEPS.length - 1;
        this._shopTutorialTextEl.textContent = SHOP_TUTORIAL_STEPS[this._shopTutorialStepIndex];
        this._shopTutorialNextBtn.textContent = isLast ? 'Got it!' : 'Next';
    }

    _advanceShopTutorial() {
        this._shopTutorialStepIndex += 1;
        if (this._shopTutorialStepIndex >= SHOP_TUTORIAL_STEPS.length) {
            this._shopTutorialEl.classList.add('hidden');
            this._game.save.setShopTutorialSeen(true);
            return;
        }
        this._showShopTutorialStep();
    }

    onResize(w, h) {
        this._bg.resize(w, h);
    }

    update() {
        if (this._heartTimerEl && this._game.save.hearts < this._game.save.maxHearts) {
            this._heartTimerEl.textContent = `Next in ${formatMs(this._game.save.msUntilNextHeart)}`;
        }
    }
}
