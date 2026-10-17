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

    setupRulesPopup();
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
    const oldStage = document.querySelector('#roller-outer .roll-stage');
    if (oldStage) oldStage.remove();
    const ft = document.getElementById('flash-text');
    if (ft) ft.classList.remove('roll-hidden');
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

    await deckRoll(spinSequence, winner);

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
// Roll animation: action cards flip past on a small deck, slowing down,
// then the chosen card lands with a bounce and a burst of light.
function rollReduced() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

function rollStage() {
    const outer = document.getElementById('roller-outer');
    let stage = outer.querySelector('.roll-stage');
    if (!stage) {
        stage = document.createElement('div');
        stage.className = 'roll-stage';
        stage.innerHTML =
            '<div class="roll-card roll-card-under u2"></div>' +
            '<div class="roll-card roll-card-under u1"></div>' +
            '<div class="roll-card roll-card-top"><span class="roll-card-text"></span></div>' +
            '<div class="roll-burst"></div>';
        outer.appendChild(stage);
    }
    return stage;
}

async function deckRoll(sequence, winner) {
    const flashText = document.getElementById('flash-text');
    flashText.classList.add('roll-hidden');
    const stage = rollStage();
    const card = stage.querySelector('.roll-card-top');
    const text = card.querySelector('.roll-card-text');
    stage.classList.remove('is-landed');
    stage.classList.add('is-rolling');
    const canAnim = typeof card.animate === 'function' && !rollReduced();
    // Constant fast speed all the way, so no earlier action is readable; then the card lands.
    const steps = Math.min(sequence.length, 18);
    for (let i = 0; i < steps; i++) {
        const dur = 70;
        text.textContent = sequence[i];
        if (canAnim) {
            await card.animate([
                { transform: 'translateY(16px) rotateX(-70deg)', opacity: 0.35 },
                { transform: 'translateY(0) rotateX(0deg)', opacity: 1 }
            ], { duration: dur * 0.55, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }).finished.catch(() => { });
        }
        await delay(dur * 0.45);
        if (canAnim && i < steps - 1) {
            await card.animate([
                { transform: 'none', opacity: 1 },
                { transform: 'translateY(-16px) rotateX(70deg)', opacity: 0.35 }
            ], { duration: Math.max(40, dur * 0.35), easing: 'ease-in' }).finished.catch(() => { });
        }
    }
    text.textContent = winner;
    stage.classList.remove('is-rolling');
    stage.classList.add('is-landed');
    if (canAnim) {
        card.animate([
            { transform: 'translateY(26px) rotateX(-90deg) scale(0.9)', opacity: 0 },
            { transform: 'translateY(-6px) rotateX(8deg) scale(1.1)', opacity: 1, offset: 0.6 },
            { transform: 'none', opacity: 1 }
        ], { duration: 650, easing: 'cubic-bezier(0.2, 1.3, 0.4, 1)' });
        rollBurst(stage);
    }
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { }
}

function rollBurst(stage) {
    const ring = stage.querySelector('.roll-burst');
    ring.animate([
        { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 },
        { transform: 'translate(-50%, -50%) scale(2.4)', opacity: 0 }
    ], { duration: 700, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    for (let i = 0; i < 14; i++) {
        const spark = document.createElement('span');
        spark.className = 'roll-spark';
        stage.appendChild(spark);
        const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 80 + Math.random() * 60;
        spark.animate([
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
            { transform: 'translate(calc(-50% + ' + Math.cos(angle) * dist + 'px), calc(-50% + ' + Math.sin(angle) * dist + 'px)) scale(0.2)', opacity: 0 }
        ], { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' })
            .finished.then(() => spark.remove(), () => spark.remove());
    }
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}


// Rules popup, the same as Mafia and Undercover. Lives at page level so no screen animation can trap it.
function setupRulesPopup() {
    const modal = document.getElementById('rules-modal');
    const btn = document.getElementById('rules-btn');
    if (!modal || !btn) return;
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    const open = () => { modal.classList.remove('hidden'); const s = modal.querySelector('.rules-scroll'); if (s) s.scrollTop = 0; };
    const close = () => modal.classList.add('hidden');
    btn.addEventListener('click', open);
    document.getElementById('close-rules').addEventListener('click', close);
    document.getElementById('rules-modal-overlay').addEventListener('click', close);
}
