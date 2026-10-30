import * as THREE from '../../vendor/three/three.module.js';
import { GameState } from '../engine/GameState.js';
import { IceLevel } from '../mechanics/IceLevel.js';
import { easeOutCubic, easeOutBack } from '../engine/Easing.js';
import { LEVELS, getLevelByIndex, TOOL_UNLOCK_LEVEL, isToolUnlocked, RULES, dayKey } from '../data/levels.js';
import { HairdryerOverheat, OverheatState } from '../mechanics/HairdryerOverheat.js';
import { ComboMeter } from '../mechanics/ComboMeter.js';
import { BreakManager } from '../engine/BreakManager.js';
import { getSkin } from '../data/skins.js';

// Enum-style list driving the tool hotbar's state - add a new tool by adding its name here
// and a matching `#tool-<name>` button in index.html; _selectTool()/the click wiring below
// both loop over this instead of hardcoding each tool.
const TOOL_NAMES = ['pickaxe', 'hairdryer', 'scraper'];

const BASE_COINS_PER_LEVEL = 50;
const BONUS_PER_PIECE = 2;
const LEVEL_CLEAR_ANIM_DURATION = 0.8;
const SCORE_COUNT_DURATION = 1.2;
const REVEAL_HOLD_SECONDS = 1.6; // beat held on the fully-revealed object (and its name) before the score panel appears
const BONUS_CELL_COINS = 15; // paid per hidden bonus chunk cleared (see IceLevel.takeBonusEvents)
const FRAGILE_PENALTY_SECONDS = 5; // added to the timer when the Hairdryer overheats on a Fragile level
const DAILY_BASE_BONUS = 100; // extra Snowflakes for the day's first Daily Thing clear...
const DAILY_STREAK_BONUS = 20; // ...plus this per day of streak, up to DAILY_STREAK_CAP days
const DAILY_STREAK_CAP = 10;
const COMBO_WINDOW = 0.6; // seconds between chips to keep a combo streak alive
const COMBO_SHOW_THRESHOLD = 2; // streak length before the on-screen "Nx!" label appears
const COMBO_BONUS_THRESHOLD = 3; // streak length before a combo starts adding bonus coins

// A nudge shown once per level, pointing at the hint button, if the player goes this long
// without clearing any more ice - most likely stuck on a stubborn patch.
const HINT_NUDGE_STUCK_SECONDS = 12;
const HINT_NUDGE_VISIBLE_SECONDS = 5;

// Star thresholds: how fast the level must be cleared to earn each one. Slower than
// STAR1_CUTOFF earns none. speedMultiplier() below pays Snowflakes off the same tiers.
const STAR3_CUTOFF = 15;
const STAR2_CUTOFF = 30;
const STAR1_CUTOFF = 45;

// Breaking your thing: hitting the bare object cracks it - a Pickaxe tap on it, or holding the
// Hairdryer over it for SCORCH_SECONDS (the Scraper is always safe). MAX_CRACKS and it
// shatters and the level is lost; one rewarded-ad continue per attempt mends a crack.
const MAX_CRACKS = 3;
const SAFE_LEVELS = 5; // levels 1-5 still show cracks but can't be lost, so new players learn first
const SCORCH_SECONDS = 1.5;
const SCORCH_WARN_FROM = 0.35; // share of SCORCH_SECONDS before the brush starts glowing red
const CRACK_GRACE_SECONDS = 0.4; // a double-tap in the same instant only costs one crack
const BREAK_ANIM_SECONDS = 1.3; // the shatter plays out before the lost panel appears
// Near ice (an edge, or a small leftover patch - see IceLevel.bareObjectAt's nearIce) a miss is
// easy, so a Pickaxe hit there only scuffs: this many scuffs make one crack.
const SCUFFS_PER_CRACK = 2;
const SCUFF_SIZE = 40; // world px - a smaller mark than a full crack

// Ice-crystal gem for the health row; .broken greys it out and shows the crack line.
const GEM_SVG = '<svg class="health-gem" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path class="gem-body" d="M12 2L21 8.5L12 22L3 8.5Z"/>'
    + '<path class="gem-shine" d="M12 3.5L15.5 8.5L12 19L8.5 8.5Z"/>'
    + '<path class="gem-crack" d="M13.5 3.5L10.5 9L13.8 12.5L11 19"/></svg>';

// First-time tutorial walkthrough (level index 0 only, gated by save.tutorialSeen).
// `requires` steps advance on the matching gameplay action; steps with no `requires`
// are informational and advance on tap (see _advanceTutorial/_showTutorialStep). The
// level can't be finished (see update()'s isCleared branch) until every step is read.
const TUTORIAL_STEPS = [
    { text: 'One of your things is frozen in this block of ice.\nClear all the ice to get it back!', requires: null },
    { text: 'Tap the ice with the Pickaxe to chip a chunk away.', requires: 'chip' },
    { text: `Careful! Don't hit your thing once it's bare - it cracks.\n${MAX_CRACKS} cracks and it breaks! (You're safe for the first ${SAFE_LEVELS} levels.)`, requires: null },
    { text: 'The bar shows how much ice you\'ve cleared. Finish fast to earn up to 3 stars and more Snowflakes.', requires: null },
    { text: 'Stuck? Tap the red candy to clear a patch of ice instantly. Hints refill over time.', requires: null },
    { text: `Better tools unlock as you go: the Hairdryer at level ${TOOL_UNLOCK_LEVEL.hairdryer} and the Scraper at level ${TOOL_UNLOCK_LEVEL.scraper}.\nSpend Snowflakes in the Shop to upgrade them.`, requires: null },
];

