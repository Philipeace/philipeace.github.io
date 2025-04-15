// File Name: ui_interactions.js (NEW FILE)
// Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\static\js\ui\ui_interactions.js
// static/js/ui/ui_interactions.js
// Functions handling direct user interactions like clicks, toggles

function initializeTabs() {
    const tabs = document.querySelectorAll('.client-tab');
    tabs.forEach(tab => {
        // Ensure switchTab is defined
        if(typeof switchTab === 'function') {
            tab.onclick = () => switchTab(tab.dataset.clientId);
        } else { console.error("switchTab function not defined for tab init."); }
    });
    // Ensure currentActiveClientId is defined
    const activeClientId = typeof currentActiveClientId !== 'undefined' ? currentActiveClientId : null;
    if(activeClientId) {
        const initialContent = document.getElementById(`client-content-${activeClientId}`);
        if (initialContent) initialContent.classList.add('active');
        else if (tabs.length > 0) { // Fallback if active client content missing
            if(typeof switchTab === 'function') switchTab(tabs[0].dataset.clientId);
        }
    } else if (tabs.length > 0) { // Fallback if no active client ID set
        if(typeof switchTab === 'function') switchTab(tabs[0].dataset.clientId);
    }
}

function switchTab(clientId) {
    // Ensure currentActiveClientId is defined
    const activeClientId = typeof currentActiveClientId !== 'undefined' ? currentActiveClientId : null;
    if (!clientId || clientId === activeClientId) return;

    // Deactivate previous
    const previousTab = document.querySelector(`.client-tab[data-client-id="${activeClientId}"]`);
    const previousContent = document.getElementById(`client-content-${activeClientId}`);
    if (previousTab) previousTab.classList.remove('active');
    if (previousContent) previousContent.classList.remove('active');

    // Activate new
    const newTab = document.querySelector(`.client-tab[data-client-id="${clientId}"]`);
    const newContent = document.getElementById(`client-content-${clientId}`);
    if (newTab) newTab.classList.add('active');
    if (newContent) newContent.classList.add('active');

    // Update global state variable (ensure it's accessible)
    if (typeof currentActiveClientId !== 'undefined') {
        currentActiveClientId = clientId;
    } else {
        console.error("Cannot update currentActiveClientId, variable not found.");
    }


    console.log("Switched to client tab:", currentActiveClientId);
    // Ensure UI update functions are defined
    if(typeof updateClientSpecificUI === 'function') updateClientSpecificUI(clientId);
    else console.error("updateClientSpecificUI function not found during tab switch.");
    if(typeof updateClientSettingsSection === 'function') updateClientSettingsSection(clientId);
    else console.error("updateClientSettingsSection function not found during tab switch.");
}

function initializeGroupToggles() {
    // Initialize endpoint groups
    document.querySelectorAll('.group-header').forEach(header => {
        const content = header.nextElementSibling;
        if (content && content.classList.contains('group-content')) {
            const toggle = header.querySelector('.group-toggle');
            // Check initial state (assuming default is expanded unless class 'collapsed' is present)
            if (content.classList.contains('collapsed')) {
                 content.style.maxHeight = '0'; content.style.paddingTop = '0'; content.style.paddingBottom = '0'; content.style.borderTopWidth = '0';
                 if (toggle) toggle.style.transform = 'rotate(-90deg)';
            } else {
                 content.style.maxHeight = 'none'; // Allow natural height
                 if (toggle) toggle.style.transform = 'rotate(0deg)';
            }
        }
    });
    // Initialize client settings toggle state too
    document.querySelectorAll('.client-settings-header').forEach(header => {
        const body = header.nextElementSibling;
        if (body && body.classList.contains('client-settings-body')) {
            const toggle = header.querySelector('.client-settings-toggle');
            // Default client settings to expanded unless 'collapsed' class exists
            if (body.classList.contains('collapsed')) {
                body.style.maxHeight = '0'; body.style.paddingTop = '0'; body.style.paddingBottom = '0'; body.style.borderTopWidth = '0';
                if (toggle) toggle.style.transform = 'rotate(-90deg)';
            } else { // Default to expanded
                body.style.maxHeight = 'none';
                if (toggle) toggle.style.transform = 'rotate(0deg)';
            }
        }
    });
}

function toggleGroup(headerElement) {
    if (!headerElement) return;
    const content = headerElement.nextElementSibling;
    if (!content || !content.classList.contains('group-content')) return;
    const toggle = headerElement.querySelector('.group-toggle');
    content.classList.toggle('collapsed');
    if (content.classList.contains('collapsed')) {
        // Start transition FROM current height
        content.style.maxHeight = content.scrollHeight + "px";
        // Need a frame delay for transition to register
        requestAnimationFrame(() => {
            content.style.maxHeight = '0'; content.style.paddingTop = '0'; content.style.paddingBottom = '0'; content.style.borderTopWidth = '0';
            if (toggle) toggle.style.transform = 'rotate(-90deg)';
        });
    } else {
        // Start transition TO scrollHeight
        content.style.paddingTop = ''; content.style.paddingBottom = ''; content.style.borderTopWidth = '';
        content.style.maxHeight = content.scrollHeight + "px";
        if (toggle) toggle.style.transform = 'rotate(0deg)';
        // After animation, allow natural height
        setTimeout(() => { if (!content.classList.contains('collapsed')) content.style.maxHeight = 'none'; }, 500); // Match CSS transition duration
    }
}

function toggleClientSettings(clientId) {
    const settingsContainer = document.getElementById(`client-settings-${clientId}`);
    if (!settingsContainer) return;
    const body = settingsContainer.querySelector('.client-settings-body');
    const toggle = settingsContainer.querySelector('.client-settings-toggle');
    if (!body || !toggle) return;

    body.classList.toggle('collapsed');
    if (body.classList.contains('collapsed')) {
        body.style.maxHeight = body.scrollHeight + "px";
        requestAnimationFrame(() => {
            body.style.maxHeight = '0'; body.style.paddingTop = '0'; body.style.paddingBottom = '0'; body.style.borderTopWidth = '0';
            if (toggle) toggle.style.transform = 'rotate(-90deg)';
        });
    } else {
        body.style.paddingTop = ''; body.style.paddingBottom = ''; body.style.borderTopWidth = '';
        body.style.maxHeight = body.scrollHeight + "px";
        if (toggle) toggle.style.transform = 'rotate(0deg)';
        setTimeout(() => { if (!body.classList.contains('collapsed')) body.style.maxHeight = 'none'; }, 500);
    }
}