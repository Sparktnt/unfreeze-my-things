// Reads the phone's orientation and hands the ice shader a smoothed, normalized -1..1 tilt
// per axis, so the ice slab visibly slides over the object as the player turns the device
// (see computeIceView in rendering/IceMaterial.js).
//
// Tilt is reported RELATIVE to a neutral baseline captured from the first reading rather
// than to flat-on-a-table, because nobody holds a phone at 0 degrees - a fixed reference
// would leave the effect pegged to one side for the whole session. The baseline also
// creeps toward the current pose over time, so shifting how you're sitting re-centres
// itself instead of permanently biasing the picture.
//
// Without a sensor (desktop), the mouse stands in for the player's head: pointing at the
// right of the window looks at the ice from the right. Idle, it falls back to a slow sway.

const TILT_RANGE_DEG = 22; // deviation from neutral that maps to full -1..1
const SMOOTHING = 7; // higher = snappier response to the raw sensor
const BASELINE_DRIFT = 0.06; // per second, how fast "neutral" follows a new resting pose
const IDLE_SWAY_AMPLITUDE = 0.22; // fallback motion when there's no orientation sensor at all
const IDLE_SWAY_SPEED = 0.55;
const SENSOR_TIMEOUT = 1.5; // seconds without an event before we fall back to the idle sway
const MOUSE_LOOK_GAIN = 0.7; // tilt with the mouse at the window's edge
const MOUSE_TIMEOUT = 4; // seconds of mouse stillness before the idle sway resumes

export class DeviceTilt {
    constructor() {
        this.x = 0; // + = right edge of the phone tipped away from the player
        this.y = 0; // + = top edge tipped toward the player (DeviceOrientation beta increasing)

        this._targetX = 0;
        this._targetY = 0;
        this._baseBeta = null;
        this._baseGamma = null;
        this._lastEventAge = Infinity;
        this._idleTime = 0;
        this._mouseX = 0;
        this._mouseY = 0;
        this._mouseAge = Infinity;
        this._started = false;

        this._onOrientation = this._onOrientation.bind(this);
        this._onFirstGesture = this._onFirstGesture.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
    }

    /** Begins listening. On iOS 13+ the sensor needs an explicit grant that only a user
     *  gesture can ask for, so there we wait for the first tap. Listener goes on window,
     *  not the canvas - the DOM UI overlays would otherwise swallow it. */
    start() {
        if (this._started) return;
        this._started = true;

        const needsPermission = typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function';

        if (needsPermission) {
            window.addEventListener('pointerdown', this._onFirstGesture, { once: true, passive: true });
        } else {
            this._listen();
        }
        window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    }

    _onPointerMove(evt) {
        if (evt.pointerType !== 'mouse') return;
        const clampUnit = (v) => Math.max(-1, Math.min(1, v));
        // Mouse to the right = eye to the right = the phone's right edge turned toward you.
        this._mouseX = clampUnit(-((evt.clientX / window.innerWidth) * 2 - 1)) * MOUSE_LOOK_GAIN;
        this._mouseY = clampUnit(1 - (evt.clientY / window.innerHeight) * 2) * MOUSE_LOOK_GAIN;
        this._mouseAge = 0;
    }

    _onFirstGesture() {
        DeviceOrientationEvent.requestPermission()
            .then((res) => { if (res === 'granted') this._listen(); })
            .catch(() => { /* denied or unavailable - the idle sway below covers it */ });
    }

    _listen() {
        window.addEventListener('deviceorientation', this._onOrientation, { passive: true });
    }

    _onOrientation(evt) {
        const { beta, gamma } = evt;
        if (beta === null || gamma === null || beta === undefined || gamma === undefined) return;

        this._lastEventAge = 0;
        if (this._baseBeta === null) {
            this._baseBeta = beta;
            this._baseGamma = gamma;
        }

        const clampUnit = (v) => Math.max(-1, Math.min(1, v));
        this._targetX = clampUnit((gamma - this._baseGamma) / TILT_RANGE_DEG);
        this._targetY = clampUnit((beta - this._baseBeta) / TILT_RANGE_DEG);
    }

    update(dt) {
        this._lastEventAge += dt;
        this._mouseAge += dt;

        if (this._lastEventAge > SENSOR_TIMEOUT && this._mouseAge < MOUSE_TIMEOUT) {
            this._targetX = this._mouseX;
            this._targetY = this._mouseY;
        } else if (this._lastEventAge > SENSOR_TIMEOUT) {
            // No sensor (desktop, or permission refused). A slow lissajous sway keeps the
            // refraction alive so the ice still reads as a thick, angled slab rather than
            // a static filter - it's deliberately far weaker than a real tilt.
            this._idleTime += dt;
            this._targetX = Math.sin(this._idleTime * IDLE_SWAY_SPEED) * IDLE_SWAY_AMPLITUDE;
            this._targetY = Math.sin(this._idleTime * IDLE_SWAY_SPEED * 0.73 + 1.1) * IDLE_SWAY_AMPLITUDE;
        } else if (this._baseBeta !== null) {
            // Let neutral creep toward however the phone is being held now.
            const drift = BASELINE_DRIFT * dt * TILT_RANGE_DEG;
            this._baseBeta += Math.sign(this._targetY) * Math.min(Math.abs(this._targetY) * drift, drift);
            this._baseGamma += Math.sign(this._targetX) * Math.min(Math.abs(this._targetX) * drift, drift);
        }

        const k = Math.min(1, dt * SMOOTHING);
        this.x += (this._targetX - this.x) * k;
        this.y += (this._targetY - this.y) * k;
    }

    /** Forgets the neutral pose, so the next reading re-centres. Called when a level starts
     *  and the player has presumably just settled into position. */
    recenter() {
        this._baseBeta = null;
        this._baseGamma = null;
        this._targetX = 0;
        this._targetY = 0;
    }

    dispose() {
        window.removeEventListener('deviceorientation', this._onOrientation);
        window.removeEventListener('pointerdown', this._onFirstGesture);
        window.removeEventListener('pointermove', this._onPointerMove);
        this._started = false;
    }
}
