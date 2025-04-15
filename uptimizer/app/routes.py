import uuid
import json
from flask import Blueprint, render_template, jsonify, request, current_app
from datetime import datetime, timedelta, timezone
from werkzeug.exceptions import NotFound, BadRequest, InternalServerError

# Use absolute imports based on package structure
from app.state import current_state, state_lock, CONFIG_PATH, DEFAULT_CLIENT_ID, DEFAULT_GLOBAL_SETTINGS, DEFAULT_CLIENT_SETTINGS
from app.config_manager import (load_config_from_file, process_config_data, save_config_to_file)
from app.auth import token_required, generate_client_api_token # Import auth functions
# Import DB functions and the models module itself
try:
    from app.database import get_stats_last_24h, get_history_for_period
    from app import models
except ImportError:
     class DummyModels: ENGINE_INITIALIZED = False; DB_TABLES_CREATED = False
     models = DummyModels()
     def get_stats_last_24h(*args): return {"error": "DB N/A", "uptime_percentage_24h": None}
     def get_history_for_period(*args): return {"error": "DB N/A", "data": []}

# Create a Blueprint
api_bp = Blueprint('api', __name__)

# --- Helper Function ---
def _get_client_or_404(client_id):
    """Helper to get client data or return 404 if not found."""
    with state_lock:
        # Use deepcopy to avoid modifying state directly if caller modifies result
        client_data = current_state.get("clients", {}).get(client_id)
        return deepcopy(client_data) if client_data else None

# --- HTML Routes ---
@api_bp.route('/')
def index():
    """Renders the main dashboard page with client tabs."""
    # Logic remains the same as v1.14.0
    with state_lock:
        clients_data_copy = {}
        for client_id, client_info in current_state.get("clients", {}).items():
            client_settings = client_info.get("settings", {}).copy()
            if not client_settings:
                 client_settings = DEFAULT_CLIENT_SETTINGS.copy()
                 client_settings['name'] = f"Client {client_id}"

            clients_data_copy[client_id] = {
                "settings": client_settings,
                "endpoints": sorted(
                    client_info.get("endpoints", []),
                     key=lambda x: (x.get('group', 'Default Group'), x.get('name', ''))
                )
            }
        global_settings_copy = current_state.get("global_settings", {}).copy()
        all_endpoint_data = {
            ep.get('id'): ep
            for client_info in current_state.get("clients", {}).values()
            for ep in client_info.get("endpoints", []) if ep.get('id')
        }

    sorted_client_ids = sorted(clients_data_copy.keys(), key=lambda cid: clients_data_copy[cid]['settings'].get('name', cid))
    initial_active_client_id = sorted_client_ids[0] if sorted_client_ids else DEFAULT_CLIENT_ID

    return render_template('index.html',
                           sorted_client_ids=sorted_client_ids,
                           clients_data=clients_data_copy,
                           all_endpoint_data=all_endpoint_data,
                           global_settings=global_settings_copy,
                           DEFAULT_CLIENT_ID=DEFAULT_CLIENT_ID,
                           initial_active_client_id=initial_active_client_id)

# --- API Routes ---

# GET /status - Overall Status (Unchanged)
@api_bp.route('/status')
def get_status():
    """API endpoint for latest status from in-memory cache (per client)."""
    with state_lock:
        response_data = {
            "statuses": {
                 client_id: client_data.get("statuses", {}).copy()
                 for client_id, client_data in current_state.get("clients", {}).items()
            },
            "last_updated": current_state.get("last_updated", 0)
        }
    return jsonify(response_data)

# --- Global Settings API (Unchanged for now) ---
@api_bp.route('/config_api/global_settings', methods=['GET'])
def get_global_settings():
    """API endpoint for current global settings."""
    with state_lock: settings_copy = current_state.get("global_settings", {}).copy()
    return jsonify({"global_settings": settings_copy})

# --- Client Management API ---

