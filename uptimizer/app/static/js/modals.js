// File Name: modals.js
// Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\static\js\modals.js
// static/js/modals.js

// --- Modal References (Assume these elements exist in the DOM) ---
const historyModalOverlay = document.getElementById('history-modal-overlay');
const addEditModalOverlay = document.getElementById('add-edit-modal-overlay');
const addClientModalOverlay = document.getElementById('add-client-modal-overlay');
const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const reloadConfirmModalOverlay = document.getElementById('reload-confirm-modal-overlay'); // Keep for fallback

// Add/Edit Endpoint Modal Form Elements
const addEditForm = document.getElementById('add-edit-endpoint-form');
const addEditErrorElement = document.getElementById('add-edit-endpoint-error');
const addEditModalTitle = document.getElementById('add-edit-modal-title');
const urlWarningElement = document.getElementById('url-dot-warning'); // Might be null

// Add Client Modal Form Elements
const addClientForm = document.getElementById('add-client-form');
const addClientError = document.getElementById('add-client-error');
const linkedClientFields = document.getElementById('linked-client-fields');

// Confirm Modal Elements
const confirmModalMessage = document.getElementById('confirm-modal-message');
const confirmYesBtn = document.getElementById('confirm-yes-btn');
const confirmNoBtn = document.getElementById('confirm-no-btn');

// Reload Confirm Modal Elements (Fallback)
const reloadConfirmRefreshBtn = document.getElementById('reload-confirm-refresh-btn');
const reloadConfirmCloseBtn = document.getElementById('reload-confirm-close-btn');

// --- Modal State ---
let currentModalEndpointId = null; // Used by history modal
let currentHistoryPeriod = '24h'; // Used by history modal
let currentDeleteTarget = { id: null, type: null, clientId: null }; // Used by confirm modal

// --- History Modal ---
function openHistoryModalMaybe(event, endpointId) {
    // Prevent opening if clicking on action buttons within the row
    if (event.target.closest('.endpoint-actions button')) return;
    openHistoryModal(endpointId);
}

function openHistoryModal(endpointId) {
    if (!historyModalOverlay) return;
    currentModalEndpointId = endpointId;
    const title = document.getElementById('history-modal-title');
    // Ensure endpointData is defined and accessible
    const epName = (typeof endpointData !== 'undefined' && endpointData[endpointId]?.name) || endpointId;
    if(title) title.textContent = `History: ${escapeHTML(epName)}`; // Use escapeHTML utility

    // Set default period button state
    document.querySelectorAll('#history-modal-overlay .modal-controls button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.period === '24h') btn.classList.add('active');
    });
    currentHistoryPeriod = '24h';

    historyModalOverlay.style.display = 'flex';
    // Ensure fetchAndRenderHistory is defined and accessible
    if (typeof fetchAndRenderHistory === 'function') {
        fetchAndRenderHistory(endpointId, currentHistoryPeriod);
    } else { console.error("fetchAndRenderHistory function not found."); }
}

function closeHistoryModal() {
    if(historyModalOverlay) historyModalOverlay.style.display = 'none';
    currentModalEndpointId = null;
    // Clear chart instance (assuming historyChart is accessible in chart.js scope)
    if (typeof historyChart !== 'undefined' && historyChart) { historyChart.destroy(); historyChart = null; }
    const errEl = document.getElementById('history-modal-error'); if(errEl) errEl.textContent = '';
}

function changeHistoryPeriod(buttonElement) {
    const newPeriod = buttonElement?.dataset?.period;
    if (!newPeriod || newPeriod === currentHistoryPeriod || !currentModalEndpointId) return;

    currentHistoryPeriod = newPeriod;
    // Update button active state
    document.querySelectorAll('#history-modal-overlay .modal-controls button').forEach(btn => btn.classList.remove('active'));
    buttonElement.classList.add('active');

    // Ensure fetchAndRenderHistory is defined and accessible
    if (typeof fetchAndRenderHistory === 'function') {
        fetchAndRenderHistory(currentModalEndpointId, currentHistoryPeriod);
    } else { console.error("fetchAndRenderHistory function not found."); }
}


