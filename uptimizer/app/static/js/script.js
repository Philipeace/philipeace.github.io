// File Name: script.js
// Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\static\js\script.js
// static/js/script.js - Main Orchestrator

// --- Global State & Configuration ---
// These are initialized from data injected into index.html
let clientsData = {};
let globalSettings = {};
let endpointData = {}; // Flat map { epId: epData } for easy lookup
let currentActiveClientId = ''; // Track active client tab
// Ensure defaultClientId is defined, fallback if template injection fails
const defaultClient = typeof defaultClientId !== 'undefined' ? defaultClientId : "default_client";

// --- Constants ---
const POLLING_INTERVAL_MS = 5000; // How often to fetch status updates

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Uptimizer UI Initializing (v1.15.3)...");

    // 1. Initialize Global State from Template Data
    initializeGlobalState();

    // 2. Build Initial UI Structure (Tabs, Content Panes)
    // Assumes ui_builder.js is loaded
    const tabContainer = document.getElementById('client-tabs');
    const contentContainer = document.getElementById('client-content-container');
    // Ensure clientsData is populated before sorting
    const sortedClientIds = Object.keys(clientsData || {}).sort((a, b) =>
        ((clientsData[a]?.settings?.name || a)).localeCompare(clientsData[b]?.settings?.name || b)
    );
    // Ensure currentActiveClientId is valid, fallback if needed
    if (!clientsData || !clientsData[currentActiveClientId]) {
       currentActiveClientId = sortedClientIds.length > 0 ? sortedClientIds[0] : defaultClient;
       console.warn("Initial active client ID invalid or missing, falling back to:", currentActiveClientId);
    }
    // Ensure buildClientTabsAndContent is defined (from ui_builder.js)
    if (typeof buildClientTabsAndContent === 'function') {
        buildClientTabsAndContent(tabContainer, contentContainer, sortedClientIds, clientsData);
    } else { console.error("buildClientTabsAndContent function not found."); }


    // 3. Setup UI components and Event Listeners
    // Assumes ui_interactions.js and ui_updater.js are loaded
    setupUI(); // From this file

    // 4. Fetch initial data and start polling
    // Assumes api.js is loaded
    if (typeof fetchAndUpdateStatus === 'function') {
        fetchAndUpdateStatus(); // Initial fetch
        setInterval(fetchAndUpdateStatus, POLLING_INTERVAL_MS); // Start polling
    } else { console.error("fetchAndUpdateStatus function not found."); }


    // 5. Setup Modal Listeners
    // Assumes modals.js is loaded
    if (typeof setupModalCloseListeners === 'function') {
        setupModalCloseListeners();
    } else { console.error("setupModalCloseListeners function not found."); }


    // 6. Initialize Floating Elements
    // Assumes floating.js is loaded
    if (typeof initializeFloatingElements === 'function') {
        initializeFloatingElements();
    } else { console.error("initializeFloatingElements function not found."); }


    console.log("Uptimizer UI Initialized. Active Client:", currentActiveClientId);
});

function initializeGlobalState() {
    // Access global variables injected via script tags in index.html
    // Add checks for existence
    clientsData = typeof initialClientsData !== 'undefined' ? initialClientsData : {};
    globalSettings = typeof initialGlobalSettings !== 'undefined' ? initialGlobalSettings : {};
    endpointData = typeof allInitialEndpointData !== 'undefined' ? allInitialEndpointData : {};
    currentActiveClientId = typeof initialActiveClientId !== 'undefined' ? initialActiveClientId : defaultClient;
}

function setupUI() {
    // This function now primarily sets up listeners for static elements
    // and initializes components based on the current state after the
    // initial structure is built.

    // Tab Listeners (Initialize tab switching functionality)
    // Assumes ui_interactions.js is loaded
    if (typeof initializeTabs === 'function') initializeTabs();
    else console.error("initializeTabs function not found.");

    // Client Settings Section (Initial setup for the active client)
    // Assumes ui_updater.js is loaded
    if (typeof updateClientSettingsSection === 'function') updateClientSettingsSection(currentActiveClientId);
    else console.error("updateClientSettingsSection function not found.");


    // Client Specific UI (Footer buttons, body class, Add Endpoint btn)
    // Assumes ui_updater.js is loaded
     if (typeof updateClientSpecificUI === 'function') updateClientSpecificUI(currentActiveClientId);
     else console.error("updateClientSpecificUI function not found.");

    // Group & Settings Toggles (Initialize correct collapsed/expanded states)
    // Assumes ui_interactions.js is loaded
    if (typeof initializeGroupToggles === 'function') initializeGroupToggles();
    else console.error("initializeGroupToggles function not found.");

    // Static Button Listeners in Footer/Top Bar
    const reloadBtn = document.getElementById('refresh-config-btn');
    // Assumes api.js is loaded
    if (reloadBtn) {
        if (typeof reloadConfig === 'function') reloadBtn.onclick = reloadConfig;
        else console.error("reloadConfig function not found for reload button.");
    }

    const addClientBtn = document.getElementById('add-client-btn');
    // Assumes modals.js is loaded
     if (addClientBtn) {
        if (typeof openAddClientModal === 'function') addClientBtn.onclick = openAddClientModal;
        else console.error("openAddClientModal function not found for add client button.");
    }

    // Add Endpoint button listener is now handled dynamically in updateClientSpecificUI
    // Toggle Floating button listener is now handled dynamically in updateClientSpecificUI
}
