import { Game } from './engine/Game.js';
import { GameState } from './engine/GameState.js';
import { SplashScreen } from './screens/SplashScreen.js';
import { MainMenuScreen } from './screens/MainMenuScreen.js';
import { HowToPlayScreen } from './screens/HowToPlayScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { ShopScreen } from './screens/ShopScreen.js';
import { CollectionScreen } from './screens/CollectionScreen.js';
import { WheelScreen } from './screens/WheelScreen.js';
import { LevelMapScreen } from './screens/LevelMapScreen.js';
import { LoadingScreen } from './screens/LoadingScreen.js';
import { GameplayScreen } from './screens/GameplayScreen.js';
import { LEVELS, getLevel } from './data/levels.js';
import { scheduleMorningReminder } from './engine/MorningReminder.js';

/**
 * Puts a readable failure panel on screen. Without one, ANY exception thrown before
 * game.start() is completely silent to the player: every .screen overlay in index.html
 * starts with the `hidden` class and only Game.goTo() ever removes it, so a startup
 * crash leaves a blank page painted by nothing but the body's background colour. The
 * usual cause is WebGL being unavailable, which three.js reports by throwing out of the
 * WebGLRenderer constructor.
 *
 * Styled inline rather than through style.css, on the assumption that if we got here
 * something about the page's environment is already not to be trusted.
 */
function showStartupError(heading, detail, steps) {
    if (document.getElementById('startup-error')) return; // the boot watchdog got here first
    const box = document.createElement('div');
    box.id = 'startup-error'; // index.html's watchdog checks for this so we don't stack two panels
    box.setAttribute('role', 'alert');
    box.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'display:flex', 'flex-direction:column', 'justify-content:center', 'align-items:center',
        'gap:14px', 'padding:24px', 'box-sizing:border-box',
        'background:#1a1030', 'color:#f3ecff', 'text-align:center',
        'font-family:system-ui,Segoe UI,Roboto,sans-serif', 'overflow:auto',
    ].join(';');

    const h = document.createElement('h1');
    h.textContent = heading;
    h.style.cssText = 'margin:0;font-size:clamp(20px,5vw,30px);color:#ffd479;font-weight:800';

    const p = document.createElement('p');
    p.textContent = detail;
    p.style.cssText = 'margin:0;max-width:52ch;line-height:1.55;font-size:15px;opacity:0.92';

    box.append(h, p);

    if (steps && steps.length) {
        const ul = document.createElement('ul');
        ul.style.cssText = 'margin:0;max-width:52ch;text-align:left;line-height:1.7;font-size:14px;opacity:0.9';
        for (const step of steps) {
            const li = document.createElement('li');
            li.textContent = step;
            ul.appendChild(li);
        }
        box.appendChild(ul);
    }

    document.body.appendChild(box);
}

/** Matches how three.js probes for a context, so this agrees with what WebGLRenderer will do. */
function webglAvailable() {
    try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch (_) {
        return false;
    }
}

