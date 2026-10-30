import * as THREE from '../../vendor/three/three.module.js';

// Ice at or below this (of 255) is invisible on screen but would still block a 100% clear,
// so melting through it snaps straight to bare object. See meltAt() and sweepResidue().
const RESIDUE_EPSILON = 4;

// Render-side shape of the slab. The ice shader (rendering/IceMaterial.js) reads these from
// the texture below and IceLevel ray-marches the same surface on the CPU to place taps, so
// both sides use surfaceHeight() / the matching GLSL and these constants.
export const SDF_RANGE_TEXELS = 6; // outline distance encoded in the alpha channel, +-
export const BEVEL_TEXELS = 3.5; // width of the rounded lip along the block's outline
const BEVEL_BLUR_RADIUS = 1; // box radius (x2 passes) that rounds chip holes and melt fronts
const SHADOW_BLUR_RADIUS = 5; // box radius (x2 passes) of the soft ice silhouette used for shadows

/**
 * The "ice remaining" buffer: one byte per cell-field pixel (255 = fully iced,
 * 0 = melted/chipped away to bare object). All coordinates here use the CellField
 * convention: v=0 is the TOP row of the source photo (see the vTop conversion in IceLevel.js).
 *
 * `data` is the gameplay truth. The GPU gets an RGBA texture derived from it (rows top-down,
 * no flipY):
 *   R - ice amount (data itself)
 *   G - ice amount lightly blurred, so chip holes and melt fronts have a rounded slope
 *   B - ice amount heavily blurred: the soft silhouette the block's shadow is cast from
 *   A - the block's outline as a signed distance (static; 0.5 = on the outline)
 */
export class IceMask {
    /** @param {Uint8Array|null} initialMask - optional starting ice amounts (e.g. the ice
     *  block from ObjectMask.buildIceShape) instead of icing the whole photo rect.
     *  @param {Float32Array|null} shapeSdf - the block outline's signed distance in texels,
     *  positive inside. Without it the outline is taken from initialMask as-is. */
    constructor(mapW, mapH, initialMask = null, shapeSdf = null) {
        this.mapW = mapW;
        this.mapH = mapH;
        const n = mapW * mapH;
        this.data = initialMask ? Uint8Array.from(initialMask) : new Uint8Array(n).fill(255);

        this._initialSum = 0;
        for (let i = 0; i < n; i++) this._initialSum += this.data[i];

        // Inside/outside the block as first laid down - the blur behind the bevel height
        // treats everywhere outside it as solid, so only chips and melts get sloped walls
        // while the block's own outline takes its crisp rounded lip from the SDF.
        this._inShape = Uint8Array.from(this.data, (v) => (v > 0 ? 1 : 0));

        this.sdf = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            this.sdf[i] = shapeSdf ? shapeSdf[i] : (this._inShape[i] ? SDF_RANGE_TEXELS : -SDF_RANGE_TEXELS);
        }

        this.bevel = new Float32Array(n); // G, 0..1 - also what the CPU tap ray-march reads
        this._shadow = new Float32Array(n);
        this._scratchA = new Float32Array(n);
        this._scratchB = new Float32Array(n);

        this._rgba = new Uint8Array(n * 4);
        for (let i = 0; i < n; i++) {
            const a = 0.5 + this.sdf[i] / (2 * SDF_RANGE_TEXELS);
            this._rgba[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
        }

        this.texture = new THREE.DataTexture(this._rgba, mapW, mapH, THREE.RGBAFormat, THREE.UnsignedByteType);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.wrapS = THREE.ClampToEdgeWrapping;
        this.texture.wrapT = THREE.ClampToEdgeWrapping;

        this._dirty = true;
        this.flushToGPU();
    }

    /** Instantly clears every pixel belonging to one Voronoi cell (a "chip" of ice breaking off). */
    chipCell(cellField, cellIndex) {
        const { cellId } = cellField;
        for (let i = 0; i < cellId.length; i++) {
            if (cellId[i] === cellIndex) this.data[i] = 0;
        }
        this._dirty = true;
    }

    /** Reduces every pixel of one cell by a flat amount instead of zeroing it outright -
     *  used for "reinforced" cells, so a chip visibly thins the frost rather than fully
     *  clearing it, and it takes a few taps (or a melt) to finish the cell off. */
    chipCellStep(cellField, cellIndex, amount) {
        const { cellId } = cellField;
        for (let i = 0; i < cellId.length; i++) {
            if (cellId[i] === cellIndex) this.data[i] = Math.max(0, this.data[i] - amount);
        }
        this._dirty = true;
    }

    /** Puts one cell's ice back exactly as it was laid down (`initial` = a copy of `data`
     *  taken at load) - the Frost Creep rule regrowing a cleared chunk. */
    restoreCell(cellField, cellIndex, initial) {
        const { cellId } = cellField;
        for (let i = 0; i < cellId.length; i++) {
            if (cellId[i] === cellIndex) this.data[i] = initial[i];
        }
        this._dirty = true;
    }

