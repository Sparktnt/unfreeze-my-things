import * as THREE from '../../vendor/three/three.module.js';
import { loadImageElement } from '../engine/Assets.js';

/**
 * A full-viewport "cover fit" background plane in an orthographic (1 unit = 1 CSS px)
 * scene, centered at the origin. Recomputes its scale on resize so the image always
 * fills the screen without distortion (cropping overflow), matching CoverRect() from
 * the original C# VisualEffects helper.
 *
 * The reference mock photos have their own UI text/buttons baked into the pixels, which
 * would visually clash with our real DOM buttons drawn on top - so by default the image
 * is pre-blurred/darkened into soft ambient bokeh (mood + palette only) rather than used
 * at full clarity. Pass `blurPx: 0` to keep a source image crisp.
 */
export class BackgroundPlane {
    constructor(url, { opacity = 1, blurPx = 22, darken = 0.18 } = {}) {
        this.group = new THREE.Group();
        this._imgAspect = 1;

        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity });
        this._mesh = new THREE.Mesh(geo, mat);
        this.group.add(this._mesh);

        loadImageElement(url).then((img) => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');

            if (blurPx > 0) {
                ctx.filter = `blur(${blurPx}px)`;
                ctx.drawImage(img, 0, 0);
                ctx.filter = 'none';
            } else {
                ctx.drawImage(img, 0, 0);
            }

            if (darken > 0) {
                ctx.fillStyle = `rgba(10, 6, 20, ${darken})`;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.generateMipmaps = false;

            mat.map = tex;
            mat.needsUpdate = true;
            this._imgAspect = img.width / img.height;
            if (this._lastW) this.resize(this._lastW, this._lastH);
        });
    }

    resize(width, height) {
        this._lastW = width;
        this._lastH = height;
        const screenAspect = width / height;
        let w, h;
        if (screenAspect > this._imgAspect) {
            w = width;
            h = width / this._imgAspect;
        } else {
            h = height;
            w = height * this._imgAspect;
        }
        this._mesh.scale.set(w, h, 1);
    }

    setOpacity(v) {
        this._mesh.material.opacity = v;
    }

    dispose() {
        this._mesh.geometry.dispose();
        this._mesh.material.dispose();
    }
}