# GET /clients - List all clients
@api_bp.route('/clients', methods=['GET'])
def list_clients():
    """API endpoint to list all configured clients (ID, name, type)."""
    with state_lock:
        clients_list = [
            {
                "id": client_id,
                "name": client_data.get("settings", {}).get("name", client_id),
                "type": client_data.get("settings", {}).get("client_type", "local")
            }
            for client_id, client_data in current_state.get("clients", {}).items()
        ]
    # Sort by name for consistency
    clients_list.sort(key=lambda x: x.get('name', x['id']))
    return jsonify({"clients": clients_list})

# POST /clients - Create a new client (local or linked)
@api_bp.route('/clients', methods=['POST'])
def create_client():
    """API endpoint to create a new client."""
    if not request.is_json: raise BadRequest("Request must be JSON")
    data = request.get_json()

    client_name = data.get('name', '').strip()
    client_type = data.get('type', 'local').strip().lower() # 'local' or 'linked'
    remote_url = data.get('remote_url', '').strip()
    api_token = data.get('api_token', '').strip() # Token provided for linking

    if not client_name: raise BadRequest("Client name is required.")
    if client_type not in ['local', 'linked']: raise BadRequest("Invalid client type. Must be 'local' or 'linked'.")

    new_client_id = f"client_{uuid.uuid4().hex[:12]}"

    if client_type == 'linked':
        if not remote_url or not api_token:
            raise BadRequest("For 'linked' clients, 'remote_url' and 'api_token' are required.")
        # Basic URL validation (very simple)
        if not remote_url.startswith(('http://', 'https://')):
             raise BadRequest("Invalid remote_url format.")
        # Note: We don't validate the token here, just store it. Validation happens during fetch.

    with state_lock:
        if new_client_id in current_state["clients"]:
             # Extremely unlikely, but handle collision
             raise InternalServerError("Failed to generate unique client ID. Please try again.")

        new_client_settings = DEFAULT_CLIENT_SETTINGS.copy()
        new_client_settings.update({
            "name": client_name,
            "client_type": client_type,
            "remote_url": remote_url if client_type == 'linked' else None,
            "api_token": api_token if client_type == 'linked' else None, # Store token for linked type
            "api_enabled": False, # API exposure defaults to disabled
            "disable_floating_elements": False # Default floating elements
        })

        current_state["clients"][new_client_id] = {
            "settings": new_client_settings,
            "endpoints": [], # Endpoints are empty for linked, fetched from remote
            "statuses": {}
        }
        current_app.logger.info(f"API: Created new client '{client_name}' (ID: {new_client_id}, Type: {client_type}).")

        # Fetch global settings and updated client data for saving
        global_settings_now = current_state["global_settings"].copy()
        clients_data_now = current_state["clients"].copy()

    # Save updated config
    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
         # Return the details of the newly created client
         return jsonify({
             "id": new_client_id,
             "settings": new_client_settings # Return the settings we just created
         }), 201
    else: # Rollback in-memory addition if save fails
        with state_lock:
             current_state["clients"].pop(new_client_id, None)
             current_app.logger.error(f"API: Rolled back creation of client '{new_client_id}' due to save failure.")
        raise InternalServerError("Failed to save configuration after creating client.")


# DELETE /clients/<client_id> - Delete a client
@api_bp.route('/clients/<client_id>', methods=['DELETE'])
def delete_client(client_id):
    """API endpoint to delete a client."""
    if client_id == DEFAULT_CLIENT_ID:
         raise BadRequest("Cannot delete the default client.")

    original_client_data = None
    with state_lock:
        if client_id not in current_state["clients"]:
            raise NotFound("Client not found")
        original_client_data = deepcopy(current_state["clients"][client_id]) # For rollback
        del current_state["clients"][client_id]
        current_app.logger.info(f"API: Deleted client '{client_id}' from memory.")

        # Prepare data for saving
        global_settings_now = current_state["global_settings"].copy()
        clients_data_now = current_state["clients"].copy()

    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
        return jsonify({"message": f"Client '{client_id}' deleted successfully."}), 200
    else: # Rollback
        with state_lock:
             current_state["clients"][client_id] = original_client_data # Restore deleted client
             current_app.logger.error(f"API: Rolled back deletion of client '{client_id}' due to save failure.")
        raise InternalServerError("Failed to save configuration after deleting client.")


