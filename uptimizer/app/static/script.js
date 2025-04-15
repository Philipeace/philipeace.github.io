// --- Global State & Configuration ---
let historyChart = null;
let currentModalEndpointId = null;
let currentHistoryPeriod = '24h';
let currentActiveClientId = typeof initialActiveClientId !== 'undefined' ? initialActiveClientId : (typeof defaultClientId !== 'undefined' ? defaultClientId : "default_client"); // Track active client tab

// Initial data structure (will be updated on load/reload)
let clientsData = typeof initialClientsData !== 'undefined' ? initialClientsData : {}; // { client_id: { settings: {}, endpoints: [], statuses: {} } }
let globalSettings = typeof initialGlobalSettings !== 'undefined' ? initialGlobalSettings : {};
let endpointData = typeof allInitialEndpointData !== 'undefined' ? allInitialEndpointData : {}; // Keep flat map {ep_id: data} for easy lookup
const defaultClient = typeof defaultClientId !== 'undefined' ? defaultClientId : "default_client";

const POLLING_INTERVAL_MS = 5000;
const statusEndpoint = '/status'; // Fetches { client_id: { endpoint_id: {...} } }
const statsEndpoint = '/statistics'; // Fetches { endpoint_id: {...} } (flat map)
let currentDeleteTarget = { endpointId: null, clientId: null }; // Store both IDs for delete
let animationFrameId = null;

// --- Initialization & UI Setup ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Uptimizer UI Initializing (v1.14.0)...");
    // Initialize global state from potentially undefined injected variables
    clientsData = typeof initialClientsData !== 'undefined' ? initialClientsData : {};
    globalSettings = typeof initialGlobalSettings !== 'undefined' ? initialGlobalSettings : {};
    endpointData = typeof allInitialEndpointData !== 'undefined' ? allInitialEndpointData : {};
    currentActiveClientId = typeof initialActiveClientId !== 'undefined' ? initialActiveClientId : (typeof defaultClientId !== 'undefined' ? defaultClientId : "default_client");

    // Set up UI based on initial data
    setupUI();

    // Fetch initial data and start polling
    fetchAndUpdateStatus();
    setInterval(fetchAndUpdateStatus, POLLING_INTERVAL_MS);

    // Add common modal listeners
    setupModalCloseListeners();

    // Floating Elements Init
    initializeFloatingElements();

    console.log("Uptimizer UI Initialized. Active Client:", currentActiveClientId);
});

function setupUI() {
    // Set up tabs
    initializeTabs();
    // Set up client settings display/toggles for the initially active client
    updateClientSpecificUI(currentActiveClientId);
    // Initial population of global settings display
    updateGlobalSettingsUI();
    // Initialize Groups (ensure correct collapsing)
    initializeGroupToggles();
    // Add listener for Reload button
    const reloadBtn = document.getElementById('refresh-config-btn');
    if (reloadBtn) reloadBtn.onclick = reloadConfig;
    // Add listener for Add Endpoint button
    const addBtn = document.getElementById('add-endpoint-btn');
    if (addBtn) addBtn.onclick = () => openAddEditModal(null); // Opens for the active client
}

function redrawUI(reloadedData) {
    console.log("Redrawing UI after config reload...");
    // Update global state variables
    clientsData = reloadedData.clients_data || {};
    globalSettings = reloadedData.global_settings || {};
    endpointData = reloadedData.all_endpoint_data || {};
    const sortedClientIds = reloadedData.sorted_client_ids || Object.keys(clientsData);
    currentActiveClientId = reloadedData.initial_active_client_id || (sortedClientIds.length > 0 ? sortedClientIds[0] : defaultClient);

    // Clear existing tabs and content
    const tabContainer = document.getElementById('client-tabs');
    const contentContainer = document.getElementById('client-content-container');
    if (tabContainer) tabContainer.innerHTML = '';
    if (contentContainer) contentContainer.innerHTML = '';

    // Rebuild HTML structure (tabs and content panes)
    buildClientTabsAndContent(tabContainer, contentContainer, sortedClientIds, clientsData);

    // Re-initialize UI components based on the new structure/data
    setupUI();

    // Trigger status update to populate new elements
    fetchAndUpdateStatus();
    console.log("UI Redraw complete. Active Client:", currentActiveClientId);
}


function buildClientTabsAndContent(tabContainer, contentContainer, sortedClientIds, clientsData) {
    if (!tabContainer || !contentContainer) return;

    sortedClientIds.forEach((clientId, index) => {
        const clientInfo = clientsData[clientId];
        const clientSettings = clientInfo?.settings || { name: `Client ${clientId}` };
        const clientEndpoints = clientInfo?.endpoints || [];
        const isActive = clientId === currentActiveClientId;

        // Create Tab Button
        const tabButton = document.createElement('button');
        tabButton.className = `client-tab ${isActive ? 'active' : ''}`;
        tabButton.dataset.clientId = clientId;
        tabButton.textContent = clientSettings.name || clientId;
        tabButton.onclick = () => switchTab(clientId);
        tabContainer.appendChild(tabButton);

        // Create Tab Content Pane
        const contentPane = document.createElement('div');
        contentPane.className = `client-tab-content ${isActive ? 'active' : ''}`;
        contentPane.id = `client-content-${clientId}`;
        contentPane.dataset.clientId = clientId;

        // Client-Specific Settings Display (Placeholder)
        // const clientSettingsDiv = document.createElement('div');
        // clientSettingsDiv.className = 'client-settings-display'; // Add styling later
        // clientSettingsDiv.innerHTML = `<span>Floating Elements:</span> <span id="client-${clientId}-floating-status">${clientSettings.disable_floating_elements ? 'Disabled' : 'Enabled'}</span>`;
        // contentPane.appendChild(clientSettingsDiv);

        // Group Containers within Content Pane
        if (clientEndpoints.length > 0) {
            const groups = groupEndpoints(clientEndpoints);
            Object.keys(groups).sort().forEach(groupName => {
                const items = groups[groupName];
                const displayGroupName = groupName || 'Default Group';
                const safeGroupName = displayGroupName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
                const safeClientId = clientId.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
                const listId = `endpoint-list-${safeClientId}-${safeGroupName}`;

                const groupContainer = document.createElement('div');
                groupContainer.className = 'group-container';
                groupContainer.dataset.clientId = clientId;
                groupContainer.dataset.groupName = displayGroupName;

                const groupHeader = document.createElement('div');
                groupHeader.className = 'group-header';
                groupHeader.onclick = () => toggleGroup(groupHeader);
                groupHeader.innerHTML = `<span class="group-title">${displayGroupName}</span><span class="group-toggle">▼</span>`;
                groupContainer.appendChild(groupHeader);

                const groupContent = document.createElement('div');
                groupContent.className = 'group-content'; // Initially expanded
                const listElement = document.createElement('ul');
                listElement.className = 'endpoint-list';
                listElement.id = listId;

                items.forEach(endpoint => {
                    const row = createEndpointRow(endpoint, clientId); // Pass client ID
                    if (row) listElement.appendChild(row);
                });

                groupContent.appendChild(listElement);
                groupContainer.appendChild(groupContent);
                contentPane.appendChild(groupContainer);
            });
        } else {
            // Display message if client has no endpoints
            const noEndpointsContainer = document.createElement('div');
            noEndpointsContainer.className = 'group-container no-endpoints-client';
            noEndpointsContainer.dataset.clientId = clientId;
            noEndpointsContainer.innerHTML = `<div class="group-header" style="cursor: default;"><span class="group-title italic-placeholder">No endpoints configured for this client.</span></div>`;
            contentPane.appendChild(noEndpointsContainer);
        }
        contentContainer.appendChild(contentPane);
    });
}


