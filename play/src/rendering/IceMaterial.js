import * as THREE from '../../vendor/three/three.module.js';
import { SDF_RANGE_TEXELS, BEVEL_TEXELS } from '../mechanics/IceMask.js';
import { CHUNK_EDGE_RANGE, CHUNK_MAP_SCALE } from './ChunkMap.js';

// The ice is drawn as an actual slab of ice sitting on top of the photo, not as a filter
// over it. The photo is the ground plane (z = 0, anchored to the card); the ice's top
// surface floats a full thickness above it. Every pixel traces the view ray down through
// that slab: first to find where the ray meets the ice's top (or its bevelled side walls),
// then - refracted at IOR 1.31 through the local surface normal - on down to the photo.
//
// Tilting the phone swings the view ray, so the elevated ice visibly slides over the photo
// beneath it, bubbles and veils at intermediate depths slide by intermediate amounts, the
// block's side walls and the walls of chipped-out holes come into view, and the studio
// lights sweep across the surface as reflections. Same model LKR3D's frozen-ice material
// gets from MeshPhysicalMaterial transmission (IOR 1.31, rippled normal, Beer-Lambert
// attenuation, dispersion) - done by hand here because the "scene" behind the ice is a
// single photo, which makes the refraction exact rather than a screen-space guess.
//
// Frames: "photo px" = CSS px across the photo, x right, y DOWN (mask/chunk textures are
// stored top-down), z toward the viewer. Environment lookups go through uPhotoToWorld into a
// world frame (x right, y up, z toward the viewer) where the studio lights are fixed.

export const ICE_IOR = 1.31; // optical index of refraction of water ice
const DISPERSION = 0.022; // IOR spread across R..B - exaggerated from real ice (~0.004) so edges fringe
const DISTORTION = 2.4; // how hard surface relief bends the picture, beyond the physical amount
const REFLECTION = 1.5;
const MARCH_STEPS = 12;

// Thickness of the slab relative to the photo's width. Thick enough that a slight tilt
// visibly slides the picture under it, thin enough that the side walls stay a sliver.
const ICE_DEPTH_FRACTION = 0.105;
const ICE_DEPTH_MIN_PX = 26;
const ICE_DEPTH_MAX_PX = 64;

// View geometry. A tilt of 1 (see DeviceTilt: ~22 degrees of real rotation) swings the view
// this far - exaggerated, so the small tilts people actually make while playing still read.
export const MAX_VIEW_ANGLE = THREE.MathUtils.degToRad(32);
const EYE_DISTANCE = 2.4; // eye distance, in multiples of the photo's longer side

// Studio lighting in the world frame (x right, y up, z toward the viewer).
const KEY_LIGHT = new THREE.Vector3(-0.42, 0.55, 0.72).normalize(); // big softbox, up-left
const STRIP_LIGHT = new THREE.Vector3(0.88, 0.08, 0.47).normalize(); // tall strip, right
const WARM_BOUNCE = new THREE.Vector3(-0.35, -0.8, 0.45).normalize();

export function iceDepthForPlane(planeW) {
    return THREE.MathUtils.clamp(planeW * ICE_DEPTH_FRACTION, ICE_DEPTH_MIN_PX, ICE_DEPTH_MAX_PX);
}

/** Margin the ice mesh extends past the photo on every side, so a slab leaning out past the
 *  photo's edge at full tilt isn't clipped. */
export function iceMeshMargin(depthPx) {
    return Math.ceil(depthPx * Math.tan(MAX_VIEW_ANGLE) * 1.25 + depthPx * 0.2);
}

const _rotY = new THREE.Matrix4();
const _rotX = new THREE.Matrix4();
const _phone = new THREE.Matrix4();
const _phone3 = new THREE.Matrix3();
const _flipY = new THREE.Matrix3().set(1, 0, 0, 0, -1, 0, 0, 0, 1);
const _worldToPhoto = new THREE.Matrix3();

/**
 * Where the eye and key light sit relative to the photo for a given device tilt.
 * @param {{ eye: THREE.Vector3, light: THREE.Vector3, photoToWorld: THREE.Matrix3 }} out
 */