# --- Client Settings API ---

# GET /config_api/client_settings/<client_id> (Unchanged)
@api_bp.route('/config_api/client_settings/<client_id>', methods=['GET'])
def get_client_settings(client_id):
    """API endpoint to get specific client settings."""
    client_data = _get_client_or_404(client_id)
    if client_data is None: return jsonify({"error": "Client not found"}), 404
    settings_copy = client_data.get("settings", DEFAULT_CLIENT_SETTINGS).copy()
    settings_copy['name'] = settings_copy.get('name', f"Client {client_id}")
    # **Security:** Do not return raw api_token here, even for linked clients
    settings_copy.pop('api_token', None)
    return jsonify({"client_settings": settings_copy})

# PUT /config_api/client_settings/<client_id> - Update settings
@api_bp.route('/config_api/client_settings/<client_id>', methods=['PUT'])
def update_client_settings(client_id):
    """API endpoint to update specific client settings (name, floating, api_enabled)."""
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json()
    updated_settings_log = {}
    settings_changed = False

    with state_lock:
        if client_id not in current_state["clients"]:
            return jsonify({"error": "Client not found"}), 404

        # Ensure settings dict exists
        if "settings" not in current_state["clients"][client_id]:
            current_state["clients"][client_id]["settings"] = DEFAULT_CLIENT_SETTINGS.copy()
            current_state["clients"][client_id]["settings"]['name'] = f"Client {client_id}" # Ensure default name

        original_client_settings = current_state["clients"][client_id]["settings"].copy()
        current_settings_ref = current_state["clients"][client_id]["settings"]

        # Update name
        if 'name' in data and isinstance(data['name'], str):
            new_name = data['name'].strip()
            if new_name and current_settings_ref.get('name') != new_name:
                current_settings_ref['name'] = new_name
                updated_settings_log['name'] = new_name
                settings_changed = True

        # Update disable_floating_elements
        if 'disable_floating_elements' in data and isinstance(data['disable_floating_elements'], bool):
            if current_settings_ref.get('disable_floating_elements') != data['disable_floating_elements']:
                current_settings_ref['disable_floating_elements'] = data['disable_floating_elements']
                updated_settings_log['disable_floating_elements'] = data['disable_floating_elements']
                settings_changed = True

        # Update api_enabled (only for 'local' clients)
        if current_settings_ref.get('client_type', 'local') == 'local' and 'api_enabled' in data and isinstance(data['api_enabled'], bool):
             if current_settings_ref.get('api_enabled') != data['api_enabled']:
                current_settings_ref['api_enabled'] = data['api_enabled']
                updated_settings_log['api_enabled'] = data['api_enabled']
                settings_changed = True
                # If disabling API, consider invalidating/removing the token? For now, just disable access.
                # if not data['api_enabled']:
                #     current_settings_ref['api_token'] = None # Clear token when disabling? Let's not, requires regen.

        # Note: remote_url and api_token for 'linked' clients are set during creation

        # --- Regenerate API Token (if requested) ---
        # Added a specific field 'regenerate_token' to trigger this action
        if current_settings_ref.get('client_type', 'local') == 'local' and data.get('regenerate_token') is True:
             if not current_app.config.get('SECRET_KEY'):
                  # Prevent token generation if secret key is missing
                  current_app.logger.error(f"Cannot regenerate token for client '{client_id}': SECRET_KEY not set.")
                  # Don't save, return error immediately from within lock? Risky. Let save fail later.
             else:
                 new_token = generate_client_api_token(client_id)
                 # Only update if generated token is different or didn't exist
                 if current_settings_ref.get('api_token') != new_token:
                      current_settings_ref['api_token'] = new_token
                      updated_settings_log['api_token'] = 'REGENERATED' # Log regeneration, not the token
                      settings_changed = True
                 current_app.logger.info(f"API: Regenerated API token for client '{client_id}'.")


    if settings_changed:
        with state_lock: # Fetch current state for saving
            global_settings_now = current_state["global_settings"].copy()
            clients_data_now = current_state["clients"].copy()

        if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
            current_app.logger.info(f"API: Updated settings for client '{client_id}': {updated_settings_log}")
            with state_lock: # Get final state after potential regeneration
                final_settings = current_state["clients"][client_id]["settings"].copy()
            # **Security:** Do not return the raw token in the response.
            # The UI will need to fetch it separately via the dedicated GET endpoint if needed.
            final_settings.pop('api_token', None)
            return jsonify({"message": "Client settings updated", "client_settings": final_settings}), 200
        else:
            # Rollback in-memory changes if save fails
            with state_lock:
                current_state["clients"][client_id]["settings"] = original_client_settings
            current_app.logger.error(f"API Error: Failed save after updating settings for client '{client_id}'.");
            return jsonify({"error": "Failed to save config"}), 500
    else:
        return jsonify({"message": "No valid or changed client settings provided"}), 400

