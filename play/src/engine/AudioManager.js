// Procedural sound effects (no baked audio files needed) + haptic feedback.
// Ported from Scrape & Salvage's Core/FeedbackManager.cs, adapted to Web Audio.

export class AudioManager {
    constructor() {
        this._ctx = null;
        this._popBuffer = null;
        this._lastPopTime = 0;
        this._lastMeltTickTime = 0;
        this._lastScrapeTime = 0;
        this._lastSizzleTime = 0;
        this._unlocked = false;
        this._muted = false;
        this._hapticsEnabled = true;

        const unlock = () => {
            this._ensureContext();
            window.removeEventListener('pointerdown', unlock);
        };
        window.addEventListener('pointerdown', unlock, { once: true });
    }

    _ensureContext() {
        if (this._ctx) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this._ctx = new Ctx();
        this._popBuffer = this._generatePopBuffer();
    }

    /** Short pop with fast attack + exponential decay: low thump + high click + a hint of noise. */
    _generatePopBuffer() {
        const sampleRate = this._ctx.sampleRate;
        const durationMs = 45;
        const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
        const buffer = this._ctx.createBuffer(1, sampleCount, sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < sampleCount; i++) {
            const t = i / sampleCount;
            const envelope = Math.exp(-t * 12.0);
            const freq1 = 180;
            const freq2 = 900;
            const durSec = durationMs / 1000;
            let sample =
                Math.sin(2 * Math.PI * freq1 * t * durSec * (1000 / durationMs)) * 0.6 +
                Math.sin(2 * Math.PI * freq2 * t * durSec * (1000 / durationMs)) * 0.3 +
                (Math.random() * 2 - 1) * 0.1;
            sample *= envelope;
            data[i] = sample;
        }
        return buffer;
    }

    setMuted(muted) {
        this._muted = muted;
    }

    setHapticsEnabled(enabled) {
        this._hapticsEnabled = enabled;
    }

    /** Discrete pop feedback when a chip breaks off. Pitch/gain climb with `streak` (consecutive
     *  quick chips), so a fast run of taps escalates audibly instead of sounding identical. */
    playChip(streak = 1) {
        if (this._muted) return;
        const now = performance.now();
        if (now - this._lastPopTime < 30) return;
        this._lastPopTime = now;

        const bonus = Math.min(streak - 1, 6);
        const rate = 0.9 + Math.random() * 0.3 + bonus * 0.06;
        this._playBuffer(this._popBuffer, 0.35 + bonus * 0.015, rate);
        this._vibrate(streak >= 3 ? 20 : 15);
    }

    /** Soft, low, occasional tick while melting - gives the hold gesture some life. */
    /** Daily Spin: a light click as each slice passes the pointer. */
    playWheelTick() {
        if (this._muted) return;
        this._ensureContext();
        this._playBuffer(this._popBuffer, 0.12, 1.7);
        this._vibrate(4);
    }

    playMeltTick() {
        if (this._muted) return;
        const now = performance.now();
        if (now - this._lastMeltTickTime < 140) return;
        this._lastMeltTickTime = now;

        this._playBuffer(this._popBuffer, 0.08, 0.4 + Math.random() * 0.2);
        this._vibrate(6);
    }

    /** A soft, dull, pitch-dropped non-event - lets a tap on already-bare ice read as a miss. */
    playWhiff() {
        if (this._muted) return;
        this._playBuffer(this._popBuffer, 0.12, 0.35);
    }

    /** Quick, high, scratchy tick for the Ice Scraper's continuous swipe damage. */
    playScrape() {
        if (this._muted) return;
        const now = performance.now();
        if (now - this._lastScrapeTime < 70) return;
        this._lastScrapeTime = now;
        this._playBuffer(this._popBuffer, 0.14, 1.6 + Math.random() * 0.3);
    }

    /** Rising three-note "whoosh" when the hairdryer flips into Overheat Mode. */
    playOverheat() {
        if (this._muted) return;
        this._ensureContext();
        if (!this._ctx || !this._popBuffer) return;

        [1.5, 1.9, 2.3].forEach((rate, i) => {
            const src = this._ctx.createBufferSource();
            src.buffer = this._popBuffer;
            src.playbackRate.value = rate;
            const gain = this._ctx.createGain();
            gain.gain.value = 0.45;
            src.connect(gain).connect(this._ctx.destination);
            src.start(this._ctx.currentTime + i * 0.06);
        });
        this._vibrate([15, 20, 15]);
    }

