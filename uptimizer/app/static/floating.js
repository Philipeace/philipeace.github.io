// static/floating.js

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
const floatingElementsStore = []; // Renamed to avoid conflict with DOM element variable
let animationFrameId = null;

function createFloatingElement(index) {
    if (!floatingContainer) return null;
    const element = document.createElement('div');
    element.classList.add('floating-element');
    element.innerHTML = floatingTextsAndIcons[Math.floor(Math.random() * floatingTextsAndIcons.length)];

    const size = 1 + Math.random() * 1.5;
    element.style.fontSize = `${size}em`;
    element.style.left = `${Math.random() * 100}%`;
    element.style.top = `${Math.random() * 100}%`;

    const animClass = `float-anim${(index % 8) + 1}`;
    element.classList.add(animClass);

    floatingContainer.appendChild(element);
    // Fade in slightly delayed
    setTimeout(() => element.classList.add('visible'), 150 + Math.random() * 600);

    return { element, index };
}

function initializeFloatingElements() {
    // Check if container exists and elements haven't been created yet
    if (floatingContainer && floatingElementsStore.length === 0) {
        // Determine initial state based on body class (set during initial page load)
        const initiallyDisabled = document.body.classList.contains('floating-disabled');

        for (let i = 0; i < numFloatingElements; i++) {
            const elData = createFloatingElement(i);
            if (elData) floatingElementsStore.push(elData);
        }

        if (!initiallyDisabled) {
            startFloatingAnimation();
        } else {
            console.log("Floating elements initialized but disabled on load.");
            // Ensure they are hidden if disabled initially
            stopFloatingAnimation(); // Call stop to ensure visibility is off
        }
    }
}


function startFloatingAnimation() {
    // Check if running and if elements exist
    if (!animationFrameId && floatingElementsStore.length > 0) {
        console.log("Starting floating animation.");
        floatingElementsStore.forEach(({ element, index }) => {
            element.style.display = ''; // Ensure visible
            const animClass = `float-anim${(index % 8) + 1}`;
            if (!element.classList.contains(animClass)) {
                element.classList.add(animClass);
            }
            // Force visibility class on start
            element.classList.add('visible');
        });
        animationFrameId = 1; // Simple flag indicating "running"
    }
}

function stopFloatingAnimation() {
    if (animationFrameId) { // Check if "running"
        console.log("Stopping floating animation.");
        floatingElementsStore.forEach(({ element }) => {
            element.classList.remove('visible');
            // Optionally hide completely after fade out?
            // setTimeout(() => { element.style.display = 'none'; }, 500); // Match transition duration
        });
        // If using requestAnimationFrame, cancel it here: cancelAnimationFrame(animationFrameId);
        animationFrameId = null; // Indicate stopped state
    } else {
        // Ensure elements are hidden even if animation wasn't "running" but might be visible
        floatingElementsStore.forEach(({ element }) => {
             element.classList.remove('visible');
        });
    }
}

// Make functions globally accessible if needed by other modules,
// or manage dependencies through imports/exports later if using modules.
// For now, they are global within the browser's execution context.