# GET /clients/<client_id>/api_token - Get the current API token (show only once?)
@api_bp.route('/clients/<client_id>/api_token', methods=['GET'])
def get_client_api_token(client_id):
    """
    API endpoint to retrieve the API token for a LOCAL client.
    SECURITY: This reveals the secret token. Access should be tightly controlled.
    Consider if this endpoint is truly needed or if regeneration is sufficient.
    For now, it returns the currently stored token.
    """
    client_data = _get_client_or_404(client_id)
    if client_data is None: raise NotFound("Client not found")

    settings = client_data.get("settings", {})
    if settings.get("client_type", "local") != "local":
         raise BadRequest("API tokens are only applicable to 'local' clients.")

    # Check if API is enabled for this client
    if not settings.get("api_enabled", False):
        return jsonify({"error": "API access is not enabled for this client."}), 403 # Forbidden

    current_token = settings.get("api_token")

    if not current_token:
         # Optionally generate token on first request if enabled but no token exists?
         # Or require explicit regeneration via PUT /config_api/client_settings/
         # Let's require explicit generation for clarity.
         return jsonify({"api_token": None, "message": "API token has not been generated yet. Regenerate it via settings."}), 200


    # **Security Decision:** Return the current token.
    # In a real-world scenario, you might only show it once upon generation/regeneration
    # or implement stricter access controls around this endpoint.
    current_app.logger.warning(f"API: Retrieving API token for client '{client_id}'. Ensure access is secured.")
    return jsonify({"api_token": current_token}), 200


# --- Client Data Exposure API ---

# GET /api/v1/client/<client_id>/status - Get status for a specific client (Authenticated)
@api_bp.route('/api/v1/client/<client_id>/status', methods=['GET'])
@token_required # Apply the authentication decorator
def get_exposed_client_status(client_id, **kwargs): # Decorator adds verified_client_id to kwargs
    """API endpoint for external access to a specific client's status data."""
    # Token validation (including matching client_id) is handled by @token_required

    with state_lock:
        client_data = current_state.get("clients", {}).get(client_id)

    if not client_data:
        # This shouldn't happen if token verification worked, but safety check
        raise NotFound("Client not found")

    settings = client_data.get("settings", {})

    # Double-check if API is enabled (although token wouldn't exist if not)
    if not settings.get("api_enabled", False):
         current_app.logger.warning(f"API access attempt for disabled client '{client_id}' passed token check unexpectedly.")
         return jsonify({"error": "API access not enabled for this client."}), 403 # Forbidden

    # Extract status data for this client
    with state_lock:
        statuses = client_data.get("statuses", {}).copy()
        last_updated = current_state.get("last_updated", 0) # Get global last update time

    current_app.logger.info(f"Authenticated API request successful for client '{client_id}' status.")
    return jsonify({
        "client_id": client_id,
        "client_name": settings.get("name", client_id),
        "statuses": statuses,
        "last_updated": last_updated
    })