function groupEndpoints(endpoints) {
    return endpoints.reduce((groups, endpoint) => {
        const groupName = endpoint.group || 'Default Group';
        if (!groups[groupName]) {
            groups[groupName] = [];
        }
        groups[groupName].push(endpoint);
        return groups;
    }, {});
}

// --- Tab Management ---
function initializeTabs() {
    const tabs = document.querySelectorAll('.client-tab');
    tabs.forEach(tab => {
        tab.onclick = () => switchTab(tab.dataset.clientId);
    });
    // Ensure the initial active tab's content is shown
    const initialContent = document.getElementById(`client-content-${currentActiveClientId}`);
    if (initialContent) {
        initialContent.classList.add('active');
    } else if (tabs.length > 0) {
        // Fallback if initialActiveClientId content doesn't exist
        switchTab(tabs[0].dataset.clientId);
    }
}

function switchTab(clientId) {
    if (clientId === currentActiveClientId) return; // No change needed

    // Deactivate previous tab and content
    const previousTab = document.querySelector(`.client-tab[data-client-id="${currentActiveClientId}"]`);
    const previousContent = document.getElementById(`client-content-${currentActiveClientId}`);
    if (previousTab) previousTab.classList.remove('active');
    if (previousContent) previousContent.classList.remove('active');

    // Activate new tab and content
    const newTab = document.querySelector(`.client-tab[data-client-id="${clientId}"]`);
    const newContent = document.getElementById(`client-content-${clientId}`);
    if (newTab) newTab.classList.add('active');
    if (newContent) newContent.classList.add('active');

    currentActiveClientId = clientId;
    console.log("Switched to client tab:", currentActiveClientId);

    // Update UI elements specific to the client (like toggle button state)
    updateClientSpecificUI(clientId);
}

function updateClientSpecificUI(clientId) {
    const clientSettings = clientsData[clientId]?.settings || {};
    // Update Toggle Floating Button State & Data Attribute
    const toggleFloatingBtn = document.getElementById('toggle-floating');
    if (toggleFloatingBtn) {
        const isDisabled = !!clientSettings.disable_floating_elements;
        toggleFloatingBtn.dataset.clientId = clientId; // Update the target client ID
        toggleFloatingBtn.textContent = `Toggle Floating (${clientSettings.name || clientId})`;
        // Update body class based on the *active* client's setting
        document.body.classList.toggle('floating-disabled', isDisabled);
        // Ensure animation state matches body class
        if (isDisabled) stopFloatingAnimation();
        else startFloatingAnimation(); // Restart if needed and enabled
    }
    // Update Add Endpoint Button Text
    const addBtn = document.getElementById('add-endpoint-btn');
    if (addBtn) {
        addBtn.textContent = `+ Add Endpoint (${clientSettings.name || clientId})`;
    }

    // Update client settings display if implemented
    // const floatingStatusEl = document.getElementById(`client-${clientId}-floating-status`);
    // if (floatingStatusEl) floatingStatusEl.textContent = isDisabled ? 'Disabled' : 'Enabled';
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
            // Set initial state (assume expanded unless 'collapsed' class exists)
            if (content.classList.contains('collapsed')) {
                content.style.maxHeight = '0';
                content.style.paddingTop = '0';
                content.style.paddingBottom = '0';
                content.style.borderTopWidth = '0';
                const toggle = header.querySelector('.group-toggle');
                if (toggle) toggle.style.transform = 'rotate(-90deg)';
            } else {
                // Ensure non-collapsed groups are fully visible initially
                // This prevents issues if content was added dynamically after initial render
                 if (content.scrollHeight > 0) {
                     content.style.maxHeight = content.scrollHeight + "px";
                 }
                 setTimeout(() => {
                     if (!content.classList.contains('collapsed')) {
                         content.style.maxHeight = 'none'; // Allow natural height after transition
                     }
                 }, 500); // Match CSS transition duration
            }
        }
    });
}

// --- UI Update Functions ---
function toggleGroup(headerElement) {
    const content = headerElement.nextElementSibling;
    if (!content || !content.classList.contains('group-content')) return;

    const toggle = headerElement.querySelector('.group-toggle');
    const isCollapsed = content.classList.toggle('collapsed');

    if (isCollapsed) {
        content.style.maxHeight = content.scrollHeight + "px"; // Set height before collapsing
        requestAnimationFrame(() => { // Allow setting height before transition starts
            content.style.maxHeight = '0';
            content.style.paddingTop = '0';
            content.style.paddingBottom = '0';
            content.style.borderTopWidth = '0';
            if (toggle) toggle.style.transform = 'rotate(-90deg)';
        });
    } else {
        content.style.maxHeight = content.scrollHeight + "px";
        content.style.paddingTop = '';
        content.style.paddingBottom = '';
        content.style.borderTopWidth = '';
        if (toggle) toggle.style.transform = 'rotate(0deg)';
        // Remove maxHeight after transition to allow dynamic content resizing
        // Use a timeout matching the CSS transition duration
        setTimeout(() => {
            if (!content.classList.contains('collapsed')) {
                content.style.maxHeight = 'none';
            }
        }, 500); // Match transition duration in style.css
    }
}

