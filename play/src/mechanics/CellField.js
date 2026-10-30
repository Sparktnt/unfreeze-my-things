// Ported/simplified from Scrape & Salvage's Mechanics/GridGenerator.cs.
// The original diffed clean-vs-damaged textures to decide where pieces could exist.
// Here the whole photo is iced over, so every pixel is eligible; seeds are still
// jittered and nudged toward luminance edges so the fracture lines look organic
// rather than a rigid grid.

function luminance(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Deep Freeze: how many chip-hits a reinforced cell takes to clear (255 / DEEP_FREEZE_LAYERS
// per hit, via IceMask.chipCellStep). 3 layers = 3 taps, stepping through unbroken -> cracked
// -> deeply shattered -> destroyed, one visual tier per remaining third of the mask value
// (see IceMaterial.js's fragment shader for the cracked/shattered look itself).
export const DEEP_FREEZE_LAYERS = 3;

// Smallest patch of ice a cell is allowed to own, measured in mask pixels. Cells are laid
// out over the whole photo rectangle and then clipped to the object, so the ones straddling
// the silhouette can end up owning a handful of pixels each. At this map resolution that is
// a speck a few screen pixels across - the player cannot see it or aim at it, but it is
// still a piece standing between them and 100%. Undersized cells get folded into a
// neighbour instead of shipping as their own piece (see mergeUndersizedCells).
const MIN_PIECE_MASK_PIXELS = 18; // roughly a 20x20 screen-px patch on a phone-sized plane
const MIN_PIECE_AREA_FRACTION = 0.15; // ...or this share of the average cell, whichever is bigger
const MIN_CELLS_AFTER_MERGE = 4; // never merge a level down into a couple of giant pieces

/**
 * @param {ImageData} imageData - source photo pixels, used only to bias seed placement toward edges.
 * @param {number} mapW - low-res cell-id buffer width (also the mask canvas resolution).
 * @param {number} mapH - low-res cell-id buffer height.
 * @param {number} targetCells - approximate number of Voronoi cells to generate.
 * @param {Uint8Array|null} objectMask - optional mapW*mapH buffer (255=iced, 0=bare, see
 *   ObjectMask.js's buildIceShape). When given, cells that don't cover any iced pixel are
 *   dropped so piece counts/taps only ever apply to the actual block of ice.
 * @param {number} reinforcedFraction - 0..1 share of cells flagged as "Deep Freeze" cells,
 *   i.e. `layers > 1` (need several chips instead of one - see IceLevel.tryChip and
 *   IceMask.chipCellStep, which both work generically off `cell.layers`). Melting still
 *   clears them at the normal rate either way, so a Deep Freeze patch is a reason to reach
 *   for the hairdryer - or now the Ice Scraper, which is nearly useless against them by
 *   design - instead of just tapping through it.
 */
export function buildCellField(imageData, mapW, mapH, targetCells = 46, objectMask = null, reinforcedFraction = 0) {
    const { data, width: srcW, height: srcH } = imageData;

    // Downsample source luminance to map resolution for a cheap edge-strength estimate.
    const lum = new Float32Array(mapW * mapH);
    for (let y = 0; y < mapH; y++) {
        const sy = Math.min(srcH - 1, Math.floor((y / mapH) * srcH));
        for (let x = 0; x < mapW; x++) {
            const sx = Math.min(srcW - 1, Math.floor((x / mapW) * srcW));
            const idx = (sy * srcW + sx) * 4;
            lum[y * mapW + x] = luminance(data[idx], data[idx + 1], data[idx + 2]);
        }
    }

    const edge = new Float32Array(mapW * mapH);
    for (let y = 1; y < mapH - 1; y++) {
        for (let x = 1; x < mapW - 1; x++) {
            const gx = Math.abs(lum[y * mapW + (x + 1)] - lum[y * mapW + (x - 1)]);
            const gy = Math.abs(lum[(y + 1) * mapW + x] - lum[(y - 1) * mapW + x]);
            edge[y * mapW + x] = gx + gy;
        }
    }

    // Jittered grid seed placement, biased toward the strongest nearby edge.
    const aspect = mapW / mapH;
    const seedCols = Math.max(1, Math.ceil(Math.sqrt(targetCells * aspect)));
    const seedRows = Math.max(1, Math.ceil(targetCells / seedCols));
    const cellW = mapW / seedCols;
    const cellH = mapH / seedRows;

    const seeds = [];
    for (let row = 0; row < seedRows; row++) {
        for (let col = 0; col < seedCols; col++) {
            const baseX = (col + 0.5) * cellW;
            const baseY = (row + 0.5) * cellH;
            const jx = (Math.random() - 0.5) * cellW * 0.6;
            const jy = (Math.random() - 0.5) * cellH * 0.6;

            let px = clampInt(baseX + jx, 0, mapW - 1);
            let py = clampInt(baseY + jy, 0, mapH - 1);

            const searchR = Math.max(2, Math.floor(cellW * 0.4));
            let bestEdge = -1, bestX = px, bestY = py;
            for (let sy = Math.max(0, py - searchR); sy < Math.min(mapH, py + searchR); sy += Math.max(1, Math.floor(searchR / 3))) {
                for (let sx = Math.max(0, px - searchR); sx < Math.min(mapW, px + searchR); sx += Math.max(1, Math.floor(searchR / 3))) {
                    const e = edge[sy * mapW + sx];
                    if (e > bestEdge) { bestEdge = e; bestX = sx; bestY = sy; }
                }
            }
            px = clampInt(px * 0.5 + bestX * 0.5, 0, mapW - 1);
            py = clampInt(py * 0.5 + bestY * 0.5, 0, mapH - 1);

            seeds.push({ x: px, y: py });
        }
    }

    // Assign every pixel to its nearest seed (brute force - map resolution is small, ~100x140).
    const cellId = new Int16Array(mapW * mapH);
    for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
            let best = 0, bestDist = Infinity;
            for (let s = 0; s < seeds.length; s++) {
                const dx = x - seeds[s].x;
                const dy = y - seeds[s].y;
                const d = dx * dx + dy * dy;
                if (d < bestDist) { bestDist = d; best = s; }
            }
            cellId[y * mapW + x] = best;
        }
    }

    // The raw Voronoi assignment, kept before any merging relabels it, plus which final cell
    // each seed ended up in. Together with `seeds` that's exact chunk geometry at any
    // resolution - the renderer rebuilds crisp chunk borders from it (see ChunkMap.js).
    const seedId = Int16Array.from(cellId);
    const seedCell = Int16Array.from(seeds, (_, i) => i);

    // Pixel counts + centroid per cell (centroid used to position chip debris/flash).
    // Object-only sums are tracked separately so a cell clipped by the silhouette centres on
    // the ice it actually owns, not on the empty backdrop half of its Voronoi region.
    const counts = new Int32Array(seeds.length);
    const sumX = new Float64Array(seeds.length);
    const sumY = new Float64Array(seeds.length);
    const objectCounts = objectMask ? new Int32Array(seeds.length) : null;
    const objSumX = objectMask ? new Float64Array(seeds.length) : null;
    const objSumY = objectMask ? new Float64Array(seeds.length) : null;
    for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
            const i = y * mapW + x;
            const c = cellId[i];
            counts[c]++;
            sumX[c] += x;
            sumY[c] += y;
            if (objectMask && objectMask[i] > 0) {
                objectCounts[c]++;
                objSumX[c] += x;
                objSumY[c] += y;
            }
        }
    }

    if (objectMask) {
        mergeUndersizedCells(cellId, seedCell, mapW, mapH, objectMask, { counts, sumX, sumY, objectCounts, objSumX, objSumY });
    }

    // Snap each centroid onto a pixel the cell actually owns. A plain average lands outside
    // its own cell whenever the piece is concave or split in two (the scissors' blades cross,
    // so one cell can own ice on both sides of a gap), and the centroid is used as "where
    // this piece is" - useHint's debris burst spawns there. An average that points at a hole
    // in the middle of the object is the wrong answer.
    const anchorX = new Int32Array(seeds.length);
    const anchorY = new Int32Array(seeds.length);
    if (objectMask) {
        const bestDist = new Float64Array(seeds.length).fill(Infinity);
        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                const i = y * mapW + x;
                if (objectMask[i] <= 0) continue;
                const c = cellId[i];
                if (objectCounts[c] <= 0) continue;
                const dx = x - objSumX[c] / objectCounts[c];
                const dy = y - objSumY[c] / objectCounts[c];
                const d = dx * dx + dy * dy;
                if (d < bestDist[c]) { bestDist[c] = d; anchorX[c] = x; anchorY[c] = y; }
            }
        }
    }

    const cells = seeds.map((seed, i) => {
        const onObject = objectMask && objectCounts[i] > 0;
        const cx = onObject ? anchorX[i] : sumX[i] / counts[i];
        const cy = onObject ? anchorY[i] : sumY[i] / counts[i];
        return {
            index: i,
            seed,
            pixelCount: counts[i],
            iceCount: objectMask ? objectCounts[i] : counts[i],
            centroidU: counts[i] > 0 ? cx / mapW : seed.x / mapW,
            centroidV: counts[i] > 0 ? cy / mapH : seed.y / mapH,
            reinforced: false,
            layers: 1, // "thin/weak" ice by default - one hit clears it, and the Ice Scraper is highly effective here
        };
    }).filter((c) => c.pixelCount > 0 && (!objectMask || objectCounts[c.index] > 0));

    // Pick a random subset of cells to be Deep Freeze cells (need several chips, or a melt, to clear).
    const reinforcedCount = Math.round(cells.length * reinforcedFraction);
    if (reinforcedCount > 0) {
        const order = cells.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        for (const i of order.slice(0, reinforcedCount)) {
            cells[i].reinforced = true;
            cells[i].layers = DEEP_FREEZE_LAYERS;
        }
    }

    return { mapW, mapH, cellId, cells, seeds, seedId, seedCell };
}