# --- Endpoint Management API (Client-Specific - Unchanged from v1.14.0) ---

# GET /clients/<client_id>/endpoints
@api_bp.route('/clients/<client_id>/endpoints', methods=['GET'])
def get_client_endpoints(client_id):
    client_data = _get_client_or_404(client_id)
    if client_data is None: return jsonify({"error": "Client not found"}), 404
    if client_data.get("settings", {}).get("client_type", "local") != "local":
         return jsonify({"error": "Endpoints can only be listed for 'local' clients."}), 400
    endpoints_copy = list(client_data.get('endpoints', []))
    return jsonify({"endpoints": endpoints_copy})

# POST /clients/<client_id>/endpoints
@api_bp.route('/clients/<client_id>/endpoints', methods=['POST'])
def add_client_endpoint(client_id):
    # ... (Logic unchanged from v1.14.0, ensure checks client_type) ...
    with state_lock:
        client_data = current_state.get("clients", {}).get(client_id)
        if not client_data: return jsonify({"error": "Client not found"}), 404
        if client_data.get("settings", {}).get("client_type", "local") != "local":
            return jsonify({"error": "Endpoints can only be added to 'local' clients."}), 400
    # ... (rest of the add endpoint logic) ...
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(); name = data.get('name'); url = data.get('url'); group = data.get('group', 'Default Group');
    timeout_str = data.get('check_timeout_seconds'); interval_str = data.get('check_interval_seconds')
    if not name or not url: return jsonify({"error": "Missing name or url"}), 400
    timeout_val = None; interval_val = None
    if timeout_str is not None and timeout_str != '':
        try: timeout_val = int(timeout_str); assert timeout_val >= 1
        except: return jsonify({"error": "Invalid timeout"}), 400
    if interval_str is not None and interval_str != '':
        try: interval_val = int(interval_str); assert interval_val >= 5
        except: return jsonify({"error": "Invalid interval"}), 400

    new_id = f"ep_{uuid.uuid4().hex[:10]}"
    new_endpoint = {"id": new_id, "name": name, "url": url, "group": group or 'Default Group'}
    if timeout_val is not None: new_endpoint['check_timeout_seconds'] = timeout_val
    if interval_val is not None: new_endpoint['check_interval_seconds'] = interval_val

    with state_lock:
        # Re-check client exists inside lock
        if client_id not in current_state["clients"]: return jsonify({"error": "Client not found"}), 404
        if "endpoints" not in current_state["clients"][client_id]: current_state["clients"][client_id]["endpoints"] = []
        if "statuses" not in current_state["clients"][client_id]: current_state["clients"][client_id]["statuses"] = {}

        current_state["clients"][client_id]["endpoints"].append(new_endpoint)
        current_state["clients"][client_id]["statuses"][new_id] = {"status": "PENDING", "last_check_ts": 0, "details": None}
        current_app.logger.info(f"API: Added {new_id} to client '{client_id}' memory.")
        global_settings_now = current_state["global_settings"].copy()
        clients_data_now = current_state["clients"].copy()

    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
         return jsonify({"client_id": client_id, **new_endpoint}), 201
    else: # Rollback
        with state_lock:
             if client_id in current_state["clients"]:
                 current_state["clients"][client_id]["endpoints"] = [ep for ep in current_state["clients"][client_id]["endpoints"] if ep.get('id') != new_id]
                 current_state["clients"][client_id]["statuses"].pop(new_id, None)
                 current_app.logger.error(f"API: Rolled back add {new_id} from client '{client_id}'.")
        return jsonify({"error": "Failed to save config"}), 500


