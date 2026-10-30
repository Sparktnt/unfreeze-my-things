import * as THREE from '../../vendor/three/three.module.js';
import { generateDropletTexture, generateSteamTexture } from '../rendering/TextureGen.js';

const GRAVITY = 2800; // px/s^2, matches PuzzlePiece.cs

/**
 * Small pooled shard burst spawned when a chip of ice breaks off - ported from the
 * physics in Mechanics/PuzzlePiece.cs (upward pop, gravity, rotation, shrink + fade).
 */
export class ChipDebrisEmitter {
    constructor(group, maxShards = 32) {
        this._texture = generateDropletTexture(48);
        this._pool = [];
        for (let i = 0; i < maxShards; i++) {
            const mat = new THREE.SpriteMaterial({ map: this._texture, color: 0xdff2ff, transparent: true, depthTest: false });
            const sprite = new THREE.Sprite(mat);
            sprite.visible = false;
            sprite.renderOrder = 10;
            group.add(sprite);
            this._pool.push({ sprite, mat, active: false, t: 0, dur: 0.6, vx: 0, vy: 0, rot: 0, baseSize: 14 });
        }
    }

    /** Radial "explosion" burst - shards fly outward from the impact point in every
     *  direction, then gravity takes over. Reads as a shatter, not an upward pop. */
    burst(worldX, worldY, count = 5) {
        let spawned = 0;
        for (const shard of this._pool) {
            if (shard.active) continue;
            shard.active = true;
            shard.t = 0;
            shard.dur = 0.45 + Math.random() * 0.25;
            shard.x = worldX;
            shard.y = worldY;
            const angle = Math.random() * Math.PI * 2;
            const speed = 260 + Math.random() * 260;
            shard.vx = Math.cos(angle) * speed;
            shard.vy = Math.sin(angle) * speed;
            shard.rot = (Math.random() * 360 - 180) * (Math.PI / 180);
            shard.baseSize = 8 + Math.random() * 14;
            shard.sprite.visible = true;
            shard.sprite.material.opacity = 1;
            shard.sprite.material.rotation = 0;
            shard.sprite.scale.set(shard.baseSize, shard.baseSize, 1);
            shard.sprite.position.set(worldX, worldY, 2 + Math.random());
            spawned++;
            if (spawned >= count) break;
        }
    }

    update(dt) {
        for (const shard of this._pool) {
            if (!shard.active) continue;
            shard.t += dt;
            const t = Math.min(shard.t / shard.dur, 1);

            shard.vy -= GRAVITY * dt; // gravity pulls toward negative (world space is Y-up)
            shard.x += shard.vx * dt;
            shard.y += shard.vy * dt;

            const scale = t < 0.6 ? 1 : 1 - ((t - 0.6) / 0.4) * 0.5;
            const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;

            shard.sprite.position.x = shard.x;
            shard.sprite.position.y = shard.y;
            shard.sprite.material.rotation = shard.rot * t;
            shard.sprite.scale.set(shard.baseSize * scale, shard.baseSize * scale, 1);
            shard.sprite.material.opacity = alpha;

            if (t >= 1) {
                shard.active = false;
                shard.sprite.visible = false;
            }
        }
    }

    dispose() {
        for (const shard of this._pool) shard.mat.dispose();
        this._texture.dispose();
    }
}

/**
 * Small drops that peel away from the melt front and fall with gravity, fading out -
 * the "realistic drips" requested for the hold-to-melt gesture.
 */
export class DripEmitter {
    constructor(group, maxDrips = 30) {
        this._texture = generateDropletTexture(48);
        this._pool = [];
        for (let i = 0; i < maxDrips; i++) {
            const mat = new THREE.SpriteMaterial({ map: this._texture, color: 0x8fd6ff, transparent: true, depthTest: false });
            const sprite = new THREE.Sprite(mat);
            sprite.visible = false;
            sprite.renderOrder = 9;
            group.add(sprite);
            this._pool.push({ sprite, mat, active: false, t: 0, dur: 1, vy: 0, x: 0, y: 0, w: 6, h: 10 });
        }
        this._spawnAccum = 0;
    }

