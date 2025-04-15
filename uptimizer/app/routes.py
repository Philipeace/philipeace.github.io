import uuid
import json
from flask import Blueprint, render_template, jsonify, request
from datetime import datetime, timedelta, timezone

# Use absolute imports based on package structure
from app.state import current_state, state_lock, CONFIG_PATH, DEFAULT_CHECK_INTERVAL, DEFAULT_CHECK_TIMEOUT
from app.config_manager import (load_config_from_file, process_config_data,
                                save_config_to_file)
# Import DB functions and the models module itself
try:
    from app.database import get_stats_last_24h, get_history_for_period
    from app import models # Import module to check flags directly
    # --- REMOVED Direct import of DB_ENABLED ---
    # from app.models import DB_ENABLED
except ImportError:
     # Handle cases where DB is disabled - provide stubs for routes
     # DB_ENABLED = False # No longer needed here
     # --- Define dummy models object if import fails ---
     class DummyModels:
         ENGINE_INITIALIZED = False
         DB_TABLES_CREATED = False
     models = DummyModels()
     # --------------------------------------------------
     def get_stats_last_24h(*args): return {"error": "DB N/A", "uptime_percentage_24h": None}
     def get_history_for_period(*args): return {"error": "DB N/A", "data": []}


# Create a Blueprint
api_bp = Blueprint('api', __name__)

# --- HTML Routes ---
@api_bp.route('/')
def index():
    """Renders the main dashboard page."""
    with state_lock:
        endpoints_list = list(current_state.get('endpoints', []))
        app_settings = current_state.get('settings', {}).copy()
        # Ensure defaults are present if missing from state (shouldn't happen with new state init)
        app_settings.setdefault('check_interval_seconds', DEFAULT_CHECK_INTERVAL)
        app_settings.setdefault('check_timeout_seconds', DEFAULT_CHECK_TIMEOUT)
        app_settings.setdefault('disable_floating_elements', False)
    endpoints_sorted = sorted(endpoints_list, key=lambda x: (x.get('group', 'Default Group'), x.get('name', '')))
    endpoint_data_for_template = {ep.get('id'): ep for ep in endpoints_list}
    return render_template('index.html',
                           endpoints=endpoints_sorted,
                           endpoint_data=endpoint_data_for_template,
                           app_settings=app_settings)

# --- API Routes ---
@api_bp.route('/status')
def get_status():
    """API endpoint for latest status from in-memory cache."""
    with state_lock: response_data = {"statuses": current_state.get("statuses", {}).copy(), "last_updated": current_state.get("last_updated", 0)}
    return jsonify(response_data)

@api_bp.route('/config_api/settings', methods=['GET'])
def get_settings():
    """API endpoint for current in-memory settings."""
    with state_lock: settings_copy = current_state.get("settings", {}).copy()
    return jsonify({"settings": settings_copy})

@api_bp.route('/config_api/settings', methods=['PUT'])
def update_settings():
    """API endpoint to update specific global settings."""
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(); updated_settings = {}; settings_changed = False
    with state_lock:
        original_settings = current_state["settings"].copy()
        if 'disable_floating_elements' in data and isinstance(data['disable_floating_elements'], bool):
            current_state["settings"]['disable_floating_elements'] = data['disable_floating_elements']
            updated_settings['disable_floating_elements'] = data['disable_floating_elements']
            settings_changed = True
    if settings_changed:
        with state_lock: endpoints_list = list(current_state['endpoints'])
        # Use save_config_to_file from config_manager, passing CONFIG_PATH
        if save_config_to_file(CONFIG_PATH, current_state["settings"], endpoints_list):
            print(f"API: Updated settings: {updated_settings}")
            return jsonify({"message": "Settings updated", "settings": current_state["settings"]}), 200
        else:
            with state_lock: current_state["settings"] = original_settings
            print("API Error: Failed save after updating settings."); return jsonify({"error": "Failed save config"}), 500
    else: return jsonify({"message": "No valid settings provided"}), 400

@api_bp.route('/config/reload', methods=['POST'])
def reload_config_from_file_route():
    """API endpoint to reload the entire config from config.json."""
    print("API: Received request to reload config from file...")
    try:
        config_data = load_config_from_file(CONFIG_PATH)
        settings, endpoints = process_config_data(config_data)
        with state_lock:
            current_state["settings"] = settings
            current_state["endpoints"] = endpoints
            current_state["statuses"] = {ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None} for ep in endpoints if ep.get('id')}
            current_state["check_interval"] = settings.get("check_interval_seconds", DEFAULT_CHECK_INTERVAL)
            current_state["last_updated"] = 0
        print("API: Config reloaded successfully from file.")
        # --- Trigger immediate check cycle after reload ---
        from app.checker import run_checks_task # Import locally to avoid circular dependency issues at top level
        try:
             print("API: Triggering check cycle after config reload...")
             run_checks_task(current_state, state_lock)
             print("API: Post-reload check cycle triggered.")
        except Exception as check_err:
             print(f"API WARN: Error triggering check cycle after reload: {check_err}")
        # -------------------------------------------------
        return jsonify({"message": "Configuration reloaded successfully. Refresh page to see changes."}), 200
    except FileNotFoundError as e:
         print(f"API Error: Config file not found during reload: {e}")
         return jsonify({"error": f"Config file not found: {CONFIG_PATH}"}), 404
    except json.JSONDecodeError as e:
         print(f"API Error: Invalid JSON in config file during reload: {e}")
         return jsonify({"error": f"Invalid JSON in config file: {e}"}), 400
    except Exception as e:
         print(f"API Error: Unexpected error during config reload: {e}")
         return jsonify({"error": "An unexpected error occurred during reload."}), 500

