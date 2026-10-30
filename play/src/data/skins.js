// Ice skins, bought and equipped in the Shop. Each one recolours the ice through the same
// physics the shader already uses (see rendering/IceMaterial.js):
//   tint - what white looks like seen through a full slab (turned into Beer-Lambert absorption)
//   body - light scattered back out of normal ice
//   deep - the same for Deep Freeze ice, which should read darker/richer than `body`
// Keep every skin clearly visible over a white backdrop - that's how players spot the ice left.

export const SKINS = [
    { id: 'classic', name: 'Classic', price: 0, tint: [0.54, 0.81, 0.92], body: [0.50, 0.73, 0.88], deep: [0.26, 0.48, 0.78] },
    { id: 'mint', name: 'Mint', price: 400, tint: [0.60, 0.93, 0.80], body: [0.55, 0.86, 0.74], deep: [0.22, 0.62, 0.52] },
    { id: 'strawberry', name: 'Strawberry', price: 500, tint: [0.96, 0.64, 0.76], body: [0.94, 0.62, 0.76], deep: [0.78, 0.30, 0.52] },
    { id: 'lavender', name: 'Lavender', price: 600, tint: [0.78, 0.68, 0.96], body: [0.74, 0.66, 0.92], deep: [0.46, 0.34, 0.78] },
    { id: 'honey', name: 'Honey', price: 800, tint: [0.98, 0.80, 0.46], body: [0.95, 0.78, 0.45], deep: [0.82, 0.50, 0.16] },
    { id: 'midnight', name: 'Midnight', price: 1000, tint: [0.45, 0.52, 0.78], body: [0.30, 0.36, 0.62], deep: [0.14, 0.18, 0.42] },
];

export function getSkin(id) {
    return SKINS.find((s) => s.id === id) || SKINS[0];
}
