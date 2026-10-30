// Translates pointer events into the tap / hold-to-melt vocabulary the game needs.
// A quick press-and-release is a "tap" (chip a piece). A press still down past
// HOLD_THRESHOLD_MS becomes a continuous "hold" (melt that follows the finger, drag and
// all) until release; movement only disqualifies the release from counting as a tap.

const HOLD_THRESHOLD_MS = 200;
const TAP_MOVE_TOLERANCE = 14; // px - beyond this while still under the threshold, it's a drag, not a tap

export class InputHandler {
    constructor(element) {
        this._element = element;

        this._down = false;
        this._downTime = 0;
        this._downPos = { x: 0, y: 0 };
        this._currentPos = { x: 0, y: 0 };
        this._movedBeyondTolerance = false;

        this.tapDetected = false;
        this.tapPosition = { x: 0, y: 0 };
        this.isHolding = false;
        this.holdPosition = { x: 0, y: 0 };
        this.holdDuration = 0; // seconds since the hold gesture started melting (0 while not holding)
        this.justReleased = false;
        this.releasePosition = { x: 0, y: 0 };

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        element.addEventListener('pointerdown', this._onPointerDown, { passive: true });
        window.addEventListener('pointermove', this._onPointerMove, { passive: true });
        window.addEventListener('pointerup', this._onPointerUp, { passive: true });
        window.addEventListener('pointercancel', this._onPointerUp, { passive: true });
    }

    _localPos(evt) {
        const rect = this._element.getBoundingClientRect();
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    _onPointerDown(evt) {
        const pos = this._localPos(evt);
        this._down = true;
        this._downTime = performance.now();
        this._downPos = pos;
        this._currentPos = pos;
        this._movedBeyondTolerance = false;
        this._pendingTap = true;
    }

    _onPointerMove(evt) {
        if (!this._down) return;
        const pos = this._localPos(evt);
        this._currentPos = pos;
        const dx = pos.x - this._downPos.x;
        const dy = pos.y - this._downPos.y;
        if (Math.hypot(dx, dy) > TAP_MOVE_TOLERANCE) {
            this._movedBeyondTolerance = true;
        }
    }

    _onPointerUp(evt) {
        if (!this._down) return;
        this._down = false;
        this._pendingRelease = true;
        this._releasePos = this._localPos(evt);
    }

    /** Call once per frame before screens read the flags. */
    update() {
        this.tapDetected = false;
        this.justReleased = false;

        const now = performance.now();

        if (this._down) {
            const held = now - this._downTime;
            if (this._pendingTap && (held > HOLD_THRESHOLD_MS || this._movedBeyondTolerance)) {
                // Held long enough (or moved) - this is no longer a simple tap.
                this._pendingTap = false;
            }
            if (held > HOLD_THRESHOLD_MS) {
                this.isHolding = true;
                this.holdPosition = this._currentPos;
                this.holdDuration = (held - HOLD_THRESHOLD_MS) / 1000;
            } else {
                this.isHolding = false;
                this.holdDuration = 0;
            }
        } else {
            this.isHolding = false;
            this.holdDuration = 0;
            if (this._pendingRelease) {
                this._pendingRelease = false;
                if (this._pendingTap) {
                    this.tapDetected = true;
                    this.tapPosition = this._releasePos;
                }
                this.justReleased = true;
                this.releasePosition = this._releasePos;
                this._pendingTap = false;
            }
        }
    }

    dispose() {
        this._element.removeEventListener('pointerdown', this._onPointerDown);
        window.removeEventListener('pointermove', this._onPointerMove);
        window.removeEventListener('pointerup', this._onPointerUp);
        window.removeEventListener('pointercancel', this._onPointerUp);
    }
}
