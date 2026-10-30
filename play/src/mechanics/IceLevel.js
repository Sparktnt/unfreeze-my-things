import * as THREE from '../../vendor/three/three.module.js';
import { loadTexture, loadImageElement } from '../engine/Assets.js';
import { buildCellField } from './CellField.js';
import { IceMask } from './IceMask.js';
import { buildObjectMask, buildIceShape } from './ObjectMask.js';
import { createIceMaterial, computeIceView, iceDepthForPlane, iceMeshMargin } from '../rendering/IceMaterial.js';
import { buildChunkMap } from '../rendering/ChunkMap.js';
import { generateRingTexture, generatePuddleTexture, generateCrackTexture, generateScorchTexture } from '../rendering/TextureGen.js';
import { ChipDebrisEmitter, DripEmitter, SteamEmitter } from './Particles.js';
import { easeOutCubic } from '../engine/Easing.js';
import { getSkin } from '../data/skins.js';

const MASK_RES_H = 170;
const TARGET_CELLS = 20; // chunks of ice on the object when a level doesn't say (levelDef.targetCells)
// Seeds are scattered over the whole photo and the ones off the object are dropped, so the
// seed count is scaled up by how little of the photo the ice covers. Capped because ChunkMap
// stores chunk indices in 8 bits (256 seeds), with headroom for the grid rounding up.
const MAX_SEEDS = 200;
// Tool power is a progression (see TOOL_UNLOCK_LEVEL in data/levels.js): the Hairdryer
// (level 3) has to out-clear the Pickaxe's one-chunk-per-tap, and the Scraper (level 7)
// has to out-clear the Hairdryer.
const MELT_RADIUS_MIN_UV = 0.1; // brush size right as the hold starts
const MELT_RADIUS_MAX_UV = 0.24; // brush size once fully ramped up
const MELT_RATE_MIN_MULT = 0.55; // melt speed right as the hold starts (fraction of MELT_RATE)
const MELT_RATE_MAX_MULT = 1.35; // melt speed once fully ramped up
const MELT_RAMP_SECONDS = 0.6; // how long a stationary hold takes to reach max radius/speed
// Ice units (0-255) removed per second at the brush centre. The brush falls off with the
// square of distance (IceMask.meltAt), so only the middle clears quickly: at 2000 a held
// brush opens roughly 10 chunks' worth a second, about double fast Pickaxe tapping.
const MELT_RATE = 2000;
// A level counts as cleared once the ice left is under this share of what it started with.
// It isn't a freebie: at this size the remainder is a scatter of sub-visible crumbs along
// melt-brush rims (see IceMask.meltAt) that a player can neither see nor aim at, and the
// smallest real cell is an order of magnitude bigger. Whatever's left is wiped outright
// when the threshold trips, so the win shot shows a genuinely bare object.
const CLEAR_TOLERANCE = 0.004;

// Purely cosmetic hairdryer-hold feedback - none of these touch mask/melt-rate math above.
const MELT_PULSE_RISE = 0.35; // seconds of continuous holding to reach full ripple strength
const MELT_PULSE_FALL = 0.25; // seconds to relax back once the finger lifts
const MELT_PUDDLE_THRESHOLD = 20; // of 255 - a spot below this "just finished melting" for the puddle flash

// Per-level bonus granted by each level of the matching Shop upgrade (see SaveManager).
const UPGRADE_RADIUS_STEP_UV = 0.02;
const UPGRADE_RATE_STEP_MULT = 0.15;
const UPGRADE_SCRAPE_RADIUS_STEP_UV = 0.02;
const UPGRADE_SCRAPE_RATE_STEP_MULT = 0.15;

// Hairdryer Overheat Mode: doubles melt radius/rate while active (state machine and timing
// live in HairdryerOverheat.js - IceLevel just reacts to setOverheat() every frame).
const OVERHEAT_MULT = 2;
const SCORCH_COLOR = new THREE.Color(0xff3b1f); // melt cursor tint as the Hairdryer is about to scorch bare object

// Ice Scraper: a wide, speed-gated swipe brush. Reuses IceMask.meltAt (same erosion primitive
// as the hairdryer) but shaped by swipe speed instead of hold duration, and scaled down on
// Deep Freeze (layers > 1) cells - as the last tool to unlock it's the strongest overall,
// but thick ice still takes a few passes.
const SCRAPE_MIN_SPEED = 200; // px/s - below this the swipe barely counts as a swipe, no damage
const SCRAPE_SPEED_FOR_MAX = 1400; // px/s - speed at which radius/effect saturates
const SCRAPE_RADIUS_MIN_UV = 0.08;
const SCRAPE_RADIUS_MAX_UV = 0.32; // wider than the hairdryer's brush - "wide hitbox"
// A fast swipe only has the brush over any one spot for ~0.15s, so this has to be far higher
// than MELT_RATE for a single pass to clear a wide band - a few swipes strip a whole level.
const SCRAPE_RATE = 9000;
const SCRAPE_THIN_MULT = 1.6; // effect on normal (layers === 1) ice - clears it fast
const SCRAPE_THICK_MULT = 0.35; // effect on Deep Freeze (layers > 1) ice - slower, not useless

// Frost Creep rule (levelDef.rule === 'refreeze'): every this many seconds one fully cleared
// chunk that still touches standing ice freezes over again. Slow enough that steady play
// always outpaces it, fast enough that stalling costs real progress.
const REFREEZE_INTERVAL = 3;

// Hidden bonus chunks (levelDef.bonusCells): a faint glint marks each one, and clearing the
// chunk under it pays out - see takeBonusEvents().
const BONUS_GLINT_SIZE = 26;

