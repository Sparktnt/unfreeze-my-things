import * as THREE from '../../vendor/three/three.module.js';

// The ice mask lives at a low resolution (a few screen px per texel), which is plenty for
// the melt brush but far too coarse to draw the edge of a chipped-out chunk: a thresholded
// low-res mask gives wobbly, stair-stepped holes. The chunks themselves are just Voronoi
// cells, though, so their borders can be rebuilt exactly from the seed points at whatever
// resolution the screen needs. That's this map: per high-res texel, which chunk it's in,
// which chunk lies across the nearest border, and how far away that border is.

export const CHUNK_MAP_SCALE = 4; // high-res texels per mask texel, per axis
export const CHUNK_EDGE_RANGE = 3; // mask texels of border distance an edge value of 255 stands for

const CANDIDATE_RADIUS = 3; // mask texels searched for seeds that could own/border a texel
const MAX_CANDIDATES = 16;

/**
 * @param {{ mapW: number, mapH: number, seeds: {x:number,y:number}[], seedId: Int16Array,
 *   seedCell: Int16Array }} field - from CellField.buildCellField.
 * @returns {{ width: number, height: number, idTexture: THREE.DataTexture,
 *   edgeTexture: THREE.DataTexture, dispose(): void }}
 *   idTexture (nearest): R = chunk index, G = chunk across the nearest border.
 *   edgeTexture (linear): R = distance to that border, 0..CHUNK_EDGE_RANGE mask texels.
 */
export function buildChunkMap(field) {
    const { mapW, mapH, seeds, seedId, seedCell } = field;
    if (seeds.length > 256) throw new Error(`ChunkMap: ${seeds.length} seeds won't fit an 8-bit chunk index`);

    // Every seed whose raw Voronoi region reaches within CANDIDATE_RADIUS of each mask texel.
    // Voronoi regions are convex and these ones are several texels across, so the true owner
    // of any point - and every border within the encoded range - is always in this list.
    const candidates = new Int16Array(mapW * mapH * MAX_CANDIDATES).fill(-1);
    for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
            const base = (y * mapW + x) * MAX_CANDIDATES;
            let count = 0;
            for (let dy = -CANDIDATE_RADIUS; dy <= CANDIDATE_RADIUS && count < MAX_CANDIDATES; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= mapH) continue;
                for (let dx = -CANDIDATE_RADIUS; dx <= CANDIDATE_RADIUS; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= mapW) continue;
                    const s = seedId[ny * mapW + nx];
                    let seen = false;
                    for (let k = 0; k < count; k++) {
                        if (candidates[base + k] === s) { seen = true; break; }
                    }
                    if (!seen) {
                        candidates[base + count++] = s;
                        if (count >= MAX_CANDIDATES) break;
                    }
                }
            }
        }
    }

    const width = mapW * CHUNK_MAP_SCALE;
    const height = mapH * CHUNK_MAP_SCALE;
    const ids = new Uint8Array(width * height * 4);
    const edge = new Uint8Array(width * height);
    const edgeScale = 255 / CHUNK_EDGE_RANGE;

    for (let hy = 0; hy < height; hy++) {
        // Texel centre in mask-texel coordinates (mask texel centres sit on integers, which
        // is also where CellField placed the seeds and sampled its own assignment).
        const py = (hy + 0.5) / CHUNK_MAP_SCALE - 0.5;
        const ly = Math.min(mapH - 1, Math.max(0, Math.round(py)));
        for (let hx = 0; hx < width; hx++) {
            const px = (hx + 0.5) / CHUNK_MAP_SCALE - 0.5;
            const lx = Math.min(mapW - 1, Math.max(0, Math.round(px)));
            const base = (ly * mapW + lx) * MAX_CANDIDATES;

            let best = -1;
            let bestD = Infinity;
            for (let k = 0; k < MAX_CANDIDATES; k++) {
                const s = candidates[base + k];
                if (s < 0) break;
                const dx = px - seeds[s].x;
                const dy = py - seeds[s].y;
                const d = dx * dx + dy * dy;
                if (d < bestD) { bestD = d; best = s; }
            }
            const own = seedCell[best];
            const ax = seeds[best].x;
            const ay = seeds[best].y;

            // Distance to the chunk's border = distance to the nearest bisector against a seed
            // of a *different* chunk (borders between seeds a merge fused together don't exist).
            let border = Infinity;
            let across = own;
            for (let k = 0; k < MAX_CANDIDATES; k++) {
                const s = candidates[base + k];
                if (s < 0) break;
                const other = seedCell[s];
                if (other === own) continue;
                const bx = seeds[s].x;
                const by = seeds[s].y;
                const sep = Math.hypot(bx - ax, by - ay);
                if (sep <= 0) continue;
                const dbx = px - bx;
                const dby = py - by;
                const toBisector = (dbx * dbx + dby * dby - bestD) / (2 * sep);
                if (toBisector < border) { border = toBisector; across = other; }
            }

            const i = hy * width + hx;
            ids[i * 4] = own;
            ids[i * 4 + 1] = across;
            ids[i * 4 + 3] = 255;
            edge[i] = Math.min(255, Math.round(Math.max(0, border) * edgeScale));
        }
    }

    const idTexture = new THREE.DataTexture(ids, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    idTexture.minFilter = THREE.NearestFilter;
    idTexture.magFilter = THREE.NearestFilter;
    idTexture.needsUpdate = true;

    const edgeTexture = new THREE.DataTexture(edge, width, height, THREE.RedFormat, THREE.UnsignedByteType);
    edgeTexture.minFilter = THREE.LinearFilter;
    edgeTexture.magFilter = THREE.LinearFilter;
    edgeTexture.wrapS = THREE.ClampToEdgeWrapping;
    edgeTexture.wrapT = THREE.ClampToEdgeWrapping;
    edgeTexture.needsUpdate = true;

    return {
        width,
        height,
        idTexture,
        edgeTexture,
        dispose() {
            idTexture.dispose();
            edgeTexture.dispose();
        },
    };
}
