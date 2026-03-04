'use strict';

// ================================
// CONSTANTS
// ================================
const ITEM_HEIGHT = 56; // px — must match CSS .roller-item height
const VISIBLE_ITEMS = 5;  // items visible in viewfinder at once
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

let allActions = [];
let chosenAction = null;
let isRolling = false;
let playerCount = 4;

// ================================
// INIT
// ================================
document.addEventListener('DOMContentLoaded', async () => {
    // Load actions JSON
    try {
        const res = await fetch('../actions.json');
        const data = await res.json();
        allActions = data.actions_list || [];
    } catch (e) {
        allActions = ['Driving an auto-rickshaw', 'Flipping a pancake', 'Rock climbing', 'Riding a bumpy camel'];
        console.error('Failed to load actions.json', e);
    }

    // Player counter
    document.getElementById('decrease-players').addEventListener('click', () => {
        if (playerCount > 2) { playerCount--; updatePlayerDisplay(); }
    });
    document.getElementById('increase-players').addEventListener('click', () => {
        playerCount++;
        updatePlayerDisplay();
    });

    // Navigation
    document.getElementById('start-btn').addEventListener('click', () => showScreen('screen-roller'));
    document.getElementById('back-to-setup-btn').addEventListener('click', (e) => {
        e.preventDefault();
        showScreen('screen-setup');
    });
    document.getElementById('roll-btn').addEventListener('click', rollAction);
    document.getElementById('reveal-btn').addEventListener('click', () => {
        document.getElementById('reveal-action-text').textContent = chosenAction;
        showScreen('screen-reveal');
    });
    document.getElementById('next-round-btn').addEventListener('click', () => {
        // Reset roller for next spin
        chosenAction = null;
        document.getElementById('roller-result-banner').classList.add('hidden');
        document.getElementById('reveal-btn').classList.add('hidden');
        document.getElementById('roll-btn').classList.remove('hidden');
        document.getElementById('roll-btn').textContent = '🎲 Roll Action!';
        buildIdleRoller();
        showScreen('screen-roller');
    });
});

function updatePlayerDisplay() {
    document.getElementById('player-count-display').textContent = playerCount;
}

// ================================
// SCREEN MANAGEMENT
// ================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');

    if (id === 'screen-roller') buildIdleRoller();
}

// ================================
// COOLDOWN LOGIC (same as words.json rotation)
// ================================
function loadUsedActions() {
    try {
        const raw = localStorage.getItem('aom_used_actions');
        if (!raw) return [];
        const list = JSON.parse(raw);
        const now = Date.now();
        return list.filter(e => now - e.ts < COOLDOWN_MS);
    } catch (_) { return []; }
}

function saveUsedActions(used) {
    try { localStorage.setItem('aom_used_actions', JSON.stringify(used)); } catch (_) { }
}

function pickActions(count) {
    // Get recently used action texts
    const used = loadUsedActions();
    const usedSet = new Set(used.map(e => e.action));

    // Available pool excludes recently used
    let pool = allActions.filter(a => !usedSet.has(a));
    if (pool.length < count) pool = allActions; // reset if pool too small

    // Fisher-Yates shuffle pool
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const chosen = pool.slice(0, count);

    // Mark chosen as used
    const now = Date.now();
    used.push(...chosen.map(action => ({ action, ts: now })));
    saveUsedActions(used);

    return chosen;
}

// ================================
// ROLLER: IDLE STATE
// ================================
function buildIdleRoller() {
    const track = document.getElementById('roller-track');
    // Show a slow-drifting placeholder list
    const demo = [...allActions].sort(() => Math.random() - 0.5).slice(0, 8);
    track.style.transition = 'none';
    track.style.transform = `translateY(0px)`;
    buildTrackItems(track, demo);
}

function buildTrackItems(track, items) {
    track.innerHTML = '';
    // Add padding items top + bottom so center item is visible
    const pad = Math.floor(VISIBLE_ITEMS / 2); // 2
    for (let i = 0; i < pad; i++) {
        const spacer = document.createElement('div');
        spacer.className = 'roller-item';
        track.appendChild(spacer);
    }
    items.forEach(text => {
        const el = document.createElement('div');
        el.className = 'roller-item';
        el.textContent = text;
        track.appendChild(el);
    });
    for (let i = 0; i < pad; i++) {
        const spacer = document.createElement('div');
        spacer.className = 'roller-item';
        track.appendChild(spacer);
    }
}

// ================================
// ROLLER: SPIN ANIMATION
// ================================
async function rollAction() {
    if (isRolling) return;
    isRolling = true;

    const rollBtn = document.getElementById('roll-btn');
    const revealBtn = document.getElementById('reveal-btn');
    const resultBanner = document.getElementById('roller-result-banner');
    const track = document.getElementById('roller-track');

    rollBtn.disabled = true;
    rollBtn.textContent = '🌀 Rolling...';
    resultBanner.classList.add('hidden');
    revealBtn.classList.add('hidden');

    // Pick 6 – 10 actions for this spin
    const spinCount = 6 + Math.floor(Math.random() * 5); // 6..10
    const spinList = pickActions(spinCount);

    // The winner is the last item
    const winnerIndex = spinList.length - 1;
    // How many full rotations before slow-down (extra padding at start)
    const extraScrollItems = 10; // scroll through 10 extra items before slowing

    // Build track: [extras (repeated from spinList)] + spinList
    const extraItems = [];
    for (let i = 0; i < extraScrollItems; i++) {
        extraItems.push(spinList[i % spinList.length]);
    }
    const fullList = [...extraItems, ...spinList];
    buildTrackItems(track, fullList);

    // Wait one tick so DOM settles
    await tick();

    // Start at top (translateY = 0 means first padding item is centred)
    track.style.transition = 'none';
    track.style.transform = 'translateY(0px)';
    await tick();

    // Phase 1: fast scroll to the beginning of spinList (past extraItems)
    const fastTarget = -(extraScrollItems * ITEM_HEIGHT);
    const fastDuration = 1200; // ms
    await animateTrack(track, 0, fastTarget, fastDuration, 'cubic-bezier(0.1, 0, 0.9, 1)');

    // Phase 2: slow scroll to the winner item inside spinList
    const totalOffset = -((extraScrollItems + winnerIndex) * ITEM_HEIGHT);
    const slowDuration = 1800;
    await animateTrack(track, fastTarget, totalOffset, slowDuration, 'cubic-bezier(0.25, 0.46, 0.45, 0.94)');

    // Mark winner item
    const allItems = track.querySelectorAll('.roller-item');
    // The winner item index in track (with top padding)
    const padCount = Math.floor(VISIBLE_ITEMS / 2);
    const winnerEl = allItems[padCount + extraScrollItems + winnerIndex];
    if (winnerEl) {
        winnerEl.classList.add('roller-winner');
        // Small delay then glow
        await delay(200);
        winnerEl.classList.add('roller-glow');
    }

    chosenAction = spinList[winnerIndex];

    // Show result
    const banner = document.getElementById('roller-result-banner');
    document.getElementById('roller-result-text').textContent = `✨ "${chosenAction}"`;
    banner.classList.remove('hidden');

    rollBtn.classList.add('hidden');
    revealBtn.classList.remove('hidden');

    isRolling = false;
}

// Animate track from `from` to `to` translateY over `duration` ms with `easing`
function animateTrack(track, from, to, duration, easing) {
    return new Promise(resolve => {
        track.style.transition = `transform ${duration}ms ${easing}`;
        track.style.transform = `translateY(${to}px)`;
        setTimeout(resolve, duration + 50);
    });
}

function tick() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
