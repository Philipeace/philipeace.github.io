// File Name: ui_updater.js (NEW FILE)
// Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\static\js\ui\ui_updater.js
// static/js/ui/ui_updater.js
// Functions that update existing UI elements based on data changes

function redrawUI(reloadedData) {
    console.log("Redrawing UI after config reload/client add/delete...");
    // Update global state variables (assuming they are accessible globally)
    clientsData = reloadedData.clients_data || {};
    globalSettings = reloadedData.global_settings || {};
    endpointData = reloadedData.all_endpoint_data || {};
    const sortedClientIds = reloadedData.sorted_client_ids || Object.keys(clientsData);
    // Determine the active client ID, ensure it exists, fallback if needed
    let newActiveClientId = reloadedData.initial_active_client_id || currentActiveClientId;
    if (!clientsData || !clientsData[newActiveClientId]) {
        newActiveClientId = sortedClientIds.length > 0 ? sortedClientIds[0] : defaultClient;
    }
    currentActiveClientId = newActiveClientId;


    // Clear existing tabs and content
    const tabContainer = document.getElementById('client-tabs');
    const contentContainer = document.getElementById('client-content-container');
    if (tabContainer) tabContainer.innerHTML = '';
    if (contentContainer) contentContainer.innerHTML = '';

    // Rebuild HTML structure using functions from ui_builder.js
    // Ensure buildClientTabsAndContent is defined
    if (typeof buildClientTabsAndContent === 'function') {
        buildClientTabsAndContent(tabContainer, contentContainer, sortedClientIds, clientsData);
    } else { console.error("buildClientTabsAndContent function not found during redraw."); }


    // Re-initialize UI components based on the new structure/data
    // Ensure setupUI is defined/accessible (likely in script.js)
    if(typeof setupUI === 'function') {
        setupUI(); // This re-attaches listeners and sets initial states
    } else {
        console.error("setupUI function not defined during redraw.");
    }


    // Trigger status update to populate new elements
    // Ensure fetchAndUpdateStatus is defined/accessible (likely in api.js)
    if (typeof fetchAndUpdateStatus === 'function') {
        fetchAndUpdateStatus();
    } else {
         console.error("fetchAndUpdateStatus function not defined during redraw.");
    }
    console.log("UI Redraw complete. New Active Client:", currentActiveClientId);
}


function updateClientSpecificUI(clientId) {
    // Ensure clientsData is defined
    if (typeof clientsData === 'undefined') {
        console.error("Cannot update client specific UI: clientsData is undefined.");
        return;
    }
    const clientSettings = clientsData[clientId]?.settings || {};
    const clientName = clientSettings.name || clientId;

    // Toggle Floating Button in Footer
    const toggleFloatingBtn = document.getElementById('toggle-floating');
    if (toggleFloatingBtn) {
        const isDisabled = !!clientSettings.disable_floating_elements;
        toggleFloatingBtn.dataset.clientId = clientId; // Store client ID for the handler
        toggleFloatingBtn.textContent = `Toggle Floating (${escapeHTML(clientName)})`;
        // Ensure body class reflects the *current* client's setting
        document.body.classList.toggle('floating-disabled', isDisabled);
        // Ensure animation functions are defined
        if (isDisabled) {
             if (typeof stopFloatingAnimation === 'function') stopFloatingAnimation();
             else console.error("stopFloatingAnimation function not found.");
        } else {
             if (typeof startFloatingAnimation === 'function') startFloatingAnimation();
             else console.error("startFloatingAnimation function not found.");
        }
        // Make sure API toggle function is defined and accessible
        // Assign directly here as the button context changes
        if (typeof apiToggleFloatingElements === 'function') {
            toggleFloatingBtn.onclick = apiToggleFloatingElements;
        } else { console.error("apiToggleFloatingElements function not found for toggle button."); }
    }

    // Add Endpoint Button (outside client pane)
    const addEndpointBtn = document.getElementById('add-endpoint-btn');
    const addEndpointContainer = document.getElementById('add-endpoint-button-container');
    if (addEndpointBtn && addEndpointContainer) {
        const isLinked = clientSettings.client_type === 'linked';
        addEndpointBtn.textContent = `+ Add Endpoint (${escapeHTML(clientName)})`;
        addEndpointBtn.disabled = isLinked;
        addEndpointBtn.title = isLinked ? 'Endpoints managed by remote instance' : 'Add endpoint to this client';
        // Ensure modal function is defined
        if (typeof openAddEditModal === 'function') {
             // Pass explicit client ID to the modal opener
             addEndpointBtn.onclick = (event) => openAddEditModal(event, null, clientId);
        } else { console.error("openAddEditModal function not found for add endpoint button."); }
        // Show/hide container based on client type
        addEndpointContainer.style.display = isLinked ? 'none' : '';
    }
}


