import * as THREE from '../../vendor/three/three.module.js';

/** Soft glowing ring used as the on-screen melt-brush indicator while holding to melt. */
export function generateRingTexture(size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 2;

    const grad = ctx.createRadialGradient(cx, cy, outerR * 0.65, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.72, 'rgba(255,255,255,0)');
    grad.addColorStop(0.86, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    return tex;
}

/** Soft, diffuse puff sprite for the gentle steam wisps spawned while melting - wider
 *  and airier than the droplet texture, with no hard falling-drop core. */
export function generateSteamTexture(size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const cx = size / 2;
    const cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    return tex;
}

/** Flat, wide radial blob used for the brief "puddle" flash right as a melt point
 *  finishes clearing - stretched into an ellipse by the sprite's own scale, not here. */
export function generatePuddleTexture(size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const cx = size / 2;
    const cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    grad.addColorStop(0, 'rgba(215,240,255,0.95)');
    grad.addColorStop(0.55, 'rgba(140,205,255,0.55)');
    grad.addColorStop(1, 'rgba(140,205,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    return tex;
}

/** Soft radial droplet sprite used for both chip debris shards and falling melt drips. */
export function generateDropletTexture(size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const cx = size / 2;
    const cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy * 0.85, 0, cx, cy, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.5, 'rgba(210,240,255,0.75)');
    grad.addColorStop(1, 'rgba(160,210,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    return tex;
}

/** A jagged crack - a few branching random-walk fractures from the centre, each a dark line
 *  with a thin white edge beside it so it reads on light and dark objects alike. Random on
 *  every call, so no two cracks on a level look the same. */
export function generateCrackTexture(size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;

    const lines = [];
    const walk = (x, y, angle, length, depth) => {
        const pts = [[x, y]];
        const steps = 4 + Math.floor(Math.random() * 3);
        for (let i = 0; i < steps; i++) {
            angle += (Math.random() - 0.5) * 0.9;
            x += Math.cos(angle) * (length / steps);
            y += Math.sin(angle) * (length / steps);
            pts.push([x, y]);
            if (depth < 2 && Math.random() < 0.35) walk(x, y, angle + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6), length * 0.45, depth + 1);
        }
        lines.push({ pts, width: 3.2 - depth });
    };
    const branches = 4 + Math.floor(Math.random() * 3);
    for (let b = 0; b < branches; b++) {
        walk(c, c, (b / branches) * Math.PI * 2 + Math.random() * 0.6, size * (0.3 + Math.random() * 0.17), 0);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const stroke = (style, widthMult, dx, dy) => {
        ctx.strokeStyle = style;
        for (const line of lines) {
            ctx.lineWidth = Math.max(0.8, line.width * widthMult);
            ctx.beginPath();
            line.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
            ctx.stroke();
        }
    };
    stroke('rgba(255,255,255,0.85)', 0.7, 1.2, 1.2);
    stroke('rgba(28,22,38,0.92)', 1, 0, 0);

    // small impact pit at the centre
    ctx.fillStyle = 'rgba(28,22,38,0.9)';
    ctx.beginPath();
    ctx.arc(c, c, size * 0.035, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    return tex;
}

/** A scorch mark: an uneven dark-brown blotch with a charred core. */
export function generateScorchTexture(size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;
    for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * size * 0.12;
        const x = c + Math.cos(a) * d;
        const y = c + Math.sin(a) * d;
        const r = size * (0.22 + Math.random() * 0.14);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(45,22,8,0.55)');
        grad.addColorStop(0.6, 'rgba(70,36,12,0.3)');
        grad.addColorStop(1, 'rgba(90,50,20,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.14);
    core.addColorStop(0, 'rgba(20,10,4,0.85)');
    core.addColorStop(1, 'rgba(20,10,4,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.14, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    return tex;
}
