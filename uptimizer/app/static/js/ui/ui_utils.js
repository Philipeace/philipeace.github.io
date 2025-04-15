// File Name: ui_utils.js (NEW FILE)
// Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\static\js\ui\ui_utils.js
// static/js/ui/ui_utils.js

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    // Basic check for objects that might accidentally be passed
    if (typeof str === 'object') {
        try { str = JSON.stringify(str); } catch (e) { str = String(str); }
    }
    return String(str).replace(/[&<>"']/g, function(match) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
    });
}

function escapeJS(str) {
     if (str === null || str === undefined) return '';
     // Basic check for objects
     if (typeof str === 'object') {
        try { str = JSON.stringify(str); } catch (e) { str = String(str); }
     }
     // Basic escaping for use in JS function calls within HTML attributes
     return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function groupEndpoints(endpoints) {
    if (!endpoints || !Array.isArray(endpoints)) return {};
    return endpoints.reduce((groups, endpoint) => {
        // Ensure endpoint is an object and has a group property
        if (typeof endpoint !== 'object' || endpoint === null) return groups;
        const groupName = endpoint.group || 'Default Group';
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(endpoint);
        return groups;
    }, {});
}

