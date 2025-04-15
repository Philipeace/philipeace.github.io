// static/modals.js

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
    if (event.target.closest('.endpoint-actions button')) return;
    openHistoryModal(endpointId);
}

function openHistoryModal(endpointId) {
    currentModalEndpointId = endpointId;
    const title = document.getElementById('history-modal-title');
    const epName = endpointData[endpointId]?.name || endpointId; // endpointData assumed global
    if(title) title.textContent = `History: ${epName}`;
    document.querySelectorAll('#history-modal-overlay .modal-controls button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.period === '24h') btn.classList.add('active');
    });
    currentHistoryPeriod = '24h';
    if(historyModalOverlay) historyModalOverlay.style.display = 'flex';
    fetchAndRenderHistory(endpointId, currentHistoryPeriod); // Assumes fetchAndRenderHistory is global/accessible
}

function closeHistoryModal() {
    if(historyModalOverlay) historyModalOverlay.style.display = 'none';
    currentModalEndpointId = null;
    // Clear chart instance (assuming historyChart is accessible or managed elsewhere)
    if (typeof historyChart !== 'undefined' && historyChart) { historyChart.destroy(); historyChart = null; }
    const errEl = document.getElementById('history-modal-error'); if(errEl) errEl.textContent = '';
}

function changeHistoryPeriod(buttonElement) {
    const newPeriod = buttonElement.dataset.period;
    if (newPeriod === currentHistoryPeriod || !currentModalEndpointId) return;
    currentHistoryPeriod = newPeriod;
    document.querySelectorAll('#history-modal-overlay .modal-controls button').forEach(btn => btn.classList.remove('active'));
    buttonElement.classList.add('active');
    fetchAndRenderHistory(currentModalEndpointId, currentHistoryPeriod); // Assumes fetchAndRenderHistory is global/accessible
}


// --- Add/Edit Endpoint Modal ---
function setupUrlWarningListener(form) {
    const urlInput = form?.querySelector('#endpoint-url');
    const warningSpan = form?.querySelector('#url-dot-warning');
    if (!urlInput || !warningSpan) return;
    urlInput.oninput = () => { warningSpan.style.display = (urlInput.value && !urlInput.value.includes('.')) ? 'inline' : 'none'; };
}

function openAddEditModal(event, endpointId = null, clientId = null) {
    if (event) event.stopPropagation();
    const targetClientId = clientId || currentActiveClientId; // currentActiveClientId assumed global
    const clientName = clientsData[targetClientId]?.settings?.name || targetClientId; // clientsData assumed global
    if(!addEditForm) return; // Modal doesn't exist
    addEditForm.reset();
    if(addEditErrorElement) { addEditErrorElement.textContent = ''; addEditErrorElement.style.display = 'none'; }
    const urlWarnSpan = addEditForm.querySelector('#url-dot-warning'); if (urlWarnSpan) urlWarnSpan.style.display = 'none';
    addEditForm.dataset.clientId = targetClientId;
    if(addEditModalTitle) addEditModalTitle.textContent = endpointId ? `Edit Endpoint in Client: ${escapeHTML(clientName)}` : `Add New Endpoint to Client: ${escapeHTML(clientName)}`;

    const gSettings = typeof globalSettings !== 'undefined' ? globalSettings : {}; // globalSettings assumed global
    const intervalPlaceholder = gSettings.check_interval_seconds || 30;
    const timeoutPlaceholder = gSettings.check_timeout_seconds || 10;

    if (endpointId) {
        const data = endpointData[endpointId]; // endpointData assumed global
        if (!data) { console.error("Edit error: Data not found for Endpoint ID", endpointId); return; }
        addEditForm.elements['id'].value = data.id; addEditForm.elements['name'].value = data.name || ''; addEditForm.elements['url'].value = data.url || ''; addEditForm.elements['group'].value = data.group || '';
        addEditForm.elements['check_interval_seconds'].value = data.check_interval_seconds ?? ''; // Use ?? for null/undefined
        addEditForm.elements['check_interval_seconds'].placeholder = intervalPlaceholder;
        addEditForm.elements['check_timeout_seconds'].value = data.check_timeout_seconds ?? '';
        addEditForm.elements['check_timeout_seconds'].placeholder = timeoutPlaceholder;
    } else {
        addEditForm.elements['id'].value = '';
        addEditForm.elements['check_interval_seconds'].placeholder = intervalPlaceholder;
        addEditForm.elements['check_timeout_seconds'].placeholder = timeoutPlaceholder;
    }
    setupUrlWarningListener(addEditForm);
    if(addEditModalOverlay) addEditModalOverlay.style.display = 'flex';
}