/**
 * Folds every cell owning less ice than the visibility floor into a neighbouring cell,
 * smallest first, so no level ships a piece too small to see or tap. Merging rather than
 * deleting matters: that ice belongs to the object either way, so it still has to be
 * clearable - it just becomes part of the piece next door instead of its own invisible one.
 *
 * Mutates `cellId` (the victim's pixels take the survivor's id), `seedCell` (every seed that
 * belonged to the victim now belongs to the survivor) and the accumulator arrays.
 */
function mergeUndersizedCells(cellId, seedCell, mapW, mapH, objectMask, acc) {
    const { counts, sumX, sumY, objectCounts, objSumX, objSumY } = acc;

    const alive = new Set();
    let totalIce = 0;
    for (let c = 0; c < objectCounts.length; c++) {
        if (objectCounts[c] > 0) { alive.add(c); totalIce += objectCounts[c]; }
    }
    if (alive.size <= MIN_CELLS_AFTER_MERGE) return;

    // The floor is fixed up front from the starting average - recomputing it as cells absorb
    // each other would keep raising the bar and cascade into a handful of huge pieces.
    const minArea = Math.max(MIN_PIECE_MASK_PIXELS, (totalIce / alive.size) * MIN_PIECE_AREA_FRACTION);

    while (alive.size > MIN_CELLS_AFTER_MERGE) {
        let victim = -1;
        let victimArea = Infinity;
        for (const c of alive) {
            if (objectCounts[c] < minArea && objectCounts[c] < victimArea) {
                victim = c;
                victimArea = objectCounts[c];
            }
        }
        if (victim < 0) break; // everything left is big enough to see

        const target = pickMergeTarget(cellId, mapW, mapH, objectMask, victim, alive, acc);
        if (target < 0) break;

        for (let i = 0; i < cellId.length; i++) if (cellId[i] === victim) cellId[i] = target;
        for (let s = 0; s < seedCell.length; s++) if (seedCell[s] === victim) seedCell[s] = target;
        counts[target] += counts[victim];
        sumX[target] += sumX[victim];
        sumY[target] += sumY[victim];
        objectCounts[target] += objectCounts[victim];
        objSumX[target] += objSumX[victim];
        objSumY[target] += objSumY[victim];
        counts[victim] = 0;
        objectCounts[victim] = 0;
        alive.delete(victim);
    }
}

