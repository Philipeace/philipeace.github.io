// static/ui.js

// --- UI Construction & Update Functions ---

function redrawUI(reloadedData) {
    console.log("Redrawing UI after config reload/client add/delete...");
    // Update global state variables (assuming they are accessible globally)
    clientsData = reloadedData.clients_data || {};
    globalSettings = reloadedData.global_settings || {};
    endpointData = reloadedData.all_endpoint_data || {};
    const sortedClientIds = reloadedData.sorted_client_ids || Object.keys(clientsData);
    // Determine the active client ID, ensure it exists, fallback if needed
    let newActiveClientId = reloadedData.initial_active_client_id || currentActiveClientId;
    if (!clientsData[newActiveClientId]) {
        newActiveClientId = sortedClientIds.length > 0 ? sortedClientIds[0] : defaultClient;
    }
    currentActiveClientId = newActiveClientId;


    // Clear existing tabs and content
    const tabContainer = document.getElementById('client-tabs');
    const contentContainer = document.getElementById('client-content-container');
    if (tabContainer) tabContainer.innerHTML = '';
    if (contentContainer) contentContainer.innerHTML = '';

    // Rebuild HTML structure
    buildClientTabsAndContent(tabContainer, contentContainer, sortedClientIds, clientsData);

    // Re-initialize UI components based on the new structure/data
    setupUI(); // This re-attaches listeners and sets initial states

    // Trigger status update to populate new elements
    fetchAndUpdateStatus(); // Call API function (assumed global or imported)
    console.log("UI Redraw complete. New Active Client:", currentActiveClientId);
}

function buildClientTabsAndContent(tabContainer, contentContainer, sortedClientIds, clientsData) {
    if (!tabContainer || !contentContainer) return;

    if (sortedClientIds.length === 0) {
        // Handle case where there are no clients at all
        tabContainer.innerHTML = `<button class="client-tab active" data-client-id="${defaultClient}">Default Client</button>`;
        contentContainer.innerHTML = `<div class="client-tab-content active" id="client-content-${defaultClient}" data-client-id="${defaultClient}"></div>`;
        const defaultContentPane = document.getElementById(`client-content-${defaultClient}`);
        if(defaultContentPane) defaultContentPane.appendChild(createNoEndpointsMessage(defaultClient, 'none')); // Special message
        return;
    }

    sortedClientIds.forEach((clientId) => {
        const clientInfo = clientsData[clientId];
        if (!clientInfo) return;
        const clientSettings = clientInfo.settings || { name: `Client ${clientId}`, client_type: 'local' };
        const clientEndpoints = clientInfo.endpoints || [];
        const isActive = clientId === currentActiveClientId;

        // Tab Button
        const tabButton = document.createElement('button');
        tabButton.className = `client-tab ${isActive ? 'active' : ''}`;
        tabButton.dataset.clientId = clientId;
        tabButton.textContent = clientSettings.name || clientId;
        // onclick assigned in initializeTabs
        tabContainer.appendChild(tabButton);

        // Tab Content Pane
        const contentPane = document.createElement('div');
        contentPane.className = `client-tab-content ${isActive ? 'active' : ''}`;
        contentPane.id = `client-content-${clientId}`;
        contentPane.dataset.clientId = clientId;

        // Client Settings Section Container (content added later)
        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'client-settings-container';
        settingsContainer.id = `client-settings-${clientId}`;
        contentPane.appendChild(settingsContainer);

        // Endpoint Groups (only for 'local' clients)
        if (clientSettings.client_type === 'local') {
            if (clientEndpoints.length > 0) {
                const groups = groupEndpoints(clientEndpoints); // Assumed global or utility function
                Object.keys(groups).sort().forEach(groupName => {
                    const items = groups[groupName];
                    contentPane.appendChild(createGroupContainer(clientId, groupName, items));
                });
            } else {
                contentPane.appendChild(createNoEndpointsMessage(clientId, 'local'));
            }
        } else if (clientSettings.client_type === 'linked') {
            contentPane.appendChild(createLinkedClientPlaceholder(clientId, clientSettings));
        }
        contentContainer.appendChild(contentPane);
    });
}

