'use strict';

// ================================
// CONSTANTS
// ================================
const ITEM_HEIGHT = 56;   // px - must match CSS .roller-item height
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

let allActions = [];
let chosenAction = null;
let isRolling = false;

// ================================
// INIT
// ================================
document.addEventListener('DOMContentLoaded', async () => {
    // Load actions from JSON
    try {
        const res = await fetch('../actions.json');
        const data = await res.json();
        allActions = data.actions_list || [];
    } catch (e) {
        allActions = [
            'Driving an auto-rickshaw', 'Flipping a pancake', 'Rock climbing',
            'Riding a very bumpy camel', 'Threading a needle', 'Directing traffic'
        ];
        console.error('Failed to load actions.json', e);
    }

    // Button listeners
    document.getElementById('start-btn').addEventListener('click', () => {
        buildIdleRoller();
        showScreen('screen-roller');
    });

    document.getElementById('roll-btn').addEventListener('click', rollAction);

    document.getElementById('next-round-btn').addEventListener('click', () => {
        // Reset for another spin
        chosenAction = null;
        document.getElementById('reveal-box').classList.add('hidden');
        document.getElementById('next-round-btn').classList.add('hidden');
        document.getElementById('roll-btn').classList.remove('hidden');
        document.getElementById('roll-btn').textContent = 'Roll Action!';
        document.getElementById('roller-title').textContent = 'Roll the Action';
        document.getElementById('roller-subtitle').textContent = 'Two players step up and roll!';
        document.getElementById('roller-outer').classList.remove('hidden');
        buildIdleRoller();
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

// ================================
// COOLDOWN LOGIC
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
    const used = loadUsedActions();
    const usedSet = new Set(used.map(e => e.action));

    let pool = allActions.filter(a => !usedSet.has(a));
    if (pool.length < count) pool = [...allActions]; // reset if pool too small

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
// ROLLER: IDLE STATE
// ================================
function buildIdleRoller() {
    const track = document.getElementById('roller-track');
    // Pick a fresh display list for idle
    let demo = [...allActions].sort(() => Math.random() - 0.5).slice(0, 8);
    track.style.transition = 'none';
    track.style.transform = 'translateY(0px)';
    buildTrackItems(track, demo);
}

function buildTrackItems(track, items) {
    track.innerHTML = '';
    // 2 blank padding items top and bottom so center is visible
    const PAD = 2;
    for (let i = 0; i < PAD; i++) {
        track.appendChild(makeDivItem(''));
    }
    items.forEach(text => {
        track.appendChild(makeDivItem(text));
    });
    for (let i = 0; i < PAD; i++) {
        track.appendChild(makeDivItem(''));
    }
}

function makeDivItem(text) {
    const el = document.createElement('div');
    el.className = 'roller-item';
    el.textContent = text;
    return el;
}

// ================================
// ROLLER: SPIN ANIMATION
// ================================
async function rollAction() {
    if (isRolling) return;
    isRolling = true;

    const rollBtn = document.getElementById('roll-btn');
    const revealBox = document.getElementById('reveal-box');
    const nextRoundBtn = document.getElementById('next-round-btn');
    const track = document.getElementById('roller-track');

    rollBtn.disabled = true;
    rollBtn.textContent = 'Rolling...';
    revealBox.classList.add('hidden');

    // Pick 6-10 actions for this spin
    const spinCount = 6 + Math.floor(Math.random() * 5); // 6..10
    const spinList = pickActions(spinCount);
    // Winner = last item in spinList
    const winner = spinList[spinList.length - 1];

    // Build a LOOPING track:
    // We repeat spinList 4 times + partial last to create the illusion of endless loop
    const REPEATS = 5;
    const loopList = [];
    for (let r = 0; r < REPEATS; r++) {
        spinList.forEach(a => loopList.push(a));
    }
    // The "winner" position = (REPEATS-1)*spinList.length + winnerIndex in last batch
    const winnerIndexInLoop = (REPEATS - 1) * spinList.length + (spinList.length - 1);

    buildTrackItems(track, loopList);
    await tick();

    // Reset to top
    track.style.transition = 'none';
    track.style.transform = 'translateY(0px)';
    await tick();

    const PAD = 2;

    // Phase 1: fast scroll past first (REPEATS-2)*spinList items quickly
    const fastScrollItems = (REPEATS - 2) * spinList.length;
    const fastTarget = -(fastScrollItems * ITEM_HEIGHT);
    await animateTrack(track, 0, fastTarget, 1400, 'cubic-bezier(0.25, 0, 0.8, 1)');

    // Phase 2: slow scroll to winner
    const totalItems = winnerIndexInLoop + PAD;
    const slowTarget = -(winnerIndexInLoop * ITEM_HEIGHT);
    await animateTrack(track, fastTarget, slowTarget, 1600, 'cubic-bezier(0.25, 0.46, 0.45, 0.94)');

    // Highlight winner item in track
    const allItems = track.querySelectorAll('.roller-item');
    const winnerEl = allItems[PAD + winnerIndexInLoop];
    if (winnerEl) {
        winnerEl.classList.add('roller-winner');
        await delay(250);
        winnerEl.classList.add('roller-glow');
    }

    chosenAction = winner;

    // Short pause then reveal below the roller
    await delay(600);

    // Update reveal box
    document.getElementById('reveal-action-text').textContent = chosenAction;
    revealBox.classList.remove('hidden');

    // Update title/subtitle
    document.getElementById('roller-title').textContent = 'Your Action!';
    document.getElementById('roller-subtitle').textContent = "Actor: memorise, then hand phone face-down to the Leader!";

    // Hide roller animation, show result more prominently
    document.getElementById('roller-outer').classList.add('hidden');

    rollBtn.classList.add('hidden');
    nextRoundBtn.classList.remove('hidden');

    isRolling = false;
    rollBtn.disabled = false;
}

// ================================
// ANIMATION HELPERS
// ================================
function animateTrack(track, from, to, duration, easing) {
    return new Promise(resolve => {
        track.style.transition = `transform ${duration}ms ${easing}`;
        track.style.transform = `translateY(${to}px)`;
        setTimeout(resolve, duration + 60);
    });
}

function tick() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