// The ice is drawn as a raised slab that shifts over the photo as the phone tilts (see
// rendering/IceMaterial.js), so "which ice is under the finger" means ray-marching the same
// slab the shader draws. This many steps (plus a bisection) is exact to well under a pixel.
const TAP_MARCH_STEPS = 24;

// Breaking your thing (see GameplayScreen's MAX_CRACKS): a spot only counts as bare object
// when every mask texel within this many of it is object with no ice - the same kind of
// grace _chunkHasIceNear gives a tap that only just misses a piece of ice.
const BARE_GRACE_TEXELS = 2;
// Ice within this many texels makes a bare spot "near ice" - along an ice edge or beside a
// small leftover patch, where the slab's tilt parallax makes a near-miss easy. GameplayScreen
// only scuffs the object there (two scuffs = one crack) instead of cracking it outright.
const NEAR_ICE_TEXELS = 8;
const CRACK_SIZE = 74; // world px across one crack/scorch decal
const SHATTER_CRACKS = 9; // decals splashed over the object when it breaks

/**
 * Owns the full "object encased in ice" presentation and interaction for one level:
 * procedural ice coverage (CellField + IceMask), the refracting slab shader
 * (IceMaterial + ChunkMap), tap-to-chip, and hold-to-melt-with-drips.
 */
export class IceLevel {
    constructor(group, audio, renderer) {
        this.group = group;
        this._audio = audio;
        this._renderer = renderer;
        this._mesh = null;
        this._material = null;
        this._mask = null;
        this._field = null;
        this._chunks = null;
        this._cellState = null; // per chunk (by seed index): cap, share still iced, Deep Freeze, random
        this._cellStateTexture = null;
        this._cellInitialIce = null;
        this._view = { eye: new THREE.Vector3(), light: new THREE.Vector3(), photoToWorld: new THREE.Matrix3() };
        this._iceDepth = 30;
        this._imgWidth = 1;
        this._debris = new ChipDebrisEmitter(group);
        this._drips = new DripEmitter(group);
        this._steam = new SteamEmitter(group);
        this._puddleTexture = generatePuddleTexture(64);
        this._puddles = [];

        this._ringTexture = generateRingTexture(128);
        const ringMat = new THREE.SpriteMaterial({
            map: this._ringTexture,
            color: 0xdff2ff,
            transparent: true,
            depthTest: false,
            opacity: 0,
        });
        this._meltCursor = new THREE.Sprite(ringMat);
        this._meltCursor.renderOrder = 8;
        this._meltCursor.visible = false;
        group.add(this._meltCursor);
        this._meltingThisFrame = false;
        this._meltPulse = 0;
        this._meltPoint = { x: -1e4, y: -1e4 }; // photo px (y down) of the ice being melted
        this._meltRadiusPx = 60;
        this._overheatActive = false;
        this._tilt = { x: 0, y: 0 };
        this._overheatVisual = 0; // smoothed 0..1, feeds uOverheat so the glow eases rather than snapping
        this._scrapeAccum = 0;
        this._progressAccum = 0;
        this._cachedProgress = 0;
        this._revealRings = [];
        this._impactFlashes = [];
        this._center = { x: 0, y: 0 };
        this._planeSize = { w: 1, h: 1 };
        this._time = 0;
        this.ready = false;
        this.totalPieces = 0;
        this._radiusBonusUv = 0;
        this._rateBonusMult = 0;
        this._scrapeRadiusBonusUv = 0;
        this._scrapeRateBonusMult = 0;
        this._rule = null;
        this._initialData = null;
        this._neighbours = null;
        this._refreezeTimer = 0;
        this._bonus = [];
        this._bonusEvents = [];
        this._objectMask = null;
        this._cracks = []; // { sprite, mat, tex, u, vTop, t, size, shatter }
        this._scorchWarn = 0;
    }

    /** Applies Shop-purchased tool upgrade levels (0..max each) to the melt/scrape brushes. */
    setUpgrades({ meltRadius = 0, meltRate = 0, scrapeRadius = 0, scrapeRate = 0 } = {}) {
        this._radiusBonusUv = meltRadius * UPGRADE_RADIUS_STEP_UV;
        this._rateBonusMult = meltRate * UPGRADE_RATE_STEP_MULT;
        this._scrapeRadiusBonusUv = scrapeRadius * UPGRADE_SCRAPE_RADIUS_STEP_UV;
        this._scrapeRateBonusMult = scrapeRate * UPGRADE_SCRAPE_RATE_STEP_MULT;
    }

    /** Device tilt, -1..1 per axis (see engine/DeviceTilt.js). Swings the view into the ice
     *  slab, so turning the phone slides the ice over the picture beneath it. Never touches
     *  the mask, though it does move where on the ice a tap lands (see _screenToIce). */
    /** Ice skin for the next load() - an entry from data/skins.js. */
    setSkin(skin) {
        this._skin = skin;
    }

    setTilt(x, y) {
        this._tilt.x = x;
        this._tilt.y = y;
    }

    /** Called every frame by GameplayScreen from its HairdryerOverheat state machine.
     *  While active, tryMelt()'s radius/rate are doubled and the shader/cursor/steam glow red. */
    setOverheat(active) {
        this._overheatActive = !!active;
    }