export function computeIceView(tiltX, tiltY, planeW, planeH, out) {
    // Phone orientation in the world: turned about its vertical axis by the right edge
    // tipping away (+x), then about its horizontal axis by the top edge tipping toward the
    // player (+y, see DeviceTilt). The eye and the lights stay put in the world, so in the
    // phone's frame they swing the opposite way.
    _rotY.makeRotationY(tiltX * MAX_VIEW_ANGLE);
    _rotX.makeRotationX(tiltY * MAX_VIEW_ANGLE);
    _phone.multiplyMatrices(_rotX, _rotY);
    _phone3.setFromMatrix4(_phone);

    out.photoToWorld.multiplyMatrices(_phone3, _flipY);
    _worldToPhoto.copy(out.photoToWorld).transpose(); // rotation * reflection: inverse = transpose

    const eyeDistance = EYE_DISTANCE * Math.max(planeW, planeH);
    out.eye.set(0, 0, 1).applyMatrix3(_worldToPhoto).multiplyScalar(eyeDistance);
    out.eye.x += planeW / 2;
    out.eye.y += planeH / 2;
    out.light.copy(KEY_LIGHT).applyMatrix3(_worldToPhoto);
    return out;
}

function glslFloat(v) {
    return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

function glslVec3(v) {
    return `vec3(${glslFloat(v.x)}, ${glslFloat(v.y)}, ${glslFloat(v.z)})`;
}

/** Two unit vectors spanning the plane perpendicular to `axis` (for softbox shapes). */
function tangentBasis(axis) {
    const t1 = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
    const t2 = new THREE.Vector3().crossVectors(axis, t1).normalize();
    return [t1, t2];
}

const [KEY_T1, KEY_T2] = tangentBasis(KEY_LIGHT);
const [STRIP_T1, STRIP_T2] = tangentBasis(STRIP_LIGHT);

const VERTEX_SHADER = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    #define PI 3.14159265
    #define IOR ${glslFloat(ICE_IOR)}
    #define DISPERSION ${glslFloat(DISPERSION)}
    #define DISTORTION ${glslFloat(DISTORTION)}
    #define REFLECTION ${glslFloat(REFLECTION)}
    #define MARCH_STEPS ${MARCH_STEPS}
    #define SDF_RANGE ${glslFloat(SDF_RANGE_TEXELS)}
    #define BEVEL_TEXELS ${glslFloat(BEVEL_TEXELS)}
    #define EDGE_RANGE ${glslFloat(CHUNK_EDGE_RANGE)}
    #define CHUNK_SCALE ${glslFloat(CHUNK_MAP_SCALE)}

    // Ice colour, set per skin (data/skins.js). SIGMA is Beer-Lambert optical depth per full
    // slab thickness: classic ice soaks up red first, so white seen through it turns cyan -
    // which is what keeps the block visible over a white backdrop.
    uniform vec3 SIGMA;
    uniform vec3 ICE_BODY;      // light scattered back out of cloudy ice
    uniform vec3 ICE_BODY_DEEP; // ...out of Deep Freeze ice

    const vec3 KEY_AXIS = ${glslVec3(KEY_LIGHT)};
    const vec3 KEY_T1 = ${glslVec3(KEY_T1)};
    const vec3 KEY_T2 = ${glslVec3(KEY_T2)};
    const vec3 STRIP_AXIS = ${glslVec3(STRIP_LIGHT)};
    const vec3 STRIP_T1 = ${glslVec3(STRIP_T1)};
    const vec3 STRIP_T2 = ${glslVec3(STRIP_T2)};
    const vec3 WARM_AXIS = ${glslVec3(WARM_BOUNCE)};

    uniform sampler2D tObject;    // the photo (mipmapped)
    uniform sampler2D tMask;      // R ice, G rounded ice, B soft silhouette, A outline SDF
    uniform sampler2D tEdge;      // distance to the nearest chunk border (high-res, linear)
    uniform sampler2D tCells;     // R chunk index, G chunk across that border (high-res, nearest)
    uniform sampler2D tCellState; // per chunk: R hits left (cap), G share still iced, B Deep Freeze, A random

    uniform vec2 uPlaneSize;   // photo size, px
    uniform vec2 uMeshSize;    // mesh size (photo + margin), px
    uniform vec2 uMapSize;     // ice mask resolution
    uniform vec2 uCellsSize;   // chunk map resolution
    uniform float uPhotoLod;   // mip level that samples the photo 1:1 with the screen
    uniform float uPhotoTexel; // px per photo texel at mip 0
    uniform float uPx;         // px per device pixel
    uniform float uIceDepth;   // slab thickness, px
    uniform vec3 uEyePos;      // photo px frame
    uniform vec3 uLightDir;    // photo px frame, toward the key light
    uniform mat3 uPhotoToWorld;
    uniform float uTime;
    uniform vec2 uMeltPoint;   // photo px
    uniform float uMeltRadius; // px
    uniform float uMeltPulse;
    uniform float uOverheat;

    varying vec2 vUv;

    // ---------------------------------------------------------------- noise
    float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    vec2 hash22(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
    }

    /** Value noise with its analytic derivative: (value, d/dx, d/dy). */
    vec3 noised(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash12(i);
        float b = hash12(i + vec2(1.0, 0.0));
        float c = hash12(i + vec2(0.0, 1.0));
        float d = hash12(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        vec2 du = 6.0 * f * (1.0 - f);
        float k = a - b - c + d;
        return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
                    du * (vec2(b - a, c - a) + k * u.yx));
    }

    /** Slope of the frozen surface's relief (px of height per px): slow swells plus a finer
     *  hammered texture. It never animates - ice is solid - so every bit of movement in the
     *  refracted picture comes from the viewing angle, which is what sells it as a solid. */
    vec2 reliefSlope(vec2 p) {
        float s = uIceDepth / 40.0;
        vec2 g = noised(p / 95.0 + vec2(3.1, 7.7)).yz * (4.8 / 95.0);
        g += noised(mat2(0.8, -0.6, 0.6, 0.8) * p / 36.0 + vec2(11.7, 2.3)).yz * (1.7 / 36.0);
        g += noised(mat2(0.6, 0.8, -0.8, 0.6) * p / 13.0 - vec2(5.3, 9.1)).yz * (0.5 / 13.0);
        return g * s;
    }

    /** Distance to the nearest border of a jittered Voronoi pattern (in cell units). */
    float voronoiBorder(vec2 x) {
        vec2 n = floor(x);
        vec2 f = fract(x);
        vec2 mg = vec2(0.0);
        vec2 mr = vec2(0.0);
        float md = 8.0;
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 r = g + hash22(n + g) - f;
                float d = dot(r, r);
                if (d < md) { md = d; mr = r; mg = g; }
            }
        }
        md = 8.0;
        for (int j = -2; j <= 2; j++) {
            for (int i = -2; i <= 2; i++) {
                vec2 g = mg + vec2(float(i), float(j));
                vec2 r = g + hash22(n + g) - f;
                vec2 dr = r - mr;
                if (dot(dr, dr) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(dr)));
            }
        }
        return md;
    }

    // ---------------------------------------------------------------- slab shape
    // Explicit LOD on every lookup made inside the ray march or its branches: implicit
    // derivatives are undefined in non-uniform control flow.
    vec4 maskAt(vec2 p) {
        return textureLod(tMask, p / uPlaneSize, 0.0);
    }

    float edgeAt(vec2 p) {
        return textureLod(tEdge, p / uPlaneSize, 0.0).r;
    }

    /** 0..1 of full thickness. Keep in step with surfaceHeight() in IceMask.js - the CPU
     *  ray-marches the same surface to decide which ice a tap lands on. */
    float surfaceHeight(vec4 m) {
        float sdf = (m.a - 0.5) * (2.0 * SDF_RANGE);
        float x = clamp(sdf / BEVEL_TEXELS, 0.0, 1.0);
        float lip = sqrt(max(0.0, 1.0 - (1.0 - x) * (1.0 - x)));
        return min(lip, smoothstep(0.1, 0.9, m.g));
    }

    // ---------------------------------------------------------------- photo
    // Past the photo's edge lies the pale card it sits on. Refracted rays that land out there
    // must see that, not the photo's border pixels smeared outward by clamping.
    const vec3 CARD = vec3(0.80, 0.83, 0.86);

    vec3 photo(vec2 p, float lod) {
        vec3 c = textureLod(tObject, vec2(p.x / uPlaneSize.x, 1.0 - p.y / uPlaneSize.y), lod).rgb;
        vec2 beyond = max(-p, p - uPlaneSize);
        return mix(c, CARD, smoothstep(0.0, 1.5, max(beyond.x, beyond.y)));
    }

    /** Soft-focus version of the photo around p: four taps from a mip level matched to radius. */
    vec3 photoBlur(vec2 p, float radius) {
        float lod = max(uPhotoLod, log2(max(radius * 0.5 / uPhotoTexel, 1.0)));
        vec2 o1 = vec2(0.62, 0.28) * radius;
        vec2 o2 = vec2(-0.28, 0.62) * radius;
        return 0.25 * (photo(p + o1, lod) + photo(p - o1, lod) + photo(p + o2, lod) + photo(p - o2, lod));
    }

    // ---------------------------------------------------------------- lighting
    float softbox(vec3 d, vec3 axis, vec3 t1, vec3 t2, vec2 halfSize, float soft) {
        float w = dot(d, axis);
        if (w <= 0.05) return 0.0;
        vec2 q = abs(vec2(dot(d, t1), dot(d, t2))) / w;
        vec2 inside = 1.0 - smoothstep(halfSize * (1.0 - soft), halfSize, q);
        return inside.x * inside.y;
    }

    /** Radiance arriving from world direction d: a dim studio with a big key softbox up-left,
     *  a strip light to the right, and the player (plus the phone in their hand) blocking
     *  what's straight behind the screen - so a face-on reflection is dark and the lights
     *  only flare up as the surface turns toward them. */
    vec3 studio(vec3 d) {
        vec3 col = mix(vec3(0.03, 0.035, 0.045), vec3(0.26, 0.30, 0.36), smoothstep(-0.3, 0.9, d.y));
        col += vec3(0.10, 0.11, 0.12) * exp(-abs(d.y + 0.05) * 6.0);
        col *= 1.0 - 0.75 * smoothstep(0.72, 0.97, d.z);
        col += vec3(9.0, 9.3, 9.6) * softbox(d, KEY_AXIS, KEY_T1, KEY_T2, vec2(0.62, 0.36), 0.45);
        col += vec3(5.0, 5.6, 6.4) * softbox(d, STRIP_AXIS, STRIP_T1, STRIP_T2, vec2(0.09, 0.95), 0.5);
        col += vec3(0.35, 0.18, 0.10) * smoothstep(0.4, 1.0, dot(d, WARM_AXIS));
        return col;
    }

    /** Trapped air bubbles on one layer: x = inside a bubble, y = its silvery rim, z = the
     *  pinpoint highlight (placed toward the light, so it slides as the phone turns). */
    vec3 bubbles(vec2 q, float cellPx, float density, float seed, vec2 lightTilt) {
        vec2 g = q / cellPx;
        vec2 id = floor(g);
        if (hash12(id + seed) > density) return vec3(0.0);
        vec2 c = 0.3 + 0.4 * hash22(id + seed * 1.37);
        float r = mix(0.07, 0.19, hash12(id * 1.7 + seed));
        vec2 dv = (fract(g) - c) / r;
        float d = length(dv);
        // One device pixel in bubble radii. Worked out rather than taken from fwidth(): this
        // runs inside branches, where screen-space derivatives are undefined.
        float w = uPx / (r * cellPx) + 0.08;
        float disc = 1.0 - smoothstep(1.0 - w, 1.0 + w, d);
        float rim = smoothstep(0.5, 1.0, d) * disc;
        float spot = (1.0 - smoothstep(0.0, 0.3 + w, length(dv + lightTilt * 0.5))) * disc;
        return vec3(disc, rim, spot);
    }

    vec2 clampLength(vec2 v, float maxLen) {
        float len = length(v);
        return len > maxLen ? v * (maxLen / len) : v;
    }

    vec3 highlightShoulder(vec3 c) {
        vec3 over = max(c - 0.85, 0.0);
        return min(c, 0.85) + 0.15 * (1.0 - exp(-over / 0.15));
    }

    void main() {
        float T = uIceDepth;
        vec2 texel = uPlaneSize / uMapSize;
        float texelPx = 0.5 * (texel.x + texel.y);
        float aa = uPx * 1.25;

        // This fragment's point on the photo plane, and the view ray through it: at height z
        // the ray is at s + e * z.
        vec2 s = vec2(vUv.x, 1.0 - vUv.y) * uMeshSize - 0.5 * (uMeshSize - uPlaneSize);
        vec3 toEye = uEyePos - vec3(s, 0.0);
        vec2 e = toEye.xy / toEye.z;
        vec3 L = normalize(uLightDir);

        // ------------------------------------------------ the bare photo, shadowed by the block
        // A photo point is shaded when there's ice between it and the key light. The ice is
        // translucent, so the shadow is a cool tint rather than grey, with the light the
        // rounded rim focuses landing as a brighter caustic band just inside its edge.
        bool inPhoto = s.x >= 0.0 && s.y >= 0.0 && s.x <= uPlaneSize.x && s.y <= uPlaneSize.y;
        float shadow = maskAt(s + L.xy / max(L.z, 0.35) * (T * 0.6)).b;
        float contact = maskAt(s).b;
        float shade = clamp(shadow * 0.85 + contact * 0.3, 0.0, 1.0);
        float caustic = smoothstep(0.08, 0.3, shadow) * (1.0 - smoothstep(0.3, 0.7, shadow)) * (1.0 - contact);
        vec3 bare;
        float bareAlpha;
        if (inPhoto) {
            bare = photo(s, uPhotoLod);
            bare *= mix(vec3(1.0), vec3(0.52, 0.68, 0.80), shade * 0.6);
            bare += caustic * vec3(0.16, 0.26, 0.30);
            bareAlpha = 1.0;
        } else {
            bare = vec3(0.08, 0.14, 0.2);
            bareAlpha = shade * 0.35;
        }

        // ------------------------------------------------ where the view ray meets the ice
        // Heightfield ray march from the slab's top down to the photo. Most fragments settle
        // on the first sample (flat top of intact ice) or skip it entirely (no ice near the
        // ray at all); only the ones grazing a lip or a wall take the full walk.
        float hitZ = -1.0;
        vec2 hitP = s;
        vec4 m = maskAt(s + e * T);
        if (surfaceHeight(m) >= 0.999) {
            hitZ = T;
            hitP = s + e * T;
        } else if (m.b + contact + maskAt(s + e * (0.5 * T)).b > 0.001) {
            float zAbove = T;
            for (int i = 1; i <= MARCH_STEPS; i++) {
                float z = T * (1.0 - float(i) / float(MARCH_STEPS));
                float hz = T * surfaceHeight(maskAt(s + e * z));
                if (hz >= z && hz > 0.01 * T) {
                    float lo = z;
                    float hi = zAbove;
                    for (int j = 0; j < 5; j++) {
                        float mid = 0.5 * (lo + hi);
                        if (T * surfaceHeight(maskAt(s + e * mid)) >= mid) lo = mid; else hi = mid;
                    }
                    hitZ = 0.5 * (lo + hi);
                    hitP = s + e * hitZ;
                    m = maskAt(hitP);
                    break;
                }
                zAbove = z;
            }
        }

        vec3 outColor = bare;
        float outAlpha = bareAlpha;

        if (hitZ > 0.0) {
            vec2 p = hitP;
            float h = hitZ;
            float thick = clamp(h / T, 0.0, 1.0);
            vec2 puv = p / uPlaneSize;
            ivec2 cellsMax = ivec2(uCellsSize) - 1;

            // ---------------------------------------- which chunk, and is its edge broken open?
            vec4 ids = texelFetch(tCells, clamp(ivec2(puv * uCellsSize), ivec2(0), cellsMax), 0);
            int own = int(ids.r * 255.0 + 0.5);
            int across = int(ids.g * 255.0 + 0.5);
            vec4 chunk = texelFetch(tCellState, ivec2(own, 0), 0);
            vec4 chunkAcross = texelFetch(tCellState, ivec2(across, 0), 0);
            float cap = chunk.r;
            float deep = chunk.b;
            float edgePx = edgeAt(p) * (EDGE_RANGE * texelPx);
            bool exposed = across != own && (chunkAcross.r < cap - 0.2 || chunkAcross.g < 0.5);

            // Coverage: the chunk must still be standing, the mask must still hold ice here,
            // and we must be inside the block's outline - each anti-aliased on its own edge.
            // Melt fronts are traced on the lightly blurred channel: the raw mask thresholded
            // this close to zero hugs the texel grid and stairsteps.
            float sdfPx = (m.a - 0.5) * (2.0 * SDF_RANGE) * texelPx;
            float cov = step(0.004, cap) * smoothstep(0.03, 0.12, m.g) * smoothstep(0.0, aa, sdfPx);
            if (exposed) cov *= smoothstep(0.0, aa, edgePx);

            if (cov > 0.0) {
                // ------------------------------------ surface normal
                vec2 dx = vec2(texelPx * 0.7, 0.0);
                vec2 dy = vec2(0.0, texelPx * 0.7);
                vec2 slope = T * vec2(
                    surfaceHeight(maskAt(p + dx)) - surfaceHeight(maskAt(p - dx)),
                    surfaceHeight(maskAt(p + dy)) - surfaceHeight(maskAt(p - dy))) / (1.4 * texelPx);

                if (exposed) {
                    // Crisp rounded lip along the broken face of a chipped-out neighbour.
                    float hs = texelPx / CHUNK_SCALE;
                    vec2 gE = vec2(edgeAt(p + vec2(hs, 0.0)), edgeAt(p + vec2(0.0, hs)))
                              * (EDGE_RANGE * texelPx) - edgePx;
                    vec2 away = gE / max(length(gE), 1e-4);
                    float lipW = texelPx * 1.5;
                    float lx = clamp(edgePx / lipW, 0.0, 1.0);
                    float lipSlope = (1.0 - lx) / max(sqrt(1.0 - (1.0 - lx) * (1.0 - lx)), 0.2);
                    slope += away * lipSlope * (0.3 * T * thick) / lipW;
                }

                vec2 relief = reliefSlope(p) * (0.5 + 0.5 * thick);

                // Every chunk is a slightly differently angled facet, so as the phone turns
                // they catch the light - and bend the picture - one by one, like the pieces
                // of a real fractured block.
                float facetAngle = chunk.a * 6.2831853;
                float facetTilt = 0.025 + 0.045 * fract(chunk.a * 17.31);
                slope += vec2(cos(facetAngle), sin(facetAngle)) * facetTilt * smoothstep(0.2, 0.6, thick);

                // A film of meltwater rippling out from the hairdryer / scraper.
                vec2 toMelt = p - uMeltPoint;
                float meltDist = length(toMelt);
                float melt = (1.0 - smoothstep(0.0, uMeltRadius * 1.15, meltDist)) * uMeltPulse;
                slope += toMelt / max(meltDist, 0.001)
                    * cos(meltDist * (38.0 / uMeltRadius) - uTime * 9.0) * 0.28 * melt;

                // The picture is bent by the full relief; reflections see a calmer surface,
                // or a light's reflection shatters into spots instead of smearing into streaks.
                vec3 N = normalize(vec3(-(slope + relief), 1.0));
                vec3 Nr = normalize(vec3(-(slope + relief * 0.3), 1.0));
                vec3 V = normalize(uEyePos - vec3(p, h));

                // ------------------------------------ refraction down to the photo
                // A flat slab shifts the ray by 'drift' on its way down; the surface's shape
                // bends it further (the amount by which each channel's refracted ray differs
                // from the flat one), scaled up so the relief is legible at phone size.
                vec3 flatRay = refract(-V, vec3(0.0, 0.0, 1.0), 1.0 / IOR);
                vec2 flatStep = flatRay.xy / max(-flatRay.z, 0.2);
                vec2 drift = flatStep * h;
                float lever = max(h, 0.55 * T) * DISTORTION;
                vec3 rayR = refract(-V, N, 1.0 / (IOR - DISPERSION));
                vec3 rayG = refract(-V, N, 1.0 / IOR);
                vec3 rayB = refract(-V, N, 1.0 / (IOR + DISPERSION));
                vec2 bendR = clampLength((rayR.xy / max(-rayR.z, 0.2) - flatStep) * lever, T);
                vec2 bendG = clampLength((rayG.xy / max(-rayG.z, 0.2) - flatStep) * lever, T);
                vec2 bendB = clampLength((rayB.xy / max(-rayB.z, 0.2) - flatStep) * lever, T);
                vec2 inside = drift + bendG * 0.5; // the ray's travel through the slab, top to bottom

                // Cloudy veils hang at mid-depth, so they drift at half the picture's rate.
                vec2 pMid = p + inside * 0.5;
                float veil = noised(pMid / 75.0 + vec2(1.3, 4.2)).x * 0.55
                           + noised(pMid / 29.0 - vec2(4.1, 0.7)).x * 0.3
                           + noised(pMid / 11.0 + vec2(8.7, 2.9)).x * 0.15;
                float frost = smoothstep(0.38, 0.78, veil);
                float wet = clamp((cap - m.r) / max(cap, 0.01) * 2.5, 0.0, 1.0);
                float haze = clamp((0.06 + 0.8 * frost) * (0.35 + 0.65 * thick) * (1.0 - 0.75 * wet)
                                   + deep * 0.2, 0.0, 1.0);

                vec3 sharp = vec3(photo(p + drift + bendR, uPhotoLod).r,
                                  photo(p + drift + bendG, uPhotoLod).g,
                                  photo(p + drift + bendB, uPhotoLod).b);
                vec3 soft = photoBlur(p + drift + bendG, 1.5 + 8.0 * haze);
                vec3 through = mix(sharp, soft, smoothstep(0.05, 0.7, haze));

                // ------------------------------------ the ice body
                // Light that crosses a bevel travels through the side of the block, not just
                // its thickness - which is why real ice edges read darker and deeper in colour.
                float path = max(h / max(-rayG.z, 0.3) + (1.0 - N.z) * T * 1.8, 0.3 * T);
                vec3 trans = exp(-SIGMA * (1.0 + 0.85 * deep) * (path / T));
                float scatter = 1.0 - exp(-(path / T) * (0.18 + 0.9 * haze));
                vec3 col = mix(through * trans, mix(ICE_BODY, ICE_BODY_DEEP, deep), scatter * 0.55);

                // Air bubbles on two layers, each sliding at its own depth's rate.
                // Mostly in the cloudy veils, the way air gets trapped in real ice.
                vec2 lightTilt = L.xy;
                float bubbleDensity = (0.015 + 0.2 * frost) * thick;
                vec3 b1 = bubbles(p + inside * 0.3, 12.0, bubbleDensity, 17.0, lightTilt);
                vec3 b2 = bubbles(p + inside * 0.65, 23.0, bubbleDensity * 0.6, 41.0, lightTilt);
                col = mix(col, col * 0.8, (b1.x + b2.x) * 0.3);
                col += (b1.y + b2.y) * vec3(0.13, 0.16, 0.18) + (b1.z + b2.z) * vec3(0.9);

                // Fracture planes between chunks that are still standing: a hairline where
                // the plane meets the surface, and - once tilted - the plane itself, a thin
                // silvery sheet the ray crosses on its way down. It's what shows where the
                // pieces are, i.e. where to tap.
                // (Only the chunk under the ray's exit decides the sheet: 'across' is filled in
                // just near borders, in mask-texel blocks, so gating on it would stairstep.)
                if (!exposed) {
                    float line = across != own ? 1.0 - smoothstep(0.2 * aa, 1.2 * aa, edgePx) : 0.0;
                    vec2 bottom = p + inside;
                    ivec2 bottomTexel = clamp(ivec2(bottom / uPlaneSize * uCellsSize), ivec2(0), cellsMax);
                    int ownBottom = int(texelFetch(tCells, bottomTexel, 0).r * 255.0 + 0.5);
                    float sheet = 0.0;
                    if (ownBottom != own && texelFetch(tCellState, ivec2(ownBottom, 0), 0).g > 0.5) {
                        float edgeBottomPx = edgeAt(bottom) * (EDGE_RANGE * texelPx);
                        // How deep the ray is where it pierces the plane (0 = at the surface):
                        // the plane fades as it recedes, so it reads as a sheet going down
                        // into the ice rather than a flat stripe painted on top.
                        float pierce = edgePx / max(edgePx + edgeBottomPx, 1e-3);
                        sheet = smoothstep(0.0, 1.5 * aa, edgeBottomPx) * (1.0 - 0.75 * pierce);
                    }
                    col = col * (1.0 - 0.1 * sheet) + (0.11 * sheet + 0.13 * line * thick) * vec3(0.85, 0.93, 1.0);
                }

                // Deep Freeze after a hit or two: a network of cracks at mid-depth, then
                // crushed-white once it's close to breaking.
                if (deep > 0.5 && cap < 0.9) {
                    float shattered = step(cap, 0.5);
                    float cellPx = mix(15.0, 7.0, shattered);
                    vec2 pc = p + inside * 0.45;
                    float crackPx = voronoiBorder(pc / cellPx) * cellPx;
                    float crack = 1.0 - smoothstep(0.25, 1.3, crackPx / max(uPx, 0.5));
                    // The first hit leaves a few cracks running through the piece, not a grid.
                    crack *= mix(smoothstep(0.35, 0.65, noised(pc / 24.0 + chunk.a * 50.0).x), 1.0, shattered);
                    col = mix(col, ICE_BODY * 1.1, shattered * 0.35);
                    col += crack * vec3(0.7, 0.8, 0.9) * (0.35 + 0.25 * shattered);
                }

                // ------------------------------------ the surface: reflections and glints
                float NdV = clamp(dot(Nr, V), 0.0, 1.0);
                float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
                float gloss = 1.0 - 0.55 * haze * (1.0 - wet);
                col += studio(uPhotoToWorld * reflect(-V, Nr)) * fresnel * REFLECTION * gloss;

                vec3 H = normalize(L + V);
                float rough = mix(0.035, 0.16, haze) * (1.0 - 0.6 * wet);
                float a2 = rough * rough * rough * rough;
                float NdH = max(dot(Nr, H), 0.0);
                float dd = NdH * NdH * (a2 - 1.0) + 1.0;
                float ggx = a2 / (PI * dd * dd);
                float hv = 1.0 - max(dot(H, V), 0.0);
                col += vec3(1.0, 0.98, 0.95) * min(ggx * (0.02 + 0.98 * hv * hv * hv * hv * hv), 40.0)
                       * max(dot(Nr, L), 0.0) * 0.05;

                // Frost crystals: tiny facets at random angles, each flashing only when the
                // phone turns it just right toward the key light.
                vec2 gp = p / 3.2;
                vec2 gid = floor(gp);
                if (hash12(gid + 71.3) < (0.04 + 0.28 * frost) * thick * (1.0 - wet)) {
                    vec2 gf = fract(gp) - (0.2 + 0.6 * hash22(gid + 5.1));
                    vec3 gn = normalize(vec3((hash22(gid + 13.7) - 0.5) * 1.3, 1.0));
                    float align = max(dot(reflect(-V, gn), L), 0.0);
                    col += vec3(5.0) * pow(align, 300.0) * (1.0 - smoothstep(0.0, 0.25, length(gf)));
                }

                col += melt * (0.06 + 0.55 * uOverheat) * mix(vec3(0.7, 0.85, 1.0), vec3(1.4, 0.45, 0.14), uOverheat);

                col = highlightShoulder(col);
                outColor = mix(bare, col, cov);
                outAlpha = mix(bareAlpha, 1.0, cov);
            }
        }

        gl_FragColor = vec4(outColor, outAlpha);
        #include <colorspace_fragment>
    }
