# File Name: views.py (NEW FILE)
# Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\views.py
from flask import Blueprint, render_template, jsonify, current_app
from copy import deepcopy

# Use absolute imports based on package structure
from app.state import current_state, state_lock, DEFAULT_CLIENT_ID
# Import settings defaults if needed, though likely handled by config manager on load
from app.state import DEFAULT_CLIENT_SETTINGS

# Create Blueprint for HTML views
views_bp = Blueprint('views', __name__, template_folder='templates')

# --- HTML Routes ---
@views_bp.route('/')
def index():
    """Renders the main dashboard page with client tabs."""
    with state_lock:
        # Deep copy necessary parts of state for rendering
        clients_data_copy = {}
        for client_id, client_info in current_state.get("clients", {}).items():
            # Ensure settings exist, using defaults as fallback
            client_settings = deepcopy(client_info.get("settings", DEFAULT_CLIENT_SETTINGS))
            client_settings['name'] = client_settings.get('name', f"Client {client_id}") # Ensure name exists

            # Create sorted list of endpoints for this client
            endpoints_copy = deepcopy(client_info.get("endpoints", []))
            sorted_endpoints = sorted(
                endpoints_copy,
                key=lambda x: (x.get('group', 'Default Group'), x.get('name', ''))
            )

            clients_data_copy[client_id] = {
                "settings": client_settings,
                "endpoints": sorted_endpoints
                # Note: Statuses are fetched dynamically by JS, not needed for initial render
            }

        global_settings_copy = deepcopy(current_state.get("global_settings", {}))

        # Create a flat map of all known endpoint configurations for JS lookup
        all_endpoint_data = {
            ep.get('id'): deepcopy(ep)
            for client_info in current_state.get("clients", {}).values()
            for ep in client_info.get("endpoints", []) if ep.get('id')
        }

    # Sort clients by name for tab order
    sorted_client_ids = sorted(clients_data_copy.keys(), key=lambda cid: clients_data_copy[cid]['settings'].get('name', cid))

    # Determine initial active client ID (ensure it exists)
    initial_active_client_id = DEFAULT_CLIENT_ID # Start with default
    if current_state['clients']: # If clients exist
        if DEFAULT_CLIENT_ID not in current_state['clients'] and sorted_client_ids:
             initial_active_client_id = sorted_client_ids[0] # Fallback to first sorted if default is missing
        # If default exists or is the only one, initial_active_client_id remains DEFAULT_CLIENT_ID
    else: # No clients configured
        initial_active_client_id = DEFAULT_CLIENT_ID # Should match the ID used if UI creates a default placeholder

    current_app.logger.debug(f"Rendering index.html with active client: {initial_active_client_id}")

    return render_template('index.html',
                           sorted_client_ids=sorted_client_ids,
                           clients_data=clients_data_copy,
                           all_endpoint_data=all_endpoint_data,
                           global_settings=global_settings_copy,
                           DEFAULT_CLIENT_ID=DEFAULT_CLIENT_ID,
                           initial_active_client_id=initial_active_client_id)
