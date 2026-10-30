import * as THREE from '../../vendor/three/three.module.js';

/** Gentle drifting/twinkling dust of sparkle points, used as ambient decoration behind menus. */
export class SparkleField {
    constructor(count = 40, color = 0xbfe9ff) {
        this._count = count;
        this._phase = new Float32Array(count);
        this._speed = new Float32Array(count);
        this._baseX = new Float32Array(count);
        this._baseY = new Float32Array(count);

        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            this._phase[i] = Math.random() * Math.PI * 2;
            this._speed[i] = 0.4 + Math.random() * 0.8;
            positions[i * 3 + 2] = 1;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.PointsMaterial({
            color,
            size: 6,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: false,
        });

        this.points = new THREE.Points(geo, mat);
        this._elapsed = 0;
        this._w = 0;
        this._h = 0;
    }

    resize(width, height) {
        this._w = width;
        this._h = height;
        for (let i = 0; i < this._count; i++) {
            this._baseX[i] = (Math.random() - 0.5) * width;
            this._baseY[i] = (Math.random() - 0.5) * height;
        }
        this._syncPositions(0);
    }

    _syncPositions(t) {
        const pos = this.points.geometry.attributes.position;
        for (let i = 0; i < this._count; i++) {
            const drift = Math.sin(t * this._speed[i] + this._phase[i]) * 18;
            pos.setX(i, this._baseX[i] + drift);
            pos.setY(i, this._baseY[i] + Math.cos(t * this._speed[i] * 0.6 + this._phase[i]) * 10);
        }
        pos.needsUpdate = true;
    }

    update(dt) {
        this._elapsed += dt;
        this._syncPositions(this._elapsed);
        const twinkle = 0.55 + Math.sin(this._elapsed * 2) * 0.25;
        this.points.material.opacity = twinkle;
    }

    dispose() {
        this.points.geometry.dispose();
        this.points.material.dispose();
    }
}
