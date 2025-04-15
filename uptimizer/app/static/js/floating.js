// File Name: floating.js
// Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\static\js\floating.js
// static/js/floating.js

// --- Floating Element Data ---
const floatingTextsAndIcons = [
    "🐳 Dockerized!", "🐙 GitOps FTW", "☸️ Kube?", "🛡️ Cyber... maybe", "🦑 ArgoCD Dreaming", "</> Spaghetti?",
    "🐍 Pythonic? Ish.", "📊 Grafana Wannabe", "🧪 Flasky & Fast?", "🚀 CI/CD... Soon™", "💾 Postgres Power!",
    "📈 99.9% Uptime?", "💡 Idea!", "🔥 It's Fine.", "👀 Watching...", "🕒 Time Flies", "🌐 Network Latency",
    "🚦 Red. Green. Red.", "🤔 What Was That?", "☕ Needs Coffee", "💾 Save Config!", "♻️ Refactor!",
    "🐛 Bug?", "✅ Test Pass?", "🔑 Secrets!", "📜 Check Logs", "📈 Metrics!", "💾 -> ☁️?", "👨‍💻 Code...",
    "😴 Sleepy?", "🤯 LLM Magic!", "✨ Vibe Coded ✨", "🖱️ You Still Click?", "⚡ Speedy!", "🧠 Thinking...",
    "🤖 Bot At Work", "📑 Tabs!", "🔗 Linked!", "💧 Leaky?", "💡 Secret Key!", "🧪 Testing...",
    "<a href='https://www.youtube.com/watch?v=dQw4w9WgXcQ' target='_blank' style='color: inherit; text-decoration: underline; pointer-events: auto !important;'>Click Me?</a>"
];

// --- Floating Element Logic ---
const floatingContainer = document.getElementById('floating-elements');
const numFloatingElements = 25;
const floatingElementsStore = []; // Store references to created elements/data
let animationFrameId = null; // Flag to track if animation is conceptually "running"

function createFloatingElement(index) {
    if (!floatingContainer) return null;
    const element = document.createElement('div');
    element.classList.add('floating-element');
    element.innerHTML = floatingTextsAndIcons[Math.floor(Math.random() * floatingTextsAndIcons.length)];

    const size = 1 + Math.random() * 1.5;
    element.style.fontSize = `${size}em`;
    element.style.left = `${Math.random() * 100}%`;
    element.style.top = `${Math.random() * 100}%`;

    const animClass = `float-anim${(index % 8) + 1}`; // Cycle through 8 animation types
    element.classList.add(animClass);

    floatingContainer.appendChild(element);
    // Fade in slightly delayed for a staggered effect
    setTimeout(() => element.classList.add('visible'), 150 + Math.random() * 600);

    return { element, index };
}

function initializeFloatingElements() {
    // Check if container exists and elements haven't been created yet
    if (floatingContainer && floatingElementsStore.length === 0) {
        console.log("Initializing floating elements...");
        // Determine initial state based on body class (set during initial page load in index.html)
        const initiallyDisabled = document.body.classList.contains('floating-disabled');

        for (let i = 0; i < numFloatingElements; i++) {
            const elData = createFloatingElement(i);
            if (elData) floatingElementsStore.push(elData);
        }

        if (!initiallyDisabled) {
            startFloatingAnimation(); // Start if not disabled by default
        } else {
            console.log("Floating elements initialized but disabled on load.");
            // Ensure they are hidden if disabled initially
            stopFloatingAnimation(true); // Pass flag to force immediate hide
        }
    }
}


function startFloatingAnimation() {
    // Check if conceptually "stopped" and if elements exist
    if (animationFrameId === null && floatingElementsStore.length > 0) {
        console.log("Starting floating animation.");
        animationFrameId = 1; // Mark as running
        floatingElementsStore.forEach(({ element, index }) => {
            element.style.display = ''; // Ensure element is not hidden via display:none
            const animClass = `float-anim${(index % 8) + 1}`;
            // Re-add animation class if somehow removed
            if (!element.classList.contains(animClass)) {
                element.classList.add(animClass);
            }
            // Add visible class to trigger fade-in (might already be there)
            element.classList.add('visible');
        });
        // If using requestAnimationFrame, start the loop here.
        // Since we use CSS animations, just marking as running is sufficient.
    }
}

function stopFloatingAnimation(forceImmediate = false) {
    // Check if conceptually "running" or if force hiding
    if (animationFrameId !== null || forceImmediate) {
        console.log("Stopping floating animation.");
        animationFrameId = null; // Mark as stopped
        floatingElementsStore.forEach(({ element }) => {
            element.classList.remove('visible'); // Trigger fade-out
            // Optionally hide completely after fade out if forced
            if (forceImmediate) {
                element.style.display = 'none'; // Hide immediately if forced
            } else {
                // Hide after transition duration (match CSS)
                // setTimeout(() => { element.style.display = 'none'; }, 500);
            }
        });
        // If using requestAnimationFrame, cancel it here: cancelAnimationFrame(animationFrameId);
    } else if (floatingElementsStore.length > 0 && !forceImmediate) {
        // Ensure elements are hidden even if animation wasn't "running" but might be visible
        // This handles cases where the page loaded with them disabled.
        floatingElementsStore.forEach(({ element }) => {
             element.classList.remove('visible');
        });
    }
}

// Make functions globally accessible if needed by other modules,
// or manage dependencies through imports/exports later if using modules.
// For now, they are global within the browser's execution context.
