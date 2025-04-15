// File Name: ui.js
// Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\static\ui.js
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
        // onclick assigned later by initializeTabs
        tabContainer.appendChild(tabButton);

        // Tab Content Pane
        const contentPane = document.createElement('div');
        contentPane.className = `client-tab-content ${isActive ? 'active' : ''}`;
        contentPane.id = `client-content-${clientId}`;
        contentPane.dataset.clientId = clientId;

        // --- Client Settings Section (Collapsible Structure) ---
        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'client-settings-container';
        settingsContainer.id = `client-settings-${clientId}`;

        const settingsHeader = document.createElement('div');
        settingsHeader.className = 'client-settings-header';
        settingsHeader.onclick = () => toggleClientSettings(clientId); // Add toggle handler

        const settingsTitle = document.createElement('span');
        settingsTitle.className = 'client-settings-title';
        settingsTitle.textContent = 'Client Settings'; // Generic title, updated later

        const settingsToggle = document.createElement('span');
        settingsToggle.className = 'client-settings-toggle';
        settingsToggle.innerHTML = '▼'; // Initial state (expanded)

        settingsHeader.appendChild(settingsTitle);
        settingsHeader.appendChild(settingsToggle);

        const settingsBody = document.createElement('div');
        settingsBody.className = 'client-settings-body'; // Content goes here
        settingsBody.id = `client-settings-body-${clientId}`;

        settingsContainer.appendChild(settingsHeader);
        settingsContainer.appendChild(settingsBody);
        // Actual settings content populated by updateClientSettingsSection
        contentPane.appendChild(settingsContainer);
        // --- End Client Settings Section ---

        // Endpoint Groups (only for 'local' clients)
        if (clientSettings.client_type === 'local') {
            if (clientEndpoints.length > 0) {
                const groups = groupEndpoints(clientEndpoints); // Use utility function
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
    // Ensure listId generation is robust for various group names
    const safeGroupName = displayGroupName.replace(/[^a-zA-Z0-9-_]/g, '-') || 'default';
    const listId = `endpoint-list-${clientId}-${safeGroupName.toLowerCase()}`;


    const groupContainer = document.createElement('div');
    groupContainer.className = 'group-container';
    groupContainer.dataset.clientId = clientId;
    groupContainer.dataset.groupName = displayGroupName;
    groupContainer.innerHTML = `
        <div class="group-header" onclick="toggleGroup(this)">
             <span class="group-title">${escapeHTML(displayGroupName)}</span>
             <span class="group-toggle">▼</span>
         </div>
         <div class="group-content">
             <ul class="endpoint-list" id="${listId}"></ul>
         </div>`;

    const listElement = groupContainer.querySelector('.endpoint-list');
    if (endpoints && listElement) {
        endpoints.forEach(endpoint => {
            const row = createEndpointRow(endpoint, clientId);
            if (row) listElement.appendChild(row);
        });
    }
    return groupContainer;
}


function createEndpointRow(epData, clientId) {
    const template = document.getElementById('endpoint-row-template');
    if (!template) { console.error("Endpoint row template not found!"); return null; }
    const clone = template.content.firstElementChild.cloneNode(true);
    clone.dataset.endpointId = epData.id;
    clone.dataset.clientId = clientId;
    clone.id = `endpoint-item-${epData.id}`;
    // Make sure openHistoryModalMaybe is defined and accessible
    if (typeof openHistoryModalMaybe === 'function') {
        clone.onclick = (event) => openHistoryModalMaybe(event, epData.id);
    } else { console.warn("openHistoryModalMaybe function not found for row click."); }

    clone.querySelector('.endpoint-name').textContent = epData.name || epData.id;
    clone.querySelector('.endpoint-url').textContent = epData.url || 'N/A';
    clone.querySelector('.endpoint-status').id = `status-${epData.id}`;
    clone.querySelector('.endpoint-details').id = `details-${epData.id}`;
    clone.querySelector('.endpoint-stats').id = `stats-${epData.id}`;

    // Assign actions
    const editBtn = clone.querySelector('.endpoint-actions .edit-btn');
    const deleteBtn = clone.querySelector('.endpoint-actions .delete-btn');
    // Ensure modal functions are defined and accessible
    if (editBtn && typeof openAddEditModal === 'function') {
        editBtn.onclick = (event) => openAddEditModal(event, epData.id, clientId);
    } else if(editBtn) { console.warn("openAddEditModal function not found for edit button."); }
    if (deleteBtn && typeof confirmDeleteEndpoint === 'function') {
        deleteBtn.onclick = (event) => confirmDeleteEndpoint(event, epData.id, clientId);
    } else if(deleteBtn) { console.warn("confirmDeleteEndpoint function not found for delete button."); }

    // Set initial UI state (PENDING)
    // Ensure UI update functions are defined and accessible
    if(typeof updateEndpointStatusUI === 'function') updateEndpointStatusUI(epData.id, { status: "PENDING" }, clientId);
    else console.warn("updateEndpointStatusUI function not found for initial state.");
    if(typeof updateEndpointStatsUI === 'function') updateEndpointStatsUI(epData.id, null);
    else console.warn("updateEndpointStatsUI function not found for initial state.");

    return clone;
}

function getOrCreateGroupList(groupName, clientId) {
    const displayGroupName = groupName || 'Default Group';
    const safeGroupName = displayGroupName.replace(/[^a-zA-Z0-9-_]/g, '-') || 'default';
    const listId = `endpoint-list-${clientId}-${safeGroupName.toLowerCase()}`;

    let listElement = document.getElementById(listId);
    if (listElement) return listElement; // Group list already exists

    // If list doesn't exist, create the whole group container
    const clientContentPane = document.getElementById(`client-content-${clientId}`);
    if (!clientContentPane) { console.error(`Client content pane not found for ${clientId} when creating group ${displayGroupName}`); return null; }

    const groupContainer = createGroupContainer(clientId, displayGroupName, []); // Create with empty list
    const noEndpointsMsgContainer = clientContentPane.querySelector('.no-endpoints-client'); // Check if the "no endpoints" message exists

    // Insert before the "Add Endpoint" button container if it exists globally
    const globalAddBtnContainer = document.getElementById('add-endpoint-button-container');

    if (noEndpointsMsgContainer) {
        noEndpointsMsgContainer.replaceWith(groupContainer); // Replace placeholder with the new group
    } else if (globalAddBtnContainer && globalAddBtnContainer.parentNode === clientContentPane.parentNode) {
        // If add button is outside content pane (new layout)
        clientContentPane.appendChild(groupContainer); // Append group to the content pane
    } else {
        clientContentPane.appendChild(groupContainer); // Append to client pane otherwise
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
         message = "No clients configured yet. Click '+ Add New Client' to begin.";
     }
     // Make header non-clickable for placeholders
     container.innerHTML = `<div class="group-header" style="cursor: default;"><span class="group-title italic-placeholder">${escapeHTML(message)}</span></div>`;
     return container;
}

function createLinkedClientPlaceholder(clientId, clientSettings) {
     const container = document.createElement('div');
     container.className = 'group-container linked-client-info';
     container.dataset.clientId = clientId;
     container.innerHTML = `
         <div class="group-header linked-header">
             <span class="group-title">Linked Client Info</span>
             {# Toggle removed or disabled for linked info #}
         </div>
         <div class="group-content"> {# Content always visible #}
             <p><strong>Remote URL:</strong> ${escapeHTML(clientSettings.remote_url || 'Not Set')}</p>
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

    // Update global state variable
    currentActiveClientId = clientId;

    console.log("Switched to client tab:", currentActiveClientId);
    // Ensure UI update functions are defined
    if(typeof updateClientSpecificUI === 'function') updateClientSpecificUI(clientId);
    else console.error("updateClientSpecificUI function not found during tab switch.");
    if(typeof updateClientSettingsSection === 'function') updateClientSettingsSection(clientId);
    else console.error("updateClientSettingsSection function not found during tab switch.");
}

function updateClientSpecificUI(clientId) {
    // Ensure clientsData is defined
    if (typeof clientsData === 'undefined') return;
    const clientSettings = clientsData[clientId]?.settings || {};
    const clientName = clientSettings.name || clientId;

    // Toggle Floating Button
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

    // Add Endpoint Button (relocated outside client pane)
    const addEndpointBtn = document.getElementById('add-endpoint-btn');
    const addEndpointContainer = document.getElementById('add-endpoint-button-container');
    if (addEndpointBtn && addEndpointContainer) {
        const isLinked = clientSettings.client_type === 'linked';
        addEndpointBtn.textContent = `+ Add Endpoint (${escapeHTML(clientName)})`;
        addEndpointBtn.disabled = isLinked;
        addEndpointBtn.title = isLinked ? 'Endpoints managed by remote instance' : 'Add endpoint to this client';
        // Ensure modal function is defined
        if (typeof openAddEditModal === 'function') {
             addEndpointBtn.onclick = (event) => openAddEditModal(event, null, clientId); // Pass explicit client ID
        } else { console.error("openAddEditModal function not found for add endpoint button."); }
        // Show/hide container based on client type
        addEndpointContainer.style.display = isLinked ? 'none' : '';
    }
}

function updateGlobalSettingsUI() {
    // This function is now OBSOLETE as global settings are shown within client settings.
}

function initializeGroupToggles() {
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
                 const epDataFromRemote = {
                     id: endpointId,
                     name: statusData.name || endpointId, // Use name from status if available
                     url: statusData.url || 'N/A',        // Use URL from status if available
                     group: statusData.group || 'Remote' // Use group from status if available
                    };
                 rowElement = createEndpointRow(epDataFromRemote, clientId); // Use function from this file
                 if (rowElement) {
                      if (statusPlaceholder && statusPlaceholder.parentNode === listElement) statusPlaceholder.remove();
                      listElement.appendChild(rowElement);
                 } else { return; } // Failed to create row
            }
            // Update the status/details within the row
            const rowStatusEl = rowElement.querySelector('.endpoint-status');
            const rowDetailsEl = rowElement.querySelector('.endpoint-details');
            if (rowStatusEl && rowDetailsEl) updateStatusAndDetailsElements(rowStatusEl, rowDetailsEl, statusData); // Use helper
            // Update name/url if provided in statusData and different
            if (statusData.name && rowElement.querySelector('.endpoint-name').textContent !== statusData.name) rowElement.querySelector('.endpoint-name').textContent = escapeHTML(statusData.name);
            if (statusData.url && rowElement.querySelector('.endpoint-url').textContent !== statusData.url) rowElement.querySelector('.endpoint-url').textContent = escapeHTML(statusData.url);
        } else if (!endpointId && statusData?.status === 'ERROR') {
            // Handle non-link error reported globally for client (e.g., invalid remote format)
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
        const detailMsg = statusData.details; // Already a string or null

        if (statusText === 'UP') {
            detailsText = (responseTime !== undefined && responseTime !== null) ? `${responseTime} ms` : '';
        } else if (detailMsg) {
            detailsText = detailMsg; // Show provided details message
        } else if (statusText === 'DOWN' && statusCode) {
            detailsText = `HTTP ${statusCode}`;
        } else if (statusText === 'ERROR') {
            detailsText = 'Check Error'; // Generic if no specific details
        } else if (statusText === 'PENDING' || statusText === 'UNKNOWN') {
            detailsText = 'Awaiting check...';
        }
        // Handle potential null/undefined for detailsText more explicitly
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
            // Display error state, maybe with tooltip
            statsElement.innerHTML = `<span class="stats-error" title="${escapeHTML(statsData.error)}">Stats Err</span>`;
        } else if (statsData.uptime_percentage_24h !== null && statsData.uptime_percentage_24h !== undefined) {
            // Display valid percentage
            statsElement.innerHTML = `24h: <span class="stats-value">${statsData.uptime_percentage_24h}%</span>`;
        } else {
            // Data received but no percentage (e.g., no data in period)
            statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`;
        }
    } else {
        // No stats data received yet
        statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`;
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
    // Ensure apiToggleFloatingElements function exists or button won't work
    const toggleFuncExists = typeof apiToggleFloatingElements === 'function';
    content += `<p><strong>Floating BG:</strong> ${isFloatingDisabled ? 'Disabled' : 'Enabled'} <button class="inline-btn" ${toggleFuncExists ? `onclick="apiToggleFloatingElements()"` : 'disabled title="Handler missing"'}>(Toggle)</button></p>`;

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

    // --- Add Global Settings Display ---
    content += `<div class="global-settings-display">
                    <strong>Global Settings:</strong> Interval: <span>${globalSettings.check_interval_seconds || '--'}</span>s | Timeout: <span>${globalSettings.check_timeout_seconds || '--'}</span>s
                    <button class="inline-btn" title="Edit Global Settings (Coming Soon)" disabled>✎</button>
               </div>`;

    // --- Add Action Buttons (Edit Client Name/Delete) ---
    // Note: Edit client functionality is not implemented yet.
    content += `<div style="margin-top: 15px; text-align: right;">
                   <button class="inline-btn edit-client-btn" title="Edit Client Name/Type (Coming Soon)" disabled>Edit Client</button>
                   <button class="inline-btn delete-client-btn" title="Delete Client" onclick="confirmDeleteClient('${escapeJS(clientId)}')">Delete Client</button>
               </div>`;


    body.innerHTML = content;

    // Disable delete for default client after content is set
    if (clientId === defaultClient) {
        const deleteBtn = body.querySelector('.delete-client-btn');
        if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.title = "Cannot delete the default client"; }
    }

    // Re-apply initial collapsed state if needed
    const isCollapsed = body.classList.contains('collapsed');
    const toggle = container.querySelector('.client-settings-toggle');
    if (isCollapsed) {
        body.style.maxHeight = '0';
        if (toggle) toggle.style.transform = 'rotate(-90deg)';
    } else {
         body.style.maxHeight = 'none'; // Ensure it's expandable if not collapsed
         if (toggle) toggle.style.transform = 'rotate(0deg)';
    }
}

// --- Utility functions --- moved here for bundling simplicity, can be split later
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function(match) {
        return { '&': '&', '<': '<', '>': '>', '"': '"', "'": '\'' }[match];
    });
}

function escapeJS(str) {
    if (str === null || str === undefined) return '';
    // Basic escaping for use in JS function calls within HTML attributes
    return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function groupEndpoints(endpoints) {
    if (!endpoints || !Array.isArray(endpoints)) return {};
    return endpoints.reduce((groups, endpoint) => {
        const groupName = endpoint.group || 'Default Group';
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(endpoint);
        return groups;
    }, {});
}
