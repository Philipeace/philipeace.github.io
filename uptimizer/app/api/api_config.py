# File Name: api_config.py (Place in app/api/ directory)
# Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\api\api_config.py
from flask import Blueprint, jsonify, request, current_app
from werkzeug.exceptions import InternalServerError, BadRequest
from copy import deepcopy

# Use absolute imports
from app.state import (current_state, state_lock, CONFIG_PATH, DEFAULT_CLIENT_ID,
                       DEFAULT_GLOBAL_SETTINGS, DEFAULT_CLIENT_SETTINGS)
from app.config_manager import load_config_from_file, process_config_data
# Import run_checks_task for triggering after reload
from app.checker import run_checks_task

# Create Blueprint for configuration-related API endpoints
# *** ENSURE THIS LINE IS EXACTLY CORRECT ***
config_api_bp = Blueprint('api_config', __name__)
# *******************************************

# --- Config Management API ---

# GET /config_api/global_settings
@config_api_bp.route('/config_api/global_settings', methods=['GET'])
def get_global_settings():
    """API endpoint for current global settings."""
    with state_lock:
        settings_copy = deepcopy(current_state.get("global_settings", DEFAULT_GLOBAL_SETTINGS))
    current_app.logger.debug("API: Responding to GET /config_api/global_settings request.")
    return jsonify({"global_settings": settings_copy})

# POST /config/reload
@config_api_bp.route('/config/reload', methods=['POST'])
def reload_config_from_file_route():
    """API endpoint to reload the application state from the config file."""
    current_app.logger.info("API: Received request to reload config from file...")
    try:
        config_data = load_config_from_file(CONFIG_PATH)
        global_settings, clients_data = process_config_data(config_data)

        with state_lock:
            current_state["global_settings"] = global_settings
            current_state["clients"] = {}
            for client_id, client_info in clients_data.items():
                 current_state["clients"][client_id] = {
                     "settings": client_info.get("settings", deepcopy(DEFAULT_CLIENT_SETTINGS)),
                     "endpoints": client_info.get("endpoints", []),
                     "statuses": {}
                 }
                 if client_info.get("settings", {}).get("client_type", "local") == "local":
                      current_state["clients"][client_id]["statuses"] = {
                          ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None}
                          for ep in client_info.get("endpoints", []) if ep.get('id')
                      }
                 if 'name' not in current_state["clients"][client_id]["settings"]:
                      current_state["clients"][client_id]["settings"]['name'] = f"Client {client_id}"

            if DEFAULT_CLIENT_ID not in current_state["clients"]:
                current_app.logger.warning(f"Config reload: Default client '{DEFAULT_CLIENT_ID}' not in file, adding default.")
                current_state["clients"][DEFAULT_CLIENT_ID] = {
                    "settings": deepcopy(DEFAULT_CLIENT_SETTINGS),
                    "endpoints": [],
                    "statuses": {}
                }

            current_state["scheduler_interval"] = global_settings.get("check_interval_seconds", DEFAULT_GLOBAL_SETTINGS['check_interval_seconds'])
            current_state["last_updated"] = 0

            reloaded_clients = deepcopy(current_state["clients"])
            reloaded_globals = deepcopy(current_state["global_settings"])
            all_ep_data = {
                ep.get('id'): deepcopy(ep)
                for cid, cdata in reloaded_clients.items()
                for ep in cdata.get("endpoints", []) if ep.get('id')
            }
            sorted_cids = sorted(reloaded_clients.keys(), key=lambda cid: reloaded_clients[cid]['settings'].get('name', cid))
            initial_active_cid = DEFAULT_CLIENT_ID
            if DEFAULT_CLIENT_ID not in reloaded_clients and sorted_cids:
                initial_active_cid = sorted_cids[0]

        current_app.logger.info("API: Triggering check cycle after config reload...")
        try:
             run_checks_task(current_state, state_lock)
             current_app.logger.info("API: Post-reload check cycle triggered.")
        except Exception as check_err:
             current_app.logger.warning(f"API WARN: Error triggering check cycle after reload: {check_err}")

        current_app.logger.info("API: Config reloaded successfully from file.")
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
    except ValueError as ve:
         current_app.logger.error(f"API Error: Failed to reload config due to invalid format: {ve}", exc_info=True)
         raise BadRequest(f"Failed to reload config: Invalid configuration file format - {ve}")
    except Exception as e:
         current_app.logger.error(f"API Error: Unexpected error during config reload: {e}", exc_info=True)
         raise InternalServerError("An unexpected error occurred during config reload.")