// One-step callout shown in the first level played after a tool unlocks (gated by
// save.isToolIntroSeen). Runs through the same machinery as TUTORIAL_STEPS.
const TOOL_INTRO_STEPS = {
    hairdryer: { text: 'New tool: the Hairdryer!\nSelect it, then press & hold to melt the ice around your finger - far more than one Pickaxe chip.\nDon\'t hold it on your bare thing too long - it scorches!', requires: 'melt', tool: 'hairdryer' },
    scraper: { text: 'New tool: the Scraper!\nSelect it and swipe fast to shave off a wide swath of ice. Deep Freeze patches take a few extra passes.', requires: 'scrape', tool: 'scraper' },
};

// One-time callout the first time a level can actually be lost (save.isToolIntroSeen('cracks')).
const CRACKS_INTRO_STEP = {
    text: `From now on, careful!\nHitting your bare thing cracks it - ${MAX_CRACKS} cracks and it breaks.\nThe gems at the top show how many cracks it can still take.`,
    requires: null,
    introKey: 'cracks',
};

function speedMultiplier(time) {
    if (time <= STAR3_CUTOFF) return 1.0;
    if (time <= STAR2_CUTOFF) return 0.75;
    if (time <= STAR1_CUTOFF) return 0.5;
    return 0.3;
}

export class GameplayScreen {
    overlayId = 'gameplay-overlay';

    constructor(game) {
        this._game = game;
        this.group = new THREE.Group();

        const cardGeo = new THREE.PlaneGeometry(1, 1);
        const cardMat = new THREE.MeshBasicMaterial({ color: 0xf4f7fb, transparent: true, opacity: 0.92 });
        this._card = new THREE.Mesh(cardGeo, cardMat);
        this._card.position.z = -1;
        this.group.add(this._card);

        this._iceLevel = new IceLevel(this.group, game.audio, game.renderer);

        this._topbarEl = document.querySelector('.gameplay-topbar');
        this._toolBarEl = document.querySelector('.tool-bar');
        this._backBtn = document.getElementById('btn-gameplay-back');
        this._progressFill = document.getElementById('progress-fill');
        this._progressLabel = document.getElementById('progress-label');
        this._timerEl = document.getElementById('gameplay-timer');
        this._coinEl = document.getElementById('gameplay-coin-count');
        this._comboLabelEl = document.getElementById('gameplay-combo');
        this._comboMeterEl = document.getElementById('combo-meter-text');

        this._overheat = new HairdryerOverheat();
        this._combo = new ComboMeter();
        this._combo.attachDisplay(this._comboMeterEl);
        this._scrapePrevPos = null;
        this._scrapePrevTime = 0;

        this._tutorialEl = document.getElementById('gameplay-tutorial');
        this._tutorialTextEl = document.getElementById('tutorial-text');
        this._tutorialEl.addEventListener('click', () => {
            if (!this._tutorialActive) return;
            if (!this._tutorialSteps[this._tutorialStepIndex].requires) this._advanceTutorial();
        });

        this._lcPanel = document.querySelector('#levelclear-overlay .levelclear-panel');
        this._lcStats = document.querySelector('#levelclear-overlay .levelclear-stats');
        this._lcStarEls = Array.from(document.querySelectorAll('#lc-stars .lc-star'));
        this._lcName = document.getElementById('lc-name');
        this._lcTime = document.getElementById('lc-time');
        this._lcMult = document.getElementById('lc-mult');
        this._lcCombo = document.getElementById('lc-combo');
        this._lcMath = document.getElementById('lc-math');
        this._lcCoins = document.getElementById('lc-coins');
        this._lcActions = document.getElementById('lc-actions');
        this._lcBtnNext = document.getElementById('lc-btn-next');
        this._lcBtnMap = document.getElementById('lc-btn-map');
        this._levelClearOverlay = document.getElementById('levelclear-overlay');

        this._ruleEl = document.getElementById('gameplay-rule');
        this._healthEl = document.getElementById('gameplay-health');
        this._healthEl.innerHTML = GEM_SVG.repeat(MAX_CRACKS);
        this._gemEls = Array.from(this._healthEl.querySelectorAll('.health-gem'));

        this._lostOverlay = document.getElementById('levellost-overlay');
        this._llPanel = this._lostOverlay.querySelector('.levellost-panel');
        this._llName = document.getElementById('ll-name');
        this._llMsg = document.getElementById('ll-msg');
        this._llBtnContinue = document.getElementById('ll-btn-continue');
        this._llBtnMap = document.getElementById('ll-btn-map');
        this._llBtnContinue.addEventListener('click', () => this._continueAfterBreak());
        document.getElementById('ll-btn-retry').addEventListener('click', () => {
            this._state = 'idle';
            this._game.goTo(GameState.LOADING, { levelDef: this._levelDef });
        });
        this._llBtnMap.addEventListener('click', () => {
            this._state = 'idle';
            this._game.goTo(this._levelDef.isDaily ? GameState.MENU : GameState.LEVEL_MAP);
        });
        this._revealNameEl = document.getElementById('gameplay-reveal-name');
        this._floatsEl = document.getElementById('gameplay-floats');

        this._backBtn.addEventListener('click', () => {
            if (this._state === 'playing') this._game.save.recordStat(this._levelDef.id, 'quits');
            this._game.goTo(this._levelDef.isDaily ? GameState.MENU : GameState.LEVEL_MAP);
        });

        this._lcBtnNext.addEventListener('click', () => this._finishLevel(true));
        this._lcBtnMap.addEventListener('click', () => this._finishLevel(false));

        this._toolButtons = {};
        for (const name of TOOL_NAMES) {
            const btn = document.getElementById(`tool-${name}`);
            this._toolButtons[name] = btn;
            btn.addEventListener('click', () => this._selectTool(name));
        }

        this._hintBtn = document.getElementById('btn-gameplay-hint');
        this._hintCountEl = document.getElementById('gameplay-hint-count');
        this._hintNudgeEl = document.getElementById('gameplay-hint-nudge');
        this._hintBtn.addEventListener('click', () => this._useHint());

        this._state = 'idle';
    }

