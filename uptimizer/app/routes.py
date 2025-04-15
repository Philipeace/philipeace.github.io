import uuid
import json
from flask import Blueprint, render_template, jsonify, request
from datetime import datetime, timedelta, timezone

# Use absolute imports based on package structure
from app.state import current_state, state_lock, CONFIG_PATH, DEFAULT_CLIENT_ID, DEFAULT_GLOBAL_SETTINGS, DEFAULT_CLIENT_SETTINGS # <<<--- IMPORTED DEFAULT_CLIENT_SETTINGS
from app.config_manager import (load_config_from_file, process_config_data,
                                save_config_to_file)
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
        client_data = current_state.get("clients", {}).get(client_id)
    if not client_data:
        return None
    return client_data

# --- HTML Routes ---
@api_bp.route('/')
def index():
    """Renders the main dashboard page with client tabs."""
    with state_lock:
        # Pass clients data and global settings to template
        clients_data_copy = {}
        for client_id, client_info in current_state.get("clients", {}).items():
            # Ensure settings exist, default if necessary
            client_settings = client_info.get("settings", {}).copy()
            if not client_settings: # If settings dict is missing entirely
                 client_settings = DEFAULT_CLIENT_SETTINGS.copy()
                 client_settings['name'] = f"Client {client_id}" # Default name if settings were missing

            clients_data_copy[client_id] = {
                "settings": client_settings,
                "endpoints": sorted(
                    client_info.get("endpoints", []),
                     key=lambda x: (x.get('group', 'Default Group'), x.get('name', ''))
                )
                # Statuses are fetched via API, no need to pass here
            }

        global_settings_copy = current_state.get("global_settings", {}).copy()
        # Combine all endpoint data for easy JS access if needed (though JS primarily uses API)
        all_endpoint_data = {}
        for client_info in current_state.get("clients", {}).values():
             for ep in client_info.get("endpoints", []):
                 all_endpoint_data[ep['id']] = ep

    # Sort clients by name for display
    sorted_client_ids = sorted(clients_data_copy.keys(), key=lambda cid: clients_data_copy[cid]['settings'].get('name', cid))

    # Determine the initial active client (e.g., the first sorted one or default)
    initial_active_client_id = sorted_client_ids[0] if sorted_client_ids else DEFAULT_CLIENT_ID

    return render_template('index.html',
                           sorted_client_ids=sorted_client_ids, # Pass sorted IDs
                           clients_data=clients_data_copy, # Pass structured client data
                           all_endpoint_data=all_endpoint_data, # Pass flat endpoint map
                           global_settings=global_settings_copy, # Pass global settings
                           DEFAULT_CLIENT_ID=DEFAULT_CLIENT_ID,
                           initial_active_client_id=initial_active_client_id) # Pass initial active client

# --- API Routes ---
@api_bp.route('/status')
def get_status():
    """API endpoint for latest status from in-memory cache (per client)."""
    with state_lock:
        response_data = {
            "statuses": { # Restructure to { client_id: { endpoint_id: {...} } }
                 client_id: client_data.get("statuses", {}).copy()
                 for client_id, client_data in current_state.get("clients", {}).items()
            },
            "last_updated": current_state.get("last_updated", 0)
        }
    return jsonify(response_data)

@api_bp.route('/config_api/global_settings', methods=['GET'])
def get_global_settings():
    """API endpoint for current global settings."""
    with state_lock: settings_copy = current_state.get("global_settings", {}).copy()
    return jsonify({"global_settings": settings_copy})

# --- TODO: Add PUT endpoint for global_settings ---
# This would need validation and potentially scheduler update logic

@api_bp.route('/config_api/client_settings/<client_id>', methods=['GET'])
def get_client_settings(client_id):
    """API endpoint to get specific client settings."""
    client_data = _get_client_or_404(client_id)
    if client_data is None: return jsonify({"error": "Client not found"}), 404
    # Return a copy of the settings, defaulting if necessary
    settings_copy = client_data.get("settings", DEFAULT_CLIENT_SETTINGS).copy()
    # Ensure name is present, defaulting based on ID if needed
    settings_copy['name'] = settings_copy.get('name', f"Client {client_id}")
    return jsonify({"client_settings": settings_copy})