    async load(levelDef, { centerX, centerY, maxWidth, maxHeight }) {
        this._disposeLevelResources();

        const [texture, imgEl] = await Promise.all([
            loadTexture(levelDef.image),
            loadImageElement(levelDef.image),
        ]);

        const aspect = imgEl.width / imgEl.height;
        this._imgAspect = aspect;
        this._imgWidth = imgEl.width;

        const mapH = MASK_RES_H;
        const mapW = Math.round(mapH * aspect);

        const canvas = document.createElement('canvas');
        canvas.width = imgEl.width;
        canvas.height = imgEl.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const objectMask = buildObjectMask(imageData, mapW, mapH);
        this._objectMask = objectMask;
        const shape = buildIceShape(objectMask, mapW, mapH);
        const reinforcedFraction = levelDef.deepFreeze ?? 0.05;
        let iced = 0;
        for (let i = 0; i < shape.mask.length; i++) if (shape.mask[i]) iced++;
        const coverage = Math.max(iced / shape.mask.length, 0.05);
        const seedCount = Math.min(MAX_SEEDS, Math.round((levelDef.targetCells || TARGET_CELLS) / coverage));
        this._field = buildCellField(imageData, mapW, mapH, seedCount, shape.mask, reinforcedFraction);
        this.totalPieces = this._field.cells.length;
        this._mask = new IceMask(mapW, mapH, shape.mask, shape.sdf);
        this._chunks = buildChunkMap(this._field);
        this._buildCellState();

        this._rule = levelDef.rule || null;
        this._refreezeTimer = 0;
        this._initialData = Uint8Array.from(this._mask.data);
        this._buildNeighbours();
        this._placeBonuses(levelDef.bonusCells || 0);

        this._material = createIceMaterial({
            objectTexture: texture,
            maskTexture: this._mask.texture,
            chunkIdTexture: this._chunks.idTexture,
            chunkEdgeTexture: this._chunks.edgeTexture,
            cellStateTexture: this._cellStateTexture,
            mapWidth: mapW,
            mapHeight: mapH,
            chunkWidth: this._chunks.width,
            chunkHeight: this._chunks.height,
            skin: this._skin || getSkin('classic'),
        });

        const geo = new THREE.PlaneGeometry(1, 1);
        this._mesh = new THREE.Mesh(geo, this._material);
        this.group.add(this._mesh);
        this._applyLayout({ centerX, centerY, maxWidth, maxHeight });
        this._updateView();

        this._progressAccum = 0;
        this._cachedProgress = 0;
        this.ready = true;
    }

    /** Cheap re-layout on resize/orientation change - keeps all ice progress intact. */
    resize(layout) {
        if (!this.ready) return;
        this._applyLayout(layout);
    }

    /** Fits the photo into the layout box and sizes everything that's measured in screen px:
     *  the slab's thickness, the mesh (which overhangs the photo so the slab can lean out past
     *  it), and the shader's sampling scales. */
    _applyLayout({ centerX, centerY, maxWidth, maxHeight }) {
        let w = maxWidth;
        let h = w / this._imgAspect;
        if (h > maxHeight) {
            h = maxHeight;
            w = h * this._imgAspect;
        }
        this._planeSize = { w, h };
        this._center = { x: centerX, y: centerY };
        this._iceDepth = iceDepthForPlane(w);
        const margin = iceMeshMargin(this._iceDepth);

        this._mesh.scale.set(w + margin * 2, h + margin * 2, 1);
        this._mesh.position.set(centerX, centerY, 0);

        const pixelRatio = this._renderer?.getPixelRatio() || 1;
        const u = this._material.uniforms;
        u.uPlaneSize.value.set(w, h);
        u.uMeshSize.value.set(w + margin * 2, h + margin * 2);
        u.uIceDepth.value = this._iceDepth;
        u.uPx.value = 1 / pixelRatio;
        u.uPhotoTexel.value = w / this._imgWidth;
        u.uPhotoLod.value = Math.max(0, Math.log2(this._imgWidth / (w * pixelRatio)));
    }

