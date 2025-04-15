// --- Global State & Configuration ---
let historyChart = null;
let currentModalEndpointId = null;
let currentHistoryPeriod = '24h';
let endpointData = typeof initialEndpointData !== 'undefined' ? initialEndpointData : {};
let appSettings = typeof initialAppSettings !== 'undefined' ? initialAppSettings : {};
const POLLING_INTERVAL_MS = 5000;
const statusEndpoint = '/status';
const statsEndpoint = '/statistics';
let currentDeleteTargetId = null;
let animationFrameId = null;

// --- Floating Element Data & Logic ---
const floatingTextsAndIcons = [ "🐳 Dockerized!", "🐙 GitOps FTW", "☸️ Kube?", "🛡️ Cyber... maybe", "🦑 ArgoCD Dreaming", "</> Spaghetti?", "🐍 Pythonic? Ish.", "📊 Grafana Wannabe", "🧪 Flasky & Fast?", "🚀 CI/CD... Soon™", "💾 Postgres Power!", "📈 99.9% Uptime?", "💡 Idea!", "🔥 It's Fine.", "👀 Watching...", "🕒 Time Flies", "🌐 Network Latency", "🚦 Red. Green. Red.", "🤔 What Was That?", "☕ Needs Coffee", "💾 Save Config!", "♻️ Refactor!", "🐛 Bug?", "✅ Test Pass?", "🔑 Secrets?", "📜 Check Logs", "📈 Metrics!", "💾 -> ☁️?", "👨‍💻 Code...", "😴 Sleepy?", "🤯 LLM Magic!", "✨ Vibe Coded ✨", "🖱️ You Still Click?", "⚡ Lightning Fast!", "🧠 Thinking...", "🤖 Bot At Work", "<a href='https://www.youtube.com/watch?v=dQw4w9WgXcQ' target='_blank' style='color: inherit; text-decoration: underline; pointer-events: auto !important;'>Click Me?</a>" ];
const floatingElementContainer = document.getElementById('floating-elements');
const numFloatingElements = 40;
let floatingElements = [];
let availableTexts = [...floatingTextsAndIcons];

function getRandomText() { if (availableTexts.length === 0) { availableTexts = [...floatingTextsAndIcons]; } const index = Math.floor(Math.random() * availableTexts.length); return availableTexts.splice(index, 1)[0]; }
function createFloatingElement(index) { const element = document.createElement('div'); element.classList.add('floating-element'); element.innerHTML = getRandomText(); const containerRect = floatingElementContainer.getBoundingClientRect(); const x = Math.random() * containerRect.width; const y = Math.random() * containerRect.height; const speedFactor = 400 + Math.random() * 250; const vx = (Math.random() - 0.5) * (containerRect.width / speedFactor); const vy = (Math.random() - 0.5) * (containerRect.height / speedFactor); element.style.left = `${x}px`; element.style.top = `${y}px`; floatingElementContainer.appendChild(element); setTimeout(() => element.classList.add('visible'), 50 + Math.random() * 100); return { el: element, x, y, vx, vy }; }
function animateFloatingElements() { const containerRect = floatingElementContainer.getBoundingClientRect(); if (!containerRect.width || !containerRect.height) { animationFrameId = requestAnimationFrame(animateFloatingElements); return; } floatingElements.forEach(item => { item.x += item.vx; item.y += item.vy; const elWidth = item.el.offsetWidth; const elHeight = item.el.offsetHeight; item.x = (item.x + elWidth > 0) ? (item.x % (containerRect.width + elWidth)) : (containerRect.width + elWidth); item.y = (item.y + elHeight > 0) ? (item.y % (containerRect.height + elHeight)) : (containerRect.height + elHeight); item.el.style.transform = `translate(${item.x - parseFloat(item.el.style.left || 0)}px, ${item.y - parseFloat(item.el.style.top || 0)}px)`; }); animationFrameId = requestAnimationFrame(animateFloatingElements); }
function stopFloatingAnimation() { if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; } }
function startFloatingAnimation() { if (!animationFrameId && !document.body.classList.contains('floating-disabled')) { animationFrameId = requestAnimationFrame(animateFloatingElements); } }