@api_bp.route('/config_api/client_settings/<client_id>', methods=['PUT'])
def update_client_settings(client_id):
    """API endpoint to update specific client settings."""
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(); updated_settings_log = {}; settings_changed = False

    with state_lock:
        if client_id not in current_state["clients"]:
            return jsonify({"error": "Client not found"}), 404

        # Ensure settings dict exists
        if "settings" not in current_state["clients"][client_id]:
            current_state["clients"][client_id]["settings"] = DEFAULT_CLIENT_SETTINGS.copy()
            current_state["clients"][client_id]["settings"]['name'] = f"Client {client_id}" # Ensure default name

        original_client_settings = current_state["clients"][client_id]["settings"].copy()
        current_settings_ref = current_state["clients"][client_id]["settings"]

        # Update disable_floating_elements
        if 'disable_floating_elements' in data and isinstance(data['disable_floating_elements'], bool):
            if current_settings_ref.get('disable_floating_elements') != data['disable_floating_elements']:
                current_settings_ref['disable_floating_elements'] = data['disable_floating_elements']
                updated_settings_log['disable_floating_elements'] = data['disable_floating_elements']
                settings_changed = True

        # Update name
        if 'name' in data and isinstance(data['name'], str) and data['name'].strip():
            new_name = data['name'].strip()
            if current_settings_ref.get('name') != new_name:
                current_settings_ref['name'] = new_name
                updated_settings_log['name'] = new_name
                settings_changed = True

        # Add other client settings updates here...

    if settings_changed:
        # Need to fetch all clients data to save config
        with state_lock:
            global_settings_now = current_state["global_settings"].copy()
            clients_data_now = current_state["clients"].copy() # Includes endpoints/statuses

        if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
            print(f"API: Updated settings for client '{client_id}': {updated_settings_log}")
            # Return the updated settings for the specific client
            with state_lock: # Re-acquire lock to get potentially updated state
                 final_settings = current_state["clients"][client_id]["settings"].copy()
            return jsonify({"message": "Client settings updated", "client_settings": final_settings}), 200
        else:
            # Rollback in-memory change if save fails
            with state_lock:
                current_state["clients"][client_id]["settings"] = original_client_settings
            print(f"API Error: Failed save after updating settings for client '{client_id}'.");
            return jsonify({"error": "Failed to save config"}), 500
    else: return jsonify({"message": "No valid or changed client settings provided"}), 400


