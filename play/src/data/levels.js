// Level registry. Each level references a single "clean" photo - the ice shell and
// fracture pattern are generated procedurally at load time, so no separate
// damaged/rusted variant is needed any more (see mechanics/IceLevel.js).

const IMG = 'assets/images/levels';

// One level per entry, in play order - no photo is reused. `key` is the file name:
// `${IMG}/${key}.jpg` is the level photo and `${IMG}/thumbs/${key}.jpg` its Collection tile.
// Fixed shuffled order: alternate themes across the full collection.
const OBJECTS = [
    { key: 'alarm_clock', name: 'Alarm Clock' },
    { key: 'coral_handheld_console', name: 'Coral Handheld Console' },
    { key: 'accordion', name: 'Accordion' },
    { key: 'engine', name: 'Car Engine' },
    { key: 'lavender_game_controller', name: 'Lavender Game Controller' },
    { key: 'blue_toy_rocket', name: 'Blue Toy Rocket' },
    { key: 'coral_usb_microphone', name: 'Coral Desktop Microphone' },
    { key: 'frog_piggy_bank', name: 'Frog Coin Bank' },
    { key: 'record_player', name: 'Record Player' },
    { key: 'wooden_toy_train', name: 'Wooden Toy Train' },
    { key: 'turquoise_smartwatch', name: 'Turquoise Smartwatch' },
    { key: 'yellow_table_fan', name: 'Yellow Table Fan' },
    { key: 'plush_otter', name: 'Plush Otter' },
    { key: 'mint_overear_headphones', name: 'Mint Headphones' },
    { key: 'dinosaur_planter', name: 'Dinosaur Planter' },
    { key: 'scissors', name: 'Tailor\'s Scissors' },
    { key: 'mint_kettle', name: 'Mint Kettle' },
    { key: 'rotary_phone', name: 'Rotary Phone' },
    { key: 'hedgehog_planter', name: 'Hedgehog Planter' },
    { key: 'rainbow_xylophone', name: 'Rainbow Xylophone' },
    { key: 'coral_smart_doorbell', name: 'Coral Smart Doorbell' },
    { key: 'red_panda_plush', name: 'Red Panda Plush' },
    { key: 'lavender_spray_bottle', name: 'Lavender Spray Bottle' },
    { key: 'plush_axolotl', name: 'Plush Axolotl' },
    { key: 'mint_wireless_router', name: 'Mint Wireless Router' },
    { key: 'owl_coin_bank', name: 'Owl Coin Bank' },
    { key: 'yellow_toy_submarine', name: 'Yellow Toy Submarine' },
    { key: 'cloth_iron', name: 'Steam Iron' },
    { key: 'blue_gps_navigator', name: 'Blue GPS Navigator' },
    { key: 'turquoise_espresso_pot', name: 'Turquoise Espresso Pot' },
    { key: 'television', name: 'Retro TV' },
    { key: 'binoculars', name: 'Binoculars' },
    { key: 'robot_mower', name: 'Robot Mower' },
    { key: 'sample_car', name: 'Station Wagon' },
    { key: 'lavender_hand_mixer', name: 'Lavender Hand Mixer' },
    { key: 'wooden_toy_airplane', name: 'Wooden Toy Airplane' },
    { key: 'plush_elephant', name: 'Plush Elephant' },
    { key: 'violet_vr_headset', name: 'Violet VR Headset' },
    { key: 'blue_ceramic_mug', name: 'Blue Ceramic Mug' },
    { key: 'lavender_power_bank', name: 'Lavender Power Bank' },
    { key: 'pinball_machine', name: 'Pinball Machine' },
    { key: 'metallic_mint_toy_pickup', name: 'Metallic Mint Toy Pickup' },
    { key: 'lavender_digital_pen', name: 'Lavender Digital Pen' },
    { key: 'cat_coin_bank', name: 'Cat Coin Bank' },
    { key: 'yellow_robot_vacuum', name: 'Yellow Robot Vacuum' },
    { key: 'pastel_stacking_rings', name: 'Pastel Stacking Rings' },
    { key: 'sample_car2', name: 'Pickup Truck' },
    { key: 'gumball_machine', name: 'Gumball Machine' },
    { key: 'metallic_yellow_toy_racecar', name: 'Metallic Yellow Toy Race Car' },
    { key: 'mint_wireless_mouse', name: 'Mint Wireless Mouse' },
    { key: 'coral_toy_sailboat', name: 'Coral Toy Sailboat' },
    { key: 'turquoise_smart_bottle', name: 'Turquoise Smart Bottle' },
    { key: 'yellow_dustpan', name: 'Yellow Dustpan' },
    { key: 'orange_action_camera', name: 'Orange Action Camera' },
    { key: 'plush_penguin', name: 'Plush Penguin' },
    { key: 'blue_digital_voice_recorder', name: 'Blue Digital Recorder' },
    { key: 'turquoise_sewing_machine', name: 'Turquoise Sewing Machine' },
    { key: 'blue_webcam', name: 'Blue Webcam' },
    { key: 'metallic_coral_toy_hatchback', name: 'Metallic Coral Toy Hatchback' },
    { key: 'purple_toy_robot', name: 'Purple Toy Robot' },
    { key: 'mint_toy_dump_truck', name: 'Mint Toy Dump Truck' },
    { key: 'pink_pocket_translator', name: 'Pink Pocket Translator' },
    { key: 'blue_teapot', name: 'Blue Teapot' },
    { key: 'bunny_snow_globe', name: 'Bunny Snow Globe' },
    { key: 'microscope', name: 'Microscope' },
    { key: 'lavender_desktop_speaker', name: 'Lavender Desktop Speaker' },
    { key: 'yellow_casserole', name: 'Yellow Casserole' },
    { key: 'coral_ukulele', name: 'Coral Ukulele' },
    { key: 'lavender_ceramic_vase', name: 'Lavender Ceramic Vase' },
    { key: 'blue_camera_drone', name: 'Blue Camera Drone' },
    { key: 'mint_tambourine', name: 'Mint Tambourine' },
    { key: 'film_projector', name: 'Film Projector' },
    { key: 'mint_colander', name: 'Mint Colander' },
    { key: 'plush_bunny', name: 'Plush Bunny' },
    { key: 'coral_portable_ssd', name: 'Coral Portable SSD' },
    { key: 'strawberry_music_box', name: 'Strawberry Music Box' },
    { key: 'computer', name: 'Old Computer' },
    { key: 'mushroom_night_light', name: 'Mushroom Night Light' },
    { key: 'blue_garden_trowel', name: 'Blue Garden Trowel' },
    { key: 'lavender_desk_lamp', name: 'Lavender Desk Lamp' },
    { key: 'orange_walkie_talkie', name: 'Orange Walkie-Talkie' },
    { key: 'pink_cookie_jar', name: 'Pink Cookie Jar' },
    { key: 'violet_portable_scanner', name: 'Violet Portable Scanner' },
    { key: 'mint_kitchen_scale', name: 'Mint Kitchen Scale' },
    { key: 'portable_radio', name: 'Portable Radio' },
    { key: 'stand_mixer', name: 'Stand Mixer' },
    { key: 'blue_smart_home_hub', name: 'Blue Smart Home Hub' },
    { key: 'peach_rice_cooker', name: 'Peach Rice Cooker' },
    { key: 'mint_smart_projector', name: 'Mint Smart Projector' },
    { key: 'toaster', name: 'Toaster' },
    { key: 'rubber_duck', name: 'Rubber Duck' },
    { key: 'peach_blender', name: 'Peach Blender' },
    { key: 'metallic_blue_toy_roadster', name: 'Metallic Blue Toy Roadster' },
    { key: 'fire_extinguisher', name: 'Fire Extinguisher' },
    { key: 'mint_digital_microscope', name: 'Mint Digital Microscope' },
    { key: 'coral_coffee_grinder', name: 'Coral Coffee Grinder' },
    { key: 'mint_toy_camera', name: 'Mint Toy Camera' },
    { key: 'blue_lunchbox', name: 'Blue Lunchbox' },
    { key: 'coral_trackball', name: 'Coral Trackball' },
    { key: 'yellow_citrus_juicer', name: 'Yellow Citrus Juicer' },
    { key: 'radio', name: 'Boombox' },
    { key: 'coral_watering_can', name: 'Coral Watering Can' },
];