// --- Add/Edit Endpoint Modal ---
function setupUrlWarningListener(form) {
    const urlInput = form?.querySelector('#endpoint-url');
    const warningSpan = form?.querySelector('#url-dot-warning');
    if (!urlInput || !warningSpan) return;
    urlInput.oninput = () => { warningSpan.style.display = (urlInput.value && !urlInput.value.includes('.')) ? 'inline' : 'none'; };
}

function openAddEditModal(event, endpointId = null, clientId = null) {
    if (event) event.stopPropagation(); // Prevent triggering history modal if called from button click

    // Ensure currentActiveClientId is defined
    const targetClientId = clientId || (typeof currentActiveClientId !== 'undefined' ? currentActiveClientId : null);
    if (!targetClientId) { console.error("Cannot open Add/Edit modal: No target client ID."); return; }
    // Ensure clientsData is defined
    const clientName = (typeof clientsData !== 'undefined' && clientsData[targetClientId]?.settings?.name) || targetClientId;

    if(!addEditForm || !addEditModalOverlay) return; // Modal elements missing

    addEditForm.reset();
    if(addEditErrorElement) { addEditErrorElement.textContent = ''; addEditErrorElement.style.display = 'none'; }
    const urlWarnSpan = addEditForm.querySelector('#url-dot-warning'); if (urlWarnSpan) urlWarnSpan.style.display = 'none';

    addEditForm.dataset.clientId = targetClientId; // Store target client ID on the form
    if(addEditModalTitle) addEditModalTitle.textContent = endpointId ? `Edit Endpoint in Client: ${escapeHTML(clientName)}` : `Add New Endpoint to Client: ${escapeHTML(clientName)}`;

    // Ensure globalSettings is defined
    const gSettings = typeof globalSettings !== 'undefined' ? globalSettings : {};
    const intervalPlaceholder = gSettings.check_interval_seconds || 30;
    const timeoutPlaceholder = gSettings.check_timeout_seconds || 10;

    const intervalInput = addEditForm.elements['check_interval_seconds'];
    const timeoutInput = addEditForm.elements['check_timeout_seconds'];

    if (endpointId) {
        // Ensure endpointData is defined
        const data = typeof endpointData !== 'undefined' ? endpointData[endpointId] : null;
        if (!data) { console.error("Edit error: Data not found for Endpoint ID", endpointId); return; }
        addEditForm.elements['id'].value = data.id;
        addEditForm.elements['name'].value = data.name || '';
        addEditForm.elements['url'].value = data.url || '';
        addEditForm.elements['group'].value = data.group || '';
        if (intervalInput) { intervalInput.value = data.check_interval_seconds ?? ''; intervalInput.placeholder = intervalPlaceholder; }
        if (timeoutInput) { timeoutInput.value = data.check_timeout_seconds ?? ''; timeoutInput.placeholder = timeoutPlaceholder; }
    } else {
        // Adding new - clear fields and set placeholders
        addEditForm.elements['id'].value = '';
        if (intervalInput) intervalInput.placeholder = intervalPlaceholder;
        if (timeoutInput) timeoutInput.placeholder = timeoutPlaceholder;
    }

    setupUrlWarningListener(addEditForm);
    addEditModalOverlay.style.display = 'flex';
}

function closeAddEditModal() {
    if(addEditModalOverlay) addEditModalOverlay.style.display = 'none';
}

addEditForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if(addEditErrorElement) { addEditErrorElement.textContent = ''; addEditErrorElement.style.display = 'none'; }
    const urlWarningSpan = addEditForm.querySelector('#url-dot-warning'); if (urlWarningSpan) urlWarningSpan.style.display = 'none';

    const formData = new FormData(addEditForm);
    const endpointId = formData.get('id'); // Will be empty if adding
    const targetClientId = addEditForm.dataset.clientId;
    if (!targetClientId) { if(addEditErrorElement){ addEditErrorElement.textContent = 'Error: Target client ID missing.'; addEditErrorElement.style.display = 'block'; } return; }

    let url = formData.get('url').trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.includes('://')) {
        url = 'https://' + url; // Default to https if no scheme
    }
    if (url && !url.includes('.') && urlWarningSpan) urlWarningSpan.style.display = 'inline'; // Show warning if still no dot

    // Prepare payload, handling empty strings for optional numbers
    const intervalStr = formData.get('check_interval_seconds').trim();
    const timeoutStr = formData.get('check_timeout_seconds').trim();

    const endpointPayload = {
        name: formData.get('name').trim(),
        url: url,
        group: formData.get('group').trim() || 'Default Group',
        check_interval_seconds: intervalStr === '' ? null : intervalStr,
        check_timeout_seconds: timeoutStr === '' ? null : timeoutStr
    };

    // Validation
    if (!endpointPayload.name || !endpointPayload.url) { if(addEditErrorElement){ addEditErrorElement.textContent = 'Name and URL required.'; addEditErrorElement.style.display = 'block'; } return; }
    if (endpointPayload.check_interval_seconds !== null && (isNaN(parseInt(endpointPayload.check_interval_seconds)) || parseInt(endpointPayload.check_interval_seconds) < 5)) { if(addEditErrorElement){ addEditErrorElement.textContent = 'Interval must be >= 5s or blank.'; addEditErrorElement.style.display = 'block'; } return; }
    if (endpointPayload.check_timeout_seconds !== null && (isNaN(parseInt(endpointPayload.check_timeout_seconds)) || parseInt(endpointPayload.check_timeout_seconds) < 1)) { if(addEditErrorElement){ addEditErrorElement.textContent = 'Timeout must be >= 1s or blank.'; addEditErrorElement.style.display = 'block'; } return; }

    // Convert valid numbers to int, keep null if blank/invalid was handled
    endpointPayload.check_interval_seconds = endpointPayload.check_interval_seconds !== null ? parseInt(endpointPayload.check_interval_seconds) : null;
    endpointPayload.check_timeout_seconds = endpointPayload.check_timeout_seconds !== null ? parseInt(endpointPayload.check_timeout_seconds) : null;

    // Clean payload: Remove keys with null values before sending
    Object.keys(endpointPayload).forEach(key => (endpointPayload[key] === null) && delete endpointPayload[key]);

    const isEditing = !!endpointId;
    // Use refactored API path
    const apiUrl = isEditing ? `/api/clients/${targetClientId}/endpoints/${endpointId}` : `/api/clients/${targetClientId}/endpoints`;
    const apiMethod = isEditing ? 'PUT' : 'POST';

    try {
        const response = await fetch(apiUrl, { method: apiMethod, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(endpointPayload) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        console.log(`Endpoint ${isEditing ? 'updated' : 'added'} in client ${result.client_id}:`, result);

        // --- Update Local State and UI ---
        // Ensure global data stores and UI functions are accessible
        if (typeof endpointData === 'undefined' || typeof clientsData === 'undefined' || typeof createEndpointRow === 'undefined' || typeof getOrCreateGroupList === 'undefined') {
             console.error("Cannot update UI after endpoint save: Required data or functions missing.");
             closeAddEditModal(); // Close modal anyway
             return;
        }

        const returnedEndpointData = { ...result }; // Copy result data
        const affectedClientId = result.client_id;
        endpointData[returnedEndpointData.id] = returnedEndpointData; // Update global flat map

        // Ensure client data structure exists
        if (!clientsData[affectedClientId]) clientsData[affectedClientId] = { settings: {}, endpoints: [], statuses: {} };
        if (!clientsData[affectedClientId].endpoints) clientsData[affectedClientId].endpoints = [];
        if (!clientsData[affectedClientId].statuses) clientsData[affectedClientId].statuses = {};

        if (isEditing) {
            const epIndex = clientsData[affectedClientId].endpoints.findIndex(ep => ep.id === returnedEndpointData.id);
            if (epIndex > -1) {
                clientsData[affectedClientId].endpoints[epIndex] = returnedEndpointData; // Update endpoint in client's list
                // Update the row in the DOM
                const rowElement = document.getElementById(`endpoint-item-${returnedEndpointData.id}`);
                if (rowElement) {
                    // Update displayed text
                    rowElement.querySelector('.endpoint-name').textContent = returnedEndpointData.name;
                    rowElement.querySelector('.endpoint-url').textContent = returnedEndpointData.url;
                    // Check if group changed and move the row if necessary
                    const currentGroupContainer = rowElement.closest('.group-container');
                    const currentGroupName = currentGroupContainer?.dataset.groupName || 'Default Group';
                    if (currentGroupName !== returnedEndpointData.group) {
                        const newList = getOrCreateGroupList(returnedEndpointData.group, affectedClientId);
                        if (newList) {
                             newList.appendChild(rowElement); // Move row to new list
                             // Check if the old group is now empty and remove it if it's not the default
                             if (currentGroupContainer && currentGroupContainer.querySelector('.endpoint-list').children.length === 0) {
                                 if (currentGroupName !== 'Default Group') { currentGroupContainer.remove(); }
                             }
                         }
                    }
                }
            } else { console.warn("Edited endpoint not found in local clientsData array for UI update."); }
        } else { // Adding new
            clientsData[affectedClientId].endpoints.push(returnedEndpointData);
            clientsData[affectedClientId].statuses[returnedEndpointData.id] = { status: "PENDING", last_check_ts: 0, details: null }; // Initialize status
            // Create and append the new row to the correct group list
            const listElement = getOrCreateGroupList(returnedEndpointData.group, affectedClientId);
            if (listElement) {
                const newRow = createEndpointRow(returnedEndpointData, affectedClientId);
                // Remove 'no endpoints' message if present
                const groupContainer = listElement.closest('.group-container');
                const noEpMsg = groupContainer?.querySelector('.italic-placeholder');
                if(noEpMsg && groupContainer.classList.contains('no-endpoints-client')) {
                     groupContainer.remove(); // Remove the entire placeholder container
                     // Re-fetch the list element as the container was replaced
                     const newListElement = getOrCreateGroupList(returnedEndpointData.group, affectedClientId);
                     if (newListElement && newRow) newListElement.appendChild(newRow);
                } else if (newRow) {
                     listElement.appendChild(newRow);
                }
            }
        }
        // --- End Local State and UI Update ---
        closeAddEditModal();
    } catch (error) { console.error(`Error ${isEditing ? 'updating' : 'adding'} endpoint:`, error); if(addEditErrorElement){ addEditErrorElement.textContent = `Failed: ${error.message}`; addEditErrorElement.style.display = 'block'; } }
});

