import * as THREE from '../../vendor/three/three.module.js';

const _loader = new THREE.TextureLoader();
const _cache = new Map();

/** Loads (and caches) a THREE.Texture by URL. */
export function loadTexture(url) {
    if (_cache.has(url)) return _cache.get(url);
    const promise = new Promise((resolve, reject) => {
        _loader.load(
            url,
            (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.minFilter = THREE.LinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.generateMipmaps = false;
                tex.wrapS = THREE.ClampToEdgeWrapping;
                tex.wrapT = THREE.ClampToEdgeWrapping;
                resolve(tex);
            },
            undefined,
            reject,
        );
    });
    _cache.set(url, promise);
    return promise;
}

/** Loads an HTMLImageElement (for CPU-side pixel reads: silhouette/luminance analysis). */
export function loadImageElement(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}
