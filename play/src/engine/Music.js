// "Snowglobe Waltz" - looping background music, synthesized live with Web Audio like the
// sound effects in AudioManager, so there's no audio file. F major, 3/4, 84 BPM, 32 bars
// (~70s) in an A A' B A'' form, then it loops.
//
// Runs on its own AudioContext so it can be suspended on its own: when the app goes to the
// background (Android otherwise keeps a WebView's audio playing) and when the player turns
// Music off in Settings, independent of the Sound Effects switch.

const VOLUME = 0.3; // kept well under the sound effects - it's a backdrop, not a feature
const FADE_IN = 2.5; // seconds

const BPM = 84;
const BEAT = 60 / BPM;
const BEATS = 32 * 3;

const CHORDS = {
    F: ['F', 'A', 'C'], Am: ['A', 'C', 'E'], Bb: ['Bb', 'D', 'F'],
    Gm: ['G', 'Bb', 'D'], C: ['C', 'E', 'G'], Dm: ['D', 'F', 'A'],
};
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pc = (n) => (SEMI[n[0]] + (n[1] === 'b' ? -1 : n[1] === '#' ? 1 : 0) + 12) % 12;
const midi = (s) => { const m = s.match(/^([A-G][b#]?)(\d)$/); return 12 * (+m[2] + 1) + pc(m[1]); };
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** Chord tones placed inside the octave starting at `lo` (a MIDI note). */
const voice = (chord, lo) => CHORDS[chord].map((n) => lo + ((pc(n) - lo) % 12 + 12) % 12).sort((a, b) => a - b);

// One chord per bar, melody as "note:beats" (r = rest).
const SONG = [
    ['F', 'C5:2 A4:1'], ['Am', 'E5:2 C5:1'], ['Bb', 'D5:1 C5:1 Bb4:1'], ['F', 'A4:3'],
    ['Gm', 'Bb4:2 D5:1'], ['C', 'C5:1 E5:1 G5:1'], ['F', 'F5:2 E5:1'], ['C', 'C5:2 r:1'],

    ['F', 'C5:2 A4:1'], ['Am', 'E5:2 C5:1'], ['Bb', 'D5:1 F5:1 D5:1'], ['Gm', 'Bb4:2 G4:1'],
    ['F', 'A4:1 C5:1 F5:1'], ['C', 'E5:1 D5:1 E5:1'], ['F', 'F5:3'], ['F', 'r:1 A5:1 G5:1'],

    ['Dm', 'F5:2 D5:1'], ['Am', 'E5:2 C5:1'], ['Bb', 'D5:1 Bb4:1 D5:1'], ['F', 'C5:3'],
    ['Gm', 'D5:2 Bb4:1'], ['Dm', 'A4:1 D5:1 F5:1'], ['Bb', 'F5:1 D5:1 Bb4:1'], ['C', 'G5:2 E5:1'],

    ['F', 'C5:2 A4:1'], ['Am', 'E5:2 C5:1'], ['Bb', 'D5:1 F5:1 D5:1'], ['Gm', 'Bb4:2 G4:1'],
    ['F', 'A4:1 C5:1 F5:1'], ['C', 'E5:1 D5:1 E5:1'], ['F', 'F5:3'], ['F', 'r:3'],
];

function buildEvents() {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const events = [];
    SONG.forEach(([chord, mel], bar) => {
        const t0 = bar * 3;
        let t = t0;
        for (const tok of mel.split(' ')) {
            const [n, d] = tok.split(':');
            if (n !== 'r') events.push({ t, inst: 'box', m: midi(n), v: 0.26 });
            t += +d;
        }
        events.push({ t: t0, inst: 'pad', ms: voice(chord, 53), d: 3 });
        const root = pc(CHORDS[chord][0]);
        events.push({ t: t0, inst: 'bass', m: 36 + root + (root < 4 ? 12 : 0), d: 2.6 });
        if (bar >= 8 && bar !== 31) { // harp joins on the second phrase
            const [a, b, c] = voice(chord, 48);
            [a, b, c, b, a + 12, b].forEach((m, i) => events.push({ t: t0 + i * 0.5, inst: 'arp', m, v: 0.1 }));
        }
        if (bar % 2 === 1 && rnd() < 0.7) { // the odd high "ice crystal" glint
            const tones = voice(chord, 84);
            events.push({ t: t0 + 1 + Math.floor(rnd() * 4) * 0.5, inst: 'glint', m: tones[Math.floor(rnd() * 3)], v: 0.06 });
        }
    });
    return events.sort((a, b) => a.t - b.t);
}

const BOX_PARTIALS = [[1, 1, 2.4], [2, 0.22, 1.0], [3.02, 0.09, 0.5], [5.4, 0.05, 0.25]];
const GLINT_PARTIALS = [[1, 1, 3.0], [2.76, 0.3, 1.2], [5.4, 0.15, 0.6]];

export class Music {
    constructor() {
        this._events = buildEvents();
        this._ctx = null;
        this._enabled = true;
        this._next = 0;
        this._loopOffset = 0;
        this._songStart = 0;
        this._gestured = false;

        // Audio may only start after a user gesture.
        window.addEventListener('pointerdown', () => { this._gestured = true; this._start(); });
        // Android: Capacitor fires pause/resume on the document; browsers fire visibilitychange.
        document.addEventListener('visibilitychange', () => this._sync());
        document.addEventListener('pause', () => this._sync(true));
        document.addEventListener('resume', () => this._sync(false));
        setInterval(() => this._tick(), 50);
    }

    setEnabled(enabled) {
        this._enabled = enabled;
        if (enabled && this._gestured) this._start();
        this._sync();
    }

    _start() {
        if (this._ctx || !this._enabled) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = (this._ctx = new Ctx());

        this._out = ctx.createGain();
        this._out.gain.setValueAtTime(0.0001, ctx.currentTime);
        this._out.gain.exponentialRampToValueAtTime(VOLUME, ctx.currentTime + FADE_IN);
        this._out.connect(ctx.destination);

        const len = ctx.sampleRate * 3.2;
        const ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = ir.getChannelData(ch);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        }
        const reverb = ctx.createConvolver();
        reverb.buffer = ir;
        const wet = ctx.createGain();
        wet.gain.value = 0.35;
        reverb.connect(wet).connect(this._out);

        this._bus = ctx.createGain(); // everything feeds both the dry output and the reverb
        this._bus.connect(this._out);
        this._bus.connect(reverb);

        this._songStart = ctx.currentTime + 0.1;
        this._sync();
    }

    /** Plays only while enabled and the app is in the foreground. */
    _sync(hidden = document.hidden) {
        if (!this._ctx) return;
        if (this._enabled && !hidden) this._ctx.resume().catch(() => {});
        else this._ctx.suspend().catch(() => {});
    }

    // Lookahead scheduler: queue every note due in the next 0.3s, wrapping at the song's end.
    // While the context is suspended its clock stands still, so nothing piles up.
    _tick() {
        const ctx = this._ctx;
        if (!ctx || ctx.state !== 'running') return;
        const horizon = ctx.currentTime + 0.3;
        for (;;) {
            const e = this._events[this._next];
            const at = this._songStart + (this._loopOffset + e.t) * BEAT;
            if (at > horizon) break;
            if (at > ctx.currentTime - 0.05) this._play(e, at);
            if (++this._next >= this._events.length) { this._next = 0; this._loopOffset += BEATS; }
        }
    }

    _play(e, t) {
        if (e.inst === 'box') this._chime(t, e.m, e.v, BOX_PARTIALS);
        else if (e.inst === 'glint') this._chime(t, e.m, e.v, GLINT_PARTIALS);
        else if (e.inst === 'pad') this._pad(t, e.ms, e.d);
        else if (e.inst === 'bass') this._bass(t, e.m, e.d);
        else if (e.inst === 'arp') this._arp(t, e.m, e.v);
    }

    _env(g, t, peak, attack, decay) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    /** Music-box tine: a sine plus a few bright, fast-fading partials. */
    _chime(t, m, v, partials) {
        for (const [ratio, amp, decay] of partials) {
            const o = this._ctx.createOscillator();
            const g = this._ctx.createGain();
            o.frequency.value = hz(m) * ratio;
            this._env(g, t, v * amp, 0.004, decay);
            o.connect(g).connect(this._bus);
            o.start(t);
            o.stop(t + decay + 0.1);
        }
    }

    /** Warm pad: detuned triangles through a lowpass, with a slow swell. */
    _pad(t, ms, d) {
        const ctx = this._ctx;
        const dur = d * BEAT;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.7);
        g.gain.setValueAtTime(0.05, t + dur - 0.1);
        g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.0);
        f.connect(g).connect(this._bus);
        for (const m of ms) {
            for (const detune of [-7, 7]) {
                const o = ctx.createOscillator();
                o.type = 'triangle';
                o.frequency.value = hz(m);
                o.detune.value = detune;
                o.connect(f);
                o.start(t);
                o.stop(t + dur + 1.1);
            }
        }
    }

    _bass(t, m, d) {
        const o = this._ctx.createOscillator();
        const g = this._ctx.createGain();
        o.frequency.value = hz(m);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d * BEAT);
        o.connect(g).connect(this._bus);
        o.start(t);
        o.stop(t + d * BEAT + 0.05);
    }

    /** Soft harp pluck. */
    _arp(t, m, v) {
        const o = this._ctx.createOscillator();
        const g = this._ctx.createGain();
        const f = this._ctx.createBiquadFilter();
        o.type = 'triangle';
        o.frequency.value = hz(m);
        f.type = 'lowpass';
        f.frequency.value = 2200;
        this._env(g, t, v, 0.006, 0.9);
        o.connect(f).connect(g).connect(this._bus);
        o.start(t);
        o.stop(t + 1.0);
    }
}
