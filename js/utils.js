// ================================
// SHARED UTILITIES
// ================================

/**
 * Generates a random alphanumeric ID
 */
function generateId() {
    return Math.random().toString(36).substring(2, 9).toUpperCase();
}

/**
 * Saves game state to localStorage with a prefix
 */
function saveGame(gameKey, state) {
    try {
        localStorage.setItem(`meenit-${gameKey}`, JSON.stringify(state));
    } catch (e) {
        console.error('Error saving game:', e);
    }
}

/**
 * Loads game state from localStorage
 */
function loadGame(gameKey) {
    try {
        const data = localStorage.getItem(`meenit-${gameKey}`);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        console.error('Error loading game:', e);
        return null;
    }
}

/**
 * Creates a DOM element with classes and attributes
 */
function createElement(tag, options = {}) {
    const el = document.createElement(tag);

    if (options.classes) {
        options.classes.forEach(c => {
            if (c) el.classList.add(c);
        });
    }

    if (options.text) el.textContent = options.text;
    if (options.html) el.innerHTML = options.html;

    if (options.attrs) {
        Object.entries(options.attrs).forEach(([key, value]) => {
            el.setAttribute(key, value);
        });
    }

    return el;
}

/**
 * Adds a shake animation to an element
 */
function shakeElement(element) {
    if (!element) return;
    element.classList.add('animate-shake');
    setTimeout(() => {
        element.classList.remove('animate-shake');
    }, 500);
}

/**
 * Returns a random item from an array
 */
function getRandomItem(array) {
    if (!array || array.length === 0) return null;
    return array[Math.floor(Math.random() * array.length)];
}

/**
 * Shows a specific screen by ID and hides others
 */
function showScreen(screenId, allScreenIds) {
    allScreenIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('hidden', id !== screenId);
        }
    });
}

/**
 * Setup global storage listener for cross-tab sync debug
 */
window.addEventListener('storage', (e) => {
    console.log('Storage changed:', e.key);
});