function closeAddEditModal() {
    if(addEditModalOverlay) addEditModalOverlay.style.display = 'none';
}

addEditForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if(addEditErrorElement) { addEditErrorElement.textContent = ''; addEditErrorElement.style.display = 'none'; }
    const urlWarningSpan = addEditForm.querySelector('#url-dot-warning'); if (urlWarningSpan) urlWarningSpan.style.display = 'none';

    const formData = new FormData(addEditForm);
    const endpointId = formData.get('id');
    const targetClientId = addEditForm.dataset.clientId;
    if (!targetClientId) { if(addEditErrorElement){ addEditErrorElement.textContent = 'Error: Target client ID missing.'; addEditErrorElement.style.display = 'block'; } return; }

    let url = formData.get('url').trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.includes('://')) url = 'https://' + url;
    if (url && !url.includes('.') && urlWarningSpan) urlWarningSpan.style.display = 'inline';

    const endpointPayload = {
        name: formData.get('name').trim(), url: url, group: formData.get('group').trim() || 'Default Group',
        check_interval_seconds: formData.get('check_interval_seconds').trim() || null,
        check_timeout_seconds: formData.get('check_timeout_seconds').trim() || null
    };

    // Validation
    if (!endpointPayload.name || !endpointPayload.url) { if(addEditErrorElement){ addEditErrorElement.textContent = 'Name and URL required.'; addEditErrorElement.style.display = 'block'; } return; }
    if (endpointPayload.check_interval_seconds !== null && (isNaN(parseInt(endpointPayload.check_interval_seconds)) || parseInt(endpointPayload.check_interval_seconds) < 5)) { if(addEditErrorElement){ addEditErrorElement.textContent = 'Interval must be >= 5s or blank.'; addEditErrorElement.style.display = 'block'; } return; }
    if (endpointPayload.check_timeout_seconds !== null && (isNaN(parseInt(endpointPayload.check_timeout_seconds)) || parseInt(endpointPayload.check_timeout_seconds) < 1)) { if(addEditErrorElement){ addEditErrorElement.textContent = 'Timeout must be >= 1s or blank.'; addEditErrorElement.style.display = 'block'; } return; }
    endpointPayload.check_interval_seconds = endpointPayload.check_interval_seconds !== null ? parseInt(endpointPayload.check_interval_seconds) : null;
    endpointPayload.check_timeout_seconds = endpointPayload.check_timeout_seconds !== null ? parseInt(endpointPayload.check_timeout_seconds) : null;
    Object.keys(endpointPayload).forEach(key => (endpointPayload[key] === null) && delete endpointPayload[key]); // Remove null keys

    const isEditing = !!endpointId;
    const apiUrl = isEditing ? `/clients/${targetClientId}/endpoints/${endpointId}` : `/clients/${targetClientId}/endpoints`;
    const apiMethod = isEditing ? 'PUT' : 'POST';

    try {
        const response = await fetch(apiUrl, { method: apiMethod, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(endpointPayload) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        console.log(`Endpoint ${isEditing ? 'updated' : 'added'} in client ${result.client_id}:`, result);

        // --- Update Local State and UI ---
        const returnedEndpointData = { ...result }; const affectedClientId = result.client_id;
        endpointData[returnedEndpointData.id] = returnedEndpointData; // endpointData assumed global
        if (!clientsData[affectedClientId]) clientsData[affectedClientId] = { settings: {}, endpoints: [], statuses: {} }; // clientsData assumed global
        if (!clientsData[affectedClientId].endpoints) clientsData[affectedClientId].endpoints = [];
        if (!clientsData[affectedClientId].statuses) clientsData[affectedClientId].statuses = {};

        if (isEditing) {
            const epIndex = clientsData[affectedClientId].endpoints.findIndex(ep => ep.id === returnedEndpointData.id);
            if (epIndex > -1) {
                const oldGroup = clientsData[affectedClientId].endpoints[epIndex].group; clientsData[affectedClientId].endpoints[epIndex] = returnedEndpointData;
                const rowElement = document.getElementById(`endpoint-item-${returnedEndpointData.id}`);
                if (rowElement) {
                    rowElement.querySelector('.endpoint-name').textContent = returnedEndpointData.name; rowElement.querySelector('.endpoint-url').textContent = returnedEndpointData.url;
                    const currentGroupContainer = rowElement.closest('.group-container'); const currentGroupName = currentGroupContainer?.dataset.groupName || 'Default Group';
                    if (currentGroupName !== returnedEndpointData.group) {
                        const newList = getOrCreateGroupList(returnedEndpointData.group, affectedClientId); // Assumed global/accessible
                        if (newList) { newList.appendChild(rowElement); if (currentGroupContainer && currentGroupContainer.querySelector('.endpoint-list').children.length === 0) { if (currentGroupName !== 'Default Group') currentGroupContainer.remove(); } }
                    }
                }
            }
        } else {
            clientsData[affectedClientId].endpoints.push(returnedEndpointData); clientsData[affectedClientId].statuses[returnedEndpointData.id] = { status: "PENDING", last_check_ts: 0, details: null };
            const listElement = getOrCreateGroupList(returnedEndpointData.group, affectedClientId); // Assumed global/accessible
            if (listElement) { const newRow = createEndpointRow(returnedEndpointData, affectedClientId); const noEpMsg = listElement.closest('.group-container')?.querySelector('.italic-placeholder'); if(noEpMsg) noEpMsg.closest('.group-container.no-endpoints-client')?.remove(); if (newRow) listElement.appendChild(newRow); } // createEndpointRow assumed global/accessible
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
    if (linkedClientFields) linkedClientFields.style.display = 'none';
    addClientModalOverlay.style.display = 'flex';
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
    const clientPayload = { name: formData.get('name').trim(), type: formData.get('type') };
    if (!clientPayload.name) { if(addClientError){ addClientError.textContent='Name required.'; addClientError.style.display='block'; } return; }

    if (clientPayload.type === 'linked') {
        clientPayload.remote_url = formData.get('remote_url').trim(); clientPayload.api_token = formData.get('api_token').trim();
        if (!clientPayload.remote_url || !clientPayload.api_token) { if(addClientError){ addClientError.textContent='URL & Token required.'; addClientError.style.display='block'; } return; }
        if (!clientPayload.remote_url.startsWith('http')) { if(addClientError){ addClientError.textContent='Invalid URL format.'; addClientError.style.display='block'; } return; }
    }

    try {
        const response = await fetch('/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clientPayload) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        console.log("Client added:", result);
        // --- Update local state and redraw UI ---
        clientsData[result.id] = { settings: result.settings, endpoints: [], statuses: {} }; // clientsData assumed global
        const sortedIds = Object.keys(clientsData).sort((a, b) => (clientsData[a].settings.name || a).localeCompare(clientsData[b].settings.name || b));
        redrawUI({ // redrawUI assumed global/accessible
             clients_data: clientsData, global_settings: globalSettings, // globalSettings assumed global
             all_endpoint_data: endpointData, // endpointData assumed global
             sorted_client_ids: sortedIds, initial_active_client_id: result.id
         });
        // --- End UI update ---
        closeAddClientModal();
    } catch (error) { console.error("Error adding client:", error); if(addClientError){ addClientError.textContent=`Failed: ${error.message}`; addClientError.style.display='block'; } }
});

// --- Delete Confirmation Modal ---
function confirmDeleteEndpoint(event, endpointId, clientId) {
    event.stopPropagation();
    currentDeleteTarget = { id: endpointId, type: 'endpoint', clientId: clientId };
    const epName = endpointData[endpointId]?.name || endpointId; // endpointData assumed global
    const clientName = clientsData[clientId]?.settings?.name || clientId; // clientsData assumed global
    if(confirmModalMessage) confirmModalMessage.textContent = `Delete Endpoint "${escapeHTML(epName)}" from Client "${escapeHTML(clientName)}"?`; // escapeHTML assumed global/accessible
    if(confirmModalOverlay) confirmModalOverlay.style.display = 'flex';
}

function confirmDeleteClient(clientId) {
    if (clientId === defaultClient) { alert("Cannot delete the default client."); return; } // defaultClient assumed global
    currentDeleteTarget = { id: clientId, type: 'client' };
    const clientName = clientsData[clientId]?.settings?.name || clientId; // clientsData assumed global
    if(confirmModalMessage) confirmModalMessage.textContent = `Delete Client "${escapeHTML(clientName)}" and all configuration? This action cannot be undone.`; // escapeHTML assumed global/accessible
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
    if (type === 'endpoint' && clientId) { apiUrl = `/clients/${clientId}/endpoints/${id}`; successMessage = `Endpoint ${id} deleted.`; }
    else if (type === 'client') { apiUrl = `/clients/${id}`; successMessage = `Client ${id} deleted.`; }
    else { return; }

    try {
        const response = await fetch(apiUrl, { method: apiMethod });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        console.log(successMessage, result);

        // --- Update Local State and UI ---
        if (type === 'endpoint') {
             delete endpointData[id]; // endpointData assumed global
             if (clientsData[clientId]) { // clientsData assumed global
                 if (clientsData[clientId].endpoints) clientsData[clientId].endpoints = clientsData[clientId].endpoints.filter(ep => ep.id !== id);
                 if (clientsData[clientId].statuses) delete clientsData[clientId].statuses[id];
             }
             const rowEl = document.getElementById(`endpoint-item-${id}`);
             if (rowEl) {
                const groupCont = rowEl.closest('.group-container'); const listEl = rowEl.closest('.endpoint-list'); rowEl.remove();
                if (listEl && listEl.children.length === 0) {
                    const groupName = groupCont?.dataset.groupName; if (groupName !== 'Default Group' && groupCont) groupCont.remove();
                    const clientPane = document.getElementById(`client-content-${clientId}`); const remainingGroups = clientPane?.querySelectorAll('.group-container:not(.client-settings-container)');
                    if (clientPane && (!remainingGroups || remainingGroups.length === 0)) clientPane.appendChild(createNoEndpointsMessage(clientId)); // Assumes createNoEndpointsMessage accessible
                }
             }
        } else if (type === 'client') {
             delete clientsData[id]; // clientsData assumed global
             const tab = document.querySelector(`.client-tab[data-client-id="${id}"]`); const content = document.getElementById(`client-content-${id}`);
             if (tab) tab.remove(); if (content) content.remove();
             if (currentActiveClientId === id) { const firstTab = document.querySelector('.client-tab'); if (firstTab) switchTab(firstTab.dataset.clientId); else currentActiveClientId = null; } // Assumes currentActiveClientId global, switchTab accessible
        }
    } catch (error) { console.error(`Error deleting ${type}:`, error); alert(`Failed to delete ${type}: ${error.message}`); }
    finally { currentDeleteTarget = { id: null, type: null, clientId: null }; }
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
    modals.forEach(({ overlay, closeFn }) => { if (overlay) { overlay.addEventListener('click', (event) => { if (event.target === overlay) closeFn(); }); const closeButton = overlay.querySelector('.modal-close-btn'); if (closeButton) closeButton.onclick = closeFn; } });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { modals.forEach(({ overlay, closeFn }) => { if (overlay && overlay.style.display === 'flex') closeFn(); }); } });
}