@api_bp.route('/endpoints', methods=['GET'])
def get_endpoints():
    """API endpoint to get the current list of configured endpoints."""
    with state_lock: endpoints_copy = list(current_state.get('endpoints', []))
    return jsonify({"endpoints": endpoints_copy})

@api_bp.route('/endpoints', methods=['POST'])
def add_endpoint():
    """API endpoint to add a new endpoint configuration."""
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(); name = data.get('name'); url = data.get('url'); group = data.get('group', 'Default Group');
    timeout_str = data.get('check_timeout_seconds'); interval_str = data.get('check_interval_seconds')
    if not name or not url: return jsonify({"error": "Missing name or url"}), 400
    timeout_val = None; interval_val = None
    # Corrected Indentation Applied previously ok
    if timeout_str is not None and timeout_str != '':
        try:
            timeout_val = int(timeout_str)
            if timeout_val < 1: raise ValueError()
        except (ValueError, TypeError): return jsonify({"error": "Invalid timeout"}), 400
    if interval_str is not None and interval_str != '':
        try:
            interval_val = int(interval_str)
            if interval_val < 5: raise ValueError()
        except (ValueError, TypeError): return jsonify({"error": "Invalid interval"}), 400
    new_id = f"ep_{uuid.uuid4().hex[:10]}"
    new_endpoint = {"id": new_id, "name": name, "url": url, "group": group or 'Default Group'}
    if timeout_val is not None: new_endpoint['check_timeout_seconds'] = timeout_val
    if interval_val is not None: new_endpoint['check_interval_seconds'] = interval_val
    with state_lock: current_state["endpoints"].append(new_endpoint); current_state["statuses"][new_id] = {"status": "PENDING", "last_check_ts": 0, "details": None}; print(f"API: Added {new_id} memory.")
    with state_lock: settings_now = current_state["settings"].copy(); endpoints_now = list(current_state["endpoints"])
    if save_config_to_file(CONFIG_PATH, settings_now, endpoints_now):
         return jsonify(new_endpoint), 201
    else:
        with state_lock: current_state["endpoints"] = [ep for ep in current_state["endpoints"] if ep.get('id') != new_id]; current_state["statuses"].pop(new_id, None); print(f"API: Rolled back add {new_id}.")
        return jsonify({"error": "Failed save config"}), 500

@api_bp.route('/endpoints/<endpoint_id>', methods=['PUT'])
def update_endpoint(endpoint_id):
    """API endpoint to update an existing endpoint configuration."""
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(); name = data.get('name'); url = data.get('url'); group = data.get('group');
    timeout_str = data.get('check_timeout_seconds'); interval_str = data.get('check_interval_seconds')
    if not name or not url: return jsonify({"error": "Missing name or url"}), 400
    timeout_val = None; interval_val = None
    # Corrected Indentation Applied previously ok
    if timeout_str is not None:
        if timeout_str == '': timeout_val = None
        else:
            try:
                timeout_val = int(timeout_str)
                if timeout_val < 1: raise ValueError()
            except (ValueError, TypeError): return jsonify({"error": "Invalid timeout"}), 400
    if interval_str is not None:
        if interval_str == '': interval_val = None
        else:
            try:
                interval_val = int(interval_str)
                if interval_val < 5: raise ValueError()
            except (ValueError, TypeError): return jsonify({"error": "Invalid interval"}), 400
    updated_endpoint_data = None; original_endpoint_data = None; endpoint_found = False
    with state_lock:
        for i, ep in enumerate(current_state["endpoints"]):
            if ep.get('id') == endpoint_id:
                original_endpoint_data = ep.copy(); ep['name'] = name; ep['url'] = url; ep['group'] = group or 'Default Group'
                if timeout_str is not None:
                    if timeout_val is None: ep.pop('check_timeout_seconds', None)
                    else: ep['check_timeout_seconds'] = timeout_val
                if interval_str is not None:
                    if interval_val is None: ep.pop('check_interval_seconds', None)
                    else: ep['check_interval_seconds'] = interval_val
                updated_endpoint_data = ep.copy(); endpoint_found = True; print(f"API: Updated {endpoint_id} memory."); break
        if not endpoint_found: return jsonify({"error": "Not found"}), 404
    with state_lock: settings_now = current_state["settings"].copy(); endpoints_now = list(current_state["endpoints"])
    if save_config_to_file(CONFIG_PATH, settings_now, endpoints_now):
         return jsonify(updated_endpoint_data), 200
    else:
        with state_lock:
             for i, ep in enumerate(current_state["endpoints"]):
                  if ep.get('id') == endpoint_id: current_state["endpoints"][i] = original_endpoint_data; print(f"API: Rolled back update {endpoint_id}."); break
        print(f"API Error: Failed save after updating {endpoint_id}.")
        return jsonify({"error": "Failed save after update."}), 500

