// Manages the between-level break: the interstitial ad shown on the beat between finishing
// one level and starting the next, via @capacitor-community/admob. No bundler in this
// project (see AudioManager._vibrate's Haptics pattern), so the plugin is reached through
// window.Capacitor.Plugins.AdMob, which only exists inside the packaged Android app -
// every method here silently no-ops when previewing in a desktop/browser.
//
// NAMING - do not "fix" this back to AdManager.js. Content blockers (uBlock Origin,
// AdBlock, and the filter lists behind them) match on URL, and a path containing
// "admanager" is on those lists. This file is a STATIC ES import from Game.js, so when a
// blocker cancels the request the whole module graph fails to load, main.js never runs,
// and - because every .screen overlay in index.html starts out `hidden` - the player gets
// a silently blank page. The class name is irrelevant to blockers; only the path matters,
// so keep any advertising vocabulary out of the filename.

// SWITCHING TO REAL ADS: follow ADS-RELEASE-README.md - the IDs alone are not enough.

// Real AdMob ad unit ("Level break interstitial"). Never tap these ads on your own phone -
// register it as a test device in the AdMob console instead (ADS-RELEASE-README.md step 3).
const INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-7301973762602295/2163202209';

// Real AdMob rewarded interstitial unit - same rule, never tap it on your own phone.
const REWARDED_AD_UNIT_ID = 'ca-app-pub-7301973762602295/7862910582';

// Coins granted from the Shop's "watch an ad" offer.
export const REWARD_AD_COINS = 500;

const FIRST_AD_AFTER_LEVELS = 4; // show the first interstitial after this many level completions
const AD_EVERY_LEVELS = 2; // then one every N completions after that

export class BreakManager {
    constructor() {
        this._ready = false;
        this._loaded = false;
        this._loading = false;
        this._rewardLoaded = false;
        this._rewardLoading = false;
        this._rewardResolve = null;
        this._canRequestAds = false;
        this._privacyOptionsRequired = false;
    }

    /** True once `completedCount` level completions (see SaveManager.incrementLevelsCompleted)
     *  have reached the next scheduled ad beat: after level 4, then every 2 levels. */
    static shouldShowAfter(completedCount) {
        return completedCount >= FIRST_AD_AFTER_LEVELS && (completedCount - FIRST_AD_AFTER_LEVELS) % AD_EVERY_LEVELS === 0;
    }

    get _bridge() {
        return window.Capacitor?.Plugins?.AdMob || null;
    }

    /** Gets GDPR consent where it's needed, then initializes the Mobile Ads SDK and preloads
     *  the first ads. Call once at startup - ads must never block or break gameplay, so every
     *  failure here is swallowed. */
    async init() {
        const AdMob = this._bridge;
        if (!AdMob) return; // no native bridge - desktop/browser preview

        await this._gatherConsent();

        try {
            await AdMob.initialize();
            AdMob.addListener('interstitialAdLoaded', () => { this._loaded = true; this._loading = false; });
            AdMob.addListener('interstitialAdFailedToLoad', () => { this._loaded = false; this._loading = false; });
            // Keep a fresh ad ready at all times for the next scheduled beat.
            AdMob.addListener('interstitialAdDismissed', () => { this._loaded = false; this._preload(); });

            AdMob.addListener('onRewardedInterstitialAdLoaded', () => { this._rewardLoaded = true; this._rewardLoading = false; });
            AdMob.addListener('onRewardedInterstitialAdFailedToLoad', () => { this._rewardLoaded = false; this._rewardLoading = false; });
            // Fires while the ad is still on screen - just note it, and pay out on dismiss.
            AdMob.addListener('onRewardedInterstitialAdReward', () => { this._rewardEarned = true; });
            // Fires whether or not the reward was earned - always preload the next one here.
            AdMob.addListener('onRewardedInterstitialAdDismissed', () => {
                this._rewardLoaded = false;
                this._rewardResolve?.(!!this._rewardEarned);
                this._rewardResolve = null;
                this._preloadReward();
            });

            this._ready = true;
            this._preload();
            this._preloadReward();
        } catch (_) { /* AdMob unavailable on this device - fine, just no ads */ }
    }

    /** GDPR consent (Google's UMP SDK, set up as the GDPR message in AdMob > Privacy &
     *  messaging). In the EEA, UK and Switzerland this shows Google's consent form on first
     *  launch, before any ad is requested; everywhere else it returns straight away. If the
     *  request fails (say, offline) the previous session's answer still applies. */
    async _gatherConsent() {
        const AdMob = this._bridge;
        try {
            let info = await AdMob.requestConsentInfo();
            if (!info.canRequestAds && info.isConsentFormAvailable && info.status === 'REQUIRED') {
                info = await AdMob.showConsentForm();
            }
            this._applyConsent(info);
        } catch (_) {
            this._canRequestAds = true; // UMP unavailable - AdMob applies the stored choice itself
        }
    }

    _applyConsent(info) {
        this._canRequestAds = !!info.canRequestAds;
        this._privacyOptionsRequired = info.privacyOptionsRequirementStatus === 'REQUIRED';
    }

    /** Whether Settings should offer the "Privacy Options" button (players under GDPR). */
    get privacyOptionsRequired() { return this._privacyOptionsRequired; }

    /** Re-opens Google's consent form so the player can change their choice (Settings). */
    async showPrivacyOptions() {
        const AdMob = this._bridge;
        if (!AdMob) return;
        try {
            await AdMob.showPrivacyOptionsForm();
            this._applyConsent(await AdMob.requestConsentInfo());
            this._preload();
            this._preloadReward();
        } catch (_) { /* form unavailable right now - nothing to change */ }
    }

    _preload() {
        const AdMob = this._bridge;
        if (!AdMob || !this._ready || !this._canRequestAds || this._loading || this._loaded) return;
        this._loading = true;
        AdMob.prepareInterstitial({ adId: INTERSTITIAL_AD_UNIT_ID }).catch(() => { this._loading = false; });
    }

    _preloadReward() {
        const AdMob = this._bridge;
        if (!AdMob || !this._ready || !this._canRequestAds || this._rewardLoading || this._rewardLoaded) return;
        this._rewardLoading = true;
        AdMob.prepareRewardInterstitialAd({ adId: REWARDED_AD_UNIT_ID }).catch(() => { this._rewardLoading = false; });
    }

    /** Shows the preloaded interstitial if one's ready; otherwise does nothing rather than
     *  block level flow waiting on a network load. Preloads the next one once dismissed. */
    showInterstitial() {
        const AdMob = this._bridge;
        if (!AdMob || !this._loaded) return;
        this._loaded = false;
        AdMob.showInterstitial().catch(() => this._preload());
    }

    get rewardedReady() { return this._rewardLoaded; }

    /** Shows the preloaded rewarded interstitial if one's ready. Resolves when the ad is closed:
     *  true if the reward was earned, false if it's not ready yet or was skipped early. Always
     *  preloads the next one once this ad closes, same as showInterstitial(). */
    showRewarded() {
        const AdMob = this._bridge;
        if (!AdMob || !this._rewardLoaded) return Promise.resolve(false);
        this._rewardLoaded = false;
        this._rewardEarned = false;
        return new Promise((resolve) => {
            this._rewardResolve = resolve;
            AdMob.showRewardInterstitialAd().catch(() => {
                this._rewardResolve = null;
                resolve(false);
                this._preloadReward();
            });
        });
    }
}