    /**
     * Erodes ice in a soft circular brush around (uTop, vTop), called continuously
     * while the player holds their finger down. `radiusUV`/`strength` control the
     * melt puddle's size and speed.
     */
    meltAt(uTop, vTop, radiusUV, strength) {
        const cx = uTop * this.mapW;
        const cy = vTop * this.mapH;
        const rPx = radiusUV * this.mapW;
        const rPxSq = rPx * rPx;

        const minX = Math.max(0, Math.floor(cx - rPx));
        const maxX = Math.min(this.mapW - 1, Math.ceil(cx + rPx));
        const minY = Math.max(0, Math.floor(cy - rPx));
        const maxY = Math.min(this.mapH - 1, Math.ceil(cy + rPx));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dx = x - cx;
                const dy = y - cy;
                const distSq = dx * dx + dy * dy;
                if (distSq > rPxSq) continue;
                const falloff = 1 - Math.sqrt(distSq) / rPx; // 1 at center, 0 at edge
                const idx = y * this.mapW + x;
                const reduce = strength * falloff * falloff;
                const left = Math.max(0, this.data[idx] - reduce);
                // Snap the last sliver away instead of letting it asymptote. The brush's
                // squared falloff removes well under 1 unit per frame near its rim, and
                // this is a Uint8Array, so without this a pass leaves a ring of 1-3 unit
                // crumbs that render as nothing but still count as uncleared ice.
                this.data[idx] = left <= RESIDUE_EPSILON ? 0 : left;
            }
        }
        this._dirty = true;
    }

    /** Wipes whatever ice is left. Called once a level is within CLEAR_TOLERANCE of done,
     *  so the object is genuinely fully revealed for the win shot rather than keeping a few
     *  invisible units the player would have had to hunt down. Returns true if it removed
     *  anything. */
    sweepResidue() {
        let removed = false;
        for (let i = 0; i < this.data.length; i++) {
            if (this.data[i] > 0) {
                this.data[i] = 0;
                removed = true;
            }
        }
        if (removed) this._dirty = true;
        return removed;
    }

    /** Fraction of the ice that existed at load time which still remains, 0..1. */
    remainingFraction() {
        if (this._initialSum <= 0) return 0;
        let sum = 0;
        for (let i = 0; i < this.data.length; i++) sum += this.data[i];
        return sum / this._initialSum;
    }

    /**
     * Height of the ice's top surface at a mask-space point, 0..1 of the full slab thickness
     * (texel centres on integers, v from the top). Bilinear, like the GPU's filtering of the
     * same data, and must stay in step with surfaceHeight() in IceMaterial.js's shader.
     */
    surfaceHeightAt(tx, ty) {
        const { mapW, mapH } = this;
        const x = Math.min(mapW - 1, Math.max(0, tx));
        const y = Math.min(mapH - 1, Math.max(0, ty));
        const x0 = Math.min(mapW - 2, Math.floor(x));
        const y0 = Math.min(mapH - 2, Math.floor(y));
        const fx = x - x0;
        const fy = y - y0;
        const i00 = y0 * mapW + x0;
        const lerp2 = (arr) => {
            const top = arr[i00] + (arr[i00 + 1] - arr[i00]) * fx;
            const bottom = arr[i00 + mapW] + (arr[i00 + mapW + 1] - arr[i00 + mapW]) * fx;
            return top + (bottom - top) * fy;
        };
        return surfaceHeight(lerp2(this.sdf), lerp2(this.bevel));
    }

    flushToGPU() {
        if (!this._dirty) return;
        this._dirty = false;

        const { data, _inShape: inShape, bevel, _shadow: shadow, _rgba: rgba } = this;
        const n = data.length;
        for (let i = 0; i < n; i++) {
            bevel[i] = inShape[i] ? data[i] / 255 : 1;
            shadow[i] = data[i] / 255;
        }
        this._blur(bevel, BEVEL_BLUR_RADIUS);
        this._blur(shadow, SHADOW_BLUR_RADIUS);

        for (let i = 0; i < n; i++) {
            rgba[i * 4] = data[i];
            rgba[i * 4 + 1] = Math.round(bevel[i] * 255);
            rgba[i * 4 + 2] = Math.round(shadow[i] * 255);
        }
        this.texture.needsUpdate = true;
    }

    /** In-place approximate gaussian: two passes of a separable running-sum box blur. */
    _blur(field, radius) {
        const { mapW: w, mapH: h, _scratchA: tmp, _scratchB: tmp2 } = this;
        for (let pass = 0; pass < 2; pass++) {
            boxBlur1D(field, tmp, w, h, radius, 1, w);
            boxBlur1D(tmp, tmp2, h, w, radius, w, 1);
            field.set(tmp2);
        }
    }

    dispose() {
        this.texture.dispose();
    }
}

/** Shape of the slab's top: the rounded lip of the block's outline, capped by the sloped
 *  walls of chip holes and melt fronts. `sdfTexels` and `bevel` as stored by IceMask. */
export function surfaceHeight(sdfTexels, bevel) {
    const x = Math.min(1, Math.max(0, sdfTexels / BEVEL_TEXELS));
    const lip = Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x)));
    const t = Math.min(1, Math.max(0, (bevel - 0.1) / 0.8));
    return Math.min(lip, t * t * (3 - 2 * t));
}

/** Box blur along one axis with edge clamping. `len` samples per line, `lines` lines;
 *  `step` walks along a line, `stride` jumps between lines. */
function boxBlur1D(src, dst, len, lines, r, step, stride) {
    const inv = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
        const base = l * stride;
        let acc = src[base] * (r + 1);
        for (let k = 1; k <= r; k++) acc += src[base + Math.min(k, len - 1) * step];
        for (let k = 0; k < len; k++) {
            dst[base + k * step] = acc * inv;
            const add = Math.min(k + r + 1, len - 1);
            const sub = Math.max(k - r, 0);
            acc += src[base + add * step] - src[base + sub * step];
        }
    }
}