// Browser demo on the website (scripts/build-demo.js sets window.DEMO_LEVELS): only the first
// few levels, and only their photos ship, so everything below picks from PLAYABLE.
export const DEMO_LEVELS = globalThis.DEMO_LEVELS || 0;
export const TOTAL_LEVELS = OBJECTS.length;
const PLAYABLE = DEMO_LEVELS ? OBJECTS.slice(0, DEMO_LEVELS) : OBJECTS;

// A handful of later nodes also require a minimum total star count (across all levels)
// on top of the usual sequential unlock, so replaying earlier levels for a 3rd star has
// a payoff. Keyed by level index (0-based).
const STAR_GATES = { 4: 8, 9: 20 };

// Tool progression: the level number (1-based) the player has to reach before a tool shows
// up in the hotbar and Shop. Each one is tuned to out-clear the one before it (IceLevel.js).
export const TOOL_UNLOCK_LEVEL = { pickaxe: 1, hairdryer: 3, scraper: 7 };

/** @param {number} unlockedIndex - SaveManager.unlockedIndex (0-based furthest level reached). */
export function isToolUnlocked(tool, unlockedIndex) {
    return unlockedIndex + 1 >= TOOL_UNLOCK_LEVEL[tool];
}

// Special rules a level can carry so levels differ by more than their photo. `tool` limits
// the hotbar to that one tool; the rest are implemented in IceLevel (refreeze) and
// GameplayScreen (fragile). `needs` is the tool a rule is pointless without.
export const RULES = {
    refreeze: { label: 'Frost Creep', desc: 'Cleared ice grows back - keep moving!' },
    fragile: { label: 'Fragile', desc: 'Don\'t let the Hairdryer overheat: +5s penalty.', needs: 'hairdryer' },
    pickaxeOnly: { label: 'Pickaxe Only', desc: 'Only the Pickaxe works on this one.', tool: 'pickaxe' },
    hairdryerOnly: { label: 'Hairdryer Only', desc: 'Only the Hairdryer works on this one.', tool: 'hairdryer' },
    scraperOnly: { label: 'Scraper Only', desc: 'Only the Scraper works on this one.', tool: 'scraper' },
};