    /** Heavy async work, called by LoadingScreen while its progress bar is visible. */
    async prepareLevel(levelDef) {
        this._levelDef = levelDef;
        const w = this._game.width;
        const h = this._game.height;
        const topMargin = 110;
        // Clears the tool bar (50px bottom offset + 96px buttons, see .tool-bar/.tool-btn
        // in style.css) - too small a margin here let the item art sit low enough to
        // crowd the tools.
        const bottomMargin = 170;
        const maxWidth = w - 40;
        const maxHeight = h - topMargin - bottomMargin;
        const centerY = -topMargin / 2 + bottomMargin / 2;

        this._layout = { centerX: 0, centerY, maxWidth, maxHeight };

        this._iceLevel.setSkin(getSkin(this._game.save.equippedSkin));
        this._iceLevel.setUpgrades({
            meltRadius: this._game.save.getUpgradeLevel('meltRadius'),
            meltRate: this._game.save.getUpgradeLevel('meltRate'),
            scrapeRadius: this._game.save.getUpgradeLevel('scrapeRadius'),
            scrapeRate: this._game.save.getUpgradeLevel('scrapeRate'),
        });

        await this._iceLevel.load(levelDef, {
            centerX: 0,
            centerY,
            maxWidth,
            maxHeight,
        });

        this._resizeCard();
    }

    _resizeCard() {
        if (!this._layout) return;
        const pad = 24;
        this._card.position.set(this._layout.centerX, this._layout.centerY, -1);
        const w = Math.min(this._layout.maxWidth, this._iceLevel.planeSize.w + pad * 2);
        const h = Math.min(this._layout.maxHeight, this._iceLevel.planeSize.h + pad * 2);
        this._card.scale.set(w, h, 1);
    }

    _selectTool(tool) {
        this._tool = tool;
        for (const name of TOOL_NAMES) {
            this._toolButtons[name].classList.toggle('selected', name === tool);
        }
        this._scrapePrevPos = null; // don't compute a bogus first-frame swipe speed from a stale point
        this._updateTutorialHand();
    }

    /** Where the tutorial hand points: at a new tool's button until it's selected (and the
     *  callout lifts out of the way), then at the ice like any other `requires` step. */
    _updateTutorialHand() {
        const step = this._tutorialActive ? this._tutorialSteps[this._tutorialStepIndex] : null;
        const target = step?.tool && this._tool !== step.tool ? step.tool : null;
        for (const name of TOOL_NAMES) {
            this._toolButtons[name].classList.toggle('point', name === target);
        }
        this._tutorialEl.classList.toggle('step-select', !!target);
        this._tutorialEl.classList.toggle('no-hand', !step?.requires || !!target);
    }