@api_bp.route('/config/reload', methods=['POST'])
def reload_config_from_file_route():
    """API endpoint to reload the entire config from config.json."""
    print("API: Received request to reload config from file...")
    try:
        config_data = load_config_from_file(CONFIG_PATH)
        global_settings, clients_data = process_config_data(config_data)

        with state_lock:
            # --- Update state with new structure ---
            current_state["global_settings"] = global_settings
            # Clear and repopulate clients, ensuring statuses dict exists
            current_state["clients"] = {}
            for client_id, client_info in clients_data.items():
                 current_state["clients"][client_id] = {
                     "settings": client_info.get("settings", DEFAULT_CLIENT_SETTINGS.copy()), # Ensure settings dict exists
                     "endpoints": client_info.get("endpoints", []),
                     "statuses": {ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None}
                                  for ep in client_info.get("endpoints", []) if ep.get('id')}
                 }
                 # Ensure default name if missing from loaded settings
                 if 'name' not in current_state["clients"][client_id]["settings"]:
                      current_state["clients"][client_id]["settings"]['name'] = f"Client {client_id}"


            # If default client is missing after load, add it back
            if DEFAULT_CLIENT_ID not in current_state["clients"]:
                current_state["clients"][DEFAULT_CLIENT_ID] = {
                    "settings": DEFAULT_CLIENT_SETTINGS.copy(),
                    "endpoints": [],
                    "statuses": {}
                }

            current_state["scheduler_interval"] = global_settings.get("check_interval_seconds", DEFAULT_GLOBAL_SETTINGS['check_interval_seconds'])
            current_state["last_updated"] = 0
            # --- End state update ---

        print("API: Config reloaded successfully from file.")
        # Rerun checks immediately after reload
        from app.checker import run_checks_task
        try:
             print("API: Triggering check cycle after config reload...")
             run_checks_task(current_state, state_lock)
             print("API: Post-reload check cycle triggered.")
        except Exception as check_err:
             print(f"API WARN: Error triggering check cycle after reload: {check_err}")
        # Return the updated state structure needed by the frontend
        with state_lock:
            reloaded_clients = current_state["clients"].copy()
            reloaded_globals = current_state["global_settings"].copy()
            all_ep_data = {ep.get('id'): ep for cid in reloaded_clients for ep in reloaded_clients[cid].get("endpoints", []) if ep.get('id')}
            sorted_cids = sorted(reloaded_clients.keys(), key=lambda cid: reloaded_clients[cid]['settings'].get('name', cid))
            initial_active_cid = sorted_cids[0] if sorted_cids else DEFAULT_CLIENT_ID

        return jsonify({
            "message": "Configuration reloaded. UI should update.",
            "reloaded_data": { # Send back data needed to reconstruct UI
                 "clients_data": reloaded_clients,
                 "global_settings": reloaded_globals,
                 "all_endpoint_data": all_ep_data,
                 "sorted_client_ids": sorted_cids,
                 "initial_active_client_id": initial_active_cid
            }
        }), 200
    except Exception as e:
         print(f"API Error: Unexpected error during config reload: {e}")
         # Provide more context in the error log
         import traceback
         traceback.print_exc()
         return jsonify({"error": "An unexpected error occurred during reload."}), 500


# --- Endpoint Management (Now Client-Specific) ---

# GET /clients/<client_id>/endpoints - Get endpoints for a specific client
@api_bp.route('/clients/<client_id>/endpoints', methods=['GET'])
def get_client_endpoints(client_id):
    """API endpoint to get the current list of configured endpoints for a specific client."""
    client_data = _get_client_or_404(client_id)
    if client_data is None: return jsonify({"error": "Client not found"}), 404
    endpoints_copy = list(client_data.get('endpoints', []))
    return jsonify({"endpoints": endpoints_copy})

# POST /clients/<client_id>/endpoints - Add endpoint to a specific client
@api_bp.route('/clients/<client_id>/endpoints', methods=['POST'])
def add_client_endpoint(client_id):
    """API endpoint to add a new endpoint configuration to a specific client."""
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
        if client_id not in current_state["clients"]:
            return jsonify({"error": "Client not found"}), 404
        # Ensure lists exist
        if "endpoints" not in current_state["clients"][client_id]: current_state["clients"][client_id]["endpoints"] = []
        if "statuses" not in current_state["clients"][client_id]: current_state["clients"][client_id]["statuses"] = {}

        current_state["clients"][client_id]["endpoints"].append(new_endpoint)
        current_state["clients"][client_id]["statuses"][new_id] = {"status": "PENDING", "last_check_ts": 0, "details": None}
        print(f"API: Added {new_id} to client '{client_id}' memory.")
        # Fetch data needed for saving
        global_settings_now = current_state["global_settings"].copy()
        clients_data_now = current_state["clients"].copy()

    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
         # Return the endpoint data and the client_id it was added to
         return jsonify({"client_id": client_id, **new_endpoint}), 201
    else: # Rollback
        with state_lock:
             if client_id in current_state["clients"]:
                 current_state["clients"][client_id]["endpoints"] = [ep for ep in current_state["clients"][client_id]["endpoints"] if ep.get('id') != new_id]
                 current_state["clients"][client_id]["statuses"].pop(new_id, None)
                 print(f"API: Rolled back add {new_id} from client '{client_id}'.")
        return jsonify({"error": "Failed to save config"}), 500

