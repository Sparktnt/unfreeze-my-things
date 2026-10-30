// Unified combo meter across all three tools (Pickaxe/Hairdryer/Ice Scraper). This is a
// separate, new system from GameplayScreen's existing pickaxe-only chip-streak popup
// ("Nx!" + bonus coins, see COMBO_WINDOW/COMBO_SHOW_THRESHOLD there) - that one is left
// completely untouched. This meter instead answers "is the player continuously damaging
// ice with *any* tool right now" and exposes a score multiplier for that.

const COMBO_WINDOW_SECONDS = 2; // no damage for this long and the combo fully resets
const HITS_PER_TIER = 4; // consecutive damage ticks (within the window) to advance a tier
const TIERS = [1.0, 1.2, 1.5, 2.0];

export class ComboMeter {
    constructor() {
        this._hits = 0;
        this._timer = COMBO_WINDOW_SECONDS + 1; // starts already-expired
        this._displayEl = null;
    }

    /** Wires this meter to a DOM element it will keep in sync on every change - the public
     *  "update a UI Text element" hook. Call once during screen setup. */
    attachDisplay(el) {
        this._displayEl = el;
        this._render();
    }

    get multiplier() {
        const tier = Math.min(TIERS.length - 1, Math.floor(this._hits / HITS_PER_TIER));
        return TIERS[tier];
    }

    /** Call whenever a piece of ice takes damage or is destroyed, from any tool - resets
     *  the combo timer and, often, advances the multiplier tier. */
    registerDamage() {
        this._timer = 0;
        this._hits += 1;
        this._render();
    }

    /** Call once per frame. Expires (resets to 1.0x) after COMBO_WINDOW_SECONDS of no damage. */
    update(dt) {
        if (this._hits === 0) return;
        this._timer += dt;
        if (this._timer >= COMBO_WINDOW_SECONDS) {
            this._hits = 0;
            this._render();
        }
    }

    _render() {
        if (!this._displayEl) return;
        const mult = this.multiplier;
        this._displayEl.textContent = mult > 1 ? `Combo: ${mult.toFixed(1)}x` : '';
        this._displayEl.classList.toggle('show', mult > 1);
    }
}
