// Ported from Scrape & Salvage's Graphics/VisualEffects.cs

export function easeOutSine(t) {
    return Math.sin((t * Math.PI) / 2);
}

export function easeInSine(t) {
    return 1 - Math.cos((t * Math.PI) / 2);
}

export function easeOutCubic(t) {
    const inv = 1 - t;
    return 1 - inv * inv * inv;
}

export function easeInCubic(t) {
    return t * t * t;
}

export function easeOutElastic(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const p = 0.4;
    const s = p / 4;
    return Math.pow(2, -10 * t) * Math.sin(((t - s) * (2 * Math.PI)) / p) + 1;
}

export function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const inv = t - 1;
    return 1 + c3 * inv * inv * inv + c1 * inv * inv;
}

export function lerp(start, end, t) {
    const ct = Math.min(Math.max(t, 0), 1);
    return start + (end - start) * ct;
}

export function smoothStep(t) {
    const ct = Math.min(Math.max(t, 0), 1);
    return ct * ct * (3 - 2 * ct);
}

export function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
}
