// The level photos are product shots on a plain light backdrop (see assets/images/levels).
// This flags which low-res mask pixels belong to the product itself vs that backdrop, and
// then grows that silhouette into the rounded block of ice that encases it (buildIceShape).
//
// The ice deliberately overhangs the object by a margin: a block that stops exactly at the
// silhouette leaves the object's own outline poking out, and reads as a sticker rather than
// as a thing frozen inside something. That only works because the ice shader makes ice over
// the pale backdrop plainly visible (cyan body, dark refracting rim, cast shadow) - it used
// to draw as near-white frost on near-white pixels, which is why the old mask was shaved
// tight to the object instead.

const BACKDROP_TOLERANCE = 46; // per-channel distance from the sampled backdrop colour
const BACKDROP_COVERAGE = 0.55; // share of a mask cell's source pixels that must match it
const MIN_ISLAND_FRACTION = 0.004; // islands under this share of the main blob are dropped
const MIN_ISLAND_CELLS = 4; // ...and anything this tiny goes regardless of the ratio
const SAMPLES_PER_CELL = 3; // NxN source taps averaged per mask cell
const PLAIN_BACKDROP_MIN_SHARE = 0.6; // border agreement needed to trust the backdrop test at all
const MIN_OBJECT_SHARE = 0.04; // sanity floor - below this we assume the detection misfired

/**
 * Median border colour, used as the reference "backdrop" this photo was shot on. Sampling
 * it rather than hardcoding white lets slightly grey or warm studio backdrops work too.
 * @returns {{ r: number, g: number, b: number, share: number }} reference colour, plus the
 *   share of border samples close to it (low = the photo isn't a plain-backdrop product shot).
 */
function sampleBackdropColor(data, srcW, srcH) {
    const samples = [];
    const push = (x, y) => {
        const idx = (y * srcW + x) * 4;
        samples.push([data[idx], data[idx + 1], data[idx + 2]]);
    };
    const stepX = Math.max(1, Math.floor(srcW / 64));
    for (let x = 0; x < srcW; x += stepX) {
        push(x, 0);
        push(x, srcH - 1);
    }
    const stepY = Math.max(1, Math.floor(srcH / 64));
    for (let y = 0; y < srcH; y += stepY) {
        push(0, y);
        push(srcW - 1, y);
    }

    // Median by brightness, so a dark object bleeding off one edge can't drag the reference.
    samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const [r, g, b] = samples[samples.length >> 1];

    let agreeing = 0;
    for (const [sr, sg, sb] of samples) {
        if (Math.max(Math.abs(sr - r), Math.abs(sg - g), Math.abs(sb - b)) <= BACKDROP_TOLERANCE) agreeing++;
    }
    return { r, g, b, share: agreeing / samples.length };
}

/**
 * @param {ImageData} imageData - source photo pixels.
 * @param {number} mapW - low-res mask buffer width.
 * @param {number} mapH - low-res mask buffer height.
 * @returns {Uint8Array} mapW*mapH buffer: 255 where the object is, 0 where it's backdrop.
 */
