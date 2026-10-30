const STORAGE_KEY = 'defrostit.save.v1';
const MAX_HEARTS = 5;
const HEART_REGEN_MS = 5 * 60 * 1000; // one hint charge regenerates every 5 real minutes

// Coin cost to advance a tool upgrade from level N to N+1 (index = current level, 0-based).
// Both upgrades share a max level and cost curve for now - see Shop screen.
const UPGRADE_MAX_LEVEL = 5;
const UPGRADE_COSTS = [40, 70, 110, 160, 220];
const BUY_HEART_COST = 30;

const DEFAULT_SAVE = {
    coins: 0,
    hearts: MAX_HEARTS,
    heartsUpdatedAt: Date.now(),
    unlockedIndex: 0,
    levels: {}, // levelId -> { cleared, stars, bestTimeMs }
    upgrades: { meltRadius: 0, meltRate: 0, scrapeRadius: 0, scrapeRate: 0 }, // Shop-purchased tool upgrade levels, 0..UPGRADE_MAX_LEVEL
    tutorialSeen: false,
    shopTutorialSeen: false,
    mapShopHintSeen: false,
    toolIntrosSeen: {}, // tool name -> true once its "new tool" callout has been shown in a level
    levelsCompletedCount: 0, // total level completions (replays included) - drives interstitial ad cadence
    daily: { last: null, streak: 0, best: 0 }, // `last` = dayKey() of the most recent Daily Thing cleared
    stats: {}, // levelId -> { plays, clears, quits, totalMs } - local play stats (How to Play > Stats)
    wheel: { last: null, adLast: null }, // dayKey() of the last free / ad-rewarded Daily Spin
    ownedSkins: ['classic'], // ice skins bought in the Shop (data/skins.js)
    equippedSkin: 'classic',
    musicEnabled: true,
    soundEnabled: true,
    hapticsEnabled: true,
};