function createGroupContainer(clientId, groupName, endpoints) {
    const displayGroupName = groupName || 'Default Group';
    const listId = `endpoint-list-${clientId}-${displayGroupName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()}`;

    const groupContainer = document.createElement('div');
    groupContainer.className = 'group-container';
    groupContainer.dataset.clientId = clientId;
    groupContainer.dataset.groupName = displayGroupName;
    groupContainer.innerHTML = `
        <div class="group-header" onclick="toggleGroup(this)">
             <span class="group-title">${displayGroupName}</span>
             <span class="group-toggle">▼</span>
         </div>
         <div class="group-content">
             <ul class="endpoint-list" id="${listId}"></ul>
         </div>`;

    const listElement = groupContainer.querySelector('.endpoint-list');
    endpoints.forEach(endpoint => {
        const row = createEndpointRow(endpoint, clientId); // THIS is the function that needs to be defined/accessible
        if (row) listElement.appendChild(row);
    });
    return groupContainer;
}


function createEndpointRow(epData, clientId) { // Definition now in ui.js
    const template = document.getElementById('endpoint-row-template');
    if (!template) { console.error("Endpoint row template not found!"); return null; }
    const clone = template.content.firstElementChild.cloneNode(true);
    clone.dataset.endpointId = epData.id;
    clone.dataset.clientId = clientId;
    clone.id = `endpoint-item-${epData.id}`;
    clone.onclick = (event) => openHistoryModalMaybe(event, epData.id); // Assumes openHistoryModalMaybe is global/accessible

    clone.querySelector('.endpoint-name').textContent = epData.name || epData.id; // Fallback to ID if name missing
    clone.querySelector('.endpoint-url').textContent = epData.url || 'N/A'; // Handle missing URL case
    clone.querySelector('.endpoint-status').id = `status-${epData.id}`;
    clone.querySelector('.endpoint-details').id = `details-${epData.id}`;
    clone.querySelector('.endpoint-stats').id = `stats-${epData.id}`;

    // Assign actions
    const editBtn = clone.querySelector('.endpoint-actions .edit-btn');
    const deleteBtn = clone.querySelector('.endpoint-actions .delete-btn');
    if (editBtn) editBtn.onclick = (event) => openAddEditModal(event, epData.id, clientId); // Assumes openAddEditModal is global/accessible
    if (deleteBtn) deleteBtn.onclick = (event) => confirmDeleteEndpoint(event, epData.id, clientId); // Assumes confirmDeleteEndpoint is global/accessible

    // Set initial UI state (PENDING)
    updateEndpointStatusUI(epData.id, { status: "PENDING" }, clientId); // Assumes updateEndpointStatusUI is global/accessible
    updateEndpointStatsUI(epData.id, null); // Assumes updateEndpointStatsUI is global/accessible
    return clone;
}

function getOrCreateGroupList(groupName, clientId) { // Definition now in ui.js
    const displayGroupName = groupName || 'Default Group';
    const safeGroupName = displayGroupName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const listId = `endpoint-list-${clientId}-${safeGroupName}`;

    let listElement = document.getElementById(listId);
    if (listElement) return listElement; // Group list already exists

    // If list doesn't exist, create the whole group container
    const clientContentPane = document.getElementById(`client-content-${clientId}`);
    if (!clientContentPane) { console.error(`Client content pane not found for ${clientId} when creating group ${displayGroupName}`); return null; }

    const groupContainer = createGroupContainer(clientId, displayGroupName, []); // Create with empty list
    const noEndpointsMsgContainer = clientContentPane.querySelector('.no-endpoints-client'); // Check if the "no endpoints" message exists

    if (noEndpointsMsgContainer) {
        noEndpointsMsgContainer.replaceWith(groupContainer); // Replace placeholder with the new group
    } else {
        clientContentPane.appendChild(groupContainer); // Append to client pane
    }

    // Return the newly created list element
    listElement = groupContainer.querySelector('.endpoint-list');

     // Ensure group content is expanded after creation
     const groupContent = listElement.closest('.group-content');
     if (groupContent && groupContent.classList.contains('collapsed')) {
        toggleGroup(groupContent.previousElementSibling); // Toggle to expand
     } else if (groupContent) {
        groupContent.style.maxHeight = 'none'; // Ensure it allows content
     }


    return listElement;
}