# PUT /clients/<client_id>/endpoints/<endpoint_id> - Update endpoint in a specific client
@api_bp.route('/clients/<client_id>/endpoints/<endpoint_id>', methods=['PUT'])
def update_client_endpoint(client_id, endpoint_id):
    """API endpoint to update an existing endpoint configuration within a specific client."""
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(); name = data.get('name'); url = data.get('url'); group = data.get('group');
    timeout_str = data.get('check_timeout_seconds'); interval_str = data.get('check_interval_seconds')
    if not name or not url: return jsonify({"error": "Missing name or url"}), 400
    timeout_val = None; interval_val = None
    # --- Validation ---
    if timeout_str is not None:
        if timeout_str == '': timeout_val = None # Clear override
        else:
            try: timeout_val = int(timeout_str); assert timeout_val >= 1
            except: return jsonify({"error": "Invalid timeout"}), 400
    if interval_str is not None:
        if interval_str == '': interval_val = None # Clear override
        else:
            try: interval_val = int(interval_str); assert interval_val >= 5
            except: return jsonify({"error": "Invalid interval"}), 400
    # --- End Validation ---

    updated_endpoint_data = None; original_endpoint_data = None; endpoint_found = False; endpoint_index = -1

    with state_lock:
        if client_id not in current_state.get("clients", {}):
             return jsonify({"error": "Client not found"}), 404

        endpoints_list = current_state["clients"][client_id].get("endpoints", [])
        for i, ep in enumerate(endpoints_list):
            if ep.get('id') == endpoint_id:
                original_endpoint_data = ep.copy(); endpoint_index = i
                ep['name'] = name; ep['url'] = url; ep['group'] = group or 'Default Group'
                # Handle overrides
                if timeout_str is not None: # If timeout was passed in request
                    if timeout_val is None: ep.pop('check_timeout_seconds', None) # Remove override
                    else: ep['check_timeout_seconds'] = timeout_val # Set override
                if interval_str is not None: # If interval was passed in request
                    if interval_val is None: ep.pop('check_interval_seconds', None) # Remove override
                    else: ep['check_interval_seconds'] = interval_val # Set override
                updated_endpoint_data = ep.copy(); endpoint_found = True
                print(f"API: Updated {endpoint_id} in client '{client_id}' memory.")
                break
        if not endpoint_found: return jsonify({"error": "Endpoint not found"}), 404

        # Fetch data needed for saving
        global_settings_now = current_state["global_settings"].copy()
        clients_data_now = current_state["clients"].copy()

    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
         # Return the updated endpoint data and the client_id
         return jsonify({"client_id": client_id, **updated_endpoint_data}), 200
    else: # Rollback
        with state_lock:
             if client_id in current_state["clients"] and endpoint_index != -1 and original_endpoint_data:
                  if "endpoints" in current_state["clients"][client_id] and len(current_state["clients"][client_id]["endpoints"]) > endpoint_index:
                       current_state["clients"][client_id]["endpoints"][endpoint_index] = original_endpoint_data
                       print(f"API: Rolled back update {endpoint_id} in client '{client_id}'.")
                  else:
                       print(f"API Warn: Could not rollback update for {endpoint_id}, list index out of bounds or missing.")
        print(f"API Error: Failed save after updating {endpoint_id}.")
        return jsonify({"error": "Failed save after update."}), 500

