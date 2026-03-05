'use strict';

// ================================
// CONSTANTS
// ================================
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
            'Riding a very bumpy camel', 'Threading a needle', 'Directing traffic'
        ];
        console.error('Failed to load actions.json', e);
    }

    document.getElementById('start-btn').addEventListener('click', () => {
        buildIdleRoller();
        showScreen('screen-roller');
    });

    document.getElementById('roll-btn').addEventListener('click', rollAction);

    document.getElementById('next-round-btn').addEventListener('click', () => {
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

// ================================
// PICK ACTION — truly random from full list
// ================================
function pickAction() {
    const used = loadUsedActions();
    const usedSet = new Set(used.map(e => e.action));

    // Always prefer unused actions first
    let pool = allActions.filter(a => !usedSet.has(a));

    // If all actions have been used, reset the entire pool
    if (pool.length === 0) {
        localStorage.removeItem('aom_used_actions');
        pool = [...allActions];
    }

    // Fisher-Yates shuffle the entire pool for true randomness
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    // Pick from a random position in the shuffled pool (not always index 0)
    const randomPos = Math.floor(Math.random() * pool.length);
    const chosen = pool[randomPos];

    const updatedUsed = loadUsedActions();
    updatedUsed.push({ action: chosen, ts: Date.now() });
    saveUsedActions(updatedUsed);

    return chosen;
}

// ================================
// ROLLER: IDLE STATE
// ================================
function buildIdleRoller() {
    const flashText = document.getElementById('flash-text');
    flashText.textContent = "Ready to Roll?";
    flashText.className = 'flash-text';
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
    const flashText = document.getElementById('flash-text');

    rollBtn.disabled = true;
    rollBtn.textContent = 'Rolling...';
    revealBox.classList.add('hidden');

    const winner = pickAction();

    // Build a spin sequence — shuffle the FULL list multiple times and chain them
    // This ensures every item from the entire JSON gets a chance to flash by
    function fullShuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // Chain 3 full shuffles together so animation cycles through lots of variety
    const spinSequence = [
        ...fullShuffle(allActions),
        ...fullShuffle(allActions),
        ...fullShuffle(allActions)
    ].filter(a => a !== winner); // keep winner out until the very end

    const TOTAL_FLIPS = Math.min(spinSequence.length, 60); // show up to 60 items
    let delayMs = 35; // start fast

    flashText.className = 'flash-text';

    for (let i = 0; i < TOTAL_FLIPS; i++) {
        flashText.textContent = spinSequence[i];

        flashText.classList.remove('flash-active');
        void flashText.offsetWidth; // reflow to restart animation
        flashText.classList.add('flash-active');

        await delay(delayMs);

        // Start braking after halfway point
        if (i > TOTAL_FLIPS * 0.5) {
            delayMs += (i - TOTAL_FLIPS * 0.5) * 1.2;
        }
    }

    // Land on winner
    flashText.textContent = winner;
    flashText.className = 'flash-text flash-winner';

    chosenAction = winner;

    await delay(1500);

    document.getElementById('reveal-action-text').textContent = chosenAction;
    revealBox.classList.remove('hidden');

    document.getElementById('roller-title').textContent = 'Act-O-Matic';
    document.getElementById('roller-subtitle').textContent = "Actions speak louder than words and look much dumber";
    document.getElementById('roller-outer').classList.add('hidden');

    rollBtn.classList.add('hidden');
    nextRoundBtn.classList.remove('hidden');

    isRolling = false;
    rollBtn.disabled = false;
}

// ================================
// ANIMATION HELPERS
// ================================
function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