// --- Add Client Modal ---
function openAddClientModal() {
    if (!addClientModalOverlay || !addClientForm) return;
    addClientForm.reset();
    if (addClientError) { addClientError.textContent = ''; addClientError.style.display = 'none'; }
    if (linkedClientFields) linkedClientFields.style.display = 'none'; // Hide linked fields initially
    addClientModalOverlay.style.display = 'flex';
    // Add event listener to show/hide linked fields based on selection
    const typeSelect = addClientForm.querySelector('#client-type');
    if (typeSelect) typeSelect.onchange = () => { if (linkedClientFields) linkedClientFields.style.display = typeSelect.value === 'linked' ? 'block' : 'none'; };
}

function closeAddClientModal() {
    if (addClientModalOverlay) addClientModalOverlay.style.display = 'none';
}

addClientForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if(addClientError) { addClientError.textContent = ''; addClientError.style.display = 'none'; }

    const formData = new FormData(addClientForm);
    const clientPayload = {
        name: formData.get('name').trim(),
        type: formData.get('type') // Should be 'local' or 'linked'
    };
    if (!clientPayload.name) { if(addClientError){ addClientError.textContent='Name required.'; addClientError.style.display='block'; } return; }

    if (clientPayload.type === 'linked') {
        clientPayload.remote_url = formData.get('remote_url').trim();
        clientPayload.api_token = formData.get('api_token').trim(); // Get token from form
        if (!clientPayload.remote_url || !clientPayload.api_token) { if(addClientError){ addClientError.textContent='URL & Token required for linked client.'; addClientError.style.display='block'; } return; }
        if (!clientPayload.remote_url.startsWith('http')) { if(addClientError){ addClientError.textContent='Invalid URL format (must start with http/https).'; addClientError.style.display='block'; } return; }
    }

    try {
        // Use refactored API endpoint
        const response = await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clientPayload) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        console.log("Client added:", result);

        // --- Update local state and redraw UI ---
        // Ensure necessary globals/functions exist
         if (typeof clientsData === 'undefined' || typeof globalSettings === 'undefined' || typeof endpointData === 'undefined' || typeof redrawUI === 'undefined') {
             console.error("Cannot redraw UI after client add: Required data or functions missing.");
             closeAddClientModal(); // Close modal anyway
             return;
         }

        // Add new client data to global state
        clientsData[result.id] = {
            settings: result.settings, // API returns the created settings
            endpoints: [], // Linked clients start with no endpoints locally
            statuses: {}
        };
        // Regenerate endpointData map (though adding a client doesn't add endpoints)
        // endpointData remains unchanged here, redrawUI handles structure

        const sortedIds = Object.keys(clientsData).sort((a, b) => (clientsData[a].settings.name || a).localeCompare(clientsData[b].settings.name || b));
        redrawUI({ // Trigger full UI redraw
             clients_data: clientsData,
             global_settings: globalSettings,
             all_endpoint_data: endpointData,
             sorted_client_ids: sortedIds,
             initial_active_client_id: result.id // Make the new client active
         });
        // --- End UI update ---
        closeAddClientModal();
    } catch (error) { console.error("Error adding client:", error); if(addClientError){ addClientError.textContent=`Failed: ${error.message}`; addClientError.style.display='block'; } }
});