/** The neighbour a doomed cell should join: whichever surviving cell it shares the most
 *  border with, counting borders that run through ice far more heavily than ones out on the
 *  backdrop, so merged pieces stay contiguous where it shows. */
function pickMergeTarget(cellId, mapW, mapH, objectMask, victim, alive, acc) {
    const shared = new Map();
    for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
            const i = y * mapW + x;
            if (cellId[i] !== victim) continue;
            const neighbours = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
            for (const [nx, ny] of neighbours) {
                if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
                const j = ny * mapW + nx;
                const c = cellId[j];
                if (c === victim || !alive.has(c)) continue;
                const weight = (objectMask[i] > 0 && objectMask[j] > 0) ? 4 : 1;
                shared.set(c, (shared.get(c) || 0) + weight);
            }
        }
    }

    let best = -1;
    let bestScore = -1;
    for (const [c, score] of shared) {
        if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best >= 0) return best;

    // No surviving cell touches it at all (an ice island of its own). Nothing keeps the merge
    // contiguous here, so fall back to the nearest survivor by centroid - rare, because
    // ObjectMask already drops islands this small.
    const { counts: cnt, sumX: sx, sumY: sy } = acc;
    const vx = sx[victim] / cnt[victim];
    const vy = sy[victim] / cnt[victim];
    let bestDist = Infinity;
    for (const c of alive) {
        if (c === victim) continue;
        const dx = sx[c] / cnt[c] - vx;
        const dy = sy[c] / cnt[c] - vy;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; best = c; }
    }
    return best;
}

function clampInt(v, min, max) {
    return Math.max(min, Math.min(max, Math.round(v)));
}