@api_bp.route('/endpoints/<endpoint_id>', methods=['DELETE'])
def delete_endpoint(endpoint_id):
    """API endpoint to delete an endpoint configuration."""
    endpoint_to_delete = None; endpoint_index = -1
    with state_lock:
        for i, ep in enumerate(current_state["endpoints"]):
             if ep.get('id') == endpoint_id: endpoint_to_delete = ep.copy(); endpoint_index = i; break
        if endpoint_index != -1:
            del current_state["endpoints"][endpoint_index]; current_state["statuses"].pop(endpoint_id, None); print(f"API: Deleted {endpoint_id} memory.")
        else: return jsonify({"error": "Not found"}), 404
    with state_lock: settings_now = current_state["settings"].copy(); endpoints_now = list(current_state["endpoints"])
    if save_config_to_file(CONFIG_PATH, settings_now, endpoints_now):
        return jsonify({"message": "Deleted and saved"}), 200
    else:
        with state_lock:
             if endpoint_index != -1 and endpoint_to_delete: current_state["endpoints"].insert(endpoint_index, endpoint_to_delete); print(f"API: Rolled back delete {endpoint_id}.")
        print(f"API Error: Failed save after deleting {endpoint_id}.")
        return jsonify({"error": "Failed save after delete."}), 500

@api_bp.route('/statistics')
def get_statistics():
    """API endpoint to calculate and return statistics (e.g., 24h uptime)."""
    stats_results = {};
    with state_lock: endpoint_ids = [ep.get('id') for ep in current_state.get('endpoints', []) if ep.get('id')]
    if not endpoint_ids: return jsonify({"error": "No endpoints configured"})
    # --- Check DB readiness directly using models module ---
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
        print(f"API WARN: /statistics returning DB N/A. Engine Init: {models.ENGINE_INITIALIZED}, Tables Created: {models.DB_TABLES_CREATED}")
        return jsonify({eid: {"error": "DB N/A", "uptime_percentage_24h": None} for eid in endpoint_ids})
    # -------------------------------------------------------
    for ep_id in endpoint_ids:
        try: stats = get_stats_last_24h(ep_id)
        except Exception as calc_err: print(f"E: Stats calc {ep_id}: {calc_err}"); stats = {"error": "Calc error"}
        stats_results[ep_id] = stats
    return jsonify(stats_results)

@api_bp.route('/history/<endpoint_id>')
def get_endpoint_history(endpoint_id):
    """API endpoint to fetch historical data for a specific endpoint."""
    period = request.args.get('period', '24h'); end_time = datetime.now(timezone.utc)
    if period == '1h': start_time = end_time - timedelta(hours=1)
    elif period == '7d': start_time = end_time - timedelta(days=7)
    else: start_time = end_time - timedelta(hours=24); period = '24h'
    with state_lock: known_ids = {ep.get('id') for ep in current_state.get('endpoints', [])}
    if endpoint_id not in known_ids: return jsonify({"error": "Unknown endpoint ID", "data": []}), 404
    # --- Check DB readiness directly using models module ---
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
         print(f"API WARN: /history/{endpoint_id} returning DB N/A. Engine Init: {models.ENGINE_INITIALIZED}, Tables Created: {models.DB_TABLES_CREATED}")
         # Return 503 Service Unavailable status code
         return jsonify({"error": "DB N/A", "data": []}), 503
    # -------------------------------------------------------
    try: history_data = get_history_for_period(endpoint_id, start_time, end_time)
    except Exception as hist_err: print(f"E: History fetch {endpoint_id}: {hist_err}"); return jsonify({"error": "History fetch error", "data": []}), 500
    # --- Check if the function itself returned an error (e.g., session issue) ---
    if history_data.get("error"):
         # Propagate the specific error and status code if appropriate
         # Defaulting to 500 if not specified by the function
         status_code = 503 if "DB N/A" in history_data["error"] else 500
         return jsonify(history_data), status_code
    # ---------------------------------------------------------------------------
    return jsonify(history_data)