    /** Called every frame while melting; throttles itself so drips don't spawn too densely. */
    maybeSpawn(worldX, worldY, dt) {
        this._spawnAccum += dt;
        const interval = 0.09;
        if (this._spawnAccum < interval) return;
        this._spawnAccum = 0;

        for (const drop of this._pool) {
            if (drop.active) continue;
            drop.active = true;
            drop.t = 0;
            drop.dur = 0.7 + Math.random() * 0.5;
            drop.x = worldX + (Math.random() - 0.5) * 10;
            drop.y = worldY - 4;
            drop.vy = -20;
            drop.w = 5 + Math.random() * 4;
            drop.h = drop.w * 1.6;
            drop.sprite.visible = true;
            drop.sprite.material.opacity = 0.9;
            drop.sprite.position.set(drop.x, drop.y, 3);
            drop.sprite.scale.set(drop.w, drop.h, 1);
            return;
        }
    }

    update(dt) {
        for (const drop of this._pool) {
            if (!drop.active) continue;
            drop.t += dt;
            const t = Math.min(drop.t / drop.dur, 1);

            drop.vy -= GRAVITY * 0.35 * dt;
            drop.y += drop.vy * dt;

            const stretch = 1 + t * 1.8;
            drop.sprite.position.set(drop.x, drop.y, 3);
            drop.sprite.scale.set(drop.w * (1 - t * 0.3), drop.h * stretch, 1);
            drop.sprite.material.opacity = 0.9 * (1 - t);

            if (t >= 1) {
                drop.active = false;
                drop.sprite.visible = false;
            }
        }
    }

    dispose() {
        for (const drop of this._pool) drop.mat.dispose();
        this._texture.dispose();
    }
}

/**
 * Gentle rising steam puffs spawned continuously at the touch point while the hairdryer
 * is actively melting. The caller only invokes maybeSpawn() while input.isHolding is true
 * (see GameplayScreen/IceLevel.tryMelt), so the effect stops the instant a finger lifts -
 * no explicit "stop" call needed.
 */
export class SteamEmitter {
    constructor(group, maxPuffs = 14) {
        this._texture = generateSteamTexture(64);
        this._pool = [];
        for (let i = 0; i < maxPuffs; i++) {
            const mat = new THREE.SpriteMaterial({ map: this._texture, color: 0xffffff, transparent: true, depthTest: false });
            const sprite = new THREE.Sprite(mat);
            sprite.visible = false;
            sprite.renderOrder = 9;
            group.add(sprite);
            this._pool.push({ sprite, mat, active: false, t: 0, dur: 1, x: 0, y: 0, vx: 0, vy: 0, baseSize: 18 });
        }
        this._spawnAccum = 0;
    }

    /** Called every frame while melting; throttles itself so puffs don't spawn too densely.
     *  `hot` tints newly spawned puffs orange-red for the hairdryer's Overheat Mode. */
    maybeSpawn(worldX, worldY, dt, hot = false) {
        this._spawnAccum += dt;
        const interval = 0.11;
        if (this._spawnAccum < interval) return;
        this._spawnAccum = 0;

        for (const puff of this._pool) {
            if (puff.active) continue;
            puff.active = true;
            puff.t = 0;
            puff.dur = 0.7 + Math.random() * 0.5;
            puff.x = worldX + (Math.random() - 0.5) * 14;
            puff.y = worldY + (Math.random() - 0.5) * 8;
            puff.vx = (Math.random() - 0.5) * 30;
            puff.vy = 40 + Math.random() * 40; // gentle rise, not a jet
            puff.baseSize = 14 + Math.random() * 10;
            puff.mat.color.setHex(hot ? 0xffa557 : 0xffffff);
            puff.sprite.visible = true;
            puff.sprite.material.opacity = 0;
            puff.sprite.scale.set(puff.baseSize, puff.baseSize, 1);
            puff.sprite.position.set(puff.x, puff.y, 2.5);
            return;
        }
    }

    update(dt) {
        for (const puff of this._pool) {
            if (!puff.active) continue;
            puff.t += dt;
            const t = Math.min(puff.t / puff.dur, 1);

            puff.x += puff.vx * dt;
            puff.y += puff.vy * dt;
            puff.vy *= (1 - dt * 0.6); // rise decelerates as it disperses, like real vapor

            const scale = 1 + t * 1.6;
            // Quick fade in, slower fade out - avoids a hard "pop" at spawn.
            const alpha = t < 0.25 ? (t / 0.25) * 0.32 : 0.32 * (1 - (t - 0.25) / 0.75);

            puff.sprite.position.x = puff.x;
            puff.sprite.position.y = puff.y;
            puff.sprite.scale.set(puff.baseSize * scale, puff.baseSize * scale, 1);
            puff.sprite.material.opacity = Math.max(0, alpha);

            if (t >= 1) {
                puff.active = false;
                puff.sprite.visible = false;
            }
        }
    }

    dispose() {
        for (const puff of this._pool) puff.mat.dispose();
        this._texture.dispose();
    }
}