function updateClientSettingsSection(clientId) {
    // Ensure clientsData and globalSettings are accessible
    if (typeof clientsData === 'undefined' || typeof globalSettings === 'undefined') {
        console.error("Cannot update client settings: Global data missing.");
        return;
    }
    const container = document.getElementById(`client-settings-${clientId}`);
    const body = document.getElementById(`client-settings-body-${clientId}`);
    if (!container || !body) return;

    const clientSettings = clientsData[clientId]?.settings || {};
    const clientType = clientSettings.client_type || 'local';
    const clientName = clientSettings.name || clientId;
    const isApiEnabled = clientSettings.api_enabled || false;
    const isFloatingDisabled = clientSettings.disable_floating_elements || false;

    // Update header title dynamically
    const titleElement = container.querySelector('.client-settings-title');
    if (titleElement) titleElement.textContent = `Settings: ${escapeHTML(clientName)}`;

    // Build body content safely
    let content = `<p><strong>Type:</strong> ${escapeHTML(clientType)}</p>`;
    // Ensure necessary functions exist before adding buttons with onclick handlers
    const toggleFloatingFuncExists = typeof apiToggleFloatingElements === 'function';
    const toggleApiFuncExists = typeof toggleApiExposure === 'function';
    const fetchTokenFuncExists = typeof fetchAndDisplayToken === 'function';
    const regenTokenFuncExists = typeof regenerateToken === 'function';
    const confirmDeleteFuncExists = typeof confirmDeleteClient === 'function';

    content += `<p><strong>Floating BG:</strong> ${isFloatingDisabled ? 'Disabled' : 'Enabled'} <button class="inline-btn" ${toggleFloatingFuncExists ? `onclick="apiToggleFloatingElements()"` : 'disabled title="Handler missing"'}>(Toggle)</button></p>`;

    if (clientType === 'local') {
        content += `<p><strong>API Exposure:</strong> ${isApiEnabled ? 'Enabled' : 'Disabled'} <button class="inline-btn" ${toggleApiFuncExists ? `onclick="toggleApiExposure('${escapeJS(clientId)}', ${!isApiEnabled})"`: 'disabled title="Handler missing"'} >(${isApiEnabled ? 'Disable' : 'Enable'})</button></p>`;
        if (isApiEnabled) {
            content += `
                <div class="api-token-section">
                    <strong>API Token:</strong>
                    <div class="token-display-wrapper">
                        <input type="text" id="api-token-display-${clientId}" value="Click to View" readonly style="cursor:pointer;" ${fetchTokenFuncExists ? `onclick="fetchAndDisplayToken('${escapeJS(clientId)}')" ` : ''}>
                        <button class="inline-btn" ${fetchTokenFuncExists ? `onclick="fetchAndDisplayToken('${escapeJS(clientId)}')" ` : 'disabled '} title="View Token">👁️</button>
                        <button class="inline-btn" ${regenTokenFuncExists ? `onclick="regenerateToken('${escapeJS(clientId)}')" ` : 'disabled '} title="Regenerate Token">🔄</button>
                    </div>
                    <small>(Use this token to link this client from another Uptimizer instance)</small>
                </div>`;
        } else {
             content += `<small>(Enable API Exposure to allow linking from another instance)</small>`;
        }
    } else if (clientType === 'linked') {
        content += `<p><strong>Remote URL:</strong> ${escapeHTML(clientSettings.remote_url || 'N/A')}</p>`;
        content += `<p><strong>API Token:</strong> ******** <button class="inline-btn" title="Edit Linked Client (Coming Soon)" disabled>✎</button></p>`;
    }

    // --- Add Global Settings Display ---
    content += `<div class="global-settings-display">
                    <strong>Global Settings:</strong> Interval: <span>${escapeHTML(globalSettings.check_interval_seconds || '--')}</span>s | Timeout: <span>${escapeHTML(globalSettings.check_timeout_seconds || '--')}</span>s
                    <button class="inline-btn" title="Edit Global Settings (Coming Soon)" disabled>✎</button>
               </div>`;

    // --- Add Action Buttons (Edit Client Name/Delete) ---
    content += `<div style="margin-top: 15px; text-align: right;">
                   <button class="inline-btn edit-client-btn" title="Edit Client Name/Type (Coming Soon)" disabled>Edit Client</button>
                   <button class="inline-btn delete-client-btn" title="Delete Client" ${confirmDeleteFuncExists ? `onclick="confirmDeleteClient('${escapeJS(clientId)}')" ` : 'disabled '}>Delete Client</button>
               </div>`;


    body.innerHTML = content;

    // Disable delete for default client after content is set
    if (clientId === defaultClient) {
        const deleteBtn = body.querySelector('.delete-client-btn');
        if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.title = "Cannot delete the default client"; }
    }

    // Re-apply initial collapsed state if needed (handled by initializeGroupToggles)
    // We don't need to toggle here, just ensure the content is correctly populated.
    // The initial collapsed/expanded state is set by initializeGroupToggles based on class presence.
}

