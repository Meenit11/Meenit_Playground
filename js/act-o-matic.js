'use strict';

// ================================
// CONSTANTS
// ================================
const ITEM_H = 56;    // px — must match CSS .roller-item height
const VIEWER_H = 260;   // px — .roller-outer height
const VIEWER_CENTER = VIEWER_H / 2; // 130px
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
            'Sumo wrestling', 'Building a sandcastle', 'Ice skating for the first time'
        ];
    }

    document.getElementById('start-btn').addEventListener('click', () => {
        prepareRoller();
        showScreen('screen-roller');
    });

    document.getElementById('roll-btn').addEventListener('click', rollAction);

    document.getElementById('next-round-btn').addEventListener('click', () => {
        resetForNextRoll();
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

function resetForNextRoll() {
    chosenAction = null;
    // Hide reveal, show roller
    document.getElementById('reveal-box').classList.add('hidden');
    document.getElementById('next-round-btn').classList.add('hidden');
    document.getElementById('roll-btn').classList.remove('hidden');
    document.getElementById('roll-btn').disabled = false;
    document.getElementById('roll-btn').textContent = 'Roll Action!';
    document.getElementById('roller-title').textContent = 'Act-O-Matic';
    document.getElementById('roller-subtitle').textContent = 'Actions speak louder than words and look much dumber.';
    document.getElementById('roller-outer').classList.remove('hidden');
    prepareRoller();
}

// ================================
// COOLDOWN LOGIC
// ================================
function loadUsed() {
    try {
        const raw = localStorage.getItem('aom_used_actions');
        if (!raw) return [];
        return JSON.parse(raw).filter(e => Date.now() - e.ts < COOLDOWN_MS);
    } catch (_) { return []; }
}

function saveUsed(used) {
    try { localStorage.setItem('aom_used_actions', JSON.stringify(used)); } catch (_) { }
}

function pickBatch(count) {
    const used = loadUsed();
    const usedSet = new Set(used.map(e => e.action));
    let pool = allActions.filter(a => !usedSet.has(a));
    if (pool.length < count) pool = [...allActions];
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const batch = pool.slice(0, count);
    const now = Date.now();
    used.push(...batch.map(action => ({ action, ts: now })));
    saveUsed(used);
    return batch;
}

// ================================
// ROLLER: PREPARE IDLE STATE
// ================================
function prepareRoller() {
    const track = document.getElementById('roller-track');
    const demo = [...allActions].sort(() => Math.random() - 0.5).slice(0, 8);
    // Show middle of the list initially so center slot is filled
    track.style.transition = 'none';

    const fullList = buildInfiniteList(demo, 20); // 20 repeats
    buildTrackDOM(track, fullList);

    // Start showing the middle so items are visible
    const startIdx = Math.floor(fullList.length / 2);
    const startY = centeredTranslateY(startIdx);
    track.style.transform = `translateY(${startY}px)`;
}

// ================================
// BUILD AN "INFINITE" LIST
// ================================
function buildInfiniteList(batch, repeats) {
    const result = [];
    for (let r = 0; r < repeats; r++) {
        batch.forEach(a => result.push(a));
    }
    return result;
}

function buildTrackDOM(track, items) {
    track.innerHTML = '';
    items.forEach(text => {
        const el = document.createElement('div');
        el.className = 'roller-item';
        el.textContent = text;
        track.appendChild(el);
    });
}

// translateY to center item at absolute index `idx` in viewfinder
function centeredTranslateY(idx) {
    // Center of item idx = idx * ITEM_H + ITEM_H/2
    // We need that to equal VIEWER_CENTER
    // So translateY = -(idx * ITEM_H + ITEM_H/2 - VIEWER_CENTER)
    return -(idx * ITEM_H + ITEM_H / 2 - VIEWER_CENTER);
}

// ================================
// ROLLER: SPIN ANIMATION
// ================================
async function rollAction() {
    if (isRolling) return;
    isRolling = true;

    const rollBtn = document.getElementById('roll-btn');
    const revealBox = document.getElementById('reveal-box');
    const nextBtn = document.getElementById('next-round-btn');
    const track = document.getElementById('roller-track');

    rollBtn.disabled = true;
    rollBtn.textContent = 'Rolling...';
    revealBox.classList.add('hidden');

    // Pick 6-10 unique actions for this spin
    const batchSize = 6 + Math.floor(Math.random() * 5); // 6..10
    const batch = pickBatch(batchSize);
    const winner = batch[batch.length - 1];

    // Build a very long list: 30 repeats of batch = 180-300 items
    const REPEATS = 30;
    const fullList = buildInfiniteList(batch, REPEATS);
    buildTrackDOM(track, fullList);
    await tick();

    // --- START POSITION: show items from the beginning (index 3 visible) ---
    const startIdx = 3;
    const startY = centeredTranslateY(startIdx);
    track.style.transition = 'none';
    track.style.transform = `translateY(${startY}px)`;
    await tick();

    // --- WINNER INDEX: pick from batch 20-25 range (deep inside, safe) ---
    const winnerBatch = 22; // which repeat of the batch contains winner
    const winnerPosInLoop = winnerBatch * batchSize + (batchSize - 1); // last item of batch 22
    const fastStopIdx = winnerPosInLoop - 2 * batchSize; // stop fast phase here (2 batches before winner)

    // Phase 1: FAST scroll to fastStopIdx
    const fastY = centeredTranslateY(fastStopIdx);
    await animateTrack(track, startY, fastY, 1300, 'cubic-bezier(0.12, 0, 0.6, 1)');

    // Phase 2: SLOW scroll to winner
    const winnerY = centeredTranslateY(winnerPosInLoop);
    await animateTrack(track, fastY, winnerY, 1800, 'cubic-bezier(0.22, 0.61, 0.36, 1)');

    // Highlight the winner element
    const allItems = track.querySelectorAll('.roller-item');
    const winEl = allItems[winnerPosInLoop];
    if (winEl) {
        winEl.classList.add('roller-winner');
        await delay(200);
        winEl.classList.add('roller-glow');
    }

    chosenAction = winner;
    await delay(500);

    // Show reveal box, hide roller
    document.getElementById('reveal-action-text').textContent = chosenAction;
    document.getElementById('roller-outer').classList.add('hidden');
    revealBox.classList.remove('hidden');

    // Update header to show game identity
    document.getElementById('roller-title').textContent = 'Act-O-Matic';
    document.getElementById('roller-subtitle').textContent = 'Actions speak louder than words and look much dumber.';

    rollBtn.classList.add('hidden');
    nextBtn.classList.remove('hidden');

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