export class SaveManager {
    constructor() {
        this._data = this._load();
    }

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return structuredClone(DEFAULT_SAVE);
            const parsed = JSON.parse(raw);
            return { ...structuredClone(DEFAULT_SAVE), ...parsed };
        } catch (_) {
            return structuredClone(DEFAULT_SAVE);
        }
    }

    _persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
        } catch (_) { /* storage unavailable - continue in-memory only */ }
    }

    get coins() { return this._data.coins; }

    addCoins(amount) {
        this._data.coins = Math.max(0, this._data.coins + amount);
        this._persist();
        return this._data.coins;
    }

    /** Lazily regenerates hint charges based on elapsed real time since the last change. */
    _regenHearts() {
        if (this._data.hearts >= MAX_HEARTS) return;
        const now = Date.now();
        const elapsed = now - (this._data.heartsUpdatedAt || now);
        const gained = Math.floor(elapsed / HEART_REGEN_MS);
        if (gained <= 0) return;
        this._data.hearts = Math.min(MAX_HEARTS, this._data.hearts + gained);
        this._data.heartsUpdatedAt = this._data.hearts >= MAX_HEARTS ? now : this._data.heartsUpdatedAt + gained * HEART_REGEN_MS;
        this._persist();
    }

    /** Hint charges: shown as "hearts" on the map, spent in-level for a free auto-chip. */
    get hearts() { this._regenHearts(); return this._data.hearts; }
    get maxHearts() { return MAX_HEARTS; }

    /** Milliseconds until the next hint charge regenerates, or 0 if already full. */
    get msUntilNextHeart() {
        this._regenHearts();
        if (this._data.hearts >= MAX_HEARTS) return 0;
        return Math.max(0, HEART_REGEN_MS - (Date.now() - (this._data.heartsUpdatedAt || Date.now())));
    }

    /** Spends one hint charge (e.g. to auto-chip a stuck cell). Returns false if none available. */
    spendHeart() {
        this._regenHearts();
        if (this._data.hearts <= 0) return false;
        const wasFull = this._data.hearts >= MAX_HEARTS;
        this._data.hearts -= 1;
        if (wasFull) this._data.heartsUpdatedAt = Date.now();
        this._persist();
        return true;
    }

    /** Instantly buys one hint charge with coins, bypassing the regen wait. */
    get buyHeartCost() { return BUY_HEART_COST; }

    buyHeart() {
        this._regenHearts();
        if (this._data.hearts >= MAX_HEARTS) return false;
        if (this._data.coins < BUY_HEART_COST) return false;
        this._data.coins -= BUY_HEART_COST;
        this._data.hearts += 1;
        if (this._data.hearts >= MAX_HEARTS) this._data.heartsUpdatedAt = Date.now();
        this._persist();
        return true;
    }

    get unlockedIndex() { return this._data.unlockedIndex; }

    unlockNext(index) {
        if (index > this._data.unlockedIndex) {
            this._data.unlockedIndex = index;
            this._persist();
        }
    }

    getLevelRecord(levelId) {
        return this._data.levels[levelId] || { cleared: false, stars: 0, bestTimeMs: null };
    }

    recordLevelResult(levelId, { stars, timeMs }) {
        const existing = this.getLevelRecord(levelId);
        this._data.levels[levelId] = {
            cleared: true,
            stars: Math.max(existing.stars, stars),
            bestTimeMs: existing.bestTimeMs ? Math.min(existing.bestTimeMs, timeMs) : timeMs,
        };
        this._persist();
    }

    /** Current level (0..UPGRADE_MAX_LEVEL) of a Shop-purchased hairdryer upgrade. */
    getUpgradeLevel(key) {
        return this._data.upgrades[key] || 0;
    }

    get upgradeMaxLevel() { return UPGRADE_MAX_LEVEL; }

    /** Coin cost to advance one level, or null if already maxed. */
    getUpgradeCost(key) {
        const level = this.getUpgradeLevel(key);
        if (level >= UPGRADE_MAX_LEVEL) return null;
        return UPGRADE_COSTS[level];
    }

    purchaseUpgrade(key) {
        const cost = this.getUpgradeCost(key);
        if (cost === null || this._data.coins < cost) return false;
        this._data.coins -= cost;
        this._data.upgrades[key] = this.getUpgradeLevel(key) + 1;
        this._persist();
        return true;
    }

    /** Current Daily Thing streak as of `today` - 0 once a day has been missed. */
    dailyStreak(today, yesterday) {
        const { last, streak } = this._data.daily;
        return last === today || last === yesterday ? streak : 0;
    }

    get dailyBestStreak() { return this._data.daily.best; }

    isDailyDone(today) { return this._data.daily.last === today; }

    /** Marks today's Daily Thing cleared. Returns the new streak, or 0 if it was already
     *  cleared today (replays don't extend the streak or pay the bonus again). */
    completeDaily(today, yesterday) {
        const daily = this._data.daily;
        if (daily.last === today) return 0;
        daily.streak = daily.last === yesterday ? daily.streak + 1 : 1;
        daily.best = Math.max(daily.best, daily.streak);
        daily.last = today;
        this._persist();
        return daily.streak;
    }

    /** Local play stats: `event` is 'plays', 'clears' or 'quits'; `ms` adds to the clear-time total. */
    recordStat(levelId, event, ms = 0) {
        const s = this._data.stats[levelId] || (this._data.stats[levelId] = { plays: 0, clears: 0, quits: 0, totalMs: 0 });
        s[event] += 1;
        s.totalMs += ms;
        this._persist();
    }

    getStat(levelId) {
        return this._data.stats[levelId] || { plays: 0, clears: 0, quits: 0, totalMs: 0 };
    }

    get levelsCompletedCount() { return this._data.levelsCompletedCount; }

    /** Bumps the running tally of level completions and returns the new count. */
    incrementLevelsCompleted() {
        this._data.levelsCompletedCount += 1;
        this._persist();
        return this._data.levelsCompletedCount;
    }

    get tutorialSeen() { return this._data.tutorialSeen; }

    setTutorialSeen(seen = true) {
        this._data.tutorialSeen = seen;
        this._persist();
    }

    get shopTutorialSeen() { return this._data.shopTutorialSeen; }

    setShopTutorialSeen(seen = true) {
        this._data.shopTutorialSeen = seen;
        this._persist();
    }

    get mapShopHintSeen() { return this._data.mapShopHintSeen; }

    setMapShopHintSeen(seen = true) {
        this._data.mapShopHintSeen = seen;
        this._persist();
    }

    isToolIntroSeen(tool) { return !!this._data.toolIntrosSeen[tool]; }

    setToolIntroSeen(tool) {
        this._data.toolIntrosSeen[tool] = true;
        this._persist();
    }

    /** Adds hint charges (Daily Spin prize). May go over the regen cap - they're a bonus. */
    addHearts(n) {
        this._regenHearts();
        this._data.hearts += n;
        this._persist();
    }

    canSpinWheel(today) { return this._data.wheel.last !== today; }

    useWheelSpin(today) {
        this._data.wheel.last = today;
        this._persist();
    }

    canAdSpinWheel(today) { return this._data.wheel.adLast !== today; }

    useWheelAdSpin(today) {
        this._data.wheel.adLast = today;
        this._persist();
    }

    ownsSkin(id) { return this._data.ownedSkins.includes(id); }

    get equippedSkin() { return this._data.equippedSkin; }

    /** Buys a skin and equips it. Returns false if already owned or not enough coins. */
    buySkin(id, price) {
        if (this.ownsSkin(id) || this._data.coins < price) return false;
        this._data.coins -= price;
        this._data.ownedSkins.push(id);
        this._data.equippedSkin = id;
        this._persist();
        return true;
    }

    equipSkin(id) {
        if (!this.ownsSkin(id)) return;
        this._data.equippedSkin = id;
        this._persist();
    }

    get musicEnabled() { return this._data.musicEnabled; }

    setMusicEnabled(enabled) {
        this._data.musicEnabled = enabled;
        this._persist();
    }

    get soundEnabled() { return this._data.soundEnabled; }

    setSoundEnabled(enabled) {
        this._data.soundEnabled = enabled;
        this._persist();
    }

    get hapticsEnabled() { return this._data.hapticsEnabled; }

    setHapticsEnabled(enabled) {
        this._data.hapticsEnabled = enabled;
        this._persist();
    }

    /** Wipes coins/hearts/level progress but keeps music/sound/haptics preferences. */
    resetProgress() {
        const { musicEnabled, soundEnabled, hapticsEnabled } = this._data;
        this._data = { ...structuredClone(DEFAULT_SAVE), musicEnabled, soundEnabled, hapticsEnabled };
        this._persist();
    }
}