export function buildObjectMask(imageData, mapW, mapH) {
    const { data, width: srcW, height: srcH } = imageData;
    const n = mapW * mapH;

    const ref = sampleBackdropColor(data, srcW, srcH);
    // Full-bleed art with no plain margin: no backdrop to subtract, so ice the whole rect
    // rather than carving a hole out of the picture.
    if (ref.share < PLAIN_BACKDROP_MIN_SHARE) return new Uint8Array(n).fill(255);

    // Area coverage, not a single point sample: a mask cell counts as backdrop only when
    // most of the source pixels it spans are backdrop. Cells straddling the silhouette are
    // therefore decided by which side they mostly sit on, instead of by whichever lone
    // pixel a nearest-neighbour tap happened to land on.
    const isBackdropColor = new Uint8Array(n);
    for (let y = 0; y < mapH; y++) {
        const y0 = Math.floor((y * srcH) / mapH);
        const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / mapH));
        const strideY = Math.max(1, Math.floor((y1 - y0) / SAMPLES_PER_CELL));
        for (let x = 0; x < mapW; x++) {
            const x0 = Math.floor((x * srcW) / mapW);
            const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / mapW));
            const strideX = Math.max(1, Math.floor((x1 - x0) / SAMPLES_PER_CELL));

            let total = 0;
            let backdrop = 0;
            for (let sy = y0; sy < y1; sy += strideY) {
                for (let sx = x0; sx < x1; sx += strideX) {
                    const idx = (sy * srcW + sx) * 4;
                    const d = Math.max(
                        Math.abs(data[idx] - ref.r),
                        Math.abs(data[idx + 1] - ref.g),
                        Math.abs(data[idx + 2] - ref.b),
                    );
                    total++;
                    if (d <= BACKDROP_TOLERANCE) backdrop++;
                }
            }
            isBackdropColor[y * mapW + x] = backdrop >= total * BACKDROP_COVERAGE ? 1 : 0;
        }
    }

    // Flood-fill the backdrop in from the photo's edges. Only backdrop-coloured cells
    // reachable from the border count as backdrop - a bright highlight stranded inside the
    // object doesn't get punched out into a false "hole", so the ice always starts as one
    // solid, unbroken shape over the object. It also means a pale part of the object that
    // happens to fall inside the colour tolerance survives, as long as a darker outline
    // separates it from the margin.
    const mask = new Uint8Array(n).fill(255);
    const visited = new Uint8Array(n);
    const queue = new Int32Array(n);
    let qHead = 0;
    let qTail = 0;

    const enqueue = (x, y) => {
        if (x < 0 || x >= mapW || y < 0 || y >= mapH) return;
        const i = y * mapW + x;
        if (visited[i] || !isBackdropColor[i]) return;
        visited[i] = 1;
        mask[i] = 0;
        queue[qTail++] = i;
    };

    for (let x = 0; x < mapW; x++) {
        enqueue(x, 0);
        enqueue(x, mapH - 1);
    }
    for (let y = 0; y < mapH; y++) {
        enqueue(0, y);
        enqueue(mapW - 1, y);
    }

    while (qHead < qTail) {
        const i = queue[qHead++];
        const x = i % mapW;
        const y = (i / mapW) | 0;
        enqueue(x + 1, y);
        enqueue(x - 1, y);
        enqueue(x, y + 1);
        enqueue(x, y - 1);
    }

    dropTinyIslands(mask, mapW, mapH);

    let objectCells = 0;
    for (let i = 0; i < n; i++) if (mask[i]) objectCells++;
    // Detection misfired (e.g. an object that matches its own backdrop). Icing the whole
    // rect is a worse look but still completable; icing almost nothing isn't a level.
    if (objectCells < n * MIN_OBJECT_SHARE) return new Uint8Array(n).fill(255);

    return mask;
}

// Ice block geometry, as fractions of the mask height so they hold at any MASK_RES_H.
const ICE_MARGIN = 0.03; // how far the block overhangs the object's silhouette
const ICE_CLOSING = 0.05; // gaps narrower than twice this are bridged, so it reads as one block
const ICE_RECT_INSET = 1.5; // mask texels kept bare inside the photo rect, so the bevel never clips
const ICE_WOBBLE = 0.9; // mask texels of low-frequency irregularity along the outline

/**
 * Grows an object silhouette into the block of ice that encases it: dilated past the object
 * by a margin, with narrow gaps and notches bridged (a morphological closing), a slightly
 * irregular outline, and clamped inside the photo rect.
 *
 * Returns the outline as a signed distance field rather than just a mask, because the ice
 * shader needs a smooth outline to bevel and anti-alias - thresholding the SDF after bilinear
 * filtering gives a clean curved edge at any zoom, where a thresholded binary mask stairsteps.
 *
 * @param {Uint8Array} objectMask - mapW*mapH, 255 = object (see buildObjectMask).
 * @returns {{ mask: Uint8Array, sdf: Float32Array }} `mask` is 255 inside the ice, 0 outside;
 *   `sdf` is the signed distance to the outline in mask texels, positive inside.
 */