function boot() {
    try {
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('portrait').catch(() => {});
        }
    } catch (_) { /* orientation lock unavailable outside a fullscreen/installed context - fine on desktop */ }

    const game = new Game();

    const gameplayScreen = new GameplayScreen(game);

    game.registerScreen(GameState.SPLASH, new SplashScreen(game));
    game.registerScreen(GameState.MENU, new MainMenuScreen(game));
    game.registerScreen(GameState.HOW_TO_PLAY, new HowToPlayScreen(game));
    game.registerScreen(GameState.SETTINGS, new SettingsScreen(game));
    game.registerScreen(GameState.SHOP, new ShopScreen(game));
    game.registerScreen(GameState.COLLECTION, new CollectionScreen(game));
    game.registerScreen(GameState.WHEEL, new WheelScreen(game));
    game.registerScreen(GameState.LEVEL_MAP, new LevelMapScreen(game));
    game.registerScreen(GameState.LOADING, new LoadingScreen(game, gameplayScreen));
    game.registerScreen(GameState.GAMEPLAY, gameplayScreen);

    // Debug convenience: ?state=menu|howtoplay|levelmap|loading&level=lvl-3 jumps straight
    // to a screen without sitting through the splash - handy for quick local checks.
    const qp = new URLSearchParams(location.search);
    const debugState = qp.get('state');
    const DEBUG_STATES = {
        menu: GameState.MENU,
        howtoplay: GameState.HOW_TO_PLAY,
        settings: GameState.SETTINGS,
        shop: GameState.SHOP,
        collection: GameState.COLLECTION,
        wheel: GameState.WHEEL,
        levelmap: GameState.LEVEL_MAP,
    };

    if (debugState && DEBUG_STATES[debugState]) {
        game.start(DEBUG_STATES[debugState]);
    } else if (debugState === 'loading' || debugState === 'gameplay') {
        const levelDef = getLevel(qp.get('level')) || LEVELS[0];
        game.start(GameState.LOADING, { levelDef });
    } else {
        game.start(GameState.SPLASH);
    }

    window.__defrostGame = game;

    scheduleMorningReminder();

    // The "x" in a panel's corner does whatever that panel's own Back button does.
    document.querySelectorAll('.panel-close').forEach((btn) => {
        btn.addEventListener('click', () => document.getElementById(btn.dataset.back).click());
    });

    // Hardware/gesture back button (Android) - see MainActivity.onBackPressed. Closes any
    // open confirm/tutorial popup first, then falls back to whatever this screen's own
    // "Back" button does. Returns false only at the main menu, where there's nowhere left
    // to go back to and Android should exit the app as normal.
    const BACK_MODALS = [
        { overlay: 'tutorial-prompt-overlay', close: () => document.getElementById('btn-tutorial-no').click() },
        { overlay: 'shop-ad-confirm-overlay', close: () => document.getElementById('btn-shop-ad-no').click() },
        { overlay: 'shop-tutorial-overlay', close: (el) => el.classList.add('hidden') },
        { overlay: 'levellost-overlay', close: () => document.getElementById('ll-btn-map').click() },
    ];
    const BACK_BUTTON_BY_STATE = {
        [GameState.HOW_TO_PLAY]: 'btn-htp-back',
        [GameState.SETTINGS]: 'btn-settings-back',
        [GameState.SHOP]: 'btn-shop-back',
        [GameState.COLLECTION]: 'btn-collection-back',
        [GameState.WHEEL]: 'btn-wheel-back',
        [GameState.LEVEL_MAP]: 'btn-map-menu',
        [GameState.GAMEPLAY]: 'btn-gameplay-back',
    };
    window.__onAndroidBack = () => {
        for (const modal of BACK_MODALS) {
            const el = document.getElementById(modal.overlay);
            if (el && !el.classList.contains('hidden')) {
                modal.close(el);
                return true;
            }
        }
        const backBtnId = BACK_BUTTON_BY_STATE[game.currentName];
        if (!backBtnId) return false;
        document.getElementById(backBtnId).click();
        return true;
    };
}

if (!webglAvailable()) {
    showStartupError(
        'WebGL is not available',
        'Unfreeze My Things draws the ice with WebGL, and this browser could not create a WebGL context. ' +
        'That is a browser or machine setting, not a problem with the game files - the usual cause is ' +
        'hardware acceleration being switched off, an out-of-date graphics driver, or a managed/work ' +
        'device where policy disables it.',
        [
            'Chrome / Edge: open Settings > System and turn on "Use graphics acceleration when available", then restart the browser.',
            'Check chrome://gpu (or edge://gpu) - the WebGL rows there say whether it is disabled and why.',
            'On a managed work device the policy may be locked. Launching the browser once with the --enable-unsafe-swiftshader flag renders the game in software instead.',
            'Failing all of that, try a different browser (Firefox) or run the app on the phone via deploy.bat.',
        ],
    );
} else {
    try {
        boot();
    } catch (err) {
        console.error('Unfreeze My Things failed to start', err);
        showStartupError(
            'The game failed to start',
            String((err && err.message) || err),
            ['Open the browser console (F12) for the full stack trace.'],
        );
    }
}