function updateEndpointStatusUI(endpointId, statusData, clientId = null) {
    // Ensure clientsData is defined
    if (typeof clientsData === 'undefined') return;
    const clientSettings = clientId ? clientsData[clientId]?.settings : null;

    // Handle linked clients (potentially creating rows dynamically)
    if (clientSettings?.client_type === 'linked') {
        const listElement = document.getElementById(`endpoint-list-${clientId}-linked`);
        const statusPlaceholder = document.getElementById(`linked-status-${clientId}`);
        if (!listElement) return; // No container for linked items

        // Handle overall link error for the client
        if (statusData?.status === 'ERROR' && statusData?.details?.startsWith('Link Error:')) {
             if (statusPlaceholder) {
                 statusPlaceholder.textContent = escapeHTML(statusData.details);
                 // Clear existing rows if showing global error
                 listElement.innerHTML='';
                 listElement.appendChild(statusPlaceholder);
             }
        } else if (statusData && endpointId) { // Check endpointId exists for specific updates
            let rowElement = document.getElementById(`endpoint-item-${endpointId}`);
            if (!rowElement) {
                 // Dynamically create row if it doesn't exist for a linked endpoint
                 // Ensure createEndpointRow is defined
                 if(typeof createEndpointRow === 'function') {
                     const epDataFromRemote = {
                         id: endpointId,
                         name: statusData.name || endpointId,
                         url: statusData.url || 'N/A',
                         group: statusData.group || 'Remote'
                        };
                     rowElement = createEndpointRow(epDataFromRemote, clientId);
                     if (rowElement) {
                          if (statusPlaceholder && statusPlaceholder.parentNode === listElement) statusPlaceholder.remove();
                          listElement.appendChild(rowElement);
                     } else { return; } // Failed to create row
                 } else { console.error("createEndpointRow function not found for linked client."); return; }
            }
            // Update the status/details within the row
            const rowStatusEl = rowElement.querySelector('.endpoint-status');
            const rowDetailsEl = rowElement.querySelector('.endpoint-details');
            if (rowStatusEl && rowDetailsEl) updateStatusAndDetailsElements(rowStatusEl, rowDetailsEl, statusData); // Use helper
            // Update name/url if provided in statusData and different
            if (statusData.name && rowElement.querySelector('.endpoint-name').textContent !== statusData.name) rowElement.querySelector('.endpoint-name').textContent = escapeHTML(statusData.name);
            if (statusData.url && rowElement.querySelector('.endpoint-url').textContent !== statusData.url) rowElement.querySelector('.endpoint-url').textContent = escapeHTML(statusData.url);
        } else if (!endpointId && statusData?.status === 'ERROR') {
            // Handle non-link error reported globally for client
            if(statusPlaceholder) statusPlaceholder.textContent = `Error: ${escapeHTML(statusData.details || 'Unknown remote issue')}`;
            listElement.innerHTML='';
            listElement.appendChild(statusPlaceholder);
        }
        return; // Stop here for linked clients
    }

    // Regular update for local endpoints
    const statusElement = document.getElementById(`status-${endpointId}`);
    const detailsElement = document.getElementById(`details-${endpointId}`);
    if (!statusElement || !detailsElement) return; // Element not found in DOM
    updateStatusAndDetailsElements(statusElement, detailsElement, statusData); // Use helper
}


function updateStatusAndDetailsElements(statusElement, detailsElement, statusData) {
    // Reset classes first
    statusElement.className = 'endpoint-status'; // Base class
    let statusText = 'PENDING', detailsText = ' ';

    if (statusData) {
        statusText = statusData.status || 'UNKNOWN';
        statusElement.classList.add(`status-${statusText.toLowerCase()}`);

        // Determine details text based on status and available data
        const responseTime = statusData.response_time_ms;
        const statusCode = statusData.status_code;
        const detailMsg = statusData.details;

        if (statusText === 'UP') {
            detailsText = (responseTime !== undefined && responseTime !== null) ? `${responseTime} ms` : '';
        } else if (detailMsg) {
            detailsText = detailMsg;
        } else if (statusText === 'DOWN' && statusCode) {
            detailsText = `HTTP ${statusCode}`;
        } else if (statusText === 'ERROR') {
            detailsText = 'Check Error';
        } else if (statusText === 'PENDING' || statusText === 'UNKNOWN') {
            detailsText = 'Awaiting check...';
        }
        detailsText = detailsText || ' ';

    } else {
        // No statusData provided
        statusElement.classList.add('status-unknown');
        statusText = 'UNKNOWN';
        detailsText = 'No status data';
    }

    statusElement.textContent = statusText;
    detailsElement.innerHTML = escapeHTML(detailsText); // Ensure details are escaped
}

function updateEndpointStatsUI(endpointId, statsData) {
    const statsElement = document.getElementById(`stats-${endpointId}`);
    if (!statsElement) return;
    if (statsData) {
        if (statsData.error) {
            statsElement.innerHTML = `<span class="stats-error" title="${escapeHTML(statsData.error)}">Stats Err</span>`;
        } else if (statsData.uptime_percentage_24h !== null && statsData.uptime_percentage_24h !== undefined) {
            statsElement.innerHTML = `24h: <span class="stats-value">${statsData.uptime_percentage_24h}%</span>`;
        } else {
            statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`;
        }
    } else {
        statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`;
    }
}