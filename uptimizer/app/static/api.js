// static/api.js

// --- API Interaction Functions ---

async function fetchAndUpdateStatus() {
    const footerStatus = document.getElementById('footer-status');
    let hasPending = false;
    try {
        // Fetch combined status first
        const statusResponse = await fetch(statusEndpoint); // Assumes statusEndpoint is global
        let clientStatuses = {};
        let lastUpdatedTimestamp = 0;

        if (statusResponse.ok) {
            const statusResult = await statusResponse.json();
            clientStatuses = statusResult.statuses || {};
            lastUpdatedTimestamp = statusResult.last_updated;
        } else {
            console.error(`Error fetching status: ${statusResponse.status}`);
            if (footerStatus) footerStatus.textContent = `Status fetch failed! (${statusResponse.status})`;
             // Show detailed error if possible
             try {
                const errData = await statusResponse.json();
                if(errData.error) console.error("Status fetch error detail:", errData.error);
             } catch(e) { /* Ignore if body isn't JSON */ }
            return; // Don't proceed without status
        }

        // Update UI based on fetched statuses
        const allKnownEndpointIds = Object.keys(endpointData); // endpointData assumed global
        const remotelyReportedEndpointIds = new Set();

        for (const clientId in clientStatuses) {
            const endpointsStatusMap = clientStatuses[clientId];
            const clientConfig = clientsData[clientId]; // clientsData assumed global

            if (!clientConfig) continue;

            // Handle global error for the client (e.g., link fetch failure)
            if (typeof endpointsStatusMap === 'object' && endpointsStatusMap !== null && endpointsStatusMap.error) {
                // Pass null as endpointId to signal global client error update
                updateEndpointStatusUI(null, { status: 'ERROR', details: `Link Error: ${endpointsStatusMap.error}` }, clientId); // Assumes updateEndpointStatusUI is global/accessible
                continue; // Skip individual endpoint updates for this client
            }

            // Process individual endpoint statuses
            if (typeof endpointsStatusMap === 'object' && endpointsStatusMap !== null) {
                for (const endpointId in endpointsStatusMap) {
                    const statusData = endpointsStatusMap[endpointId];
                    updateEndpointStatusUI(endpointId, statusData, clientId); // Assumes updateEndpointStatusUI is global/accessible
                    if (statusData?.status === 'PENDING') {
                        hasPending = true;
                    }
                    if (clientConfig.settings.client_type === 'linked') {
                        remotelyReportedEndpointIds.add(endpointId);
                    }
                }
            } else {
                 console.warn(`Received unexpected status format for client ${clientId}:`, endpointsStatusMap);
            }
        }

        // Remove stale rows for linked endpoints
        document.querySelectorAll('.endpoint-item[data-client-id]').forEach(row => {
            const rowClientId = row.dataset.clientId;
            const rowEndpointId = row.dataset.endpointId;
            const clientType = clientsData[rowClientId]?.settings?.client_type;
            if (clientType === 'linked' && !remotelyReportedEndpointIds.has(rowEndpointId)) {
                console.log(`Removing stale linked endpoint row: ${rowEndpointId} from client ${rowClientId}`);
                row.remove();
                 // Optionally add back placeholder if list becomes empty
                 const listElement = document.getElementById(`endpoint-list-${rowClientId}-linked`);
                 if (listElement && listElement.children.length === 0) {
                     const statusPlaceholder = document.getElementById(`linked-status-${rowClientId}`);
                     if (!statusPlaceholder) { // Avoid adding multiple placeholders
                         const placeholder = document.createElement('li');
                         placeholder.className = 'italic-placeholder';
                         placeholder.id = `linked-status-${rowClientId}`;
                         placeholder.textContent = 'No endpoints reported by remote.';
                         listElement.appendChild(placeholder);
                     }
                 }
            }
        });


        // Fetch stats separately
        const statsResponse = await fetch(statsEndpoint); // Assumes statsEndpoint is global
        if (statsResponse.ok) {
            const statsResult = await statsResponse.json() || {};
            allKnownEndpointIds.forEach(endpointId => {
                updateEndpointStatsUI(endpointId, statsResult[endpointId]); // Assumes updateEndpointStatsUI is global/accessible
            });
        } else {
            console.error(`Error fetching statistics: ${statsResponse.status}`);
            allKnownEndpointIds.forEach(endpointId =>
                updateEndpointStatsUI(endpointId, { error: "Stats Fetch failed" })
            );
        }

        // Update footer
        const timestamp = lastUpdatedTimestamp ? new Date(lastUpdatedTimestamp * 1000).toLocaleTimeString() : 'N/A';
        if (footerStatus) {
            footerStatus.textContent = hasPending
                ? `Status updated: ${timestamp} (Checks ongoing...)`
                : `Status updated: ${timestamp}`;
        }

    } catch (error) {
        console.error("Error during fetch polling:", error);
        if (footerStatus) footerStatus.textContent = `Update failed: Network Error`;
    }
}