# DELETE /clients/<client_id>/endpoints/<endpoint_id> - Delete endpoint from a specific client
@api_bp.route('/clients/<client_id>/endpoints/<endpoint_id>', methods=['DELETE'])
def delete_client_endpoint(client_id, endpoint_id):
    """API endpoint to delete an endpoint configuration from a specific client."""
    endpoint_to_delete = None; endpoint_index = -1

    with state_lock:
        if client_id not in current_state.get("clients", {}):
             return jsonify({"error": "Client not found"}), 404

        endpoints_list = current_state["clients"][client_id].get("endpoints", [])
        for i, ep in enumerate(endpoints_list):
             if ep.get('id') == endpoint_id:
                 endpoint_to_delete = ep.copy(); endpoint_index = i; break

        if endpoint_index != -1:
            del current_state["clients"][client_id]["endpoints"][endpoint_index]
            if "statuses" in current_state["clients"][client_id]:
                 current_state["clients"][client_id]["statuses"].pop(endpoint_id, None)
            print(f"API: Deleted {endpoint_id} from client '{client_id}' memory.")
        else: return jsonify({"error": "Endpoint not found"}), 404

        # Fetch data needed for saving
        global_settings_now = current_state["global_settings"].copy()
        clients_data_now = current_state["clients"].copy()

    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
        return jsonify({"message": f"Endpoint {endpoint_id} deleted from client {client_id}"}), 200
    else: # Rollback
        with state_lock:
             if client_id in current_state["clients"] and endpoint_index != -1 and endpoint_to_delete:
                 # Ensure endpoints list exists before inserting
                 if "endpoints" not in current_state["clients"][client_id]:
                      current_state["clients"][client_id]["endpoints"] = []
                 current_state["clients"][client_id]["endpoints"].insert(endpoint_index, endpoint_to_delete)
                 # Re-add status if needed? Generally fine to leave deleted
                 print(f"API: Rolled back delete {endpoint_id} from client '{client_id}'.")
        print(f"API Error: Failed save after deleting {endpoint_id}.")
        return jsonify({"error": "Failed save after delete."}), 500


# --- Stats & History (Remain Endpoint-Centric) ---

@api_bp.route('/statistics')
def get_statistics():
    """API endpoint to calculate and return statistics (per endpoint, across all clients)."""
    stats_results = {}
    with state_lock:
        # Collect all endpoint IDs across all clients
        endpoint_ids = [ep.get('id')
                        for client_data in current_state.get("clients", {}).values()
                        for ep in client_data.get("endpoints", []) if ep.get('id')]

    if not endpoint_ids: return jsonify({}) # Return empty dict if no endpoints

    # Check DB readiness directly using models module
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
        print(f"API WARN: /statistics returning DB N/A. Engine Init: {models.ENGINE_INITIALIZED}, Tables Created: {models.DB_TABLES_CREATED}")
        return jsonify({eid: {"error": "DB N/A", "uptime_percentage_24h": None} for eid in endpoint_ids})

    for ep_id in endpoint_ids:
        try: stats = get_stats_last_24h(ep_id)
        except Exception as calc_err: print(f"E: Stats calc {ep_id}: {calc_err}"); stats = {"error": "Calc error"}
        stats_results[ep_id] = stats # Store flat map {endpoint_id: stats}
    return jsonify(stats_results)


@api_bp.route('/history/<endpoint_id>')
def get_endpoint_history(endpoint_id):
    """API endpoint to fetch historical data for a specific endpoint."""
    period = request.args.get('period', '24h'); end_time = datetime.now(timezone.utc)
    if period == '1h': start_time = end_time - timedelta(hours=1)
    elif period == '7d': start_time = end_time - timedelta(days=7)
    else: start_time = end_time - timedelta(hours=24); period = '24h' # Default to 24h

    # Check if endpoint exists across any client (needed for 404 check)
    endpoint_exists = False
    with state_lock:
        for client_data in current_state.get("clients", {}).values():
            if any(ep.get('id') == endpoint_id for ep in client_data.get("endpoints", [])):
                endpoint_exists = True
                break
    if not endpoint_exists: return jsonify({"error": "Unknown endpoint ID", "data": []}), 404

    # Check DB readiness directly using models module
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
         print(f"API WARN: /history/{endpoint_id} returning DB N/A. Engine Init: {models.ENGINE_INITIALIZED}, Tables Created: {models.DB_TABLES_CREATED}")
         return jsonify({"error": "DB N/A", "data": []}), 503

    try: history_data = get_history_for_period(endpoint_id, start_time, end_time)
    except Exception as hist_err: print(f"E: History fetch {endpoint_id}: {hist_err}"); return jsonify({"error": "History fetch error", "data": []}), 500

    if history_data.get("error"):
         status_code = 503 if "DB N/A" in history_data["error"] else 500
         return jsonify(history_data), status_code

    return jsonify(history_data)