    onEnter() {
        this._state = 'playing';
        this._game.tilt.recenter(); // "level flat" is wherever they're holding it right now
        this._levelTimer = 0;
        this._bonusCoins = 0;
        this._floatsEl.innerHTML = '';
        this._revealNameEl.classList.remove('show');
        this._game.save.recordStat(this._levelDef.id, 'plays');
        this._comboCount = 0;
        this._comboTimer = 999;
        this._maxCombo = 0;
        this._comboLabelVisibleFor = 0;
        this._comboLabelEl.classList.remove('show');

        this._lastProgress = 0;
        this._stuckTimer = 0;
        this._hintNudgeShown = false;
        this._hintNudgeVisibleFor = 0;
        this._hintNudgeEl.classList.add('hidden');

        // Fresh state each level - Overheat/the unified combo meter shouldn't carry over.
        this._overheat = new HairdryerOverheat();
        this._combo = new ComboMeter();
        this._combo.attachDisplay(this._comboMeterEl);
        this._toolButtons.hairdryer.classList.remove('overheating', 'heating', 'locked');
        this._iceLevel.setOverheat(false);

        this._levelClearElapsed = 0;
        this._coinAnimStarted = false;
        this._scoreCountElapsed = 0;
        this._levelClearOverlay.classList.add('hidden');
        this._lostOverlay.classList.add('hidden');
        this._llPanel.classList.remove('visible');
        this._lcPanel.classList.remove('visible');
        this._lcStats.classList.remove('visible');
        this._lcActions.style.display = 'none';
        for (const star of this._lcStarEls) star.classList.remove('filled');

        this._coinEl.textContent = String(this._game.save.coins);
        this._updateHintUi();
        this._updateTimerUi();

        this._topbarEl.classList.remove('reveal-hide');
        this._toolBarEl.classList.remove('reveal-hide');
        this._backBtn.classList.remove('reveal-hide');
        this._ruleEl.classList.remove('reveal-hide');
        this._healthEl.classList.remove('reveal-hide');
        this._comboMeterEl.classList.remove('reveal-hide');

        // The hotbar shows the tools the player has unlocked - or, on a one-tool rule level
        // (see RULES in data/levels.js), just that tool.
        const save = this._game.save;
        const rule = RULES[this._levelDef.rule] || null;
        let allowed = TOOL_NAMES.filter((name) => isToolUnlocked(name, save.unlockedIndex) && (!rule?.tool || name === rule.tool));
        if (!allowed.length) allowed = ['pickaxe'];
        for (const name of TOOL_NAMES) {
            this._toolButtons[name].classList.toggle('tool-locked', !allowed.includes(name));
        }
        this._selectTool(allowed[0]);

        // Cracks only count once past the first few levels (the Daily Thing too, until then).
        this._safe = this._levelDef.isDaily ? save.unlockedIndex < SAFE_LEVELS : this._levelDef.number <= SAFE_LEVELS;
        this._cracks = 0;
        this._scuffs = 0;
        this._crackGrace = 0;
        this._scorchTimer = 0;
        this._continued = false;
        this._iceLevel.setScorchWarning(0);
        this._healthEl.classList.toggle('hidden', this._safe);
        this._updateHealthUi();

        this._ruleEl.textContent = rule ? `${rule.label}: ${rule.desc}` : '';
        this._ruleEl.classList.toggle('hidden', !rule);

        this._tutorialSteps = !this._levelDef.isDaily && this._levelDef.index === 0 && !save.tutorialSeen
            ? TUTORIAL_STEPS
            : [
                ...allowed.filter((name) => TOOL_INTRO_STEPS[name] && !save.isToolIntroSeen(name))
                    .map((name) => TOOL_INTRO_STEPS[name]),
                ...(!this._safe && !save.isToolIntroSeen(CRACKS_INTRO_STEP.introKey) ? [CRACKS_INTRO_STEP] : []),
            ];
        this._tutorialActive = this._tutorialSteps.length > 0;
        this._tutorialStepIndex = 0;
        this._tutorialEl.classList.toggle('hidden', !this._tutorialActive);
        this._tutorialEl.classList.remove('step-hold', 'no-hand', 'advanceable');
        if (this._tutorialActive) this._showTutorialStep();
        else this._updateTutorialHand();
    }

    onResize() {
        if (!this._levelDef || !this._iceLevel.ready) return;
        const w = this._game.width;
        const h = this._game.height;
        const topMargin = 110;
        const bottomMargin = 170; // keep in sync with prepareLevel()'s margin above
        this._layout = {
            centerX: 0,
            centerY: -topMargin / 2 + bottomMargin / 2,
            maxWidth: w - 40,
            maxHeight: h - topMargin - bottomMargin,
        };
        this._iceLevel.resize(this._layout);
        this._resizeCard();
    }