function updateEndpointStatusUI(endpointId, statusData) {
  // Find the elements, they could be in any client tab's content
  const statusElement = document.getElementById(`status-${endpointId}`);
  const detailsElement = document.getElementById(`details-${endpointId}`);
  if (!statusElement || !detailsElement) {
    // console.warn(`UI elements for endpoint ${endpointId} not found.`);
    return;
  }

  statusElement.className = 'endpoint-status'; // Reset classes
  let statusText = 'PENDING';
  let detailsText = ' '; // Default to non-breaking space

  if (statusData) {
    statusText = statusData.status || 'UNKNOWN';
    statusElement.classList.add(`status-${statusText.toLowerCase()}`);

    const checkDetails = statusData.details; // Full result from checker
    if (checkDetails) {
      if (statusText === 'UP' && checkDetails.response_time_ms !== undefined) {
        detailsText = `${checkDetails.response_time_ms} ms`;
      } else if (checkDetails.details) { // Explicit details message from checker (e.g., Timeout, Connection error)
        detailsText = checkDetails.details;
      } else if (statusText === 'DOWN' && checkDetails.status_code) {
        detailsText = `HTTP ${checkDetails.status_code}`;
      } else if (statusText !== 'UP' && checkDetails.status_code) { // Show status code even for non-2xx/3xx if available
        detailsText = `HTTP ${checkDetails.status_code}`;
      } else if (statusText === 'ERROR' && !checkDetails.details) {
        detailsText = 'Check Error';
      } else if (statusText === 'PENDING' || statusText === 'UNKNOWN') {
        detailsText = 'Awaiting check...';
      }
    } else if (statusText === 'PENDING' || statusText === 'UNKNOWN') {
      detailsText = 'Awaiting check...';
    }
  } else {
    statusElement.classList.add('status-unknown');
    statusText = 'UNKNOWN';
    detailsText = 'No status data';
  }
  statusElement.textContent = statusText;
  detailsElement.innerHTML = detailsText; // Use innerHTML for potential links/formatting later
}

function updateEndpointStatsUI(endpointId, statsData) {
  const statsElement = document.getElementById(`stats-${endpointId}`);
  if (!statsElement) {
    return;
  }
  if (statsData) {
    if (statsData.error) {
      statsElement.innerHTML = `<span class="stats-error" title="${statsData.error}">Stats Err</span>`;
    } else if (statsData.uptime_percentage_24h !== null && statsData.uptime_percentage_24h !== undefined) {
      statsElement.innerHTML = `24h: <span class="stats-value">${statsData.uptime_percentage_24h}%</span>`;
    } else {
      statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`;
    }
  } else {
    statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`;
  }
}

// --- Main Polling Function ---
async function fetchAndUpdateStatus() {
  const footerStatus = document.getElementById('footer-status');
  let hasPending = false;
  try {
    const [statusResponse, statsResponse] = await Promise.allSettled([
      fetch(statusEndpoint), // Fetches { client_id: { endpoint_id: {...} } }
      fetch(statsEndpoint)   // Fetches { endpoint_id: {...} }
    ]);

    /* Status Processing */
    if (statusResponse.status === 'fulfilled' && statusResponse.value.ok) {
      const statusResult = await statusResponse.value.json();
      const clientStatuses = statusResult.statuses || {}; // { client_id: { endpoint_id: {...} } }
      const lastUpdatedTimestamp = statusResult.last_updated;

      // Update statuses for ALL known endpoints (regardless of active tab)
      for (const endpointId in endpointData) {
        let foundStatus = null;
        // Find the status for this endpoint ID from any client
        for (const clientId in clientStatuses) {
          if (clientStatuses[clientId] && clientStatuses[clientId][endpointId]) {
            foundStatus = clientStatuses[clientId][endpointId];
            // Update the status in the local clientsData structure as well (important for consistency)
             if(clientsData[clientId] && clientsData[clientId].statuses) {
                clientsData[clientId].statuses[endpointId] = foundStatus;
             }
            break; // Assume endpoint ID is unique across clients for status lookup
          }
        }
        updateEndpointStatusUI(endpointId, foundStatus); // Update UI with found status or null
        if (foundStatus?.status === 'PENDING') {
          hasPending = true;
        }
      }
      const timestamp = lastUpdatedTimestamp ? new Date(lastUpdatedTimestamp * 1000).toLocaleTimeString() : 'N/A';
      if (footerStatus) {
        footerStatus.textContent = hasPending
          ? `Status updated: ${timestamp} (Checks ongoing...)`
          : `Status updated: ${timestamp}`;
      }
    } else {
      console.error(`Error fetching status: ${statusResponse.reason || statusResponse.value?.status}`);
      if (footerStatus) footerStatus.textContent = `Status fetch failed!`;
    }

    /* Stats Processing */
    if (statsResponse.status === 'fulfilled' && statsResponse.value.ok) {
      const statsResult = await statsResponse.value.json() || {}; // { endpoint_id: {...} }
      Object.keys(endpointData).forEach(endpointId => {
        updateEndpointStatsUI(endpointId, statsResult[endpointId]);
      });
    } else {
      console.error(`Error fetching statistics: ${statsResponse.reason || statsResponse.value?.status}`);
      Object.keys(endpointData).forEach(endpointId =>
        updateEndpointStatsUI(endpointId, { error: "Stats Fetch failed" })
      );
    }

  } catch (error) {
    console.error("Network error during fetch polling:", error);
    if (footerStatus) footerStatus.textContent = `Update failed: Network Error`;
  }
}

// --- History Modal Functions (Largely unchanged, uses global endpointId) ---
async function fetchAndRenderHistory(endpointId, period) {
  console.log(`Fetching history for ${endpointId}, period: ${period}`);
  const modalErrorElement = document.getElementById('history-modal-error');
  const ctxElem = document.getElementById('history-chart');
  if (!ctxElem) {
      console.error("History chart canvas element not found.");
      if(modalErrorElement) modalErrorElement.textContent = 'Error: Chart element missing.';
      return;
  }
  const ctx = ctxElem.getContext('2d');
  if (historyChart) {
    historyChart.destroy();
    historyChart = null;
  }
  if(modalErrorElement) modalErrorElement.textContent = 'Loading history...';


  try {
    const response = await fetch(`/history/${endpointId}?period=${period}`);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({
        error: `HTTP error ${response.status} (${response.statusText})`
      }));
      throw new Error(errData.error || `HTTP error ${response.status} (${response.statusText})`);
    }
    const historyResult = await response.json();
    if (historyResult.error) {
      throw new Error(historyResult.error);
    }

    const historyData = historyResult.data; // Array of {timestamp, status, response_time_ms}
    if(modalErrorElement) modalErrorElement.textContent = '';
    if (historyData.length === 0) {
      if(modalErrorElement) modalErrorElement.textContent = 'No history data available for this period.';
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }

    const labels = historyData.map(point => new Date(point.timestamp));
    const responseTimes = historyData.map(point => point.status === 'UP' ? point.response_time_ms : null);
    const statusColors = historyData.map(point => {
      switch (point.status) {
        case 'UP': return 'rgba(30, 138, 70, 0.7)'; // Green
        case 'DOWN': return 'rgba(235, 72, 54, 0.7)'; // Red
        case 'ERROR': return 'rgba(226, 113, 29, 0.7)'; // Orange
        default: return 'rgba(90, 90, 90, 0.7)'; // Gray
      }
    });

    historyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Response Time (ms)',
            data: responseTimes,
            borderColor: 'var(--cocoa-brown)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.1,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: 'var(--cocoa-brown)',
            spanGaps: false,
            yAxisID: 'yResponseTime',
            order: 1
          },
          {
            label: 'Status',
            data: historyData.map((point, index) => ({
              x: labels[index],
              y: 0 // Plot status points along the x-axis (y=0)
            })),
            pointBackgroundColor: statusColors,
            pointRadius: 5,
            pointHoverRadius: 7,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            showLine: false,
            yAxisID: 'yStatus',
            order: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: inferTimeScaleUnit(period),
              tooltipFormat: 'Pp', // locale dependent format
              displayFormats: { /* custom formats can go here if needed */ }
            },
            title: { display: true, text: 'Time', color: 'var(--isabelline)' },
            ticks: { color: '#ccc' },
            grid: { color: 'rgba(242, 233, 228, 0.1)' }
          },
          yResponseTime: {
            position: 'left',
            beginAtZero: true,
            title: { display: true, text: 'Response Time (ms)', color: 'var(--isabelline)' },
            ticks: { color: '#ccc' },
            grid: { color: 'rgba(242, 233, 228, 0.1)' }
          },
          yStatus: {
            position: 'right',
            beginAtZero: true,
            display: false, // Hide this axis
            min: -1,
            max: 1
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            callbacks: {
              label: function (context) {
                if (!historyData || !historyData[context.dataIndex]) return null; // Guard clause
                const originalData = historyData[context.dataIndex];
                let label = '';
                // If it's the response time dataset and value exists
                if (context.datasetIndex === 0 && context.parsed.y !== null) {
                   label = `Resp. Time: ${context.parsed.y} ms`;
                   // Add status info to the same tooltip if UP
                   if (originalData.status === 'UP') {
                       label += ` (Status: UP)`;
                   }
                   return label;
                }
                // If it's the status dataset
                else if (context.datasetIndex === 1) {
                    // Only show status label if response time is null (i.e., DOWN/ERROR)
                    if (originalData.response_time_ms === null || originalData.response_time_ms === undefined) {
                       return `Status: ${originalData.status}`;
                    } else {
                       return null; // Hide the status label when response time is shown
                    }
                }
                return null; // Hide label for other cases
              }
            }
          }
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false }
      }
    });

  } catch (error) {
    console.error(`Error fetching/rendering history for ${endpointId}:`, error);
    if (modalErrorElement) modalErrorElement.textContent = `Error loading history: ${error.message}`;
    if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}