    /** Dulled, pitch-dropped thud marking the start of the forced Overheat cooldown lockout. */
    playCooldownStart() {
        if (this._muted) return;
        this._playBuffer(this._popBuffer, 0.22, 0.45);
        this._vibrate(25);
    }

    /** Small ascending three-note chime played once the object is fully revealed. */
    playReveal() {
        if (this._muted) return;
        this._ensureContext();
        if (!this._ctx || !this._popBuffer) return;

        const rates = [1.0, 1.35, 1.8];
        rates.forEach((rate, i) => {
            const src = this._ctx.createBufferSource();
            src.buffer = this._popBuffer;
            src.playbackRate.value = rate;
            const gain = this._ctx.createGain();
            gain.gain.value = 0.5;
            src.connect(gain).connect(this._ctx.destination);
            src.start(this._ctx.currentTime + i * 0.09);
        });
        this._vibrate([20, 30, 20, 30, 40]);
    }

    /** Bright double chime for a Shop purchase. */
    playPurchase() {
        if (this._muted) return;
        this._playBuffer(this._popBuffer, 0.3, 1.5);
        this._vibrate(12);
    }

    /** Warm two-note chime for spending a hint charge. */
    playHint() {
        if (this._muted) return;
        this._ensureContext();
        if (!this._ctx || !this._popBuffer) return;
        [0.75, 1.2].forEach((rate, i) => {
            const src = this._ctx.createBufferSource();
            src.buffer = this._popBuffer;
            src.playbackRate.value = rate;
            const gain = this._ctx.createGain();
            gain.gain.value = 0.45;
            src.connect(gain).connect(this._ctx.destination);
            src.start(this._ctx.currentTime + i * 0.07);
        });
        this._vibrate(18);
    }

    /** The bare object got hit: a sharp glassy snap over a low thud. A Hairdryer scorch
     *  (`kind` 'scorch') is a duller pop with a hiss of high crackle instead. */
    playCrack(kind = 'crack') {
        if (this._muted) return;
        if (kind === 'scorch') {
            this._playBuffer(this._popBuffer, 0.55, 0.4);
            for (let i = 0; i < 4; i++) this._playBuffer(this._popBuffer, 0.12, 3 + Math.random(), 0.03 + i * 0.04);
        } else {
            this._playBuffer(this._popBuffer, 0.6, 2.8);
            this._playBuffer(this._popBuffer, 0.35, 3.6, 0.025);
            this._playBuffer(this._popBuffer, 0.55, 0.45);
        }
        this._vibrate(60);
    }

    /** The object breaks: a heavy thud, then a cascade of falling glassy tinkles. */
    playShatter() {
        if (this._muted) return;
        this._playBuffer(this._popBuffer, 0.8, 0.35);
        this._playBuffer(this._popBuffer, 0.6, 2.4);
        for (let i = 0; i < 12; i++) {
            this._playBuffer(this._popBuffer, 0.4 * (1 - i / 14), 1.8 + Math.random() * 1.8, 0.05 + i * 0.045 + Math.random() * 0.02);
        }
        this._vibrate(180);
    }

    /** Quiet crackle while the Hairdryer is about to scorch bare object - a warning. */
    playSizzle() {
        if (this._muted) return;
        const now = performance.now();
        if (now - this._lastSizzleTime < 90) return;
        this._lastSizzleTime = now;
        this._playBuffer(this._popBuffer, 0.1, 3 + Math.random() * 1.2);
    }

    _playBuffer(buffer, gainValue, playbackRate, delay = 0) {
        this._ensureContext();
        if (!this._ctx || !buffer) return;
        const src = this._ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = playbackRate;
        const gain = this._ctx.createGain();
        gain.gain.value = gainValue;
        src.connect(gain).connect(this._ctx.destination);
        src.start(this._ctx.currentTime + delay);
    }

    /** @param {number|number[]} ms - a single duration, or an on/off pattern (array form uses navigator.vibrate only). */
    _vibrate(ms) {
        if (!this._hapticsEnabled) return;
        if (!Array.isArray(ms) && window.Capacitor?.Plugins?.Haptics) {
            try {
                window.Capacitor.Plugins.Haptics.vibrate({ duration: ms });
                return;
            } catch (_) { /* fall through to navigator.vibrate */ }
        }
        if (navigator.vibrate) {
            navigator.vibrate(ms);
        }
    }
}