    /** Per-chunk state the shader reads by chunk index: R = how much of the chunk the pickaxe
     *  has left standing (Deep Freeze steps down through it), G = share of its ice still
     *  there (so a melted-away neighbour counts as open), B = Deep Freeze, A = a random
     *  value that gives each chunk its own facet angle. */
    _buildCellState() {
        const { seeds, cells, cellId } = this._field;
        const count = seeds.length;
        this._cellState = new Uint8Array(count * 4);
        this._cellInitialIce = new Float64Array(count);
        for (let i = 0; i < cellId.length; i++) this._cellInitialIce[cellId[i]] += this._mask.data[i];
        for (const cell of cells) {
            const o = cell.index * 4;
            this._cellState[o] = 255;
            this._cellState[o + 1] = 255;
            this._cellState[o + 2] = cell.layers > 1 ? 255 : 0;
            this._cellState[o + 3] = Math.floor(Math.random() * 256);
        }
        this._cellStateTexture = new THREE.DataTexture(this._cellState, count, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
        this._cellStateTexture.minFilter = THREE.NearestFilter;
        this._cellStateTexture.magFilter = THREE.NearestFilter;
        this._cellStateTexture.needsUpdate = true;
        this._cellRemaining = new Float64Array(count);
    }

    _refreshCellPresence() {
        const { cellId } = this._field;
        const sums = this._cellRemaining;
        sums.fill(0);
        for (let i = 0; i < cellId.length; i++) sums[cellId[i]] += this._mask.data[i];
        for (let c = 0; c < sums.length; c++) {
            const initial = this._cellInitialIce[c];
            this._cellState[c * 4 + 1] = initial > 0 ? Math.round((sums[c] / initial) * 255) : 0;
        }
        this._cellStateTexture.needsUpdate = true;

        for (const bonus of this._bonus) {
            if (bonus.collected || this._cellState[bonus.cell.index * 4 + 1] > 5) continue;
            bonus.collected = true;
            this.group.remove(bonus.sprite);
            bonus.sprite.material.dispose();
            this._bonusEvents.push(this._localUvToWorld(bonus.cell.centroidU, bonus.cell.centroidV));
        }
    }

    /** Which chunks touch which, through ice - Frost Creep only regrows a chunk next to
     *  ice that's still standing, so the frost visibly creeps back in from the edges. */
    _buildNeighbours() {
        const { cellId, mapW, mapH } = this._field;
        const data = this._initialData;
        this._neighbours = new Map();
        const link = (a, b) => {
            if (a === b) return;
            if (!this._neighbours.has(a)) this._neighbours.set(a, new Set());
            this._neighbours.get(a).add(b);
        };
        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                const i = y * mapW + x;
                if (!data[i]) continue;
                if (x + 1 < mapW && data[i + 1]) { link(cellId[i], cellId[i + 1]); link(cellId[i + 1], cellId[i]); }
                if (y + 1 < mapH && data[i + mapW]) { link(cellId[i], cellId[i + mapW]); link(cellId[i + mapW], cellId[i]); }
            }
        }
    }

    _placeBonuses(count) {
        const pool = this._field.cells.slice();
        for (let n = 0; n < count && pool.length; n++) {
            const cell = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
            const mat = new THREE.SpriteMaterial({
                map: this._puddleTexture,
                color: 0xffd23a,
                transparent: true,
                depthTest: false,
                opacity: 0,
            });
            const sprite = new THREE.Sprite(mat);
            sprite.renderOrder = 9;
            this.group.add(sprite);
            this._bonus.push({ cell, sprite, collected: false, phase: Math.random() * 6 });
        }
    }

    /** World positions of bonus chunks cleared since the last call (GameplayScreen pays out). */
    takeBonusEvents() {
        return this._bonusEvents.splice(0);
    }

    /** Frost Creep: refreezes one bare chunk bordering standing ice. */
    _refreezeOne() {
        const hasIce = (c) => this._cellState[c * 4 + 1] > 0;
        const candidates = this._field.cells.filter((cell) => {
            if (hasIce(cell.index)) return false;
            for (const n of this._neighbours.get(cell.index) || []) if (hasIce(n)) return true;
            return false;
        });
        if (!candidates.length) return;
        const cell = candidates[Math.floor(Math.random() * candidates.length)];
        this._mask.restoreCell(this._field, cell.index, this._initialData);
        this._cellState[cell.index * 4] = 255;
        this._refreshCellPresence();
        const world = this._localUvToWorld(cell.centroidU, cell.centroidV);
        this._spawnImpactFlash(world.x, world.y);
    }

    _updateView() {
        computeIceView(this._tilt.x, this._tilt.y, this._planeSize.w, this._planeSize.h, this._view);
        const u = this._material.uniforms;
        u.uEyePos.value.copy(this._view.eye);
        u.uLightDir.value.copy(this._view.light);
        u.uPhotoToWorld.value.copy(this._view.photoToWorld);
    }

    /**
     * The ice visible at a world-space point: follows the view ray from the slab's top down
     * through the same surface the shader draws, and returns where it meets the ice (or, if
     * it finds none, the bare photo point straight under the finger).
     * @returns {{ u: number, vTop: number, x: number, y: number } | null} photo UV (v from
     *   the top) and photo px, or null when the point is off the photo entirely.
     */
    _screenToIce(worldX, worldY) {
        const { w, h } = this._planeSize;
        const { mapW, mapH } = this._mask;
        const sx = worldX - this._center.x + w / 2;
        const sy = h / 2 - (worldY - this._center.y);
        const T = this._iceDepth;
        const eye = this._view.eye;
        const ex = (eye.x - sx) / eye.z;
        const ey = (eye.y - sy) / eye.z;
        const heightAt = (z) => T * this._mask.surfaceHeightAt(
            ((sx + ex * z) / w) * mapW - 0.5,
            ((sy + ey * z) / h) * mapH - 0.5,
        );

        let hitZ = 0;
        if (heightAt(T) >= T * 0.999) {
            hitZ = T;
        } else {
            let zAbove = T;
            for (let i = 1; i <= TAP_MARCH_STEPS; i++) {
                const z = T * (1 - i / TAP_MARCH_STEPS);
                const hz = heightAt(z);
                if (hz >= z && hz > 0.01 * T) {
                    let lo = z;
                    let hi = zAbove;
                    for (let j = 0; j < 8; j++) {
                        const mid = (lo + hi) / 2;
                        if (heightAt(mid) >= mid) lo = mid; else hi = mid;
                    }
                    hitZ = (lo + hi) / 2;
                    break;
                }
                zAbove = z;
            }
        }

        const x = sx + ex * hitZ;
        const y = sy + ey * hitZ;
        const u = x / w;
        const vTop = y / h;
        if (u < 0 || u > 1 || vTop < 0 || vTop > 1) return null;
        return { u, vTop, x, y };
    }

    /** The chunk at a photo point, by the same exact nearest-seed test ChunkMap draws the
     *  chunk borders with - so a tap takes the piece it visibly landed on, even right at a
     *  border, rather than whichever piece owns the nearest mask texel. */
    _chunkAt(u, vTop) {
        const { seeds, seedCell, mapW, mapH } = this._field;
        const px = u * mapW - 0.5;
        const py = vTop * mapH - 0.5;
        let best = 0;
        let bestD = Infinity;
        for (let s = 0; s < seeds.length; s++) {
            const d = (px - seeds[s].x) ** 2 + (py - seeds[s].y) ** 2;
            if (d < bestD) { bestD = d; best = s; }
        }
        return seedCell[best];
    }

    /** Whether a chunk still has ice within a mask texel of a photo point. The renderer blends
     *  between texels, so the ice drawn along a piece's rim can sit over a texel that's already
     *  bare - a tap there should still count. */
    _chunkHasIceNear(cellIndex, u, vTop) {
        const { cellId, mapW, mapH } = this._field;
        const tx = Math.min(mapW - 1, Math.floor(u * mapW));
        const ty = Math.min(mapH - 1, Math.floor(vTop * mapH));
        for (let y = Math.max(0, ty - 1); y <= Math.min(mapH - 1, ty + 1); y++) {
            for (let x = Math.max(0, tx - 1); x <= Math.min(mapW - 1, tx + 1); x++) {
                const i = y * mapW + x;
                if (cellId[i] === cellIndex && this._mask.data[i] >= 10) return true;
            }
        }
        return false;
    }

    _localUvToWorld(u, vTop) {
        const v = 1 - vTop;
        return {
            x: this._center.x + (u - 0.5) * this._planeSize.w,
            y: this._center.y + (v - 0.5) * this._planeSize.h,
        };
    }

    /** Tap: chip away the ice cell under the tap point, if it still has ice. Returns true if it did something.
     *  `comboStreak` (1 = no streak) scales the debris burst and the pop's pitch for consecutive quick chips. */
    tryChip(worldX, worldY, comboStreak = 1) {
        if (!this.ready) return false;
        const uv = this._screenToIce(worldX, worldY);
        if (!uv) return false;

        const cellIndex = this._chunkAt(uv.u, uv.vTop);
        if (!this._chunkHasIceNear(cellIndex, uv.u, uv.vTop)) {
            this._audio.playWhiff();
            return false; // already bare here
        }

        const cell = this._field.cells.find((c) => c.index === cellIndex);
        const layers = cell?.layers || 1;

        const capIdx = cellIndex * 4;
        if (layers > 1) {
            // Deep Freeze: one even step per layer (255/3 => 3 taps stepping through
            // unbroken -> cracked -> deeply shattered -> destroyed; see IceMaterial.js
            // for how those tiers are actually shaded).
            const step = Math.ceil(255 / layers);
            this._mask.chipCellStep(this._field, cellIndex, step);
            this._cellState[capIdx] = Math.max(0, this._cellState[capIdx] - step);
        } else {
            this._mask.chipCell(this._field, cellIndex);
            this._cellState[capIdx] = 0;
        }
        this._refreshCellPresence();

        // Shatter impact lands exactly under the tap, not the cell's centroid - reads as a
        // real pickaxe hit rather than a delayed pop somewhere else on the ice.
        this._debris.burst(worldX, worldY, 8 + Math.min(comboStreak - 1, 8));
        this._spawnImpactFlash(worldX, worldY);
        this._audio.playChip(comboStreak);
        return true;
    }

    /** Quick expanding+fading ring flash at the exact impact point - the "shatter" beat
     *  for a pickaxe hit, distinct from the slower level-complete revealBurst() rings. */
    _spawnImpactFlash(worldX, worldY) {
        const mat = new THREE.SpriteMaterial({
            map: this._ringTexture,
            color: 0xffffff,
            transparent: true,
            depthTest: false,
            opacity: 0.95,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 12;
        sprite.position.set(worldX, worldY, 2.2);
        this.group.add(sprite);
        this._impactFlashes.push({ sprite, mat, t: 0, dur: 0.16, maxSize: 46 });
    }

    /** Hold: continuously melt around the finger and spawn drips. Radius and speed both
     *  ramp up the longer the hold has lasted, so lingering melts a wider, faster puddle.
     *  (Melt-rate/radius math below is untouched - only cosmetic feedback was added.) */
    tryMelt(worldX, worldY, dt, holdDuration = 0) {
        if (!this.ready) return false;
        const uv = this._screenToIce(worldX, worldY);
        if (!uv) return false;

        const rampT = easeOutCubic(Math.min(holdDuration / MELT_RAMP_SECONDS, 1));
        let radius = MELT_RADIUS_MIN_UV + (MELT_RADIUS_MAX_UV + this._radiusBonusUv - MELT_RADIUS_MIN_UV) * rampT;
        let rateMult = MELT_RATE_MIN_MULT + (MELT_RATE_MAX_MULT + this._rateBonusMult - MELT_RATE_MIN_MULT) * rampT;

        // Overheat Mode: doubles both, on top of the existing ramp above (untouched).
        if (this._overheatActive) {
            radius *= OVERHEAT_MULT;
            rateMult *= OVERHEAT_MULT;
        }

        // Sampled purely for the puddle-flash visual below - read-only, doesn't affect the melt itself.
        const centerIdx = Math.min(this._mask.mapH - 1, Math.floor(uv.vTop * this._mask.mapH)) * this._mask.mapW +
            Math.min(this._mask.mapW - 1, Math.floor(uv.u * this._mask.mapW));
        const iceBefore = this._mask.data[centerIdx];

        this._mask.meltAt(uv.u, uv.vTop, radius, MELT_RATE * rateMult * dt);

        // The exact spot under the brush just finished melting through - flash a quick
        // flat puddle there before the shard/reveal visuals move on.
        if (iceBefore > MELT_PUDDLE_THRESHOLD && this._mask.data[centerIdx] <= MELT_PUDDLE_THRESHOLD) {
            this._spawnPuddle(worldX, worldY);
        }

        this._drips.maybeSpawn(worldX, worldY, dt);
        this._steam.maybeSpawn(worldX, worldY, dt, this._overheatActive);
        if (Math.random() < 0.35) this._audio.playMeltTick();

        // Feeds the shader's localized ripple (uMeltPoint/uMeltPulse) in update() - purely
        // cosmetic, doesn't touch the mask/melt math above.
        this._meltPoint.x = uv.x;
        this._meltPoint.y = uv.y;
        this._meltRadiusPx = radius * this._planeSize.w;

        const worldDiameter = radius * this._planeSize.w * 2;
        this._meltCursor.position.set(worldX, worldY, 1);
        this._meltCursor.scale.set(worldDiameter, worldDiameter, 1);
        this._meltCursor.material.color.setHex(this._overheatActive ? 0xff6a3d : 0xdff2ff);
        if (this._scorchWarn > 0) this._meltCursor.material.color.lerp(SCORCH_COLOR, this._scorchWarn);
        this._meltCursor.material.opacity = 0.55 + 0.25 * rampT;
        this._meltCursor.visible = true;
        this._meltingThisFrame = true;
        return true;
    }

    /** Swipe: the Ice Scraper's wide, speed-gated brush. Reuses the same erosion primitive
     *  as tryMelt() (IceMask.meltAt) but shaped by swipe speed rather than hold duration, and
     *  scaled down on Deep Freeze (layers > 1) cells (SCRAPE_THICK_MULT). `speed` is in px/s (see GameplayScreen, which tracks
     *  consecutive hold-position deltas to compute it - InputHandler only tracks tap/hold). */
    tryScrape(worldX, worldY, dt, speed = 0) {
        if (!this.ready) return false;
        const uv = this._screenToIce(worldX, worldY);
        if (!uv) return false;

        const speedT = Math.min(Math.max(speed - SCRAPE_MIN_SPEED, 0) / (SCRAPE_SPEED_FOR_MAX - SCRAPE_MIN_SPEED), 1);
        const radius = SCRAPE_RADIUS_MIN_UV + (SCRAPE_RADIUS_MAX_UV + this._scrapeRadiusBonusUv - SCRAPE_RADIUS_MIN_UV) * Math.max(speedT, 0.15);

        // Cursor shows the (wide) hitbox even below the swipe-speed threshold, so the
        // player can see it before committing to a fast pass - but see the early return
        // below, no ice actually erodes until the swipe is fast enough.
        this._meltPoint.x = uv.x;
        this._meltPoint.y = uv.y;
        this._meltRadiusPx = radius * this._planeSize.w;
        this._meltCursor.position.set(worldX, worldY, 1);
        const worldDiameter = radius * this._planeSize.w * 2;
        this._meltCursor.scale.set(worldDiameter, worldDiameter, 1);
        this._meltCursor.material.color.setHex(0xd8ffea);
        this._meltCursor.material.opacity = 0.3 + 0.35 * speedT;
        this._meltCursor.visible = true;
        this._meltingThisFrame = true;

        if (speed < SCRAPE_MIN_SPEED) return false; // holding still does nothing - this is a swipe tool

        const cellIndex = this._chunkAt(uv.u, uv.vTop);
        const cell = this._field.cells.find((c) => c.index === cellIndex);
        const tierMult = (cell?.layers || 1) > 1 ? SCRAPE_THICK_MULT : SCRAPE_THIN_MULT;

        this._mask.meltAt(uv.u, uv.vTop, radius, SCRAPE_RATE * (1 + this._scrapeRateBonusMult) * speedT * tierMult * dt);

        this._scrapeAccum += dt;
        if (this._scrapeAccum > 0.07) {
            this._scrapeAccum = 0;
            this._debris.burst(worldX, worldY, 2);
        }
        if (Math.random() < 0.5) this._audio.playScrape();
        return true;
    }

    /** Quick flat "puddle" flash - the visual beat right as a spot under the hairdryer
     *  finishes melting through, before the reveal underneath takes over. */
    _spawnPuddle(worldX, worldY) {
        const mat = new THREE.SpriteMaterial({
            map: this._puddleTexture,
            color: 0xdff2ff,
            transparent: true,
            depthTest: false,
            opacity: 0,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 7; // under debris/impact flashes, above the ice mesh itself
        const size = 20 + Math.random() * 10;
        sprite.scale.set(size * 1.5, size * 0.6, 1); // flattened footprint reads as a puddle, not a droplet
        sprite.position.set(worldX, worldY, 0.4);
        this.group.add(sprite);
        this._puddles.push({ sprite, mat, t: 0, dur: 0.55 });
    }

    /** Called every frame by GameplayScreen while the Hairdryer sits on bare object: 0..1,
     *  tints the melt cursor from ice-white to red as a scorch gets close. */
    setScorchWarning(amount) {
        this._scorchWarn = Math.max(0, Math.min(1, amount));
    }

    /** Where a world point hits the bare object - on the thing itself, with no ice right
     *  under it. Returns the photo point ({ u, vTop, nearIce }) or null for ice, backdrop, or
     *  the object's very edge; `nearIce` is true when ice is still close by (NEAR_ICE_TEXELS).
     *  A Pickaxe tap or a long Hairdryer hold here damages the object. */
    bareObjectAt(worldX, worldY) {
        if (!this.ready) return null;
        const uv = this._screenToIce(worldX, worldY);
        if (!uv) return null;
        const { mapW, mapH, data } = this._mask;
        const tx = Math.min(mapW - 1, Math.floor(uv.u * mapW));
        const ty = Math.min(mapH - 1, Math.floor(uv.vTop * mapH));
        for (let y = ty - BARE_GRACE_TEXELS; y <= ty + BARE_GRACE_TEXELS; y++) {
            for (let x = tx - BARE_GRACE_TEXELS; x <= tx + BARE_GRACE_TEXELS; x++) {
                if (x < 0 || y < 0 || x >= mapW || y >= mapH) return null;
                const i = y * mapW + x;
                if (!this._objectMask[i] || data[i] >= 10) return null;
            }
        }
        let nearIce = false;
        for (let y = Math.max(0, ty - NEAR_ICE_TEXELS); y <= Math.min(mapH - 1, ty + NEAR_ICE_TEXELS) && !nearIce; y++) {
            for (let x = Math.max(0, tx - NEAR_ICE_TEXELS); x <= Math.min(mapW - 1, tx + NEAR_ICE_TEXELS); x++) {
                if (data[y * mapW + x] >= 10) { nearIce = true; break; }
            }
        }
        return { ...uv, nearIce };
    }

    /** Leaves a crack (or, for the Hairdryer, a scorch mark) on the object at a photo point.
     *  It stays for the rest of the level. */
    addCrack({ u, vTop }, kind = 'crack', { size = CRACK_SIZE, shatter = false } = {}) {
        const tex = kind === 'scorch' ? generateScorchTexture(128) : generateCrackTexture(128);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, rotation: Math.random() * Math.PI * 2 });
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 9;
        this.group.add(sprite);
        this._cracks.push({ sprite, mat, tex, u, vTop, t: 0, size, shatter });
        const world = this._localUvToWorld(u, vTop);
        this._debris.burst(world.x, world.y, kind === 'scorch' ? 4 : 10);
        this._spawnImpactFlash(world.x, world.y);
    }

    _removeCrack(crack) {
        this.group.remove(crack.sprite);
        crack.mat.dispose();
        crack.tex.dispose();
        this._cracks.splice(this._cracks.indexOf(crack), 1);
    }

    /** The object breaks: big cracks splash across the whole thing, with flying shards and a
     *  flash. Undone by repair(). */
    shatter() {
        if (!this.ready) return;
        const { mapW, mapH } = this._mask;
        const spots = [];
        for (let i = 0; i < this._objectMask.length; i += 7) if (this._objectMask[i]) spots.push(i);
        for (let n = 0; n < SHATTER_CRACKS && spots.length; n++) {
            const i = spots[Math.floor(Math.random() * spots.length)];
            const uv = { u: ((i % mapW) + 0.5) / mapW, vTop: (Math.floor(i / mapW) + 0.5) / mapH };
            this.addCrack(uv, 'crack', { size: CRACK_SIZE * (1.4 + Math.random() * 0.8), shatter: true });
        }
        this.revealBurst();
    }

    /** Continue after a break: clears the shatter and mends the newest real crack. */
    repair() {
        for (const crack of this._cracks.filter((c) => c.shatter)) this._removeCrack(crack);
        const last = this._cracks[this._cracks.length - 1];
        if (last) {
            const world = this._localUvToWorld(last.u, last.vTop);
            this._removeCrack(last);
            this._debris.burst(world.x, world.y, 14);
        }
    }

    /** Fires two expanding, fading rings from the plane's center - the "reveal" beat played
     *  once the object is fully uncovered, before the level-clear panel appears. */
    revealBurst() {
        if (!this.ready) return;
        const maxSize = Math.max(this._planeSize.w, this._planeSize.h) * 1.7;
        for (let i = 0; i < 2; i++) {
            const mat = new THREE.SpriteMaterial({
                map: this._ringTexture,
                color: 0xfff3d0,
                transparent: true,
                depthTest: false,
                opacity: 0.9,
            });
            const sprite = new THREE.Sprite(mat);
            sprite.renderOrder = 11;
            sprite.position.set(this._center.x, this._center.y, 1.5);
            this.group.add(sprite);
            this._revealRings.push({ sprite, mat, t: -i * 0.16, dur: 0.85, maxSize });
        }
    }

    /** Spends a hint charge (caller checks/deducts availability): fully clears the iciest
     *  remaining cell. Returns false if there's nothing left to clear. */
    useHint() {
        if (!this.ready) return false;
        const { cellId } = this._field;
        const sums = new Map();
        for (let i = 0; i < cellId.length; i++) {
            const v = this._mask.data[i];
            if (v <= 0) continue;
            const c = cellId[i];
            sums.set(c, (sums.get(c) || 0) + v);
        }
        let bestCell = -1;
        let bestSum = -1;
        for (const [c, sum] of sums) {
            if (sum > bestSum) { bestSum = sum; bestCell = c; }
        }
        if (bestCell < 0) return false;

        this._mask.chipCell(this._field, bestCell);
        this._cellState[bestCell * 4] = 0;
        this._refreshCellPresence();
        const cell = this._field.cells.find((c) => c.index === bestCell);
        if (cell) {
            const world = this._localUvToWorld(cell.centroidU, cell.centroidV);
            this._debris.burst(world.x, world.y, 14);
        }
        this._audio.playHint();
        return true;
    }

    update(dt) {
        this._time += dt;
        this._debris.update(dt);
        this._drips.update(dt);
        this._steam.update(dt);

        if (this._puddles.length) {
            for (let i = this._puddles.length - 1; i >= 0; i--) {
                const p = this._puddles[i];
                p.t += dt;
                const t = Math.min(p.t / p.dur, 1);
                // Quick fade in, then out - a brief flat gleam, not a lingering mark.
                const alpha = t < 0.3 ? (t / 0.3) * 0.85 : 0.85 * (1 - (t - 0.3) / 0.7);
                p.sprite.material.opacity = Math.max(0, alpha);
                if (t >= 1) {
                    this.group.remove(p.sprite);
                    p.mat.dispose();
                    this._puddles.splice(i, 1);
                }
            }
        }

        if (this._revealRings.length) {
            for (let i = this._revealRings.length - 1; i >= 0; i--) {
                const ring = this._revealRings[i];
                ring.t += dt;
                if (ring.t < 0) continue; // still waiting on its stagger delay
                const t = Math.min(ring.t / ring.dur, 1);
                const eased = easeOutCubic(t);
                const startSize = Math.max(this._planeSize.w, this._planeSize.h) * 0.1;
                const size = startSize + (ring.maxSize - startSize) * eased;
                ring.sprite.scale.set(size, size, 1);
                ring.sprite.material.opacity = 0.9 * (1 - t);
                if (t >= 1) {
                    this.group.remove(ring.sprite);
                    ring.mat.dispose();
                    this._revealRings.splice(i, 1);
                }
            }
        }

        if (this._impactFlashes.length) {
            for (let i = this._impactFlashes.length - 1; i >= 0; i--) {
                const flash = this._impactFlashes[i];
                flash.t += dt;
                const t = Math.min(flash.t / flash.dur, 1);
                const eased = easeOutCubic(t);
                const startSize = flash.maxSize * 0.25;
                const size = startSize + (flash.maxSize - startSize) * eased;
                flash.sprite.scale.set(size, size, 1);
                flash.sprite.material.opacity = 0.95 * (1 - t);
                if (t >= 1) {
                    this.group.remove(flash.sprite);
                    flash.mat.dispose();
                    this._impactFlashes.splice(i, 1);
                }
            }
        }

        for (const crack of this._cracks) {
            crack.t += dt;
            // pops in slightly oversized, then settles - a crack that "lands" rather than appears
            const pop = crack.t < 0.18 ? 1.25 - 0.25 * (crack.t / 0.18) : 1;
            const world = this._localUvToWorld(crack.u, crack.vTop);
            crack.sprite.position.set(world.x, world.y, 0.5);
            crack.sprite.scale.set(crack.size * pop, crack.size * pop, 1);
        }

        if (this._meltingThisFrame) {
            this._meltPulse = Math.min(1, this._meltPulse + dt / MELT_PULSE_RISE);
        } else {
            this._meltCursor.visible = false;
            this._meltPulse = Math.max(0, this._meltPulse - dt / MELT_PULSE_FALL);
        }
        this._meltingThisFrame = false;

        // Eased toward the raw on/off overheat flag rather than snapping, so the shader's
        // red-hot tint fades in/out instead of popping.
        const overheatTarget = this._overheatActive ? 1 : 0;
        this._overheatVisual += (overheatTarget - this._overheatVisual) * Math.min(1, dt * 6);

        for (const bonus of this._bonus) {
            if (bonus.collected) continue;
            const world = this._localUvToWorld(bonus.cell.centroidU, bonus.cell.centroidV);
            const pulse = 0.5 + 0.5 * Math.sin(this._time * 3 + bonus.phase);
            const size = BONUS_GLINT_SIZE * (0.8 + 0.4 * pulse);
            bonus.sprite.position.set(world.x, world.y, 0.6);
            bonus.sprite.scale.set(size, size, 1);
            bonus.sprite.material.opacity = 0.35 + 0.55 * pulse;
        }

        if (this.ready && this._rule === 'refreeze' && this._cachedProgress > 0 && this._cachedProgress < 1) {
            this._refreezeTimer += dt;
            if (this._refreezeTimer >= REFREEZE_INTERVAL) {
                this._refreezeTimer = 0;
                this._refreezeOne();
            }
        }

        if (this.ready) {
            const u = this._material.uniforms;
            u.uTime.value = this._time;
            u.uMeltPoint.value.set(this._meltPoint.x, this._meltPoint.y);
            u.uMeltRadius.value = this._meltRadiusPx;
            u.uMeltPulse.value = this._meltPulse;
            u.uOverheat.value = this._overheatVisual;
            this._updateView();
            this._mask.flushToGPU();

            this._progressAccum += dt;
            if (this._progressAccum > 0.15) {
                this._progressAccum = 0;
                const remaining = this._mask.remainingFraction();
                if (remaining > 0 && remaining <= CLEAR_TOLERANCE) {
                    this._mask.sweepResidue();
                    this._cachedProgress = 1;
                } else {
                    this._cachedProgress = 1 - remaining;
                }
                this._refreshCellPresence();
            }
        }
    }

    get progress() {
        return this._cachedProgress;
    }

    get planeSize() {
        return this._planeSize;
    }

    get isCleared() {
        return this.ready && this._cachedProgress >= 1;
    }

    /** Frees the previous level's mesh/material/mask before a new one is built (does NOT touch the particle pools). */
    _disposeLevelResources() {
        for (const ring of this._revealRings) {
            this.group.remove(ring.sprite);
            ring.mat.dispose();
        }
        this._revealRings.length = 0;

        for (const flash of this._impactFlashes) {
            this.group.remove(flash.sprite);
            flash.mat.dispose();
        }
        this._impactFlashes.length = 0;

        for (const puddle of this._puddles) {
            this.group.remove(puddle.sprite);
            puddle.mat.dispose();
        }
        this._puddles.length = 0;
        this._meltPulse = 0;

        for (const bonus of this._bonus) {
            if (bonus.collected) continue;
            this.group.remove(bonus.sprite);
            bonus.sprite.material.dispose();
        }
        this._bonus.length = 0;
        this._bonusEvents.length = 0;

        while (this._cracks.length) this._removeCrack(this._cracks[0]);
        this._scorchWarn = 0;

        if (this._mesh) {
            this.group.remove(this._mesh);
            this._mesh.geometry.dispose();
            this._mesh = null;
        }
        this._material?.dispose();
        this._material = null;
        this._mask?.dispose();
        this._mask = null;
        this._chunks?.dispose();
        this._chunks = null;
        this._cellStateTexture?.dispose();
        this._cellStateTexture = null;
        this.ready = false;
    }

    dispose() {
        this._disposeLevelResources();
        this._debris.dispose();
        this._drips.dispose();
        this._steam.dispose();
        this._puddleTexture.dispose();
        this._meltCursor.material.dispose();
        this._ringTexture.dispose();
        this.ready = false;
    }
}