function inferTimeScaleUnit(period) {
  switch (period) {
    case '1h': return 'minute';
    case '24h': return 'hour';
    case '7d': return 'day';
    default: return 'hour';
  }
}

function openHistoryModalMaybe(event, endpointId) {
  // Prevent opening history modal if clicking on action buttons within the row
  if (event.target.closest('.endpoint-actions button')) {
    return;
  }
  openHistoryModal(endpointId);
}

function openHistoryModal(endpointId) {
  currentModalEndpointId = endpointId;
  const modal = document.getElementById('history-modal-overlay');
  const title = document.getElementById('history-modal-title');
  const epName = endpointData[endpointId]?.name || 'Unknown Endpoint'; // Use flat map for name lookup
  if(title) title.textContent = `History: ${epName}`;
  document.querySelectorAll('#history-modal-overlay .modal-controls button').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.period === '24h') {
      btn.classList.add('active');
    }
  });
  currentHistoryPeriod = '24h';
  if(modal) modal.style.display = 'flex';
  fetchAndRenderHistory(endpointId, currentHistoryPeriod);
}

function closeHistoryModal() {
  const modal = document.getElementById('history-modal-overlay');
  if(modal) modal.style.display = 'none';
  currentModalEndpointId = null;
  if (historyChart) {
    historyChart.destroy();
    historyChart = null;
  }
  const modalErrorElement = document.getElementById('history-modal-error');
  if (modalErrorElement) modalErrorElement.textContent = '';
}

function changeHistoryPeriod(buttonElement) {
  const newPeriod = buttonElement.dataset.period;
  if (newPeriod === currentHistoryPeriod || !currentModalEndpointId) {
    return;
  }
  currentHistoryPeriod = newPeriod;
  document.querySelectorAll('#history-modal-overlay .modal-controls button').forEach(btn => btn.classList.remove('active'));
  buttonElement.classList.add('active');
  fetchAndRenderHistory(currentModalEndpointId, currentHistoryPeriod);
}

// --- Add/Edit/Delete Functions (Now operate on the active client) ---
function createEndpointRow(epData, clientId) { // Accept clientId
  const template = document.getElementById('endpoint-row-template');
  if (!template) {
    console.error("Endpoint row template not found!");
    return null;
  }
  const clone = template.content.firstElementChild.cloneNode(true);
  clone.dataset.endpointId = epData.id;
  clone.dataset.clientId = clientId; // Store client ID on the row
  clone.id = `endpoint-item-${epData.id}`; // ID remains endpoint-specific
  clone.onclick = (event) => openHistoryModalMaybe(event, epData.id);

  clone.querySelector('.endpoint-name').textContent = epData.name;
  clone.querySelector('.endpoint-url').textContent = epData.url;
  // Ensure unique IDs for elements within the row
  clone.querySelector('.endpoint-status').id = `status-${epData.id}`;
  clone.querySelector('.endpoint-details').id = `details-${epData.id}`;
  clone.querySelector('.endpoint-stats').id = `stats-${epData.id}`;

  // Pass client ID to action handlers
  clone.querySelector('.endpoint-actions .edit-btn').onclick = (event) => openAddEditModal(event, epData.id, clientId);
  clone.querySelector('.endpoint-actions .delete-btn').onclick = (event) => confirmDeleteEndpoint(event, epData.id, clientId);

  // Initial UI update
  updateEndpointStatusUI(epData.id, { status: "PENDING" }); // Initial status
  updateEndpointStatsUI(epData.id, null); // Initial stats
  return clone;
}

