'use strict';

// ================================
// CONSTANTS
// ================================
const ITEM_HEIGHT = 56;    // px — must match CSS .roller-item height
const VIEWFINDER_H = 260;   // px — must match CSS .roller-outer height
const PAD = 2;     // blank items top/bottom
const CENTER_OFFSET = (VIEWFINDER_H / 2) - (ITEM_HEIGHT / 2); // = 102px
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

let allActions = [];
let chosenAction = null;
let isRolling = false;

// ================================
// INIT
// ================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('../actions.json');
        const data = await res.json();
        allActions = data.actions_list || [];
    } catch (e) {
        allActions = [
            'Driving an auto-rickshaw', 'Flipping a pancake', 'Rock climbing',
            'Riding a very bumpy camel', 'Threading a needle', 'Directing traffic',
            'Ironing a shirt', 'Kicking a ball', 'Swimming underwater'
        ];
        console.error('Failed to load actions.json', e);
    }

    document.getElementById('start-btn').addEventListener('click', () => {
        resetRollerScreen();
        showScreen('screen-roller');
    });

    document.getElementById('roll-btn').addEventListener('click', rollAction);

    document.getElementById('next-round-btn').addEventListener('click', () => {
        resetRollerScreen();
    });

    document.getElementById('end-game-btn').addEventListener('click', () => {
        window.location.href = '../index.html';
    });
});

// ================================
// SCREEN MANAGEMENT
// ================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

function resetRollerScreen() {
    chosenAction = null;

    // Show roller, hide reveal
    document.getElementById('roller-outer').classList.remove('hidden');
    document.getElementById('reveal-box').classList.add('hidden');

    // Show roll btn, hide next-round
    document.getElementById('roll-btn').classList.remove('hidden');
    document.getElementById('roll-btn').disabled = false;
    document.getElementById('roll-btn').textContent = 'Roll Action!';
    document.getElementById('next-round-btn').classList.add('hidden');

    // Reset header
    document.getElementById('roller-title').textContent = 'Roll the Action';
    document.getElementById('roller-subtitle').textContent = 'Two players step up and roll!';

    // Build idle roller showing random items
    buildIdleRoller();

    showScreen('screen-roller');
}

// ================================
// COOLDOWN LOGIC
// ================================
function loadUsedActions() {
    try {
        const raw = localStorage.getItem('aom_used_actions');
        if (!raw) return [];
        return JSON.parse(raw).filter(e => Date.now() - e.ts < COOLDOWN_MS);
    } catch (_) { return []; }
}

function saveUsedActions(used) {
    try { localStorage.setItem('aom_used_actions', JSON.stringify(used)); } catch (_) { }
}

function pickActions(count) {
    const used = loadUsedActions();
    const usedSet = new Set(used.map(e => e.action));

    let pool = allActions.filter(a => !usedSet.has(a));
    if (pool.length < count) pool = [...allActions]; // reset when exhausted

    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const chosen = pool.slice(0, count);
    const now = Date.now();
    used.push(...chosen.map(action => ({ action, ts: now })));
    saveUsedActions(used);
    return chosen;
}

// ================================
// ROLLER: IDLE
// ================================
function buildIdleRoller() {
    // Pick 8 random items to show — no cooldown marking for idle
    const shuffled = [...allActions].sort(() => Math.random() - 0.5).slice(0, 8);
    const track = document.getElementById('roller-track');
    buildTrackItems(track, shuffled);

    // Position so first real item is centered in viewfinder
    track.style.transition = 'none';
    track.style.transform = `translateY(${translateForIndex(0)}px)`;
}

// ================================
// TRACK HELPERS
// ================================
function buildTrackItems(track, items) {
    track.innerHTML = '';
    for (let i = 0; i < PAD; i++) track.appendChild(makeItem(''));
    items.forEach(text => track.appendChild(makeItem(text)));
    for (let i = 0; i < PAD; i++) track.appendChild(makeItem(''));
}

function makeItem(text) {
    const el = document.createElement('div');
    el.className = 'roller-item';
    el.textContent = text;
    return el;
}

/**
 * Compute translateY so that loopList item at `loopIndex` is centred
 * in the viewfinder's gold highlight band.
 * DOM index = PAD + loopIndex
 */
function translateForIndex(loopIndex) {
    return CENTER_OFFSET - ((PAD + loopIndex) * ITEM_HEIGHT);
}

// ================================
// ROLLER: SPIN
// ================================
async function rollAction() {
    if (isRolling) return;
    isRolling = true;

    const rollBtn = document.getElementById('roll-btn');
    const nextRoundBtn = document.getElementById('next-round-btn');
    const revealBox = document.getElementById('reveal-box');
    const track = document.getElementById('roller-track');
    const rollerOuter = document.getElementById('roller-outer');

    rollBtn.disabled = true;
    rollBtn.textContent = 'Rolling...';

    // --- Build looping list ---
    // Pick 6-10 actions for this spin
    const spinCount = 6 + Math.floor(Math.random() * 5); // 6..10
    const spinList = pickActions(spinCount);
    // Repeat 6 times to create an endless-loop illusion
    const REPS = 6;
    const loopList = [];
    for (let r = 0; r < REPS; r++) spinList.forEach(a => loopList.push(a));

    // Winner is the last item of the second-to-last full repetition
    // = index (REPS-1)*spinCount - 1 (well into the list, guaranteed visible)
    const winnerLoopIdx = (REPS - 1) * spinCount + (spinCount - 1);

    buildTrackItems(track, loopList);
    await tick();

    // Start: first item centred (translateY = CENTER_OFFSET - PAD*ITEM_HEIGHT)
    const startY = translateForIndex(0);
    track.style.transition = 'none';
    track.style.transform = `translateY(${startY}px)`;
    await tick();

    // Phase 1: fast scroll — stop 2 full reps before winner
    const fastEndIdx = Math.max(0, winnerLoopIdx - 2 * spinCount);
    const fastEndY = translateForIndex(fastEndIdx);
    await animateTrack(track, fastEndY, 1400, 'cubic-bezier(0.15, 0, 0.85, 1)');

    // Phase 2: slow decelerate into winner
    const slowEndY = translateForIndex(winnerLoopIdx);
    await animateTrack(track, slowEndY, 1800, 'cubic-bezier(0.25, 0.46, 0.45, 0.94)');

    // Highlight the winner DOM element
    const allItems = track.querySelectorAll('.roller-item');
    const winnerEl = allItems[PAD + winnerLoopIdx];
    if (winnerEl) {
        winnerEl.classList.add('roller-winner');
        await delay(200);
        winnerEl.classList.add('roller-glow');
    }

    chosenAction = spinList[spinList.length - 1]; // last of original spinList

    // Short pause, then reveal
    await delay(700);

    // Show reveal, hide roller
    document.getElementById('reveal-action-text').textContent = chosenAction;
    rollerOuter.classList.add('hidden');
    revealBox.classList.remove('hidden');

    // Update header to game identity
    document.getElementById('roller-title').textContent = 'Act-O-Matic';
    document.getElementById('roller-subtitle').textContent = 'Actions speak louder than words and look much dumber.';

    rollBtn.classList.add('hidden');
    nextRoundBtn.classList.remove('hidden');

    isRolling = false;
}

// ================================
// HELPERS
// ================================
function animateTrack(track, toY, duration, easing) {
    return new Promise(resolve => {
        track.style.transition = `transform ${duration}ms ${easing}`;
        track.style.transform = `translateY(${toY}px)`;
        setTimeout(resolve, duration + 60);
    });
}

function tick() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