// --- Delete Confirmation Modal ---
function confirmDeleteEndpoint(event, endpointId, clientId) {
    event.stopPropagation(); // Prevent history modal
    currentDeleteTarget = { id: endpointId, type: 'endpoint', clientId: clientId };
    // Ensure global data and utils exist
    const epName = (typeof endpointData !== 'undefined' && endpointData[endpointId]?.name) || endpointId;
    const clientName = (typeof clientsData !== 'undefined' && clientsData[clientId]?.settings?.name) || clientId;
    if(confirmModalMessage) confirmModalMessage.textContent = `Delete Endpoint "${escapeHTML(epName)}" from Client "${escapeHTML(clientName)}"?`;
    if(confirmModalOverlay) confirmModalOverlay.style.display = 'flex';
}

function confirmDeleteClient(clientId) {
    // Ensure defaultClient and clientsData exist
    if (typeof defaultClient !== 'undefined' && clientId === defaultClient) { alert("Cannot delete the default client."); return; }
    currentDeleteTarget = { id: clientId, type: 'client' }; // Client ID only needed
    const clientName = (typeof clientsData !== 'undefined' && clientsData[clientId]?.settings?.name) || clientId;
    if(confirmModalMessage) confirmModalMessage.textContent = `Delete Client "${escapeHTML(clientName)}" and all its configuration? This action cannot be undone.`;
    if(confirmModalOverlay) confirmModalOverlay.style.display = 'flex';
}

function closeConfirmModal() {
    if(confirmModalOverlay) confirmModalOverlay.style.display = 'none';
    currentDeleteTarget = { id: null, type: null, clientId: null }; // Reset state
}