function getOrCreateGroupList(groupName, clientId) { // Accept clientId
    const displayGroupName = groupName || 'Default Group';
    const safeGroupName = displayGroupName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const safeClientId = clientId.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    let listId = `endpoint-list-${safeClientId}-${safeGroupName}`;
    let listElement = document.getElementById(listId);

    // Find the container for the specific client
    const clientContentPane = document.getElementById(`client-content-${clientId}`);
    if (!clientContentPane) {
        console.error(`Client content pane not found for ${clientId} when creating group ${displayGroupName}`);
        return null; // Cannot create list without the client pane
    }

    if (!listElement) {
        console.log(`Creating new group list for Client: ${clientId}, Group: ${displayGroupName}`);

        const groupContainer = document.createElement('div');
        groupContainer.className = 'group-container';
        groupContainer.dataset.clientId = clientId;
        groupContainer.dataset.groupName = displayGroupName;

        const groupHeader = document.createElement('div');
        groupHeader.className = 'group-header';
        groupHeader.onclick = () => toggleGroup(groupHeader);
        groupHeader.innerHTML = `<span class="group-title">${displayGroupName}</span><span class="group-toggle">▼</span>`;
        groupContainer.appendChild(groupHeader);

        const groupContent = document.createElement('div');
        groupContent.className = 'group-content'; // Start expanded
        listElement = document.createElement('ul');
        listElement.className = 'endpoint-list';
        listElement.id = listId;
        groupContent.appendChild(listElement);
        groupContainer.appendChild(groupContent);

        // Append the new group container to the client's content pane
        const noEndpointsMsg = clientContentPane.querySelector('.no-endpoints-client .group-header');
        if (noEndpointsMsg) {
            // Replace the 'no endpoints' message container
            noEndpointsMsg.closest('.group-container.no-endpoints-client').replaceWith(groupContainer);
        } else {
            // Append to the end of the client pane
            clientContentPane.appendChild(groupContainer);
        }

        // Make sure it's expanded correctly
        setTimeout(() => {
            if (!groupContent.classList.contains('collapsed')) {
                 groupContent.style.maxHeight = 'none'; // Allow natural height
            }
        }, 10); // Short delay to ensure it's in the DOM

    }
    return listElement;
}


// --- Add/Edit Modal Variables & Functions ---
const addEditModalOverlay = document.getElementById('add-edit-modal-overlay');
const addEditForm = document.getElementById('add-edit-endpoint-form');
const addEditErrorElement = document.getElementById('add-edit-endpoint-error');
const addEditModalTitle = document.getElementById('add-edit-modal-title');
const urlWarningElement = document.getElementById('url-dot-warning');

function setupUrlWarningListener(form) {
  const urlInputInForm = form.querySelector('#endpoint-url');
  const warningSpan = form.querySelector('#url-dot-warning');
  if (urlInputInForm && warningSpan) {
    urlInputInForm.oninput = null; // Clear previous listener
    urlInputInForm.oninput = () => {
      if (urlInputInForm.value && !urlInputInForm.value.includes('.')) {
        warningSpan.style.display = 'inline';
      } else {
        warningSpan.style.display = 'none';
      }
    };
  }
}

function openAddEditModal(event, endpointId = null, clientId = null) { // Accept clientId
    if (event) event.stopPropagation(); // Prevent triggering row click

    const targetClientId = clientId || currentActiveClientId; // Use provided ID or fallback to active tab
    const clientName = clientsData[targetClientId]?.settings?.name || targetClientId;

    addEditForm.reset();
    addEditErrorElement.textContent = '';
    addEditErrorElement.style.display = 'none';
    const urlWarningSpan = addEditForm.querySelector('#url-dot-warning');
    if (urlWarningSpan) urlWarningSpan.style.display = 'none';

    // Store the target client ID in the form (e.g., hidden input or data attribute)
    addEditForm.dataset.clientId = targetClientId; // Store client ID on the form

    if (endpointId) { // Edit Mode
        const data = endpointData[endpointId]; // Get endpoint data from flat map
        if (!data) {
            console.error("Edit error: Data not found for Endpoint ID", endpointId);
            addEditErrorElement.textContent = "Error: Endpoint data not found.";
            addEditErrorElement.style.display = 'block';
            return;
        }
        addEditModalTitle.textContent = `Edit Endpoint in Client: ${clientName}`;
        addEditForm.elements['id'].value = data.id; // Keep endpoint id
        addEditForm.elements['name'].value = data.name || '';
        addEditForm.elements['url'].value = data.url || '';
        addEditForm.elements['group'].value = data.group || '';
        addEditForm.elements['check_interval_seconds'].value = data.check_interval_seconds || '';
        addEditForm.elements['check_interval_seconds'].placeholder = globalSettings?.check_interval_seconds || 30;
        addEditForm.elements['check_timeout_seconds'].value = data.check_timeout_seconds || '';
        addEditForm.elements['check_timeout_seconds'].placeholder = globalSettings?.check_timeout_seconds || 10;
    } else { // Add Mode
        addEditModalTitle.textContent = `Add New Endpoint to Client: ${clientName}`;
        addEditForm.elements['id'].value = ''; // Clear endpoint id for add
        addEditForm.elements['check_interval_seconds'].placeholder = globalSettings?.check_interval_seconds || 30;
        addEditForm.elements['check_timeout_seconds'].placeholder = globalSettings?.check_timeout_seconds || 10;
    }
    setupUrlWarningListener(addEditForm);
    if (addEditModalOverlay) addEditModalOverlay.style.display = 'flex';
}


function closeAddEditModal() {
  if(addEditModalOverlay) addEditModalOverlay.style.display = 'none';
}

addEditForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  addEditErrorElement.textContent = '';
  addEditErrorElement.style.display = 'none';
  if (urlWarningElement) urlWarningElement.style.display = 'none';

  const formData = new FormData(addEditForm);
  const endpointId = formData.get('id'); // This is empty for Add
  const targetClientId = addEditForm.dataset.clientId; // Retrieve client ID from form

  if (!targetClientId) {
      addEditErrorElement.textContent = 'Error: Target client ID not found.';
      addEditErrorElement.style.display = 'block';
      console.error("Target client ID missing from add/edit form.");
      return;
  }

  let url = formData.get('url').trim();
  if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.includes('://')) {
    url = 'https://' + url;
  }
  if (url && !url.includes('.') && urlWarningElement) {
    urlWarningElement.style.display = 'inline';
  }

  const endpointPayload = {
    name: formData.get('name').trim(),
    url: url,
    group: formData.get('group').trim() || 'Default Group',
    // Get interval/timeout, handle empty strings as 'null' for clearing overrides
    check_interval_seconds: formData.get('check_interval_seconds').trim() || null,
    check_timeout_seconds: formData.get('check_timeout_seconds').trim() || null
  };

  // --- Validation ---
  if (!endpointPayload.name || !endpointPayload.url) {
    addEditErrorElement.textContent = 'Name and URL are required.';
    addEditErrorElement.style.display = 'block';
    return;
  }
  // Validate interval only if provided
  if (endpointPayload.check_interval_seconds !== null && (isNaN(parseInt(endpointPayload.check_interval_seconds)) || parseInt(endpointPayload.check_interval_seconds) < 5)) {
    addEditErrorElement.textContent = 'Interval must be a number >= 5, or leave blank for global.';
    addEditErrorElement.style.display = 'block';
    return;
  }
  // Validate timeout only if provided
  if (endpointPayload.check_timeout_seconds !== null && (isNaN(parseInt(endpointPayload.check_timeout_seconds)) || parseInt(endpointPayload.check_timeout_seconds) < 1)) {
    addEditErrorElement.textContent = 'Timeout must be a number >= 1, or leave blank for global.';
    addEditErrorElement.style.display = 'block';
    return;
  }
  // Convert valid numbers, keep null if blank
  endpointPayload.check_interval_seconds = endpointPayload.check_interval_seconds !== null ? parseInt(endpointPayload.check_interval_seconds) : null;
  endpointPayload.check_timeout_seconds = endpointPayload.check_timeout_seconds !== null ? parseInt(endpointPayload.check_timeout_seconds) : null;
  // Remove null keys before sending
  Object.keys(endpointPayload).forEach(key => (endpointPayload[key] === null) && delete endpointPayload[key]);


  const isEditing = !!endpointId;
  // Construct the new client-aware API URL
  const apiUrl = isEditing ? `/clients/${targetClientId}/endpoints/${endpointId}` : `/clients/${targetClientId}/endpoints`;
  const apiMethod = isEditing ? 'PUT' : 'POST';

  try {
    const response = await fetch(apiUrl, {
      method: apiMethod,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpointPayload),
    });
    const result = await response.json(); // API should return { client_id: ..., id: ..., name: ... } etc.
    if (!response.ok) {
      throw new Error(result.error || `HTTP error ${response.status}`);
    }
    console.log(`Endpoint ${isEditing ? 'updated' : 'added'} in client ${result.client_id}:`, result);

    // --- Update Local State and UI ---
    const returnedEndpointData = { ...result }; // Data returned from API
    const affectedClientId = result.client_id; // Client ID from API response

    // 1. Update flat endpointData map
    endpointData[returnedEndpointData.id] = returnedEndpointData;

    // 2. Update nested clientsData structure
    if (!clientsData[affectedClientId]) { // Should not happen if API requires valid client
      clientsData[affectedClientId] = { settings: {}, endpoints: [], statuses: {} };
      console.warn("Client data was missing locally, initialized:", affectedClientId);
    }
    if (!clientsData[affectedClientId].endpoints) clientsData[affectedClientId].endpoints = [];
    if (!clientsData[affectedClientId].statuses) clientsData[affectedClientId].statuses = {};


    if (isEditing) {
      const epIndex = clientsData[affectedClientId].endpoints.findIndex(ep => ep.id === returnedEndpointData.id);
      if (epIndex > -1) {
        const oldGroup = clientsData[affectedClientId].endpoints[epIndex].group;
        clientsData[affectedClientId].endpoints[epIndex] = returnedEndpointData; // Replace with new data

        // Update the Row UI
        const rowElement = document.getElementById(`endpoint-item-${returnedEndpointData.id}`);
        if (rowElement) {
          rowElement.querySelector('.endpoint-name').textContent = returnedEndpointData.name;
          rowElement.querySelector('.endpoint-url').textContent = returnedEndpointData.url;
          // Check if group changed and move the row element if necessary
          const currentGroupContainer = rowElement.closest('.group-container');
          const currentGroupName = currentGroupContainer?.dataset.groupName || 'Default Group';
          if (currentGroupName !== returnedEndpointData.group) {
            const newList = getOrCreateGroupList(returnedEndpointData.group, affectedClientId);
            if (newList) {
              newList.appendChild(rowElement); // Move the row
              // Check if the old group is now empty (and not 'Default Group') and remove it
              if (currentGroupContainer && currentGroupContainer.querySelector('.endpoint-list').children.length === 0) {
                  if (currentGroupName !== 'Default Group') {
                      currentGroupContainer.remove();
                  } else {
                      // Add placeholder if Default Group becomes empty? Or just leave it.
                  }
              }
            } else { console.error("Failed to get or create new group list for moving row."); }
          }
        } else { console.warn("Edited endpoint row element not found in DOM:", returnedEndpointData.id); }
      } else { console.warn("Edited endpoint not found in local client endpoint list:", returnedEndpointData.id); }
    } else { // Adding new endpoint
      clientsData[affectedClientId].endpoints.push(returnedEndpointData);
      // Add status placeholder locally
      clientsData[affectedClientId].statuses[returnedEndpointData.id] = { status: "PENDING", last_check_ts: 0, details: null };

      // Add Row to UI
      const listElement = getOrCreateGroupList(returnedEndpointData.group, affectedClientId);
      if (listElement) {
        const newRow = createEndpointRow(returnedEndpointData, affectedClientId);
        const noEndpointsMsg = listElement.closest('.group-content').querySelector('.italic-placeholder'); // Check within parent content
        if (noEndpointsMsg) noEndpointsMsg.closest('.group-container.no-endpoints-client')?.remove(); // Remove 'no endpoints' container if it exists
        if (newRow) listElement.appendChild(newRow);
      } else { console.error("Failed to get or create group list for adding new row."); }
    }
    // --- End Local State and UI Update ---

    closeAddEditModal();
  } catch (error) {
    console.error(`Error ${isEditing ? 'updating' : 'adding'} endpoint:`, error);
    addEditErrorElement.textContent = `Failed: ${error.message}`;
    addEditErrorElement.style.display = 'block';
  }
});