function createNoEndpointsMessage(clientId, clientType = 'local') {
     const container = document.createElement('div');
     container.className = 'group-container no-endpoints-client';
     container.dataset.clientId = clientId;
     let message = "No clients configured. Add one!";
     if (clientType === 'local') {
        message = "No endpoints configured for this local client.";
     } else if (clientType === 'linked') {
        message = "Waiting for status from linked client...";
     } else if (clientType === 'none') {
         // Special case for when no clients exist at all
     }
     container.innerHTML = `<div class="group-header" style="cursor: default;"><span class="group-title italic-placeholder">${message}</span></div>`;
     return container;
}

function createLinkedClientPlaceholder(clientId, clientSettings) {
     const container = document.createElement('div');
     container.className = 'group-container linked-client-info';
     container.dataset.clientId = clientId;
     container.innerHTML = `
         <div class="group-header linked-header">
             <span class="group-title">Linked Client Info</span>
         </div>
         <div class="group-content">
             <p><strong>Remote URL:</strong> ${clientSettings.remote_url || 'Not Set'}</p>
             <p><i>Endpoints and statuses are fetched periodically from the remote instance.</i></p>
             <ul class="endpoint-list" id="endpoint-list-${clientId}-linked">
                <li class="italic-placeholder" id="linked-status-${clientId}">Waiting for initial fetch...</li>
             </ul>
         </div>`;
     return container;
}

function initializeTabs() {
    const tabs = document.querySelectorAll('.client-tab');
    tabs.forEach(tab => {
        tab.onclick = () => switchTab(tab.dataset.clientId); // Assumes switchTab is global/accessible
    });
    const initialContent = document.getElementById(`client-content-${currentActiveClientId}`);
    if (initialContent) initialContent.classList.add('active');
    else if (tabs.length > 0) switchTab(tabs[0].dataset.clientId); // Fallback
}

function switchTab(clientId) {
    if (clientId === currentActiveClientId) return;
    // Deactivate previous
    const previousTab = document.querySelector(`.client-tab[data-client-id="${currentActiveClientId}"]`);
    const previousContent = document.getElementById(`client-content-${currentActiveClientId}`);
    if (previousTab) previousTab.classList.remove('active');
    if (previousContent) previousContent.classList.remove('active');
    // Activate new
    const newTab = document.querySelector(`.client-tab[data-client-id="${clientId}"]`);
    const newContent = document.getElementById(`client-content-${clientId}`);
    if (newTab) newTab.classList.add('active');
    if (newContent) newContent.classList.add('active');

    currentActiveClientId = clientId;
    console.log("Switched to client tab:", currentActiveClientId);
    updateClientSpecificUI(clientId);
    updateClientSettingsSection(clientId); // Update settings display for new active client
}

function updateClientSpecificUI(clientId) {
    // Updates elements outside the main content area (like footer buttons)
    const clientSettings = clientsData[clientId]?.settings || {};
    const clientName = clientSettings.name || clientId;

    // Toggle Floating Button
    const toggleFloatingBtn = document.getElementById('toggle-floating');
    if (toggleFloatingBtn) {
        const isDisabled = !!clientSettings.disable_floating_elements;
        toggleFloatingBtn.dataset.clientId = clientId;
        toggleFloatingBtn.textContent = `Toggle Floating (${clientName})`;
        document.body.classList.toggle('floating-disabled', isDisabled);
        if (isDisabled) stopFloatingAnimation(); else startFloatingAnimation(); // Assumes start/stop are global/accessible
    }
    // Add Endpoint Button
    const addEndpointBtn = document.getElementById('add-endpoint-btn');
    if (addEndpointBtn) {
        const isLinked = clientSettings.client_type === 'linked';
        addEndpointBtn.textContent = `+ Add Endpoint (${clientName})`;
        addEndpointBtn.disabled = isLinked;
        addEndpointBtn.title = isLinked ? 'Endpoints managed by remote instance' : 'Add endpoint to this client';
    }
}

function updateGlobalSettingsUI() {
    const globalIntEl = document.getElementById('global-interval-val');
    const globalTimeoutEl = document.getElementById('global-timeout-val');
    if (globalIntEl) globalIntEl.textContent = globalSettings.check_interval_seconds || '--';
    if (globalTimeoutEl) globalTimeoutEl.textContent = globalSettings.check_timeout_seconds || '--';
}

