// File Name: ui_builder.js
// Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\static\js\ui\ui_builder.js
// static/js/ui/ui_builder.js
// Functions that create and structure the main UI elements

function buildClientTabsAndContent(tabContainer, contentContainer, sortedClientIds, clientsData) {
    if (!tabContainer || !contentContainer) {
        console.error("Tab or Content container not found for UI build.");
        return;
    }
     // Ensure clientsData and currentActiveClientId are defined
    if (typeof clientsData === 'undefined' || typeof currentActiveClientId === 'undefined' || typeof defaultClient === 'undefined') {
        console.error("Global state (clientsData, currentActiveClientId, defaultClient) not available for UI build.");
        // Optionally display an error message in the UI
        tabContainer.innerHTML = '<span class="error-placeholder">Error loading client data.</span>';
        contentContainer.innerHTML = '<span class="error-placeholder">Error loading content data.</span>';
        return;
    }

    // --- FIX: Explicitly clear placeholder content ---
    console.log("Clearing placeholder content...");
    tabContainer.innerHTML = '';
    contentContainer.innerHTML = '';
    // -----------------------------------------------

    if (!sortedClientIds || sortedClientIds.length === 0) {
        console.log("No clients found, building default placeholders.");
        // Handle case where there are no clients at all
        // Ensure createNoEndpointsMessage is defined
        const placeholderMsgFunc = typeof createNoEndpointsMessage === 'function' ? createNoEndpointsMessage : () => document.createTextNode("No Clients Configured.");

        tabContainer.innerHTML = `<button class="client-tab active" data-client-id="${defaultClient}">Default Client</button>`; // Use defaultClient var
        contentContainer.innerHTML = `<div class="client-tab-content active" id="client-content-${defaultClient}" data-client-id="${defaultClient}"></div>`; // Use defaultClient var
        const defaultContentPane = document.getElementById(`client-content-${defaultClient}`); // Use defaultClient var
        if(defaultContentPane) defaultContentPane.appendChild(placeholderMsgFunc(defaultClient, 'none')); // Special message
        return;
    }

    console.log(`Building UI for ${sortedClientIds.length} clients.`);
    sortedClientIds.forEach((clientId) => {
        const clientInfo = clientsData[clientId];
        if (!clientInfo) {
            console.warn(`Skipping client ID ${clientId}: No data found.`);
            return;
        }
        const clientSettings = clientInfo.settings || { name: `Client ${clientId}`, client_type: 'local' };
        const clientEndpoints = clientInfo.endpoints || [];
        const isActive = clientId === currentActiveClientId;

        // Tab Button
        const tabButton = document.createElement('button');
        tabButton.className = `client-tab ${isActive ? 'active' : ''}`;
        tabButton.dataset.clientId = clientId;
        // Ensure escapeHTML is defined
        tabButton.textContent = typeof escapeHTML === 'function' ? escapeHTML(clientSettings.name || clientId) : (clientSettings.name || clientId); // Escape name
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
        // Ensure toggleClientSettings is defined before assigning onclick
        if (typeof toggleClientSettings === 'function') {
            settingsHeader.onclick = () => toggleClientSettings(clientId);
        } else { console.warn("toggleClientSettings function not found for settings header."); }


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
        // Ensure groupEndpoints and createGroupContainer are defined
        const groupEndpointsFunc = typeof groupEndpoints === 'function' ? groupEndpoints : () => ({});
        const createGroupContainerFunc = typeof createGroupContainer === 'function' ? createGroupContainer : null;
        const createNoEndpointsMessageFunc = typeof createNoEndpointsMessage === 'function' ? createNoEndpointsMessage : () => document.createTextNode("Error: UI builder missing.");
        const createLinkedPlaceholderFunc = typeof createLinkedClientPlaceholder === 'function' ? createLinkedClientPlaceholder : () => document.createTextNode("Error: UI builder missing.");


        if (clientSettings.client_type === 'local') {
            if (clientEndpoints.length > 0) {
                const groups = groupEndpointsFunc(clientEndpoints); // Use utility function
                Object.keys(groups).sort().forEach(groupName => {
                    const items = groups[groupName];
                    if(createGroupContainerFunc) {
                        contentPane.appendChild(createGroupContainerFunc(clientId, groupName, items));
                    }
                });
            } else {
                contentPane.appendChild(createNoEndpointsMessageFunc(clientId, 'local'));
            }
        } else if (clientSettings.client_type === 'linked') {
            contentPane.appendChild(createLinkedPlaceholderFunc(clientId, clientSettings));
        }
        contentContainer.appendChild(contentPane);
    });
    console.log("Finished building tabs and content.");
}

// --- Other functions previously defined in ui_builder.js remain the same ---
// createGroupContainer, createEndpointRow, getOrCreateGroupList,
// createNoEndpointsMessage, createLinkedClientPlaceholder