    update(dt) {
        const input = this._game.input;

        if (this._state === 'playing') {
            this._levelTimer += dt;
            this._comboTimer += dt;
            this._crackGrace = Math.max(0, this._crackGrace - dt);
            let scorching = false;

            // Overheat state machine advances every frame regardless of which tool is
            // active (it only "heats up" while isHoldingHairdryer is true, but still needs
            // to tick its cooldown/etc down in the meantime).
            const isHoldingHairdryer = this._tool === 'hairdryer' && input.isHolding;
            const overheatEvents = this._overheat.update(dt, isHoldingHairdryer);
            if (overheatEvents.enteredOverheat && this._levelDef.rule === 'fragile') {
                // Fragile: no boost - straight to the lockout, plus a time penalty.
                overheatEvents.enteredOverheat = false;
                overheatEvents.enteredCooldown = true;
                this._overheat.forceCooldown();
                this._levelTimer += FRAGILE_PENALTY_SECONDS;
                this._game.shake(8, 0.2);
                this._spawnFloat(`Too hot! +${FRAGILE_PENALTY_SECONDS}s`, this._game.width / 2, this._game.height * 0.3, 'penalty');
            }
            this._iceLevel.setOverheat(this._overheat.isOverheating);
            this._updateOverheatUi(overheatEvents);

            if (this._tool === 'pickaxe' && input.tapDetected) {
                const world = this._game.screenToWorld(input.tapPosition);
                const predictedStreak = this._comboTimer <= COMBO_WINDOW ? this._comboCount + 1 : 1;
                const chipped = this._iceLevel.tryChip(world.x, world.y, predictedStreak);

                if (chipped) {
                    this._comboCount = predictedStreak;
                    this._comboTimer = 0;
                    this._maxCombo = Math.max(this._maxCombo, this._comboCount);
                    if (this._comboCount >= COMBO_SHOW_THRESHOLD) this._showCombo(this._comboCount);
                    // Very slight, quick jolt so a pickaxe hit has some physical weight.
                    this._game.shake(4, 0.1);
                    this._combo.registerDamage();
                    if (this._tutorialActive && this._tutorialSteps[this._tutorialStepIndex].requires === 'chip') {
                        this._advanceTutorial();
                    }
                } else {
                    this._comboCount = 0;
                    this._comboLabelEl.classList.remove('show');
                    const bare = this._iceLevel.bareObjectAt(world.x, world.y);
                    if (bare) this._damageObject(bare, 'crack', world);
                }
            } else if (this._tool === 'hairdryer' && input.isHolding) {
                // Locked out entirely during the post-Overheat cooldown - "cannot be used".
                if (!this._overheat.isLocked) {
                    const world = this._game.screenToWorld(input.holdPosition);
                    const bare = this._iceLevel.bareObjectAt(world.x, world.y);
                    if (bare) {
                        scorching = true;
                        this._scorchTimer += dt;
                        if (this._scorchTimer >= SCORCH_SECONDS) {
                            this._scorchTimer = 0;
                            this._damageObject(bare, 'scorch', world);
                        }
                    }
                    const melted = this._iceLevel.tryMelt(world.x, world.y, dt, input.holdDuration);
                    if (melted) this._combo.registerDamage();
                    if (melted && this._tutorialActive && this._tutorialSteps[this._tutorialStepIndex].requires === 'melt') {
                        this._advanceTutorial();
                    }
                }
            } else if (this._tool === 'scraper' && input.isHolding) {
                const world = this._game.screenToWorld(input.holdPosition);
                const speed = this._trackScrapeSpeed(input.holdPosition);
                const scraped = this._iceLevel.tryScrape(world.x, world.y, dt, speed);
                if (scraped) {
                    this._combo.registerDamage();
                    if (this._tutorialActive && this._tutorialSteps[this._tutorialStepIndex].requires === 'scrape') {
                        this._advanceTutorial();
                    }
                }
            }

            if (this._tool !== 'scraper' || !input.isHolding) {
                this._scrapePrevPos = null;
            }

            // Heat on bare object cools off quickly once the Hairdryer moves back onto ice.
            if (!scorching) this._scorchTimer = Math.max(0, this._scorchTimer - dt * 2);
            const warn = (this._scorchTimer / SCORCH_SECONDS - SCORCH_WARN_FROM) / (1 - SCORCH_WARN_FROM);
            this._iceLevel.setScorchWarning(warn);
            if (scorching && warn > 0) this._game.audio.playSizzle();

            this._combo.update(dt);
            this._iceLevel.setTilt(this._game.tilt.x, this._game.tilt.y);
            this._iceLevel.update(dt);
            for (const world of this._iceLevel.takeBonusEvents()) {
                this._bonusCoins += BONUS_CELL_COINS;
                this._game.audio.playPurchase();
                this._spawnFloat(`+${BONUS_CELL_COINS}`, world.x + this._game.width / 2, this._game.height / 2 - world.y, 'bonus');
            }
            this._updateProgressUi();
            this._updateHintUi();
            this._updateTimerUi();

            if (this._comboLabelVisibleFor > 0) {
                this._comboLabelVisibleFor -= dt;
                if (this._comboLabelVisibleFor <= 0) this._comboLabelEl.classList.remove('show');
            }

            this._updateHintNudge(dt);

            if (this._state === 'breaking') {
                // the last crack landed this frame - _beginBreak() has taken over
            } else if (this._iceLevel.isCleared) {
                if (this._tutorialActive) {
                    // Can't finish the level until every tip has been read. If a required
                    // step's action (chip/melt) can no longer happen because the ice is
                    // already gone (e.g. it was all melted, or a hint cleared the rest),
                    // skip that step instead of soft-locking - the read-only tips still
                    // have to be tapped through either way.
                    if (this._tutorialSteps[this._tutorialStepIndex].requires) this._advanceTutorial();
                } else {
                    this._beginReveal();
                }
            }
        } else if (this._state === 'breaking' || this._state === 'lost') {
            this._iceLevel.update(dt);
            this._breakElapsed += dt;
            if (this._state === 'breaking' && this._breakElapsed >= BREAK_ANIM_SECONDS) this._showLost();
        } else if (this._state === 'revealing') {
            this._iceLevel.setTilt(this._game.tilt.x, this._game.tilt.y);
            this._iceLevel.update(dt);
            this._revealElapsed += dt;
            if (this._revealElapsed >= REVEAL_HOLD_SECONDS) {
                this._beginLevelClear();
            }
        } else if (this._state === 'clearing' || this._state === 'cleared') {
            this._iceLevel.setTilt(this._game.tilt.x, this._game.tilt.y);
            this._iceLevel.update(dt);
            this._updateLevelClear(dt);
        }
    }

    /** Computes swipe speed (px/s) from consecutive hold-position samples for the Ice
     *  Scraper - InputHandler only exposes tap/hold, not velocity, so it's tracked here. */
    _trackScrapeSpeed(holdPosition) {
        const now = performance.now();
        let speed = 0;
        if (this._scrapePrevPos) {
            const dtMs = now - this._scrapePrevTime;
            if (dtMs > 0) {
                const dx = holdPosition.x - this._scrapePrevPos.x;
                const dy = holdPosition.y - this._scrapePrevPos.y;
                speed = Math.hypot(dx, dy) / (dtMs / 1000);
            }
        }
        this._scrapePrevPos = { x: holdPosition.x, y: holdPosition.y };
        this._scrapePrevTime = now;
        return speed;
    }