// Level number (1-based) -> rule. A new idea every few levels, never on a level that
// introduces a tool (3, 7) and never needing a tool that isn't unlocked yet.
const LEVEL_RULES = {
    6: 'refreeze', 8: 'fragile', 9: 'pickaxeOnly',
    11: 'refreeze', 12: 'hairdryerOnly', 13: 'fragile', 14: 'scraperOnly',
    16: 'refreeze', 17: 'pickaxeOnly', 18: 'fragile', 19: 'hairdryerOnly',
    20: 'refreeze', 21: 'scraperOnly', 22: 'refreeze',
};

const FIRST_BONUS_LEVEL = 3; // hidden bonus Snowflakes start appearing in the ice here

function buildLevel(obj, i) {
    return {
        id: `lvl-${i + 1}`,
        index: i,
        number: i + 1,
        key: obj.key,
        name: obj.name,
        image: `${IMG}/${obj.key}.jpg`,
        thumb: `${IMG}/thumbs/${obj.key}.jpg`,
        // Difficulty only ever climbs: more chunks of ice to clear (whatever the object's
        // size - see IceLevel.load) and a bigger share of Deep Freeze ones.
        targetCells: Math.round(8 + i * 1.1),
        deepFreeze: Math.min(0.05 + i * 0.015, 0.28),
        bonusCells: i + 1 < FIRST_BONUS_LEVEL ? 0 : 1 + (i % 3),
        rule: LEVEL_RULES[i + 1] || null,
        starGate: DEMO_LEVELS ? 0 : STAR_GATES[i] || 0, // a short demo shouldn't stall on stars
    };
}

export const LEVELS = PLAYABLE.map(buildLevel);

export function getLevel(id) {
    return LEVELS.find((l) => l.id === id) || null;
}

export function getLevelByIndex(index) {
    return LEVELS[index] || null;
}

/** Local calendar day as 'YYYY-MM-DD' - the Daily Thing and its streak roll over at midnight. */
export function dayKey(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * Today's Daily Thing: one of the photos and one of the rules, both picked by the date, at a
 * fixed mid-to-hard difficulty. Never recorded as a numbered level (see `isDaily` in
 * GameplayScreen) - it only feeds the daily streak.
 * @param {number} unlockedIndex - rules needing a tool the player doesn't have yet are skipped.
 */
export function getDailyLevel(unlockedIndex, date = new Date()) {
    const day = Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86400000);
    const obj = PLAYABLE[day % PLAYABLE.length];
    const rules = [null, ...Object.keys(RULES)].filter((r) => {
        const tool = r && (RULES[r].tool || RULES[r].needs);
        return !tool || isToolUnlocked(tool, unlockedIndex);
    });
    return {
        ...buildLevel(obj, OBJECTS.indexOf(obj)),
        id: 'daily',
        isDaily: true,
        day: dayKey(date),
        targetCells: 22,
        deepFreeze: 0.2,
        bonusCells: 3,
        rule: rules[day % rules.length],
        starGate: 0,
    };
}