// Ensure dependencies like escapeHTML are available (assumed from ui_utils.js)
function createGroupContainer(clientId, groupName, endpoints) {
    const displayGroupName = groupName || 'Default Group';
    const safeGroupName = displayGroupName.replace(/[^a-zA-Z0-9-_]/g, '-') || 'default';
    const listId = `endpoint-list-${clientId}-${safeGroupName.toLowerCase()}`;

    const groupContainer = document.createElement('div');
    groupContainer.className = 'group-container';
    groupContainer.dataset.clientId = clientId;
    groupContainer.dataset.groupName = displayGroupName;

    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    if (typeof toggleGroup === 'function') {
        groupHeader.onclick = () => toggleGroup(groupHeader);
    } else { console.warn("toggleGroup function not found for group header."); }

    groupHeader.innerHTML = `
        <span class="group-title">${typeof escapeHTML === 'function' ? escapeHTML(displayGroupName) : displayGroupName}</span>
        <span class="group-toggle">▼</span>`;

    const groupContent = document.createElement('div');
    groupContent.className = 'group-content'; // Initially expanded

    const listElement = document.createElement('ul');
    listElement.className = 'endpoint-list';
    listElement.id = listId;

    groupContent.appendChild(listElement);
    groupContainer.appendChild(groupHeader);
    groupContainer.appendChild(groupContent);

    if (endpoints && listElement && typeof createEndpointRow === 'function') {
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

    if (!epData || typeof epData !== 'object' || !epData.id) {
        console.error("Invalid endpoint data provided to createEndpointRow:", epData);
        return null;
    }

    clone.dataset.endpointId = epData.id;
    clone.dataset.clientId = clientId;
    clone.id = `endpoint-item-${epData.id}`;
    if (typeof openHistoryModalMaybe === 'function') {
        clone.onclick = (event) => openHistoryModalMaybe(event, epData.id);
    } else { console.warn("openHistoryModalMaybe function not found for row click."); }

    clone.querySelector('.endpoint-name').textContent = typeof escapeHTML === 'function' ? escapeHTML(epData.name || epData.id) : (epData.name || epData.id);
    clone.querySelector('.endpoint-url').textContent = typeof escapeHTML === 'function' ? escapeHTML(epData.url || 'N/A') : (epData.url || 'N/A');
    clone.querySelector('.endpoint-status').id = `status-${epData.id}`;
    clone.querySelector('.endpoint-details').id = `details-${epData.id}`;
    clone.querySelector('.endpoint-stats').id = `stats-${epData.id}`;

    const editBtn = clone.querySelector('.endpoint-actions .edit-btn');
    const deleteBtn = clone.querySelector('.endpoint-actions .delete-btn');
    if (editBtn && typeof openAddEditModal === 'function') {
        editBtn.onclick = (event) => openAddEditModal(event, epData.id, clientId);
    } else if(editBtn) { console.warn("openAddEditModal function not found for edit button."); }
    if (deleteBtn && typeof confirmDeleteEndpoint === 'function') {
        deleteBtn.onclick = (event) => confirmDeleteEndpoint(event, epData.id, clientId);
    } else if(deleteBtn) { console.warn("confirmDeleteEndpoint function not found for delete button."); }

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
    if (listElement) return listElement;

    const clientContentPane = document.getElementById(`client-content-${clientId}`);
    if (!clientContentPane) { console.error(`Client content pane not found for ${clientId} when creating group ${displayGroupName}`); return null; }

    const groupContainer = createGroupContainer(clientId, displayGroupName, []);
    const noEndpointsMsgContainer = clientContentPane.querySelector('.no-endpoints-client');
    const settingsContainer = clientContentPane.querySelector('.client-settings-container');

    if (noEndpointsMsgContainer) {
        noEndpointsMsgContainer.replaceWith(groupContainer);
    } else if (settingsContainer) {
        settingsContainer.parentNode.insertBefore(groupContainer, settingsContainer.nextSibling);
    }
    else {
        clientContentPane.appendChild(groupContainer);
    }

    listElement = groupContainer.querySelector('.endpoint-list');

     const groupContent = listElement?.closest('.group-content');
     if (groupContent && groupContent.classList.contains('collapsed')) {
        if(typeof toggleGroup === 'function') toggleGroup(groupContent.previousElementSibling);
        else console.warn("toggleGroup function not available to expand new group.");
     } else if (groupContent) {
        groupContent.style.maxHeight = 'none';
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
         message = "No clients configured yet. Click '+ Add New Client' to begin.";
     }
     const escapeUtil = typeof escapeHTML === 'function' ? escapeHTML : (str) => str; // Fallback
     container.innerHTML = `<div class="group-header" style="cursor: default;"><span class="group-title italic-placeholder">${escapeUtil(message)}</span></div>`;
     return container;
}

function createLinkedClientPlaceholder(clientId, clientSettings) {
     const container = document.createElement('div');
     container.className = 'group-container linked-client-info';
     container.dataset.clientId = clientId;
     const escapeUtil = typeof escapeHTML === 'function' ? escapeHTML : (str) => str; // Fallback
     container.innerHTML = `
         <div class="group-header linked-header" style="cursor: default;">
             <span class="group-title">Linked Client Info</span>
         </div>
         <div class="group-content">
             <p><strong>Remote URL:</strong> ${escapeUtil(clientSettings?.remote_url || 'Not Set')}</p>
             <p><i>Endpoints and statuses are fetched periodically from the remote instance.</i></p>
             <ul class="endpoint-list" id="endpoint-list-${clientId}-linked">
                <li class="italic-placeholder" id="linked-status-${clientId}">Waiting for initial fetch...</li>
             </ul>
         </div>`;
     return container;
}
