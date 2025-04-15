// File Name: api.js
// Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\static\api.js
// static/api.js

// --- API Interaction Functions ---

async function fetchAndUpdateStatus() {
    const footerStatus = document.getElementById('footer-status');
    let hasPending = false;
    try {
        // Fetch combined status first
        // Ensure statusEndpoint is defined (likely '/api/status' after refactor)
        const statusResponse = await fetch('/api/status'); // Use refactored endpoint
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
        const allKnownEndpointIds = Object.keys(endpointData || {}); // endpointData assumed global
        const remotelyReportedEndpointIds = new Set();

        for (const clientId in clientStatuses) {
            // Ensure clientsData is defined and accessible
            if (typeof clientsData === 'undefined') {
                 console.error("clientsData is not defined in api.js");
                 continue;
            }
            const endpointsStatusMap = clientStatuses[clientId];
            const clientConfig = clientsData[clientId]; // clientsData assumed global

            if (!clientConfig) continue;

            // Handle global error for the client (e.g., link fetch failure)
            if (typeof endpointsStatusMap === 'object' && endpointsStatusMap !== null && endpointsStatusMap.error) {
                // Ensure updateEndpointStatusUI is defined and accessible
                if (typeof updateEndpointStatusUI === 'function') {
                    updateEndpointStatusUI(null, { status: 'ERROR', details: `Link Error: ${endpointsStatusMap.error}` }, clientId);
                } else { console.error("updateEndpointStatusUI function not found."); }
                continue; // Skip individual endpoint updates for this client
            }

            // Process individual endpoint statuses
            if (typeof endpointsStatusMap === 'object' && endpointsStatusMap !== null) {
                for (const endpointId in endpointsStatusMap) {
                    const statusData = endpointsStatusMap[endpointId];
                    if (typeof updateEndpointStatusUI === 'function') {
                        updateEndpointStatusUI(endpointId, statusData, clientId);
                    } else { console.error("updateEndpointStatusUI function not found."); }
                    if (statusData?.status === 'PENDING') {
                        hasPending = true;
                    }
                    // Ensure clientConfig has settings before accessing type
                    if (clientConfig.settings && clientConfig.settings.client_type === 'linked') {
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
            // Ensure clientsData exists before access
            const clientType = (typeof clientsData !== 'undefined' && clientsData[rowClientId]?.settings?.client_type);
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
        // Ensure statsEndpoint is defined (likely /api/statistics)
        const statsResponse = await fetch('/api/statistics'); // Use refactored endpoint
        if (statsResponse.ok) {
            const statsResult = await statsResponse.json() || {};
            allKnownEndpointIds.forEach(endpointId => {
                // Ensure updateEndpointStatsUI is defined
                if (typeof updateEndpointStatsUI === 'function') {
                    updateEndpointStatsUI(endpointId, statsResult[endpointId]);
                } else { console.error("updateEndpointStatsUI function not found."); }
            });
        } else {
            console.error(`Error fetching statistics: ${statsResponse.status}`);
            allKnownEndpointIds.forEach(endpointId => {
                // Ensure updateEndpointStatsUI is defined
                if (typeof updateEndpointStatsUI === 'function') {
                    updateEndpointStatsUI(endpointId, { error: "Stats Fetch failed" });
                } else { console.error("updateEndpointStatsUI function not found."); }
            });
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
        // Ensure endpoint uses refactored path
        const response = await fetch(`/api/history/${endpointId}?period=${period}`);
        if (!response.ok) { const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` })); throw new Error(errData.error || `HTTP ${response.status}`); }
        const historyResult = await response.json();
        if (historyResult.error) throw new Error(historyResult.error);

        const historyData = historyResult.data;
        if(modalErrorElement) modalErrorElement.textContent = '';

        // Call the chart rendering function (assumed global or imported)
        // Ensure renderHistoryChart is defined
        if (typeof renderHistoryChart === 'function') {
            renderHistoryChart(ctx, historyData, period);
        } else { console.error("renderHistoryChart function not found."); }

    } catch (error) {
        console.error(`Error fetching/rendering history for ${endpointId}:`, error);
        if (modalErrorElement) modalErrorElement.textContent = `Error: ${error.message}`;
        if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
}

async function reloadConfig() {
    const btn = document.getElementById('refresh-config-btn');
    const reloadModal = document.getElementById('reload-confirm-modal-overlay'); // Get modal ref
    if (!btn || btn.disabled) return;
    const originalText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Reloading...';
    try {
        // Ensure endpoint uses refactored path
        const response = await fetch('/api/config/reload', { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (result.reloaded_data) {
            // Ensure redrawUI is defined
            if (typeof redrawUI === 'function') {
                redrawUI(result.reloaded_data);
                if (reloadModal) reloadModal.style.display = 'flex'; // Show success modal
            } else { console.error("redrawUI function not found."); }
        } else {
            console.warn("Config reload API did not return reloaded_data.");
            if (reloadModal) reloadModal.style.display = 'flex'; // Still show modal even if data missing? Or show error?
        }
    } catch (error) { console.error("Error reloading config:", error); alert(`Error reloading config: ${error.message}`); }
    finally { btn.disabled = false; btn.textContent = originalText; }
}

// --- Floating Elements Toggle --- FIX
async function apiToggleFloatingElements() {
    // Get active client ID (assuming currentActiveClientId is global/accessible)
    const clientId = typeof currentActiveClientId !== 'undefined' ? currentActiveClientId : null;
    if (!clientId) {
        console.error("Cannot toggle floating elements: No active client ID found.");
        return;
    }
    // Ensure clientsData is accessible
    if (typeof clientsData === 'undefined') {
        console.error("Cannot toggle floating elements: clientsData not found.");
        return;
    }
    const currentSettings = clientsData[clientId]?.settings;
    if (!currentSettings) {
        console.error(`Cannot toggle floating elements: Settings for client ${clientId} not found.`);
        return;
    }

    const newState = !currentSettings.disable_floating_elements; // Toggle the state
    const clientName = currentSettings.name || clientId;
    const toggleBtn = document.getElementById('toggle-floating');

    console.log(`${newState ? 'Disabling' : 'Enabling'} floating elements for client ${clientName}`);
    if (toggleBtn) { toggleBtn.disabled = true; toggleBtn.textContent = 'Saving...'; }

    try {
        // Ensure endpoint uses refactored path
        const response = await fetch(`/api/config_api/client_settings/${clientId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disable_floating_elements: newState })
        });
        if (!response.ok) {
            const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        const data = await response.json();

        // Update local state immediately
        if (clientsData[clientId]) {
            clientsData[clientId].settings = data.client_settings;
        }

        // Update UI based on the new state
        document.body.classList.toggle('floating-disabled', newState);
        if (newState) {
            // Ensure stopFloatingAnimation is defined
            if (typeof stopFloatingAnimation === 'function') stopFloatingAnimation();
            else console.error("stopFloatingAnimation function not found.");
        } else {
            // Ensure startFloatingAnimation is defined
            if (typeof startFloatingAnimation === 'function') startFloatingAnimation();
            else console.error("startFloatingAnimation function not found.");
        }
        // Update button text
        if (toggleBtn) {
            toggleBtn.textContent = `Toggle Floating (${escapeHTML(clientName)})`;
        }
        console.log(`Floating elements ${newState ? 'disabled' : 'enabled'} for ${clientName}`);

    } catch (error) {
        console.error("Error toggling floating elements:", error);
        alert(`Error saving setting: ${error.message}`);
        // Revert UI changes if API call failed? Optional, but could be complex.
    } finally {
        if (toggleBtn) {
            toggleBtn.disabled = false;
            // Refresh button text in case name changed concurrently
            const updatedClientName = clientsData[clientId]?.settings?.name || clientId;
            toggleBtn.textContent = `Toggle Floating (${escapeHTML(updatedClientName)})`;
        }
    }
}


async function toggleApiExposure(clientId, enable) {
    console.log(`${enable ? 'Enabling' : 'Disabling'} API exposure for client ${clientId}`);
    try {
        // Ensure endpoint uses refactored path
        const response = await fetch(`/api/config_api/client_settings/${clientId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_enabled: enable }) });
        if (!response.ok) { const result = await response.json().catch(()=>({error:`HTTP ${response.status}`})); throw new Error(result.error || `HTTP ${response.status}`); }
        const data = await response.json();
        // Ensure clientsData and updateClientSettingsSection are defined
        if (typeof clientsData !== 'undefined' && clientsData[clientId]) clientsData[clientId].settings = data.client_settings;
        if (typeof updateClientSettingsSection === 'function') updateClientSettingsSection(clientId); // Refresh UI
        else console.error("updateClientSettingsSection function not found.");
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
        // Ensure endpoint uses refactored path
        const response = await fetch(`/api/clients/${clientId}/api_token`);
        if (!response.ok) { const result = await response.json().catch(()=>({error:`HTTP ${response.status}`})); throw new Error(result.error || `HTTP ${response.status}`); }
        const data = await response.json();
        tokenInput.value = data.api_token || 'Not generated yet. Regenerate?';
        tokenInput.style.cursor = 'text'; // Change cursor now that it has content
        tokenInput.onclick = null; // Remove the fetch trigger
    } catch (error) { console.error("Error fetching token:", error); tokenInput.value = `Error: ${error.message}`; tokenInput.style.cursor = 'pointer'; } // Reset cursor on error
}

async function regenerateToken(clientId) {
    const tokenInput = document.getElementById(`api-token-display-${clientId}`);
    if (!tokenInput) return;
    // Ensure clientsData is accessible
    const clientName = (typeof clientsData !== 'undefined' && clientsData[clientId]?.settings?.name) || clientId;
    if (!confirm(`Regenerate API token for client "${escapeHTML(clientName)}"? Existing links using the old token will break.`)) return; // Ensure escapeHTML is defined
    tokenInput.value = 'Regenerating...'; tokenInput.style.cursor = 'default';
    try {
        // Ensure endpoint uses refactored path
        const response = await fetch(`/api/config_api/client_settings/${clientId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ regenerate_token: true }) });
         if (!response.ok) { const result = await response.json().catch(()=>({error:`HTTP ${response.status}`})); throw new Error(result.error || `HTTP ${response.status}`); }
         const data = await response.json();
         // Ensure clientsData is accessible
         if (typeof clientsData !== 'undefined' && clientsData[clientId]) clientsData[clientId].settings = data.client_settings; // Update local state
         console.log(`Token regenerated for ${clientId}. Fetching new token...`);
         tokenInput.value = 'Click to View'; // Reset display state
         tokenInput.style.cursor = 'pointer';
         tokenInput.onclick = () => fetchAndDisplayToken(clientId); // Re-add fetch trigger
         await fetchAndDisplayToken(clientId); // Fetch and display the new token immediately
    } catch (error) { console.error("Error regenerating token:", error); tokenInput.value = `Error: ${error.message}`; alert(`Error: ${error.message}`); }
}

// Helper (ensure defined if used)
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
}