// --- UI Update Functions ---
function toggleGroup(headerElement) { const content = headerElement.nextElementSibling; const toggle = headerElement.querySelector('.group-toggle'); const isCollapsed = content.classList.toggle('collapsed'); if (isCollapsed) { content.style.maxHeight = '0'; content.style.paddingTop = '0'; content.style.paddingBottom = '0'; content.style.borderTopWidth = '0'; toggle.style.transform = 'rotate(-90deg)'; } else { content.style.maxHeight = content.scrollHeight + "px"; content.style.paddingTop = ''; content.style.paddingBottom = ''; content.style.borderTopWidth = ''; setTimeout(() => { if (!content.classList.contains('collapsed')) { content.style.maxHeight = 'none'; } }, 500); toggle.style.transform = 'rotate(0deg)'; } }
function updateEndpointStatusUI(endpointId, statusData) { const statusElement = document.getElementById(`status-${endpointId}`); const detailsElement = document.getElementById(`details-${endpointId}`); if (!statusElement || !detailsElement) { return; } statusElement.className = 'endpoint-status'; let statusText = 'PENDING'; let detailsText = ' '; if (statusData) { statusText = statusData.status || 'UNKNOWN'; statusElement.classList.add(`status-${statusText.toLowerCase()}`); if (statusData.details) { if (statusData.status === 'UP' && statusData.details.response_time_ms !== undefined) { detailsText = `${statusData.details.response_time_ms} ms`; } else if (statusData.details.details) { detailsText = statusData.details.details; } else if (statusData.status === 'DOWN' && statusData.details.status_code) { detailsText = `HTTP ${statusData.details.status_code}`; } else if (statusData.details.status_code) { detailsText = `HTTP ${statusData.details.status_code}`; } else if (statusData.status === 'PENDING' || statusData.status === 'UNKNOWN') { detailsText = 'Awaiting check...'; } } else if (statusData.status === 'PENDING' || statusData.status === 'UNKNOWN') { detailsText = 'Awaiting check...'; } } else { statusElement.classList.add('status-unknown'); statusText = 'UNKNOWN'; detailsText = 'No status data'; } statusElement.textContent = statusText; detailsElement.innerHTML = detailsText; }
function updateEndpointStatsUI(endpointId, statsData) { const statsElement = document.getElementById(`stats-${endpointId}`); if (!statsElement) { return; } if (statsData) { if (statsData.error) { statsElement.innerHTML = `<span class="stats-error" title="${statsData.error}">Stats Err</span>`; } else if (statsData.uptime_percentage_24h !== null && statsData.uptime_percentage_24h !== undefined) { statsElement.innerHTML = `24h: <span class="stats-value">${statsData.uptime_percentage_24h}%</span>`; } else { statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`; } } else { statsElement.innerHTML = `24h: <span class="stats-value">--%</span>`; } }
// Removed updateEndpointSettingsUI as columns were removed from HTML to fix layout
// function updateEndpointSettingsUI(endpointId, epData) { ... }

// --- Main Polling Function ---
async function fetchAndUpdateStatus() { const footerStatus = document.getElementById('footer-status'); let hasPending = false; try { const [statusResponse, statsResponse] = await Promise.allSettled([fetch(statusEndpoint), fetch(statsEndpoint)]); /* Status Processing */ if (statusResponse.status === 'fulfilled' && statusResponse.value.ok) { const statusResult = await statusResponse.value.json(); const statusData = statusResult.statuses; const lastUpdatedTimestamp = statusResult.last_updated; const displayedEndpointIds = new Set(); Object.keys(endpointData).forEach(id => displayedEndpointIds.add(id)); for (const endpointId in statusData) { if (displayedEndpointIds.has(endpointId)) { updateEndpointStatusUI(endpointId, statusData[endpointId]); if (statusData[endpointId]?.status === 'PENDING') { hasPending = true; } } } const timestamp = new Date(lastUpdatedTimestamp * 1000).toLocaleTimeString(); if (footerStatus) { footerStatus.textContent = hasPending ? `Status updated: ${timestamp} (Checks ongoing...)` : `Status updated: ${timestamp}`; } } else { console.error(`Error fetching status: ${statusResponse.reason || statusResponse.value?.status}`); if (footerStatus) footerStatus.textContent = `Status fetch failed!`; } /* Stats Processing */ if (statsResponse.status === 'fulfilled' && statsResponse.value.ok) { const statsResult = await statsResponse.value.json(); Object.keys(endpointData).forEach(endpointId => { updateEndpointStatsUI(endpointId, statsResult[endpointId]); }); } else { console.error(`Error fetching statistics: ${statsResponse.reason || statsResponse.value?.status}`); Object.keys(endpointData).forEach(endpointId => updateEndpointStatsUI(endpointId, { error: "Fetch failed" })); } } catch (error) { console.error("Network error during fetch polling:", error); if (footerStatus) footerStatus.textContent = `Update failed: Network Error`; } }

// --- History Modal Functions ---
async function fetchAndRenderHistory(endpointId, period) { console.log(`Fetching history for ${endpointId}, period: ${period}`); const modalErrorElement = document.getElementById('history-modal-error'); modalErrorElement.textContent = 'Loading history...'; try { const response = await fetch(`/history/${endpointId}?period=${period}`); if (!response.ok) { const errData = await response.json().catch(() => ({error: `HTTP error ${response.status}`})); throw new Error(errData.error || `HTTP error ${response.status}`); } const historyResult = await response.json(); if (historyResult.error) { throw new Error(historyResult.error); } const historyData = historyResult.data; modalErrorElement.textContent = ''; const labels = []; const responseTimes = []; historyData.forEach(point => { labels.push(new Date(point.timestamp)); if (point.status === 'UP' && point.response_time_ms !== null) { responseTimes.push(point.response_time_ms); } else { responseTimes.push(null); } }); const ctx = document.getElementById('history-chart').getContext('2d'); if (historyChart) { historyChart.destroy(); } historyChart = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [{ label: 'Response Time (ms)', data: responseTimes, borderColor: 'var(--cocoa-brown)', backgroundColor: 'var(--cocoa-brown)', borderWidth: 2, tension: 0.1, pointBackgroundColor: 'rgba(226, 113, 29, 0.7)', pointRadius: 3, pointHoverRadius: 5, spanGaps: false }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'time', time: { unit: inferTimeScaleUnit(period), tooltipFormat: 'Pp', displayFormats: { millisecond: 'HH:mm:ss.SSS', second: 'HH:mm:ss', minute: 'HH:mm', hour: 'HH:mm', day: 'MMM d', week: 'MMM d', month: 'MMM yyyy', quarter: 'QQQ yyyy', year: 'yyyy', } }, title: { display: true, text: 'Time', color: 'var(--isabelline)' }, ticks: { color: '#ccc' }, grid: { color: 'rgba(242, 233, 228, 0.1)' } }, y: { beginAtZero: true, title: { display: true, text: 'Response Time (ms)', color: 'var(--isabelline)' }, ticks: { color: '#ccc' }, grid: { color: 'rgba(242, 233, 228, 0.1)' } } }, plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false, } }, interaction: { mode: 'nearest', axis: 'x', intersect: false } } }); } catch (error) { console.error(`Error fetching/rendering history for ${endpointId}:`, error); modalErrorElement.textContent = `Error loading history: ${error.message}`; if (historyChart) { historyChart.destroy(); historyChart = null; } const ctx = document.getElementById('history-chart').getContext('2d'); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); } }
function inferTimeScaleUnit(period) { switch (period) { case '1h': return 'minute'; case '24h': return 'hour'; case '7d': return 'day'; default: return 'hour'; } }
function openHistoryModalMaybe(event, endpointId) { if (event.target.closest('.endpoint-actions button')) { return; } openHistoryModal(endpointId); }
function openHistoryModal(endpointId) { currentModalEndpointId = endpointId; const modal = document.getElementById('history-modal-overlay'); const title = document.getElementById('history-modal-title'); const epName = endpointData[endpointId]?.name || 'Unknown Endpoint'; title.textContent = `History: ${epName}`; document.querySelectorAll('.modal-controls button').forEach(btn => { btn.classList.remove('active'); if(btn.dataset.period === '24h') { btn.classList.add('active'); } }); currentHistoryPeriod = '24h'; modal.style.display = 'flex'; fetchAndRenderHistory(endpointId, currentHistoryPeriod); }
function closeHistoryModal() { const modal = document.getElementById('history-modal-overlay'); modal.style.display = 'none'; currentModalEndpointId = null; if (historyChart) { historyChart.destroy(); historyChart = null; } const modalErrorElement = document.getElementById('history-modal-error'); if(modalErrorElement) modalErrorElement.textContent = ''; }
function changeHistoryPeriod(buttonElement) { const newPeriod = buttonElement.dataset.period; if (newPeriod === currentHistoryPeriod || !currentModalEndpointId) { return; } currentHistoryPeriod = newPeriod; document.querySelectorAll('.modal-controls button').forEach(btn => btn.classList.remove('active')); buttonElement.classList.add('active'); fetchAndRenderHistory(currentModalEndpointId, currentHistoryPeriod); }

// --- Add/Edit/Delete Functions ---
function createEndpointRow(epData) {
    const template = document.getElementById('endpoint-row-template'); const clone = template.content.firstElementChild.cloneNode(true);
    clone.dataset.endpointId = epData.id; clone.id = `endpoint-item-${epData.id}`;
    clone.onclick = (event) => openHistoryModalMaybe(event, epData.id);
    clone.querySelector('.endpoint-name').textContent = epData.name;
    clone.querySelector('.endpoint-url').textContent = epData.url;
    clone.querySelector('.endpoint-status').id = `status-${epData.id}`;
    clone.querySelector('.endpoint-details').id = `details-${epData.id}`;
    clone.querySelector('.endpoint-stats').id = `stats-${epData.id}`;
    // Removed interval/timeout population as columns removed
    // clone.querySelector('.endpoint-interval').id = `interval-${epData.id}`;
    // clone.querySelector('.endpoint-timeout').id = `timeout-${epData.id}`;
    clone.querySelector('.endpoint-actions .edit-btn').onclick = (event) => openAddEditModal(event, epData.id);
    clone.querySelector('.endpoint-actions button[title="Delete Endpoint"]').onclick = (event) => confirmDeleteEndpoint(event, epData.id);
    // updateEndpointSettingsUI(epData.id, epData); // No longer needed here
    return clone;
}
function getOrCreateGroupList(groupName) { const displayGroupName = groupName || 'Default Group'; const safeGroupName = displayGroupName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase(); let listId = `endpoint-list-${safeGroupName}`; let listElement = document.getElementById(listId); if (!listElement) { console.log(`Creating new group container for: ${displayGroupName}`); const container = document.querySelector('.container'); const groupContainer = document.createElement('div'); groupContainer.className = 'group-container'; groupContainer.dataset.groupName = displayGroupName; const groupHeader = document.createElement('div'); groupHeader.className = 'group-header'; groupHeader.onclick = () => toggleGroup(groupHeader); groupHeader.innerHTML = `<span class="group-title">${displayGroupName}</span><span class="group-toggle">▼</span>`; groupContainer.appendChild(groupHeader); const groupContent = document.createElement('div'); groupContent.className = 'group-content'; listElement = document.createElement('ul'); listElement.className = 'endpoint-list'; listElement.id = listId; groupContent.appendChild(listElement); groupContainer.appendChild(groupContent); const addBtnContainer = document.querySelector('.add-edit-form-container'); container.insertBefore(groupContainer, addBtnContainer.nextSibling || document.querySelector('footer')); groupContent.style.maxHeight = groupContent.scrollHeight + "px"; setTimeout(() => { if (!groupContent.classList.contains('collapsed')) { groupContent.style.maxHeight = 'none'; } }, 500); } return listElement; }

const addEditModalOverlay = document.getElementById('add-edit-modal-overlay');
const addEditForm = document.getElementById('add-edit-endpoint-form');
const addEditErrorElement = document.getElementById('add-edit-endpoint-error');
const addEditModalTitle = document.getElementById('add-edit-modal-title');
const urlWarningElement = document.getElementById('url-dot-warning');

function setupUrlWarningListener(form) { const urlInputInForm = form.querySelector('#endpoint-url'); const warningSpan = form.querySelector('#url-dot-warning'); if (urlInputInForm && warningSpan) { urlInputInForm.oninput = null; urlInputInForm.oninput = () => { if (urlInputInForm.value && !urlInputInForm.value.includes('.')) { warningSpan.style.display = 'inline'; } else { warningSpan.style.display = 'none'; } }; } }

function openAddEditModal(event, endpointId = null) {
    if (event) event.stopPropagation();
    addEditForm.reset(); addEditErrorElement.textContent = ''; addEditErrorElement.style.display = 'none';
    const urlWarningSpan = addEditForm.querySelector('#url-dot-warning'); if (urlWarningSpan) urlWarningSpan.style.display = 'none';
    if (endpointId) { // Edit
        const data = endpointData[endpointId]; if (!data) { console.error("Edit error: Data not found"); return; }
        addEditModalTitle.textContent = "Edit Endpoint"; addEditForm.elements['id'].value = data.id;
        addEditForm.elements['name'].value = data.name || ''; addEditForm.elements['url'].value = data.url || '';
        addEditForm.elements['group'].value = data.group || '';
        addEditForm.elements['check_interval_seconds'].value = data.check_interval_seconds || '';
        addEditForm.elements['check_timeout_seconds'].value = data.check_timeout_seconds || '';
        addEditForm.elements['check_interval_seconds'].placeholder = appSettings?.check_interval_seconds || 30;
        addEditForm.elements['check_timeout_seconds'].placeholder = appSettings?.check_timeout_seconds || 10;
    } else { // Add
        addEditModalTitle.textContent = "Add New Endpoint"; addEditForm.elements['id'].value = '';
        addEditForm.elements['check_interval_seconds'].placeholder = appSettings?.check_interval_seconds || 30;
        addEditForm.elements['check_timeout_seconds'].placeholder = appSettings?.check_timeout_seconds || 10;
    }
    setupUrlWarningListener(addEditForm);
    addEditModalOverlay.style.display = 'flex';
}
function closeAddEditModal() { addEditModalOverlay.style.display = 'none'; }

addEditForm.addEventListener('submit', async (event) => {
    event.preventDefault(); addEditErrorElement.textContent = ''; addEditErrorElement.style.display = 'none'; urlWarningElement.style.display = 'none';
    const formData = new FormData(addEditForm); const endpointId = formData.get('id');
    let url = formData.get('url').trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.includes('://')) { url = 'https://' + url; }
    if (url && !url.includes('.')) { urlWarningElement.style.display = 'inline'; } // Show warning

    const endpointPayload = { name: formData.get('name').trim(), url: url, group: formData.get('group').trim() || 'Default Group', check_interval_seconds: formData.get('check_interval_seconds').trim(), check_timeout_seconds: formData.get('check_timeout_seconds').trim() };
    if (!endpointPayload.name || !endpointPayload.url) { addEditErrorElement.textContent = 'Name and URL required.'; addEditErrorElement.style.display = 'block'; return; }
    if (endpointPayload.check_interval_seconds === '') { delete endpointPayload.check_interval_seconds; } else { endpointPayload.check_interval_seconds = parseInt(endpointPayload.check_interval_seconds, 10); if(isNaN(endpointPayload.check_interval_seconds) || endpointPayload.check_interval_seconds < 5) { addEditErrorElement.textContent = 'Interval must be >= 5s.'; addEditErrorElement.style.display = 'block'; return; }}
    if (endpointPayload.check_timeout_seconds === '') { delete endpointPayload.check_timeout_seconds; } else { endpointPayload.check_timeout_seconds = parseInt(endpointPayload.check_timeout_seconds, 10); if(isNaN(endpointPayload.check_timeout_seconds) || endpointPayload.check_timeout_seconds < 1) { addEditErrorElement.textContent = 'Timeout must be >= 1s.'; addEditErrorElement.style.display = 'block'; return; }}
    const isEditing = !!endpointId; const apiUrl = isEditing ? `/endpoints/${endpointId}` : '/endpoints'; const apiMethod = isEditing ? 'PUT' : 'POST';

    try {
        const response = await fetch(apiUrl, { method: apiMethod, headers: { 'Content-Type': 'application/json', }, body: JSON.stringify(endpointPayload), });
        const result = await response.json(); if (!response.ok) { throw new Error(result.error || `HTTP error ${response.status}`); }
        console.log(`Endpoint ${isEditing ? 'updated' : 'added'}:`, result);
        const oldData = endpointData[result.id]; endpointData[result.id] = result;
        if (isEditing) {
             const rowElement = document.getElementById(`endpoint-item-${result.id}`);
             if (rowElement) {
                  rowElement.querySelector('.endpoint-name').textContent = result.name; rowElement.querySelector('.endpoint-url').textContent = result.url;
                  // updateEndpointSettingsUI(result.id, result); // Update interval/timeout display - Removed as columns removed
                  const currentGroupName = rowElement.closest('.group-container')?.dataset.groupName || 'Default Group';
                  if (currentGroupName !== result.group) { // Handle group change
                      const newList = getOrCreateGroupList(result.group); newList.appendChild(rowElement);
                      const oldList = document.getElementById(`endpoint-list-${currentGroupName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()}`);
                      if (oldList && oldList.children.length === 0) { const oldGroupContainer = oldList.closest('.group-container'); if (oldGroupContainer && oldGroupContainer.dataset.groupName !== 'Default Group') { oldGroupContainer.remove(); } }
                  }
             }
        } else { const listElement = getOrCreateGroupList(result.group); const newRow = createEndpointRow(result); const noEndpointsMsg = listElement.querySelector('#no-endpoints-message'); if (noEndpointsMsg) noEndpointsMsg.remove(); listElement.appendChild(newRow); }
        closeAddEditModal();
    } catch (error) { console.error(`Error ${isEditing ? 'updating' : 'adding'} endpoint:`, error); addEditErrorElement.textContent = `Failed: ${error.message}`; addEditErrorElement.style.display = 'block'; }
});

// --- Delete Confirmation Modal Logic ---
const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const confirmModalMessage = document.getElementById('confirm-modal-message');
const confirmYesBtn = document.getElementById('confirm-yes-btn');
const confirmNoBtn = document.getElementById('confirm-no-btn');
function confirmDeleteEndpoint(event, endpointId) { event.stopPropagation(); currentDeleteTargetId = endpointId; const epName = endpointData[endpointId]?.name || endpointId; confirmModalMessage.textContent = `Are you sure you want to permanently delete "${epName}"? History data remains in DB.`; confirmModalOverlay.style.display = 'flex'; }
function closeConfirmModal() { confirmModalOverlay.style.display = 'none'; currentDeleteTargetId = null; }
confirmNoBtn.onclick = closeConfirmModal;
confirmYesBtn.onclick = async () => { if (!currentDeleteTargetId) return; const endpointId = currentDeleteTargetId; closeConfirmModal(); try { const response = await fetch(`/endpoints/${endpointId}`, { method: 'DELETE', }); const result = await response.json(); if (!response.ok) { throw new Error(result.error || `HTTP error ${response.status}`); } console.log('Endpoint deleted:', endpointId); const rowElement = document.getElementById(`endpoint-item-${endpointId}`); if (rowElement) { rowElement.remove(); } delete endpointData[endpointId]; } catch (error) { console.error('Error deleting endpoint:', error); alert(`Failed to delete: ${error.message}`); } };

// --- Settings Toggle Logic ---
const toggleFloatingBtn = document.getElementById('toggle-floating');
async function toggleFloatingElements() {
     const isDisabled = document.body.classList.toggle('floating-disabled');
     console.log("Floating elements disabled:", isDisabled);
     if (isDisabled) { stopFloatingAnimation(); } else { if (floatingElements.length === 0) { for (let i = 0; i < numFloatingElements; i++) { floatingElements.push(createFloatingElement(i)); } } startFloatingAnimation(); }
     try {
          const response = await fetch('/config_api/settings', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ disable_floating_elements: isDisabled }) });
          if (!response.ok) { const result = await response.json(); throw new Error(result.error || `HTTP ${response.status}`); }
          console.log("Floating element setting saved."); appSettings.disable_floating_elements = isDisabled;
     } catch (error) {
          console.error("Error saving setting:", error); document.body.classList.toggle('floating-disabled', !isDisabled);
          if (!isDisabled) { startFloatingAnimation(); } else { stopFloatingAnimation(); }
          alert("Error saving setting: " + error.message);
     }
}
if (toggleFloatingBtn) toggleFloatingBtn.onclick = toggleFloatingElements;

// --- Config Reload Logic ---
async function reloadConfig() {
    const btn = document.getElementById('refresh-config-btn'); if(!btn || btn.disabled) return;
    const originalText = btn.textContent; btn.disabled = true; btn.textContent = 'Reloading...';
    try {
         const response = await fetch('/config/reload', { method: 'POST' });
         const result = await response.json();
         if (!response.ok) { throw new Error(result.error || `HTTP ${response.status}`); }
         alert('Config reloaded successfully! Refreshing page...'); window.location.reload();
    } catch (error) {
         console.error("Error reloading config:", error); alert(`Error reloading config: ${error.message}`);
         btn.disabled = false; btn.textContent = originalText;
    }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Uptimizer UI Initialized...");
    endpointData = typeof initialEndpointData !== 'undefined' ? initialEndpointData : {};
    appSettings = typeof initialAppSettings !== 'undefined' ? initialAppSettings : {};

    fetchAndUpdateStatus(); setInterval(fetchAndUpdateStatus, POLLING_INTERVAL_MS);
    // Initialize Groups / Modals...
    document.querySelectorAll('.group-content').forEach(content => { if (!content.classList.contains('collapsed')) { content.style.maxHeight = content.scrollHeight + "px"; setTimeout(() => { if (!content.classList.contains('collapsed')) { content.style.maxHeight = 'none'; } }, 500); } else { content.style.maxHeight = '0'; content.style.paddingTop = '0'; content.style.paddingBottom = '0'; content.style.borderTopWidth = '0'; const header = content.previousElementSibling; if(header) { const toggle = header.querySelector('.group-toggle'); if(toggle) toggle.style.transform = 'rotate(-90deg)'; } } });
    const addEditModalOverlayRef = document.getElementById('add-edit-modal-overlay'); addEditModalOverlayRef.addEventListener('click', (event) => { if (event.target === addEditModalOverlayRef) { closeAddEditModal(); } }); document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && addEditModalOverlayRef.style.display === 'flex') { closeAddEditModal(); } });
    const historyModalOverlay = document.getElementById('history-modal-overlay'); historyModalOverlay.addEventListener('click', (event) => { if (event.target === historyModalOverlay) { closeHistoryModal(); } }); document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && historyModalOverlay.style.display === 'flex') { closeHistoryModal(); } });
    const confirmModalOverlayRef = document.getElementById('confirm-modal-overlay'); confirmModalOverlayRef.addEventListener('click', (event) => { if (event.target === confirmModalOverlayRef) { closeConfirmModal(); } }); document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && confirmModalOverlayRef.style.display === 'flex') { closeConfirmModal(); } });
    // Floating Elements Init
    if (!document.body.classList.contains('floating-disabled')) { for (let i = 0; i < numFloatingElements; i++) { floatingElements.push(createFloatingElement(i)); } startFloatingAnimation(); } else { console.log("Floating elements disabled on load."); }
    // Removed initial call to updateEndpointSettingsUI as columns removed
    // Object.values(endpointData).forEach(ep => updateEndpointSettingsUI(ep.id, ep));
    // Add listener for Reload button
    const reloadBtn = document.getElementById('refresh-config-btn'); if (reloadBtn) reloadBtn.onclick = reloadConfig;
});