confirmNoBtn?.addEventListener('click', closeConfirmModal);
confirmYesBtn?.addEventListener('click', async () => { // Combined handler
    if (!currentDeleteTarget.id || !currentDeleteTarget.type) return;
    const { id, type, clientId } = currentDeleteTarget; // Get IDs from modal state
    closeConfirmModal(); // Close modal immediately

    let apiUrl, apiMethod = 'DELETE', successMessage = '';
    // Use refactored API paths
    if (type === 'endpoint' && clientId) { apiUrl = `/api/clients/${clientId}/endpoints/${id}`; successMessage = `Endpoint ${id} deleted.`; }
    else if (type === 'client') { apiUrl = `/api/clients/${id}`; successMessage = `Client ${id} deleted.`; }
    else { return; }

    try {
        const response = await fetch(apiUrl, { method: apiMethod });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        console.log(successMessage, result);

        // --- Update Local State and UI ---
        // Ensure global data and UI functions exist
        if (typeof endpointData === 'undefined' || typeof clientsData === 'undefined' || typeof currentActiveClientId === 'undefined' || typeof createNoEndpointsMessage === 'undefined' || typeof switchTab === 'undefined') {
            console.error("Cannot update UI after delete: Required data or functions missing.");
            return;
        }

        if (type === 'endpoint') {
             delete endpointData[id]; // Remove from flat map
             if (clientsData[clientId]) { // Update client data
                 if (clientsData[clientId].endpoints) clientsData[clientId].endpoints = clientsData[clientId].endpoints.filter(ep => ep.id !== id);
                 if (clientsData[clientId].statuses) delete clientsData[clientId].statuses[id];
             }
             // Remove the row from the DOM
             const rowEl = document.getElementById(`endpoint-item-${id}`);
             if (rowEl) {
                const groupCont = rowEl.closest('.group-container');
                const listEl = rowEl.closest('.endpoint-list');
                rowEl.remove();
                // Check if group is now empty
                if (listEl && listEl.children.length === 0) {
                    const groupName = groupCont?.dataset.groupName;
                    if (groupName !== 'Default Group' && groupCont) groupCont.remove(); // Remove non-default empty group
                    // Check if the entire client pane is now empty (excluding settings)
                    const clientPane = document.getElementById(`client-content-${clientId}`);
                    const remainingGroups = clientPane?.querySelectorAll('.group-container:not(.client-settings-container)');
                    if (clientPane && (!remainingGroups || remainingGroups.length === 0) && !clientPane.querySelector('.no-endpoints-client')) {
                        // Add 'no endpoints' message if pane is empty and message isn't there
                         clientPane.appendChild(createNoEndpointsMessage(clientId));
                    }
                }
             }
        } else if (type === 'client') {
             delete clientsData[id]; // Remove client from data
             // Remove tab and content pane
             const tab = document.querySelector(`.client-tab[data-client-id="${id}"]`);
             const content = document.getElementById(`client-content-${id}`);
             if (tab) tab.remove();
             if (content) content.remove();
             // If the deleted client was active, switch to another one
             if (currentActiveClientId === id) {
                 const firstTab = document.querySelector('.client-tab');
                 if (firstTab) {
                     switchTab(firstTab.dataset.clientId); // Switch to the first available tab
                 } else {
                     // No tabs left, potentially show a default/empty state (redraw handles this)
                     redrawUI({ clients_data: {}, global_settings: globalSettings, all_endpoint_data: {}, sorted_client_ids: [], initial_active_client_id: defaultClient });
                 }
             }
        }
    } catch (error) { console.error(`Error deleting ${type}:`, error); alert(`Failed to delete ${type}: ${error.message}`); }
    finally { currentDeleteTarget = { id: null, type: null, clientId: null }; } // Reset delete target state
});

// --- Reload Confirm Modal (Fallback) ---
function closeReloadConfirmModal() { if(reloadConfirmModalOverlay) reloadConfirmModalOverlay.style.display = 'none'; }
if (reloadConfirmRefreshBtn) reloadConfirmRefreshBtn.onclick = () => { window.location.reload(); };
if (reloadConfirmCloseBtn) reloadConfirmCloseBtn.onclick = closeReloadConfirmModal;


// --- Modal Close Listeners Setup ---
function setupModalCloseListeners() {
    const modals = [
        { overlay: historyModalOverlay, closeFn: closeHistoryModal },
        { overlay: addEditModalOverlay, closeFn: closeAddEditModal },
        { overlay: confirmModalOverlay, closeFn: closeConfirmModal },
        { overlay: addClientModalOverlay, closeFn: closeAddClientModal },
        { overlay: reloadConfirmModalOverlay, closeFn: closeReloadConfirmModal }
    ];
    modals.forEach(({ overlay, closeFn }) => {
        if (overlay && closeFn) { // Check if both exist
            overlay.addEventListener('click', (event) => { if (event.target === overlay) closeFn(); });
            const closeButton = overlay.querySelector('.modal-close-btn');
            if (closeButton) closeButton.onclick = closeFn;
        }
    });
    // Global ESC key listener
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            // Find the topmost visible modal and close it
            let closedModal = false;
            for (let i = modals.length - 1; i >= 0; i--) {
                const { overlay, closeFn } = modals[i];
                if (overlay && overlay.style.display === 'flex') {
                    if(closeFn) closeFn();
                    closedModal = true;
                    break; // Close only one modal per ESC press
                }
            }
        }
    });
}

// Utility functions (ensure defined, e.g., in ui.js or utils.js)
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function(match) {
        return { '&': '&', '<': '<', '>': '>', '"': '"', "'": '\'' }[match];
    });
}
function escapeJS(str) {
     if (str === null || str === undefined) return '';
     return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}