    /** Reflects the HairdryerOverheat state machine onto the hairdryer button: a filling
     *  ring while heating, a red pulsing glow during Overheat, a draining ring during the
     *  forced cooldown lockout (see .tool-btn.heating/.overheating/.locked in style.css).
     *  Also fires one-shot sound/shake on state transitions. */
    _updateOverheatUi(events) {
        const btn = this._toolButtons.hairdryer;
        btn.classList.toggle('heating', this._overheat.state === OverheatState.HEATING);
        btn.classList.toggle('overheating', this._overheat.isOverheating);
        btn.classList.toggle('locked', this._overheat.isLocked);
        const heatCss = this._overheat.isLocked ? this._overheat.cooldownFraction : this._overheat.heatFraction;
        btn.style.setProperty('--heat', heatCss);

        if (events.enteredOverheat) {
            this._game.audio.playOverheat();
            this._game.shake(6, 0.15);
        }
        if (events.enteredCooldown) {
            this._game.audio.playCooldownStart();
        }
    }

    _updateProgressUi() {
        const progress = this._iceLevel.progress;
        // Only ever shows 100% once every pixel of ice is actually gone - round() would
        // otherwise display "100%" while a sliver of ice (>=99.5%) still remains.
        const pct = progress >= 1 ? 100 : Math.min(99, Math.floor(progress * 100));
        this._progressFill.style.width = `${pct}%`;
        this._progressLabel.textContent = `${pct}%`;
    }

    _updateTimerUi() {
        this._timerEl.textContent = `${this._levelTimer.toFixed(1)}s`;
        const tier = this._levelTimer <= STAR3_CUTOFF ? 3 : this._levelTimer <= STAR2_CUTOFF ? 2 : 1;
        this._timerEl.className = `timer-pill tier-${tier}`;
    }

    /** Short-lived label that drifts up and fades at a screen point - bonus pickups, penalties. */
    _spawnFloat(text, x, y, kind) {
        const el = document.createElement('div');
        el.className = `gameplay-float ${kind}`;
        el.textContent = text;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.addEventListener('animationend', () => el.remove());
        this._floatsEl.appendChild(el);
    }

    _showCombo(count) {
        this._comboLabelEl.textContent = `${count}x!`;
        this._comboLabelEl.classList.add('show');
        this._comboLabelVisibleFor = 0.55;
    }

    _updateHintUi() {
        const hearts = this._game.save.hearts;
        this._hintCountEl.textContent = String(hearts);
        this._hintBtn.classList.toggle('empty', hearts <= 0);
    }

    _useHint() {
        if (this._state !== 'playing') return;
        if (this._game.save.hearts <= 0) return;
        if (!this._iceLevel.useHint()) return;
        this._game.save.spendHeart();
        this._updateHintUi();
        this._hideHintNudge();
    }

    /** Points at the hint button once per level if the player hasn't chipped/melted/scraped
     *  any ice in a while - most likely stuck on a stubborn patch and worth the reminder. */
    _updateHintNudge(dt) {
        const progress = this._iceLevel.progress;
        if (progress > this._lastProgress + 0.001) {
            this._lastProgress = progress;
            this._stuckTimer = 0;
            this._hideHintNudge();
        } else {
            this._stuckTimer += dt;
        }

        if (!this._hintNudgeShown && !this._tutorialActive
            && this._stuckTimer >= HINT_NUDGE_STUCK_SECONDS && this._game.save.hearts > 0) {
            this._hintNudgeShown = true;
            this._hintNudgeEl.classList.remove('hidden');
            this._hintNudgeVisibleFor = HINT_NUDGE_VISIBLE_SECONDS;
        }

        if (this._hintNudgeVisibleFor > 0) {
            this._hintNudgeVisibleFor -= dt;
            if (this._hintNudgeVisibleFor <= 0) this._hintNudgeEl.classList.add('hidden');
        }
    }

    _hideHintNudge() {
        this._hintNudgeVisibleFor = 0;
        this._hintNudgeEl.classList.add('hidden');
    }

    /** Renders the current TUTORIAL_STEPS entry. Steps with no `requires` are informational -
     *  the hand icon hides and a "tap to continue" hint is appended since they advance on tap
     *  (see the click handler in the constructor) rather than on a real chip/melt. */
    _showTutorialStep() {
        const step = this._tutorialSteps[this._tutorialStepIndex];
        this._tutorialTextEl.textContent = step.requires ? step.text : `${step.text}\n(tap to continue)`;
        this._tutorialEl.classList.toggle('step-hold', step.requires === 'melt' || step.requires === 'scrape');
        this._tutorialEl.classList.toggle('advanceable', !step.requires);
        this._updateTutorialHand();
    }

    _advanceTutorial() {
        const done = this._tutorialSteps[this._tutorialStepIndex];
        const seenKey = done.tool || done.introKey;
        if (seenKey) this._game.save.setToolIntroSeen(seenKey);
        this._tutorialStepIndex += 1;
        if (this._tutorialStepIndex >= this._tutorialSteps.length) {
            this._tutorialActive = false;
            this._tutorialEl.classList.add('hidden');
            this._updateTutorialHand();
            if (this._tutorialSteps === TUTORIAL_STEPS) this._game.save.setTutorialSeen(true);
            return;
        }
        this._showTutorialStep();
    }