`;

/**
 * @param {object} opts
 * @param {THREE.Texture} opts.objectTexture - the level photo (mipmaps are switched on here).
 * @param {THREE.Texture} opts.maskTexture - IceMask.texture.
 * @param {THREE.Texture} opts.chunkIdTexture - ChunkMap idTexture.
 * @param {THREE.Texture} opts.chunkEdgeTexture - ChunkMap edgeTexture.
 * @param {THREE.Texture} opts.cellStateTexture - per-chunk state, see IceLevel.
 * @param {object} opts.skin - ice colours, an entry from data/skins.js.
 */
export function createIceMaterial({
    objectTexture,
    maskTexture,
    chunkIdTexture,
    chunkEdgeTexture,
    cellStateTexture,
    mapWidth,
    mapHeight,
    chunkWidth,
    chunkHeight,
    skin,
}) {
    // The refracted picture is sampled at explicit mip levels (see photo()/photoBlur()), both
    // for the frosted blur and so a steep jump in the refraction can't trick the GPU into a
    // blurry mip along chunk seams.
    objectTexture.generateMipmaps = true;
    objectTexture.minFilter = THREE.LinearMipmapLinearFilter;
    objectTexture.needsUpdate = true;

    return new THREE.ShaderMaterial({
        uniforms: {
            tObject: { value: objectTexture },
            tMask: { value: maskTexture },
            tEdge: { value: chunkEdgeTexture },
            tCells: { value: chunkIdTexture },
            tCellState: { value: cellStateTexture },
            uPlaneSize: { value: new THREE.Vector2(1, 1) },
            uMeshSize: { value: new THREE.Vector2(1, 1) },
            uMapSize: { value: new THREE.Vector2(mapWidth, mapHeight) },
            uCellsSize: { value: new THREE.Vector2(chunkWidth, chunkHeight) },
            uPhotoLod: { value: 0 },
            uPhotoTexel: { value: 1 },
            uPx: { value: 1 },
            uIceDepth: { value: 30 },
            uEyePos: { value: new THREE.Vector3(0, 0, 1000) },
            uLightDir: { value: KEY_LIGHT.clone() },
            uPhotoToWorld: { value: new THREE.Matrix3() },
            uTime: { value: 0 },
            uMeltPoint: { value: new THREE.Vector2(-1e4, -1e4) },
            uMeltRadius: { value: 60 },
            uMeltPulse: { value: 0 },
            uOverheat: { value: 0 },
            SIGMA: { value: new THREE.Vector3(...skin.tint.map((t) => -Math.log(t))) },
            ICE_BODY: { value: new THREE.Vector3(...skin.body) },
            ICE_BODY_DEEP: { value: new THREE.Vector3(...skin.deep) },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
    });
}