function initializeGroupToggles() {
    document.querySelectorAll('.group-header').forEach(header => {
        const content = header.nextElementSibling;
        if (content && content.classList.contains('group-content')) {
            const toggle = header.querySelector('.group-toggle');
            if (content.classList.contains('collapsed')) {
                 content.style.maxHeight = '0'; content.style.paddingTop = '0'; content.style.paddingBottom = '0'; content.style.borderTopWidth = '0';
                 if (toggle) toggle.style.transform = 'rotate(-90deg)';
            } else {
                 content.style.maxHeight = 'none'; // Ensure expanded groups allow content height
                 if (toggle) toggle.style.transform = 'rotate(0deg)';
            }
        }
    });
}

function toggleGroup(headerElement) {
    const content = headerElement.nextElementSibling;
    if (!content || !content.classList.contains('group-content')) return;
    const toggle = headerElement.querySelector('.group-toggle');
    content.classList.toggle('collapsed');
    if (content.classList.contains('collapsed')) {
        content.style.maxHeight = content.scrollHeight + "px";
        requestAnimationFrame(() => {
            content.style.maxHeight = '0'; content.style.paddingTop = '0'; content.style.paddingBottom = '0'; content.style.borderTopWidth = '0';
            if (toggle) toggle.style.transform = 'rotate(-90deg)';
        });
    } else {
        content.style.paddingTop = ''; content.style.paddingBottom = ''; content.style.borderTopWidth = '';
        content.style.maxHeight = content.scrollHeight + "px";
        if (toggle) toggle.style.transform = 'rotate(0deg)';
        setTimeout(() => { if (!content.classList.contains('collapsed')) content.style.maxHeight = 'none'; }, 500);
    }
}

function updateEndpointStatusUI(endpointId, statusData, clientId = null) {
    const statusElement = document.getElementById(`status-${endpointId}`);
    const detailsElement = document.getElementById(`details-${endpointId}`);
    const clientSettings = clientId ? clientsData[clientId]?.settings : null;

    // Handle linked clients
    if (clientSettings?.client_type === 'linked') {
        const listElement = document.getElementById(`endpoint-list-${clientId}-linked`);
        const statusPlaceholder = document.getElementById(`linked-status-${clientId}`);
        if (!listElement) return;

        if (statusData?.status === 'ERROR' && statusData?.details?.startsWith('Link Error:')) {
            if (statusPlaceholder) { statusPlaceholder.textContent = statusData.details; listElement.innerHTML=''; listElement.appendChild(statusPlaceholder); }
        } else if (statusData) {
            let rowElement = document.getElementById(`endpoint-item-${endpointId}`);
            if (!rowElement) {
                 const epDataFromRemote = { id: endpointId, name: statusData.name || endpointId, url: statusData.url || 'N/A', group: statusData.group || 'Remote' };
                 rowElement = createEndpointRow(epDataFromRemote, clientId); // Use function from this file
                 if (rowElement) { if (statusPlaceholder && statusPlaceholder.parentNode === listElement) statusPlaceholder.remove(); listElement.appendChild(rowElement); } else { return; }
            }
            const rowStatusEl = rowElement.querySelector('.endpoint-status');
            const rowDetailsEl = rowElement.querySelector('.endpoint-details');
            if (rowStatusEl && rowDetailsEl) updateStatusAndDetailsElements(rowStatusEl, rowDetailsEl, statusData); // Use helper
            if (statusData.name && rowElement.querySelector('.endpoint-name').textContent !== statusData.name) rowElement.querySelector('.endpoint-name').textContent = statusData.name;
            if (statusData.url && rowElement.querySelector('.endpoint-url').textContent !== statusData.url) rowElement.querySelector('.endpoint-url').textContent = statusData.url;
        }
        return;
    }

    // Regular update for local endpoints
    if (!statusElement || !detailsElement) return;
    updateStatusAndDetailsElements(statusElement, detailsElement, statusData); // Use helper
}