    _updateHealthUi(justBroke = false) {
        this._gemEls.forEach((el, i) => {
            el.classList.toggle('broken', i >= MAX_CRACKS - this._cracks);
            el.classList.remove('just-broken');
            if (justBroke && i === MAX_CRACKS - this._cracks) {
                void el.getBoundingClientRect(); // restart the animation
                el.classList.add('just-broken');
            }
        });
    }

    /** The bare object got hit (`kind` 'crack' from the Pickaxe, 'scorch' from the Hairdryer)
     *  at photo point `uv`; `world` places the floating label. On safe levels, and during a
     *  tutorial, it's only a warning. */
    _damageObject(uv, kind, world) {
        if (this._crackGrace > 0) return;
        this._crackGrace = CRACK_GRACE_SECONDS;
        const x = world.x + this._game.width / 2;
        const y = this._game.height / 2 - world.y;

        // A Pickaxe miss right beside ice only scuffs - it takes SCUFFS_PER_CRACK of them to
        // crack. (The Hairdryer's slower scorch near ice already covers it - see update().)
        if (kind === 'crack' && uv.nearIce && ++this._scuffs < SCUFFS_PER_CRACK) {
            this._iceLevel.addCrack(uv, 'crack', { size: SCUFF_SIZE });
            this._game.audio.playWhiff();
            this._game.shake(5, 0.12);
            this._spawnFloat('Careful!', x, y, 'penalty');
            return;
        }
        if (kind === 'crack' && uv.nearIce) this._scuffs = 0;

        this._iceLevel.addCrack(uv, kind);
        this._game.audio.playCrack(kind);
        this._game.shake(10, 0.22);
        if (this._safe || this._tutorialActive) {
            this._spawnFloat('Careful!', x, y, 'penalty');
            return;
        }
        this._cracks += 1;
        this._updateHealthUi(true);
        const left = MAX_CRACKS - this._cracks;
        const label = kind === 'scorch' ? 'Scorched!' : 'Crack!';
        this._spawnFloat(left > 0 ? `${label} ${left} left` : label, x, y, 'penalty');
        if (left <= 0) this._beginBreak();
    }

    _setHudHidden(hidden) {
        for (const el of [this._topbarEl, this._toolBarEl, this._backBtn, this._ruleEl, this._healthEl, this._comboMeterEl]) {
            el.classList.toggle('reveal-hide', hidden);
        }
    }

    _beginBreak() {
        this._state = 'breaking';
        this._breakElapsed = 0;
        this._setHudHidden(true);
        this._comboLabelEl.classList.remove('show');
        this._hideHintNudge();
        this._iceLevel.setScorchWarning(0);
        this._iceLevel.shatter();
        this._game.audio.playShatter();
        this._game.shake(18, 0.5);
    }

    _showLost() {
        this._state = 'lost';
        this._llName.textContent = `Your ${this._levelDef.name} cracked into pieces.`;
        this._llMsg.textContent = '';
        this._llBtnMap.textContent = this._levelDef.isDaily ? 'Menu' : 'Map';
        this._llBtnContinue.disabled = false;
        // One continue per attempt, and only when an ad is actually ready to show.
        this._llBtnContinue.style.display = !this._continued && this._game.ads.rewardedReady ? '' : 'none';
        this._lostOverlay.classList.remove('hidden');
        requestAnimationFrame(() => this._llPanel.classList.add('visible'));
    }

    async _continueAfterBreak() {
        if (this._state !== 'lost' || this._continued) return;
        this._llBtnContinue.disabled = true;
        const earned = await this._game.ads.showRewarded();
        if (this._state !== 'lost') return; // left the screen while the ad was up
        this._llBtnContinue.disabled = false;
        if (!earned) {
            this._llMsg.textContent = 'No ad available right now - try again later.';
            return;
        }
        this._continued = true;
        this._cracks = MAX_CRACKS - 1;
        this._iceLevel.repair();
        this._updateHealthUi();
        this._lostOverlay.classList.add('hidden');
        this._llPanel.classList.remove('visible');
        this._setHudHidden(false);
        this._crackGrace = 1; // a moment to get your bearings before the next hit counts
        this._state = 'playing';
        this._game.audio.playHint();
        this._spawnFloat('Fixed! Keep going', this._game.width / 2, this._game.height * 0.35, 'bonus');
    }

    _beginReveal() {
        this._state = 'revealing';
        this._revealElapsed = 0;
        this._completionTime = this._levelTimer;

        this._topbarEl.classList.add('reveal-hide');
        this._toolBarEl.classList.add('reveal-hide');
        this._backBtn.classList.add('reveal-hide');
        this._ruleEl.classList.add('reveal-hide');
        this._healthEl.classList.add('reveal-hide');
        this._comboMeterEl.classList.add('reveal-hide');
        this._comboLabelEl.classList.remove('show');

        this._revealNameEl.textContent = this._levelDef.name;
        this._revealNameEl.classList.add('show');

        this._iceLevel.revealBurst();
        this._game.audio.playReveal();
    }

