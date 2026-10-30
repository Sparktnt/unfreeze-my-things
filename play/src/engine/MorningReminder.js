// Daily morning reminder via @capacitor/local-notifications. Scheduled on the phone itself,
// so no server is involved. Like BreakManager, the plugin is reached through
// window.Capacitor.Plugins and every call silently no-ops in a desktop/browser preview.

const HOUR = 9; // local time the reminder fires
const MINUTE = 0;

// One per weekday (index 0 = Sunday) so the reminder doesn't read the same every morning.
const MESSAGES = [
    { title: 'Lazy Sunday freeze 🧊', body: 'Your things are still stuck in the ice. Come thaw them out!' },
    { title: 'Your things froze overnight! ❄️', body: 'Grab your pickaxe and melt them free before your coffee gets cold.' },
    { title: 'Brrr, good morning! 🥶', body: 'Something of yours is frozen solid and waiting for you.' },
    { title: 'Your things are shivering ❄️', body: 'A few taps is all it takes to thaw them out.' },
    { title: 'New day, new ice 🧊', body: "Today's Daily Thing is waiting to be unfrozen. Keep your streak going!" },
    { title: 'Stuck in the ice! ❄️', body: "Your things can't move a muscle. Come chip them free!" },
    { title: 'Weekend thaw ☀️', body: 'Your frozen things are counting on you. Time to melt some ice!' },
];

/** Asks for notification permission (Android 13+ shows a prompt) and (re)schedules the
 *  week of reminders. Safe to call on every launch - the same ids just get replaced. */
export async function scheduleMorningReminder() {
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LN) return;
    try {
        const { display } = await LN.requestPermissions();
        if (display !== 'granted') return;
        await LN.schedule({
            notifications: MESSAGES.map((m, i) => ({
                id: 1000 + i,
                title: m.title,
                body: m.body,
                largeIcon: 'ic_notify_large', // res/drawable-nodpi - the full-colour app icon
                // Around 9:00 is fine - without this the plugin sends the player to the
                // "Alarms & reminders" settings screen to ask for exact alarms.
                isExactNotification: false,
                schedule: { on: { weekday: i + 1, hour: HOUR, minute: MINUTE } }, // weekday: 1 = Sunday
            })),
        });
    } catch (_) { /* notifications unavailable - the game works fine without them */ }
}
