// Standalone state machine for the hairdryer's Overheat mechanic. Kept separate from
// IceLevel (which owns the actual melt math) and GameplayScreen (which owns tool
// selection/input) so this one small piece of timing logic can be read, tuned, or reused
// on its own. GameplayScreen owns one instance and drives it once per frame; IceLevel never
// touches it directly - GameplayScreen instead calls IceLevel.setOverheat(overheat.isOverheating).

const HEAT_TO_OVERHEAT_SECONDS = 4; // continuous hold required to trigger Overheat Mode
const OVERHEAT_DURATION_SECONDS = 3; // how long the 2x melt speed/radius boost lasts
const COOLDOWN_DURATION_SECONDS = 2; // forced lockout afterwards - tryMelt must not be called

export const OverheatState = Object.freeze({
    IDLE: 'idle',
    HEATING: 'heating',
    OVERHEAT: 'overheat',
    COOLDOWN: 'cooldown',
});

export class HairdryerOverheat {
    constructor() {
        this.state = OverheatState.IDLE;
        this._timer = 0;
    }

    /** True while melting should run at 2x radius/rate (see IceLevel.setOverheat). */
    get isOverheating() {
        return this.state === OverheatState.OVERHEAT;
    }

    /** True while the hairdryer cannot melt at all (the post-Overheat lockout). Callers
     *  must skip IceLevel.tryMelt() entirely while this is true. */
    get isLocked() {
        return this.state === OverheatState.COOLDOWN;
    }

    /** 0..1 progress toward triggering Overheat - drives a heat-meter UI ring. */
    get heatFraction() {
        if (this.state === OverheatState.HEATING) return Math.min(1, this._timer / HEAT_TO_OVERHEAT_SECONDS);
        if (this.state === OverheatState.OVERHEAT || this.state === OverheatState.COOLDOWN) return 1;
        return 0;
    }

    /** 0..1 remaining-cooldown progress (1 = just entered cooldown, 0 = about to unlock). */
    get cooldownFraction() {
        if (this.state !== OverheatState.COOLDOWN) return 0;
        return 1 - Math.min(1, this._timer / COOLDOWN_DURATION_SECONDS);
    }

    /** Skips straight to the cooldown lockout - Fragile levels punish an overheat instead of
     *  rewarding it with the usual boost (see GameplayScreen). */
    forceCooldown() {
        this.state = OverheatState.COOLDOWN;
        this._timer = 0;
    }

    /**
     * Advances the state machine by one frame.
     * @param {number} dt - seconds since last frame.
     * @param {boolean} isHoldingHairdryer - true this frame iff the hairdryer tool is
     *   selected AND the player is actively holding down. Call this every frame regardless
     *   of which tool is active (pass false when a different tool is selected).
     * @returns {{enteredOverheat: boolean, enteredCooldown: boolean, enteredIdle: boolean}}
     *   one-shot flags for state transitions that happened this tick - hook audio/vfx off these.
     */
    update(dt, isHoldingHairdryer) {
        const events = { enteredOverheat: false, enteredCooldown: false, enteredIdle: false };
        this._timer += dt;

        switch (this.state) {
            case OverheatState.IDLE:
                if (isHoldingHairdryer) {
                    this.state = OverheatState.HEATING;
                    this._timer = 0;
                }
                break;

            case OverheatState.HEATING:
                if (!isHoldingHairdryer) {
                    // The spec calls for *continuous* holding - releasing early cools it
                    // back down rather than banking partial progress.
                    this.state = OverheatState.IDLE;
                    this._timer = 0;
                } else if (this._timer >= HEAT_TO_OVERHEAT_SECONDS) {
                    this.state = OverheatState.OVERHEAT;
                    this._timer = 0;
                    events.enteredOverheat = true;
                }
                break;

            case OverheatState.OVERHEAT:
                if (this._timer >= OVERHEAT_DURATION_SECONDS) {
                    this.state = OverheatState.COOLDOWN;
                    this._timer = 0;
                    events.enteredCooldown = true;
                }
                break;

            case OverheatState.COOLDOWN:
                if (this._timer >= COOLDOWN_DURATION_SECONDS) {
                    this.state = OverheatState.IDLE;
                    this._timer = 0;
                    events.enteredIdle = true;
                }
                break;
        }

        return events;
    }
}
