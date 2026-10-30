import * as THREE from '../../vendor/three/three.module.js';
import { BackgroundPlane } from '../rendering/BackgroundPlane.js';
import { GameState } from '../engine/GameState.js';
import { LEVELS, RULES, TOOL_UNLOCK_LEVEL } from '../data/levels.js';


const SECTIONS = [
    {
        title: 'THE GOAL',
        body: 'Every level has one of your things sealed inside a block of ice.\nClear all the ice to get it back - it then shows up in My Things.',
    },
    {
        title: 'GAMEPLAY',
        body: `Tap the ice with the Pickaxe to chip away a chunk.\nFrom level ${TOOL_UNLOCK_LEVEL.hairdryer}, the Hairdryer: press and hold to melt the ice around your finger, with real drips running down.\nFrom level ${TOOL_UNLOCK_LEVEL.scraper}, the Scraper: swipe fast to shave off a wide swath - thick Deep Freeze patches take a few extra passes.`,
    },
    {
        title: "DON'T BREAK IT",
        body: "Once part of your thing is bare, be gentle with it: a Pickaxe tap on it cracks it, and so does holding the Hairdryer on it too long (the brush glows red first). The Scraper is always safe.\nThe gems at the top show how many more cracks it can take - 3 cracks and it breaks and you lose the level. Watch an ad to fix a crack and keep going, or just try again.\nLevels 1-5 are practice: you'll see the cracks, but they don't count.",
    },
    {
        title: 'SPECIAL LEVELS',
        body: `Some levels come with a rule, shown under the top bar:\n${Object.values(RULES).map((r) => `${r.label} - ${r.desc}`).join('\n')}\nA golden glint in the ice marks a hidden bonus - clear that chunk for extra Snowflakes.`,
    },
    {
        title: 'DAILY THING',
        body: 'A fresh frozen thing every day, from the main menu. Clear it on consecutive days to build a streak - the longer the streak, the bigger the bonus.',
    },
];

const REWARD_SECTIONS = [
    {
        title: 'SNOWFLAKES',
        icon: 'coin-icon',
        body: 'Earned every time you clear a level - more chunks and a faster time means more Snowflakes.\nSpend them in the Shop on tool upgrades or extra hints.',
    },
    {
        title: 'HINTS',
        icon: 'heart-icon',
        body: 'Tap the red candy in a level to instantly clear your stuckest patch of ice.\nHints refill over time, or buy more with Snowflakes in the Shop.',
    },
    {
        title: 'STARS',
        icon: 'star-icon',
        body: 'Earned by clearing a level fast enough:\n45s or under = 1 star, half Snowflakes\n30s or under = 2 stars, three quarters\n15s or under = 3 stars, full Snowflakes\nYou can always replay for a better time. Some levels need a minimum total of stars to unlock.',
    },
];

const PAGES = [
    { label: 'How to Play', sections: SECTIONS },
    { label: 'Rewards', sections: REWARD_SECTIONS },
    { label: 'Stats', stats: true },
];

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

export class HowToPlayScreen {
    overlayId = 'howtoplay-overlay';

    constructor(game) {
        this._game = game;
        this.group = new THREE.Group();
        this._bg = new BackgroundPlane('assets/images/ui/bg_menu.jpg', { opacity: 0.5 });
        this.group.add(this._bg.group);

        this._tabsEl = document.getElementById('htp-tabs');
        this._sectionsEl = document.getElementById('htp-sections');
        this._renderPage(0);

        document.getElementById('btn-htp-back').addEventListener('click', () => {
            this._game.goTo(GameState.MENU);
        });
    }

    _renderPage(index) {
        this._pageIndex = index;

        this._tabsEl.innerHTML = PAGES.map((p, i) =>
            `<button class="htp-tab ${i === index ? 'active' : ''}" data-page="${i}">${p.label}</button>`,
        ).join('');
        this._tabsEl.querySelectorAll('.htp-tab').forEach((btn) => {
            btn.addEventListener('click', () => this._renderPage(Number(btn.dataset.page)));
        });

        if (PAGES[index].stats) {
            this._sectionsEl.innerHTML = this._statsHtml();
            return;
        }

        this._sectionsEl.innerHTML = PAGES[index].sections.map((s) => {
            const icon = s.icon ? `<span class="${s.icon} htp-candy-icon"></span>` : '';
            return `<div class="htp-section"><h3>${icon}${s.title}</h3><p>${s.body}</p></div>`;
        }).join('');
    }

    onEnter() {
        this._renderPage(0);
    }

    /** Per-level play stats kept in the save (SaveManager.recordStat): how often each level
     *  was started, cleared and backed out of, and how long clears take. Doubles as the
     *  balancing readout - a level with many quits or a long average is the one to retune. */
    _statsHtml() {
        const save = this._game.save;
        const rows = [...LEVELS.map((l) => ({ id: l.id, label: String(l.number) })), { id: 'daily', label: 'Daily' }]
            .map(({ id, label }) => ({ label, stat: save.getStat(id), best: save.getLevelRecord(id).bestTimeMs }))
            .filter(({ stat }) => stat.plays > 0)
            .map(({ label, stat, best }) => `<tr><td>${label}</td><td>${stat.plays}</td><td>${stat.clears}</td><td>${stat.quits}</td>`
                + `<td>${stat.clears ? seconds(stat.totalMs / stat.clears) : '-'}</td><td>${best ? seconds(best) : '-'}</td></tr>`);
        if (!rows.length) return '<div class="htp-section"><p>Play a level and your stats show up here.</p></div>';
        return `<table class="htp-stats"><tr><th>Level</th><th>Plays</th><th>Clears</th><th>Quits</th><th>Avg</th><th>Best</th></tr>${rows.join('')}</table>`;
    }


    onResize(w, h) {
        this._bg.resize(w, h);
    }

    update() {}
}