async function fetchAndRenderHistory(endpointId, period) {
    console.log(`Fetching history for ${endpointId}, period: ${period}`);
    const modalErrorElement = document.getElementById('history-modal-error');
    const ctxElem = document.getElementById('history-chart');
    if (!ctxElem) { if(modalErrorElement) modalErrorElement.textContent = 'Error: Chart element missing.'; return; }
    const ctx = ctxElem.getContext('2d');
    // Clear previous chart instance using chart.js function
    if (typeof historyChart !== 'undefined' && historyChart) { historyChart.destroy(); historyChart = null; } // historyChart needs to be accessible or passed in
    if(modalErrorElement) modalErrorElement.textContent = 'Loading history...';

    try {
        const response = await fetch(`/history/${endpointId}?period=${period}`);
        if (!response.ok) { const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` })); throw new Error(errData.error || `HTTP ${response.status}`); }
        const historyResult = await response.json();
        if (historyResult.error) throw new Error(historyResult.error);

        const historyData = historyResult.data;
        if(modalErrorElement) modalErrorElement.textContent = '';

        // Call the chart rendering function (assumed global or imported)
        renderHistoryChart(ctx, historyData, period);

    } catch (error) {
        console.error(`Error fetching/rendering history for ${endpointId}:`, error);
        if (modalErrorElement) modalErrorElement.textContent = `Error: ${error.message}`;
        if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
}

async function reloadConfig() {
    const btn = document.getElementById('refresh-config-btn');
    if (!btn || btn.disabled) return;
    const originalText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Reloading...';
    try {
        const response = await fetch('/config/reload', { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (result.reloaded_data) {
            redrawUI(result.reloaded_data); // Assumes redrawUI is global/accessible
        } else { console.warn("Config reload API did not return reloaded_data."); if(reloadConfirmModalOverlay) reloadConfirmModalOverlay.style.display = 'flex'; } // reloadConfirmModalOverlay assumed global
    } catch (error) { console.error("Error reloading config:", error); alert(`Error reloading config: ${error.message}`); }
    finally { btn.disabled = false; btn.textContent = originalText; }
}

async function toggleApiExposure(clientId, enable) {
    console.log(`${enable ? 'Enabling' : 'Disabling'} API exposure for client ${clientId}`);
    try {
        const response = await fetch(`/config_api/client_settings/${clientId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_enabled: enable }) });
        if (!response.ok) { const result = await response.json(); throw new Error(result.error || `HTTP ${response.status}`); }
        const data = await response.json();
        if (clientsData[clientId]) clientsData[clientId].settings = data.client_settings; // Update local state (clientsData assumed global)
        updateClientSettingsSection(clientId); // Refresh UI (assumed global)
        if (!enable) { const tokenInput = document.getElementById(`api-token-display-${clientId}`); if(tokenInput) tokenInput.value = 'Enable API to view/generate token'; }
    } catch (error) { console.error("Error toggling API exposure:", error); alert(`Error: ${error.message}`); }
}

async function fetchAndDisplayToken(clientId) {
    const tokenInput = document.getElementById(`api-token-display-${clientId}`);
    if (!tokenInput || tokenInput.value !== 'Click to View') { // Prevent multiple fetches if already shown/fetching
        if (tokenInput && tokenInput.value !== 'Click to View' && tokenInput.value !== 'Fetching...') {
             tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password'; // Toggle visibility if already fetched
        }
        return;
    }
    tokenInput.value = 'Fetching...'; tokenInput.type = 'text';
    try {
        const response = await fetch(`/clients/${clientId}/api_token`);
        if (!response.ok) { const result = await response.json().catch(()=>({error:`HTTP ${response.status}`})); throw new Error(result.error || `HTTP ${response.status}`); }
        const data = await response.json();
        tokenInput.value = data.api_token || 'Not generated yet. Regenerate?';
        tokenInput.style.cursor = 'text'; // Change cursor now that it has content
        tokenInput.onclick = null; // Remove the fetch trigger
        // Optionally auto-select content?
        // tokenInput.select();
        // tokenInput.setSelectionRange(0, 99999); // For mobile devices
    } catch (error) { console.error("Error fetching token:", error); tokenInput.value = `Error: ${error.message}`; tokenInput.style.cursor = 'pointer'; } // Reset cursor on error
}

async function regenerateToken(clientId) {
    const tokenInput = document.getElementById(`api-token-display-${clientId}`);
    if (!tokenInput) return;
    const clientName = clientsData[clientId]?.settings?.name || clientId; // clientsData assumed global
    if (!confirm(`Regenerate API token for client "${clientName}"? Existing links using the old token will break.`)) return;
    tokenInput.value = 'Regenerating...'; tokenInput.style.cursor = 'default';
    try {
        const response = await fetch(`/config_api/client_settings/${clientId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerate_token: true }) });
         if (!response.ok) { const result = await response.json(); throw new Error(result.error || `HTTP ${response.status}`); }
         const data = await response.json();
         if (clientsData[clientId]) clientsData[clientId].settings = data.client_settings; // Update local state
         console.log(`Token regenerated for ${clientId}. Fetching new token...`);
         tokenInput.value = 'Click to View'; // Reset display state
         tokenInput.style.cursor = 'pointer';
         tokenInput.onclick = () => fetchAndDisplayToken(clientId); // Re-add fetch trigger
         await fetchAndDisplayToken(clientId); // Fetch and display the new token immediately
    } catch (error) { console.error("Error regenerating token:", error); tokenInput.value = `Error: ${error.message}`; alert(`Error: ${error.message}`); }
}