function updateStatusAndDetailsElements(statusElement, detailsElement, statusData) {
    statusElement.className = 'endpoint-status';
    let statusText = 'PENDING', detailsText = ' ';
    if (statusData) {
        statusText = statusData.status || 'UNKNOWN';
        statusElement.classList.add(`status-${statusText.toLowerCase()}`);
        const checkDetails = statusData.details || statusData;
        const responseTime = statusData.response_time_ms; const statusCode = statusData.status_code; const detailMsg = checkDetails.details;
        if (statusText === 'UP' && responseTime !== undefined && responseTime !== null) detailsText = `${responseTime} ms`;
        else if (detailMsg) detailsText = detailMsg;
        else if (statusText === 'DOWN' && statusCode) detailsText = `HTTP ${statusCode}`;
        else if (statusText !== 'UP' && statusCode) detailsText = `HTTP ${statusCode}`;
        else if (statusText === 'ERROR' && !detailMsg) detailsText = 'Check Error';
        else if (statusText === 'PENDING' || statusText === 'UNKNOWN') detailsText = 'Awaiting check...';
    } else { statusElement.classList.add('status-unknown'); statusText = 'UNKNOWN'; detailsText = 'No status data'; }
    statusElement.textContent = statusText; detailsElement.innerHTML = detailsText;
}

function updateEndpointStatsUI(endpointId, statsData) {
    const statsElement = document.getElementById(`stats-${endpointId}`);
    if (!statsElement) return;
    if (statsData) {
        if (statsData.error) statsElement.innerHTML = `<span class="stats-error" title="${statsData.error}">Stats Err</span>`;
        else if (statsData.uptime_percentage_24h !== null && statsData.uptime_percentage_24h !== undefined) statsElement.innerHTML = `24h: <span class="stats-value">${statsData.uptime_percentage_24h}%</span>`;
        else statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`;
    } else statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`;
}

function updateClientSettingsSection(clientId) {
    const container = document.getElementById(`client-settings-${clientId}`);
    if (!container) return;
    const clientSettings = clientsData[clientId]?.settings || {};
    const clientType = clientSettings.client_type || 'local';
    const clientName = clientSettings.name || clientId;
    const isApiEnabled = clientSettings.api_enabled || false;
    const isFloatingDisabled = clientSettings.disable_floating_elements || false;

    // Build content safely
    let content = `<h4>Settings: ${escapeHTML(clientName)} <button class="inline-btn edit-client-btn" title="Edit Client Name/Type (Coming Soon)" disabled>✎</button> <button class="inline-btn delete-client-btn" title="Delete Client" onclick="confirmDeleteClient('${escapeJS(clientId)}')">🗑️</button></h4>`;
    content += `<p><strong>Type:</strong> ${escapeHTML(clientType)}</p>`;
    content += `<p><strong>Floating BG:</strong> ${isFloatingDisabled ? 'Disabled' : 'Enabled'} <button class="inline-btn" onclick="toggleFloatingElements()">(Toggle)</button></p>`; // toggleFloatingElements uses global active client ID

    if (clientType === 'local') {
        content += `<p><strong>API Exposure:</strong> ${isApiEnabled ? 'Enabled' : 'Disabled'} <button class="inline-btn" onclick="toggleApiExposure('${escapeJS(clientId)}', ${!isApiEnabled})">(${isApiEnabled ? 'Disable' : 'Enable'})</button></p>`;
        if (isApiEnabled) {
            content += `
                <div class="api-token-section">
                    <strong>API Token:</strong>
                    <div class="token-display-wrapper">
                        <input type="text" id="api-token-display-${clientId}" value="Click to View" readonly style="cursor:pointer;" onclick="fetchAndDisplayToken('${escapeJS(clientId)}')">
                        <button class="inline-btn" onclick="fetchAndDisplayToken('${escapeJS(clientId)}')" title="View Token">👁️</button>
                        <button class="inline-btn" onclick="regenerateToken('${escapeJS(clientId)}')" title="Regenerate Token">🔄</button>
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

    container.innerHTML = content;

    // Disable delete for default client after content is set
    if (clientId === defaultClient) {
        const deleteBtn = container.querySelector('.delete-client-btn');
        if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.title = "Cannot delete the default client"; }
    }
}

// --- Utility functions for escaping ---
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(match) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
    });
}

function escapeJS(str) {
    if (!str) return '';
    // Basic escaping for use in JS function calls within HTML attributes
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}