# PUT /clients/<client_id>/endpoints/<endpoint_id>
@api_bp.route('/clients/<client_id>/endpoints/<endpoint_id>', methods=['PUT'])
def update_client_endpoint(client_id, endpoint_id):
    # ... (Logic unchanged from v1.14.0, ensure checks client_type) ...
    with state_lock:
        client_data = current_state.get("clients", {}).get(client_id)
        if not client_data: return jsonify({"error": "Client not found"}), 404
        if client_data.get("settings", {}).get("client_type", "local") != "local":
            return jsonify({"error": "Endpoints can only be updated for 'local' clients."}), 400
    # ... (rest of the update endpoint logic) ...
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(); name = data.get('name'); url = data.get('url'); group = data.get('group');
    timeout_str = data.get('check_timeout_seconds'); interval_str = data.get('check_interval_seconds')
    if not name or not url: return jsonify({"error": "Missing name or url"}), 400
    timeout_val = None; interval_val = None
    if timeout_str is not None:
        if timeout_str == '': timeout_val = None
        else:
            try: timeout_val = int(timeout_str); assert timeout_val >= 1
            except: return jsonify({"error": "Invalid timeout"}), 400
    if interval_str is not None:
        if interval_str == '': interval_val = None
        else:
            try: interval_val = int(interval_str); assert interval_val >= 5
            except: return jsonify({"error": "Invalid interval"}), 400

    updated_endpoint_data = None; original_endpoint_data = None; endpoint_found = False; endpoint_index = -1
    with state_lock:
        # Re-check client exists inside lock
        if client_id not in current_state.get("clients", {}): return jsonify({"error": "Client not found"}), 404
        endpoints_list = current_state["clients"][client_id].get("endpoints", [])
        for i, ep in enumerate(endpoints_list):
            if ep.get('id') == endpoint_id:
                original_endpoint_data = ep.copy(); endpoint_index = i
                ep['name'] = name; ep['url'] = url; ep['group'] = group or 'Default Group'
                if timeout_str is not None:
                    if timeout_val is None: ep.pop('check_timeout_seconds', None)
                    else: ep['check_timeout_seconds'] = timeout_val
                if interval_str is not None:
                    if interval_val is None: ep.pop('check_interval_seconds', None)
                    else: ep['check_interval_seconds'] = interval_val
                updated_endpoint_data = ep.copy(); endpoint_found = True
                current_app.logger.info(f"API: Updated {endpoint_id} in client '{client_id}' memory.")
                break
        if not endpoint_found: return jsonify({"error": "Endpoint not found"}), 404

        global_settings_now = current_state["global_settings"].copy()
        clients_data_now = current_state["clients"].copy()

    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
         return jsonify({"client_id": client_id, **updated_endpoint_data}), 200
    else: # Rollback
        with state_lock:
             if client_id in current_state["clients"] and endpoint_index != -1 and original_endpoint_data:
                  if "endpoints" in current_state["clients"][client_id] and len(current_state["clients"][client_id]["endpoints"]) > endpoint_index:
                       current_state["clients"][client_id]["endpoints"][endpoint_index] = original_endpoint_data
                       current_app.logger.error(f"API: Rolled back update {endpoint_id} in client '{client_id}'.")
                  else:
                       current_app.logger.warning(f"API Warn: Could not rollback update for {endpoint_id}, list index out of bounds or missing.")
        return jsonify({"error": "Failed save after update."}), 500