    _beginLevelClear() {
        this._state = 'clearing';
        this._revealNameEl.classList.remove('show');
        this._levelClearOverlay.classList.remove('hidden');

        const save = this._game.save;
        const levelDef = this._levelDef;

        // The Daily Thing feeds the streak instead of the level map; only the day's first
        // clear extends it and pays the streak bonus (completeDaily returns 0 on a replay).
        let extraCoins = this._bonusCoins;
        let streak = 0;
        if (levelDef.isDaily) {
            streak = save.completeDaily(levelDef.day, dayKey(new Date(Date.now() - 86400000)));
            if (streak > 0) extraCoins += DAILY_BASE_BONUS + DAILY_STREAK_BONUS * Math.min(streak, DAILY_STREAK_CAP);
        }
        const isNew = !levelDef.isDaily && !save.getLevelRecord(levelDef.id).cleared;
        this._lcName.textContent = streak > 0 ? `${levelDef.name} - day ${streak} of your streak!`
            : isNew ? `${levelDef.name} added to My Things!`
                : levelDef.name;

        this._speedMult = speedMultiplier(this._completionTime);
        const comboBonus = this._maxCombo >= COMBO_BONUS_THRESHOLD ? (this._maxCombo - COMBO_BONUS_THRESHOLD + 1) * 3 : 0;
        this._baseScore = BASE_COINS_PER_LEVEL + this._iceLevel.totalPieces * BONUS_PER_PIECE + comboBonus;
        this._finalScore = Math.round(this._baseScore * this._speedMult) + extraCoins;
        this._stars = this._completionTime <= STAR3_CUTOFF ? 3
            : this._completionTime <= STAR2_CUTOFF ? 2
                : this._completionTime <= STAR1_CUTOFF ? 1
                    : 0;

        this._lcTime.textContent = `Time: ${this._completionTime.toFixed(2)}s`;
        this._lcMult.textContent = `Speed Bonus: ${this._speedMult.toFixed(2)}x`;
        this._lcCombo.style.display = comboBonus > 0 ? 'block' : 'none';
        this._lcCombo.textContent = comboBonus > 0 ? `Best Combo: ${this._maxCombo}x (+${comboBonus})` : '';
        this._lcMath.textContent = `${this._baseScore} x ${this._speedMult.toFixed(2)}${extraCoins ? ` + ${extraCoins} bonus` : ''} = ${this._finalScore}`;

        // Reward is banked as soon as it's known, not on the later "continue" tap - so it's
        // never lost if the player backs out or the app closes during the reveal/score beat.
        const timeMs = Math.round(this._completionTime * 1000);
        save.addCoins(this._finalScore);
        save.recordStat(levelDef.id, 'clears', timeMs);
        if (!levelDef.isDaily) {
            save.recordLevelResult(levelDef.id, { stars: this._stars, timeMs });
            if (levelDef.index + 1 > save.unlockedIndex) save.unlockNext(levelDef.index + 1);
        }

        const completedCount = this._game.save.incrementLevelsCompleted();
        this._pendingAd = BreakManager.shouldShowAfter(completedCount);

        requestAnimationFrame(() => this._lcPanel.classList.add('visible'));
    }

    _popStars() {
        this._lcStarEls.forEach((el, i) => {
            if (i >= this._stars) return;
            setTimeout(() => el.classList.add('filled'), 150 + i * 180);
        });
    }

    _updateLevelClear(dt) {
        this._levelClearElapsed += dt;

        if (!this._coinAnimStarted && this._levelClearElapsed > 0.4) {
            this._coinAnimStarted = true;
            this._lcStats.classList.add('visible');
            this._popStars();
        }

        if (this._coinAnimStarted) {
            this._scoreCountElapsed += dt;
            const t = Math.min(this._scoreCountElapsed / SCORE_COUNT_DURATION, 1);
            const eased = easeOutCubic(t);
            const displayScore = Math.floor(eased * this._finalScore);
            const scale = 0.7 + 0.3 * easeOutBack(t);
            this._lcCoins.textContent = `+${displayScore} Snowflakes`;
            this._lcCoins.style.transform = `scale(${scale})`;
        }

        if (this._levelClearElapsed >= LEVEL_CLEAR_ANIM_DURATION && this._state === 'clearing') {
            this._state = 'cleared';
            this._setupLevelClearButtons();
            this._lcActions.style.display = 'flex';
        }

        if (this._state === 'cleared' && this._game.input.tapDetected) {
            this._finishLevel(!!this._nextLevel);
        }
    }

    /** Decides whether a "Next Level" button makes sense: the next node must exist and not
     *  be star-gated shut (see LEVELS' starGate / LevelMapScreen's gating). */
    _setupLevelClearButtons() {
        const nextDef = this._levelDef.isDaily ? null : getLevelByIndex(this._levelDef.index + 1);
        let playable = null;
        if (nextDef) {
            if (nextDef.starGate > 0) {
                let total = 0;
                for (const level of LEVELS) total += this._game.save.getLevelRecord(level.id).stars;
                if (total >= nextDef.starGate) playable = nextDef;
            } else {
                playable = nextDef;
            }
        }
        this._nextLevel = playable;
        this._lcBtnNext.style.display = playable ? '' : 'none';
        this._lcBtnMap.textContent = this._levelDef.isDaily ? 'Menu' : 'Map';
    }

    _finishLevel(goNext) {
        this._state = 'idle';
        if (this._pendingAd) {
            this._pendingAd = false;
            this._game.ads.showInterstitial();
        }
        if (goNext && this._nextLevel) {
            this._game.goTo(GameState.LOADING, { levelDef: this._nextLevel });
        } else {
            this._game.goTo(this._levelDef.isDaily ? GameState.MENU : GameState.LEVEL_MAP);
        }
    }

    onExit() {
        this._levelClearOverlay.classList.add('hidden');
        this._lostOverlay.classList.add('hidden');
    }
}
