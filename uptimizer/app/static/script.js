// static/script.js - Main Orchestrator

// --- Global State & Configuration ---
// These are initialized from data injected into index.html
let clientsData = {};
let globalSettings = {};
let endpointData = {}; // Flat map { epId: epData } for easy lookup
let currentActiveClientId = ''; // Track active client tab
const defaultClient = typeof defaultClientId !== 'undefined' ? defaultClientId : "default_client"; // From template

// --- Constants ---
const POLLING_INTERVAL_MS = 5000; // How often to fetch status updates
const statusEndpoint = '/status'; // API endpoint for combined statuses
const statsEndpoint = '/statistics'; // API endpoint for uptime stats


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Uptimizer UI Initializing (v1.15.0)...");

    // 1. Initialize Global State from Template Data
    initializeGlobalState();

    // 2. Build Initial UI Structure (Tabs, Content Panes)
    // Ensure UI functions are loaded before calling this
    const tabContainer = document.getElementById('client-tabs');
    const contentContainer = document.getElementById('client-content-container');
    const sortedClientIds = Object.keys(clientsData).sort((a, b) =>
        (clientsData[a]?.settings?.name || a).localeCompare(clientsData[b]?.settings?.name || b)
    );
    // Ensure currentActiveClientId is valid, fallback if needed
    if (!clientsData[currentActiveClientId]) {
       currentActiveClientId = sortedClientIds.length > 0 ? sortedClientIds[0] : defaultClient;
       console.warn("Initial active client ID invalid, falling back to:", currentActiveClientId);
    }
    buildClientTabsAndContent(tabContainer, contentContainer, sortedClientIds, clientsData); // From ui.js

    // 3. Setup UI components and Event Listeners
    // Ensure setupUI is loaded before calling
    setupUI(); // From this file (or could be moved to ui.js)

    // 4. Fetch initial data and start polling
    // Ensure api.js is loaded
    fetchAndUpdateStatus(); // Initial fetch
    setInterval(fetchAndUpdateStatus, POLLING_INTERVAL_MS); // Start polling

    // 5. Setup Modal Listeners
    // Ensure modals.js is loaded
    setupModalCloseListeners();

    // 6. Initialize Floating Elements
    // Ensure floating.js is loaded
    initializeFloatingElements();

    console.log("Uptimizer UI Initialized. Active Client:", currentActiveClientId);
});

function initializeGlobalState() {
    // Access global variables injected via script tags in index.html
    clientsData = typeof initialClientsData !== 'undefined' ? initialClientsData : {};
    globalSettings = typeof initialGlobalSettings !== 'undefined' ? initialGlobalSettings : {};
    endpointData = typeof allInitialEndpointData !== 'undefined' ? allInitialEndpointData : {};
    currentActiveClientId = typeof initialActiveClientId !== 'undefined' ? initialActiveClientId : defaultClient;
}

function setupUI() {
    // This function now primarily sets up listeners for static elements
    // and initializes components based on the current state after the
    // initial structure is built by buildClientTabsAndContent.

    // Tab Listeners (already done in build function implicitly via initializeTabs)
    initializeTabs(); // From ui.js - ensures clicks work

    // Client Settings Section (Initial setup for the active client)
    updateClientSettingsSection(currentActiveClientId); // From ui.js

    // Client Specific UI (Footer buttons, body class)
    updateClientSpecificUI(currentActiveClientId); // From ui.js

    // Global Settings Display
    updateGlobalSettingsUI(); // From ui.js

    // Group Toggles (Ensure correct initial state)
    initializeGroupToggles(); // From ui.js

    // Static Button Listeners
    const reloadBtn = document.getElementById('refresh-config-btn');
    if (reloadBtn) reloadBtn.onclick = reloadConfig; // From api.js

    const addClientBtn = document.getElementById('add-client-btn');
    if (addClientBtn) addClientBtn.onclick = openAddClientModal; // From modals.js

    const addEndpointBtn = document.getElementById('add-endpoint-btn');
    if (addEndpointBtn) addEndpointBtn.onclick = () => openAddEditModal(null); // From modals.js (opens for active client)

     // Attach listener for Toggle Floating button
    const toggleBtn = document.getElementById('toggle-floating');
    if (toggleBtn) toggleBtn.onclick = toggleFloatingElements; // From modals.js (or could be api.js) - let's assume modals.js for now

}

// Keep utility functions here or move to utils.js? For now, keep simple ones here.
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, match => ({ '&': '&', '<': '<', '>': '>', '"': '&quot;', "'": '&#39;' }[match]));
}
function escapeJS(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}
function groupEndpoints(endpoints) {
    return endpoints.reduce((groups, endpoint) => {
        const groupName = endpoint.group || 'Default Group';
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(endpoint);
        return groups;
    }, {});
}

// If toggleFloatingElements primarily calls the API, move it to api.js
// Let's move it to api.js for consistency
async function toggleFloatingElements() {
    // Function body moved to api.js
    // Call the function defined in api.js
    if(typeof apiToggleFloatingElements === 'function') {
        apiToggleFloatingElements();
    } else {
        console.error("apiToggleFloatingElements function not found.");
    }
}
// Need to make sure the function in api.js is named appropriately and potentially exported/imported if using modules,
// or just accessible globally for now. Let's rename it in api.js and call it here.