# DELETE /clients/<client_id>/endpoints/<endpoint_id>
@api_bp.route('/clients/<client_id>/endpoints/<endpoint_id>', methods=['DELETE'])
def delete_client_endpoint(client_id, endpoint_id):
    # ... (Logic unchanged from v1.14.0, ensure checks client_type) ...
    with state_lock:
        client_data = current_state.get("clients", {}).get(client_id)
        if not client_data: return jsonify({"error": "Client not found"}), 404
        if client_data.get("settings", {}).get("client_type", "local") != "local":
            return jsonify({"error": "Endpoints can only be deleted from 'local' clients."}), 400
    # ... (rest of the delete endpoint logic) ...
    endpoint_to_delete = None; endpoint_index = -1
    with state_lock:
        # Re-check client exists inside lock
        if client_id not in current_state.get("clients", {}): return jsonify({"error": "Client not found"}), 404
        endpoints_list = current_state["clients"][client_id].get("endpoints", [])
        for i, ep in enumerate(endpoints_list):
             if ep.get('id') == endpoint_id:
                 endpoint_to_delete = ep.copy(); endpoint_index = i; break

        if endpoint_index != -1:
            del current_state["clients"][client_id]["endpoints"][endpoint_index]
            if "statuses" in current_state["clients"][client_id]:
                 current_state["clients"][client_id]["statuses"].pop(endpoint_id, None)
            current_app.logger.info(f"API: Deleted {endpoint_id} from client '{client_id}' memory.")
        else: return jsonify({"error": "Endpoint not found"}), 404

        global_settings_now = current_state["global_settings"].copy()
        clients_data_now = current_state["clients"].copy()

    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
        return jsonify({"message": f"Endpoint {endpoint_id} deleted from client {client_id}"}), 200
    else: # Rollback
        with state_lock:
             if client_id in current_state["clients"] and endpoint_index != -1 and endpoint_to_delete:
                 if "endpoints" not in current_state["clients"][client_id]: current_state["clients"][client_id]["endpoints"] = []
                 current_state["clients"][client_id]["endpoints"].insert(endpoint_index, endpoint_to_delete)
                 current_app.logger.error(f"API: Rolled back delete {endpoint_id} from client '{client_id}'.")
        return jsonify({"error": "Failed save after delete."}), 500


# --- Stats & History (Remain Endpoint-Centric - Unchanged) ---
@api_bp.route('/statistics')
def get_statistics():
    # ... (Logic unchanged from v1.14.0) ...
    stats_results = {}
    with state_lock:
        endpoint_ids = [ep.get('id') for client_data in current_state.get("clients", {}).values() for ep in client_data.get("endpoints", []) if ep.get('id')]
    if not endpoint_ids: return jsonify({})
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
        current_app.logger.warning(f"API WARN: /statistics returning DB N/A. Engine Init: {models.ENGINE_INITIALIZED}, Tables Created: {models.DB_TABLES_CREATED}")
        return jsonify({eid: {"error": "DB N/A", "uptime_percentage_24h": None} for eid in endpoint_ids})
    for ep_id in endpoint_ids:
        try: stats = get_stats_last_24h(ep_id)
        except Exception as calc_err: current_app.logger.error(f"E: Stats calc {ep_id}: {calc_err}"); stats = {"error": "Calc error"}
        stats_results[ep_id] = stats
    return jsonify(stats_results)