// --- Delete Confirmation Modal Logic ---
const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const confirmModalMessage = document.getElementById('confirm-modal-message');
const confirmYesBtn = document.getElementById('confirm-yes-btn');
const confirmNoBtn = document.getElementById('confirm-no-btn');

function confirmDeleteEndpoint(event, endpointId, clientId) { // Accept clientId
  event.stopPropagation(); // Prevent row click
  currentDeleteTarget = { endpointId, clientId }; // Store both
  const epName = endpointData[endpointId]?.name || endpointId;
  const clientName = clientsData[clientId]?.settings?.name || clientId;
  if(confirmModalMessage) confirmModalMessage.textContent = `Delete "${epName}" from Client "${clientName}"? History data remains in DB.`;
  if(confirmModalOverlay) confirmModalOverlay.style.display = 'flex';
}

function closeConfirmModal() {
  if(confirmModalOverlay) confirmModalOverlay.style.display = 'none';
  currentDeleteTarget = { endpointId: null, clientId: null }; // Reset
}

confirmNoBtn.onclick = closeConfirmModal;
confirmYesBtn.onclick = async () => {
    if (!currentDeleteTarget.endpointId || !currentDeleteTarget.clientId) return;

    const { endpointId, clientId } = currentDeleteTarget; // Get IDs
    closeConfirmModal(); // Close modal immediately

    try {
        // Use the new client-aware API endpoint
        const response = await fetch(`/clients/${clientId}/endpoints/${endpointId}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `HTTP error ${response.status}`);
        }
        console.log(`Endpoint ${endpointId} deleted from client ${clientId}.`);

        // --- Update Local State and UI ---
        // 1. Remove from flat endpointData map
        delete endpointData[endpointId];

        // 2. Remove from nested clientsData structure
        if (clientsData[clientId]) {
            if (clientsData[clientId].endpoints) {
                clientsData[clientId].endpoints = clientsData[clientId].endpoints.filter(ep => ep.id !== endpointId);
            }
            if (clientsData[clientId].statuses) {
                delete clientsData[clientId].statuses[endpointId];
            }
        }

        // 3. Remove Row from UI
        const rowElement = document.getElementById(`endpoint-item-${endpointId}`);
        if (rowElement) {
            const groupContainer = rowElement.closest('.group-container');
            const listElement = rowElement.closest('.endpoint-list');
            rowElement.remove();

            // Check if the group (and potentially client) is now empty
            if (listElement && listElement.children.length === 0) {
                 // If the list is empty, check if it's the 'Default Group'
                 const groupName = groupContainer?.dataset.groupName;
                 if (groupName !== 'Default Group' && groupContainer) {
                     // Remove the non-default group container if it's empty
                     groupContainer.remove();
                 } else if (groupName === 'Default Group' && groupContainer) {
                     // Optionally add a placeholder back to Default Group? For now, just leave it empty.
                 }

                 // Check if the client pane itself is now empty
                 const clientContentPane = document.getElementById(`client-content-${clientId}`);
                 const remainingGroupContainers = clientContentPane?.querySelectorAll('.group-container');
                 if (clientContentPane && (!remainingGroupContainers || remainingGroupContainers.length === 0)) {
                      // Add the 'no endpoints' message back
                      const noEndpointsContainer = document.createElement('div');
                      noEndpointsContainer.className = 'group-container no-endpoints-client';
                      noEndpointsContainer.dataset.clientId = clientId;
                      noEndpointsContainer.innerHTML = `<div class="group-header" style="cursor: default;"><span class="group-title italic-placeholder">No endpoints configured for this client.</span></div>`;
                      clientContentPane.appendChild(noEndpointsContainer);
                 }
            }
        } else { console.warn("Deleted endpoint row element not found in DOM:", endpointId); }
        // --- End Local State and UI Update ---

    } catch (error) {
        console.error('Error deleting endpoint:', error);
        alert(`Failed to delete endpoint: ${error.message}`); // Show error to user
    } finally {
        currentDeleteTarget = { endpointId: null, clientId: null }; // Clear target regardless of outcome
    }
};

// --- Settings Toggle Logic (Operates on Active Client) ---
const toggleFloatingBtn = document.getElementById('toggle-floating');
async function toggleFloatingElements() {
  const clientId = currentActiveClientId; // Use the currently active client ID
  if (!clientId) {
      console.error("Cannot toggle floating elements: No active client ID.");
      return;
  }

  const clientSettings = clientsData[clientId]?.settings;
  if (!clientSettings) {
      console.error(`Cannot toggle floating elements: Settings not found for client ${clientId}.`);
      return;
  }

  // Toggle state locally first for immediate UI feedback
  const isDisabled = !clientSettings.disable_floating_elements; // The new state
  clientSettings.disable_floating_elements = isDisabled; // Update local state

  // Update UI (body class and animation)
  document.body.classList.toggle('floating-disabled', isDisabled);
  if (isDisabled) stopFloatingAnimation();
  else startFloatingAnimation();

  // Persist the change via API
  try {
    console.log(`Saving floating setting for client '${clientId}': disabled=${isDisabled}`);
    const response = await fetch(`/config_api/client_settings/${clientId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disable_floating_elements: isDisabled })
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    const updatedSettings = await response.json();
    console.log(`Floating element setting saved for client ${clientId}. Response:`, updatedSettings);
    // Update local data with potentially more complete settings from response
    if (clientsData[clientId]) {
        clientsData[clientId].settings = updatedSettings.client_settings;
    }
     // Re-sync UI elements tied to client settings (like the button text)
    updateClientSpecificUI(clientId);

  } catch (error) {
    console.error("Error saving floating setting:", error);
    // Rollback local state and UI on failure
    clientSettings.disable_floating_elements = !isDisabled; // Revert local state
    document.body.classList.toggle('floating-disabled', !isDisabled); // Revert body class
    if (!isDisabled) startFloatingAnimation(); else stopFloatingAnimation(); // Revert animation state
    updateClientSpecificUI(clientId); // Re-sync button text/state
    alert("Error saving setting: " + error.message);
  }
}
// Attach listener after DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-floating');
    if (toggleBtn) toggleBtn.onclick = toggleFloatingElements;
});