export function buildIceShape(objectMask, mapW, mapH) {
    const n = mapW * mapH;
    const margin = mapH * ICE_MARGIN;
    const closing = mapH * ICE_CLOSING;

    const toObject = distanceField(mapW, mapH, (i) => objectMask[i] > 0);
    const grownReach = closing + margin;
    const toOutside = distanceField(mapW, mapH, (i) => toObject[i] > grownReach);

    const wobble = makeValueNoise(mapW, mapH, 9);
    const sdf = new Float32Array(n);
    const mask = new Uint8Array(n);
    for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
            const i = y * mapW + x;
            // Dilate by (closing + margin), then erode by closing: the erosion undoes the
            // extra growth everywhere except across gaps the dilation filled in.
            let d = toObject[i] <= grownReach
                ? (toOutside[i] - 0.5) - closing
                : margin - toObject[i];
            d += (wobble(x, y) - 0.5) * 2 * ICE_WOBBLE;
            const toRect = Math.min(x + 0.5, y + 0.5, mapW - 0.5 - x, mapH - 0.5 - y) - ICE_RECT_INSET;
            d = Math.min(d, toRect);
            sdf[i] = d;
            mask[i] = d > 0 ? 255 : 0;
        }
    }
    return { mask, sdf };
}

/** Euclidean distance (in texels) from every texel to the nearest texel where `isSeed` holds -
 *  Felzenszwalb & Huttenlocher's separable squared-distance transform, exact and O(n). */
function distanceField(w, h, isSeed) {
    const INF = 1e20;
    const n = w * h;
    const grid = new Float64Array(n);
    for (let i = 0; i < n; i++) grid[i] = isSeed(i) ? 0 : INF;

    const len = Math.max(w, h);
    const f = new Float64Array(len);
    const d = new Float64Array(len);
    const v = new Int32Array(len);
    const z = new Float64Array(len + 1);

    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
        edt1d(f, h, d, v, z);
        for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
        edt1d(f, w, d, v, z);
        for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
    }

    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.sqrt(grid[i]);
    return out;
}

/** 1D squared distance transform of sampled function f (lower envelope of parabolas). */
function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) {
            k--;
            s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
}

/** Smooth 0..1 value noise over the mask, one random lattice point every `period` texels. */
function makeValueNoise(w, h, period) {
    const gw = Math.ceil(w / period) + 2;
    const gh = Math.ceil(h / period) + 2;
    const lattice = new Float32Array(gw * gh);
    for (let i = 0; i < lattice.length; i++) lattice[i] = Math.random();
    return (x, y) => {
        const fx = x / period;
        const fy = y / period;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = lattice[y0 * gw + x0];
        const b = lattice[y0 * gw + x0 + 1];
        const c = lattice[(y0 + 1) * gw + x0];
        const e = lattice[(y0 + 1) * gw + x0 + 1];
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
    };
}

/** Removes specks left over from erosion and from stray dark marks out on the backdrop
 *  (dust, a reflection, a signature). They're a couple of pixels of ice in the middle of
 *  nowhere, and a player has no way to find them - so they never get to exist. */
function dropTinyIslands(mask, mapW, mapH) {
    const n = mapW * mapH;
    const label = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    const islands = [];

    for (let start = 0; start < n; start++) {
        if (!mask[start] || label[start] >= 0) continue;
        const id = islands.length;
        let qHead = 0;
        let qTail = 0;
        queue[qTail++] = start;
        label[start] = id;
        let size = 0;
        while (qHead < qTail) {
            const i = queue[qHead++];
            size++;
            const x = i % mapW;
            const y = (i / mapW) | 0;
            const neighbours = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
            for (const [nx, ny] of neighbours) {
                if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
                const j = ny * mapW + nx;
                if (mask[j] && label[j] < 0) {
                    label[j] = id;
                    queue[qTail++] = j;
                }
            }
        }
        islands.push(size);
    }

    if (!islands.length) return;
    const biggest = Math.max(...islands);
    for (let i = 0; i < n; i++) {
        if (!mask[i]) continue;
        const size = islands[label[i]];
        if (size < MIN_ISLAND_CELLS || size < biggest * MIN_ISLAND_FRACTION) mask[i] = 0;
    }
}