@api_bp.route('/history/<endpoint_id>')
def get_endpoint_history(endpoint_id):
    # ... (Logic unchanged from v1.14.0) ...
    period = request.args.get('period', '24h'); end_time = datetime.now(timezone.utc)
    if period == '1h': start_time = end_time - timedelta(hours=1)
    elif period == '7d': start_time = end_time - timedelta(days=7)
    else: start_time = end_time - timedelta(hours=24); period = '24h'
    endpoint_exists = False
    with state_lock:
        for client_data in current_state.get("clients", {}).values():
            if any(ep.get('id') == endpoint_id for ep in client_data.get("endpoints", [])):
                endpoint_exists = True; break
    if not endpoint_exists: return jsonify({"error": "Unknown endpoint ID", "data": []}), 404
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
         current_app.logger.warning(f"API WARN: /history/{endpoint_id} returning DB N/A. Engine Init: {models.ENGINE_INITIALIZED}, Tables Created: {models.DB_TABLES_CREATED}")
         return jsonify({"error": "DB N/A", "data": []}), 503
    try: history_data = get_history_for_period(endpoint_id, start_time, end_time)
    except Exception as hist_err: current_app.logger.error(f"E: History fetch {endpoint_id}: {hist_err}"); return jsonify({"error": "History fetch error", "data": []}), 500
    if history_data.get("error"):
         status_code = 503 if "DB N/A" in history_data["error"] else 500
         return jsonify(history_data), status_code
    return jsonify(history_data)


# --- Config Reload (Unchanged from v1.14.0) ---
@api_bp.route('/config/reload', methods=['POST'])
def reload_config_from_file_route():
    # ... (Logic unchanged from v1.14.0) ...
    current_app.logger.info("API: Received request to reload config from file...")
    try:
        config_data = load_config_from_file(CONFIG_PATH)
        global_settings, clients_data = process_config_data(config_data)
        with state_lock:
            current_state["global_settings"] = global_settings
            current_state["clients"] = {}
            for client_id, client_info in clients_data.items():
                 current_state["clients"][client_id] = {
                     "settings": client_info.get("settings", DEFAULT_CLIENT_SETTINGS.copy()),
                     "endpoints": client_info.get("endpoints", []),
                     "statuses": {} # Initialize empty
                 }
                 if client_info.get("settings", {}).get("client_type", "local") == "local":
                      current_state["clients"][client_id]["statuses"] = {
                          ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None}
                          for ep in client_info.get("endpoints", []) if ep.get('id')
                      }
                 if 'name' not in current_state["clients"][client_id]["settings"]:
                      current_state["clients"][client_id]["settings"]['name'] = f"Client {client_id}"

            if DEFAULT_CLIENT_ID not in current_state["clients"]:
                current_state["clients"][DEFAULT_CLIENT_ID] = {"settings": DEFAULT_CLIENT_SETTINGS.copy(), "endpoints": [], "statuses": {}}

            current_state["scheduler_interval"] = global_settings.get("check_interval_seconds", DEFAULT_GLOBAL_SETTINGS['check_interval_seconds'])
            current_state["last_updated"] = 0

        current_app.logger.info("API: Config reloaded successfully from file.")
        from app.checker import run_checks_task
        try:
             current_app.logger.info("API: Triggering check cycle after config reload...")
             run_checks_task(current_state, state_lock)
             current_app.logger.info("API: Post-reload check cycle triggered.")
        except Exception as check_err:
             current_app.logger.warning(f"API WARN: Error triggering check cycle after reload: {check_err}")

        with state_lock:
            reloaded_clients = current_state["clients"].copy()
            reloaded_globals = current_state["global_settings"].copy()
            all_ep_data = {ep.get('id'): ep for cid in reloaded_clients for ep in reloaded_clients[cid].get("endpoints", []) if ep.get('id')}
            sorted_cids = sorted(reloaded_clients.keys(), key=lambda cid: reloaded_clients[cid]['settings'].get('name', cid))
            initial_active_cid = sorted_cids[0] if sorted_cids else DEFAULT_CLIENT_ID

        return jsonify({
            "message": "Configuration reloaded. UI should update.",
            "reloaded_data": {
                 "clients_data": reloaded_clients,
                 "global_settings": reloaded_globals,
                 "all_endpoint_data": all_ep_data,
                 "sorted_client_ids": sorted_cids,
                 "initial_active_client_id": initial_active_cid
            }
        }), 200
    except Exception as e:
         current_app.logger.error(f"API Error: Unexpected error during config reload: {e}", exc_info=True)
         return jsonify({"error": "An unexpected error occurred during reload."}), 500