// --- Config Reload Logic ---
const reloadConfirmModalOverlay = document.getElementById('reload-confirm-modal-overlay');
const reloadConfirmRefreshBtn = document.getElementById('reload-confirm-refresh-btn');
const reloadConfirmCloseBtn = document.getElementById('reload-confirm-close-btn');

async function reloadConfig() {
  const btn = document.getElementById('refresh-config-btn');
  if (!btn || btn.disabled) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Reloading...';
  try {
    const response = await fetch('/config/reload', { method: 'POST' });
    const result = await response.json(); // API now returns { message: ..., reloaded_data: {...} }
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    // Update the entire UI based on the reloaded data
    if (result.reloaded_data) {
        redrawUI(result.reloaded_data);
        // Optionally show a success message briefly? Or rely on modal.
        console.log("Config reloaded and UI redrawn.");
    } else {
         console.warn("Config reload API did not return reloaded_data.");
         // Fallback to page refresh modal
         if(reloadConfirmModalOverlay) reloadConfirmModalOverlay.style.display = 'flex';
    }

  } catch (error) {
    console.error("Error reloading config:", error);
    alert(`Error reloading config: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
function closeReloadConfirmModal() { // This modal might become obsolete if redrawUI works reliably
  if(reloadConfirmModalOverlay) reloadConfirmModalOverlay.style.display = 'none';
}
// Keep listeners for fallback modal case
if (reloadConfirmRefreshBtn) reloadConfirmRefreshBtn.onclick = () => { window.location.reload(); };
if (reloadConfirmCloseBtn) reloadConfirmCloseBtn.onclick = closeReloadConfirmModal;


// --- Modal Close Listeners ---
function setupModalCloseListeners() {
    const modals = [
        { overlayId: 'history-modal-overlay', closeFn: closeHistoryModal },
        { overlayId: 'add-edit-modal-overlay', closeFn: closeAddEditModal },
        { overlayId: 'confirm-modal-overlay', closeFn: closeConfirmModal },
        { overlayId: 'reload-confirm-modal-overlay', closeFn: closeReloadConfirmModal } // Keep for fallback
    ];

    modals.forEach(({ overlayId, closeFn }) => {
        const overlay = document.getElementById(overlayId);
        if (overlay) {
            // Click outside modal content to close
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) {
                    closeFn();
                }
            });
            // Find and attach listener to specific close button within modal
            const closeButton = overlay.querySelector('.modal-close-btn');
            if (closeButton) {
                closeButton.onclick = closeFn;
            }
        }
    });

    // Global Escape key listener
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            modals.forEach(({ overlayId, closeFn }) => {
                const overlay = document.getElementById(overlayId);
                if (overlay && overlay.style.display === 'flex') {
                    closeFn();
                }
            });
        }
    });
}


// --- Floating Element Data (Unchanged) ---
const floatingTextsAndIcons = [ /* ... Array remains the same ... */
    "🐳 Dockerized!", "🐙 GitOps FTW", "☸️ Kube?", "🛡️ Cyber... maybe", "🦑 ArgoCD Dreaming", "</> Spaghetti?",
    "🐍 Pythonic? Ish.", "📊 Grafana Wannabe", "🧪 Flasky & Fast?", "🚀 CI/CD... Soon™", "💾 Postgres Power!",
    "📈 99.9% Uptime?", "💡 Idea!", "🔥 It's Fine.", "👀 Watching...", "🕒 Time Flies", "🌐 Network Latency",
    "🚦 Red. Green. Red.", "🤔 What Was That?", "☕ Needs Coffee", "💾 Save Config!", "♻️ Refactor!",
    "🐛 Bug?", "✅ Test Pass?", "🔑 Secrets?", "📜 Check Logs", "📈 Metrics!", "💾 -> ☁️?", "👨‍💻 Code...",
    "😴 Sleepy?", "🤯 LLM Magic!", "✨ Vibe Coded ✨", "🖱️ You Still Click?", "⚡ Lightning Fast!",
    "🧠 Thinking...", "🤖 Bot At Work", "📑 Tabs!",
    "<a href='https://www.youtube.com/watch?v=dQw4w9WgXcQ' target='_blank' style='color: inherit; text-decoration: underline; pointer-events: auto !important;'>Click Me?</a>"
];

// --- Floating Element Logic (Mostly Unchanged, Init handled separately) ---
const floatingContainer = document.getElementById('floating-elements');
const numFloatingElements = 20;
const floatingElements = []; // Store element references and state

function createFloatingElement(index) {
  if (!floatingContainer) return null;
  const element = document.createElement('div');
  element.classList.add('floating-element');
  element.innerHTML = floatingTextsAndIcons[Math.floor(Math.random() * floatingTextsAndIcons.length)];

  const size = 1 + Math.random() * 1.5;
  element.style.fontSize = `${size}em`;
  element.style.left = `${Math.random() * 100}%`;
  element.style.top = `${Math.random() * 100}%`;

  const animClass = `float-anim${(index % 8) + 1}`;
  element.classList.add(animClass);

  floatingContainer.appendChild(element);
  setTimeout(() => element.classList.add('visible'), 100 + Math.random() * 500);

  return { element, index };
}

function initializeFloatingElements() {
    if (!document.body.classList.contains('floating-disabled') && floatingElements.length === 0) {
        for (let i = 0; i < numFloatingElements; i++) {
            const el = createFloatingElement(i);
            if (el) floatingElements.push(el);
        }
        startFloatingAnimation(); // Start animation only if enabled initially
    } else if (document.body.classList.contains('floating-disabled')) {
        console.log("Floating elements disabled on load.");
    }
}

function startFloatingAnimation() {
  if (!animationFrameId && floatingElements.length > 0) { // Ensure elements exist
    console.log("Starting floating animation.");
    floatingElements.forEach(({ element, index }) => {
      element.style.display = '';
      const animClass = `float-anim${(index % 8) + 1}`;
      if (!element.classList.contains(animClass)) {
        element.classList.add(animClass);
      }
      element.classList.add('visible');
    });
    animationFrameId = 1; // Use a simple flag or requestAnimationFrame handle
  }
}

function stopFloatingAnimation() {
  if (animationFrameId) {
    console.log("Stopping floating animation.");
    floatingElements.forEach(({ element }) => {
      element.classList.remove('visible');
      // Optionally remove animation classes to stop movement completely
      // for(let i = 1; i <= 8; i++) element.classList.remove(`float-anim${i}`);
    });
    // If using requestAnimationFrame, cancel it here: cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}