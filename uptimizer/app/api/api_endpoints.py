# File Name: api_endpoints.py (NEW FILE)
# Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\api_endpoints.py
import uuid
from flask import Blueprint, jsonify, request, current_app
from werkzeug.exceptions import NotFound, BadRequest, InternalServerError
from copy import deepcopy

# Use absolute imports
from app.state import current_state, state_lock, CONFIG_PATH
from app.config_manager import save_config_to_file
from app.api.api_clients import _get_client_or_404 # Import helper from client API module

# Create Blueprint for endpoint-related API endpoints
endpoints_api_bp = Blueprint('api_endpoints', __name__)

# --- Endpoint Management API (Client-Specific) ---

# GET /clients/<client_id>/endpoints
@endpoints_api_bp.route('/clients/<client_id>/endpoints', methods=['GET'])
def get_client_endpoints(client_id):
    """API endpoint to list endpoints for a specific LOCAL client."""
    client_data = _get_client_or_404(client_id) # Gets a deep copy
    if client_data is None: raise NotFound("Client not found")

    if client_data.get("settings", {}).get("client_type", "local") != "local":
         raise BadRequest("Endpoints can only be listed for 'local' clients.")

    # Return the copy of endpoints
    endpoints_copy = client_data.get('endpoints', [])
    current_app.logger.debug(f"API: Responding to GET /clients/{client_id}/endpoints request.")
    return jsonify({"endpoints": endpoints_copy})

# POST /clients/<client_id>/endpoints
@endpoints_api_bp.route('/clients/<client_id>/endpoints', methods=['POST'])
def add_client_endpoint(client_id):
    """API endpoint to add an endpoint to a specific LOCAL client."""
    if not request.is_json: raise BadRequest("Request must be JSON")

    # Initial check outside lock (reduces lock time)
    with state_lock:
        client_exists = client_id in current_state.get("clients", {})
        client_type = current_state.get("clients", {}).get(client_id, {}).get("settings", {}).get("client_type", "local")

    if not client_exists: raise NotFound("Client not found")
    if client_type != "local":
        raise BadRequest("Endpoints can only be added to 'local' clients.")

    data = request.get_json()
    name = data.get('name')
    url = data.get('url')
    group = data.get('group', 'Default Group')
    timeout_str = data.get('check_timeout_seconds')
    interval_str = data.get('check_interval_seconds')

    # Validation
    if not name or not url: raise BadRequest("Missing name or url")
    name = name.strip(); url = url.strip(); group = (group or 'Default Group').strip()
    if not name or not url: raise BadRequest("Name and URL cannot be empty") # Check after strip

    timeout_val = None; interval_val = None
    if timeout_str is not None and str(timeout_str).strip() != '':
        try: timeout_val = int(timeout_str); assert timeout_val >= 1
        except: raise BadRequest("Invalid timeout value (must be >= 1 or blank)")
    if interval_str is not None and str(interval_str).strip() != '':
        try: interval_val = int(interval_str); assert interval_val >= 5
        except: raise BadRequest("Invalid interval value (must be >= 5 or blank)")

    new_id = f"ep_{uuid.uuid4().hex[:10]}"
    new_endpoint = {"id": new_id, "name": name, "url": url, "group": group}
    if timeout_val is not None: new_endpoint['check_timeout_seconds'] = timeout_val
    if interval_val is not None: new_endpoint['check_interval_seconds'] = interval_val

    # --- Update State and Save ---
    with state_lock:
        # Re-check client exists and type inside lock for safety
        if client_id not in current_state["clients"]: raise NotFound("Client not found (concurrent modification?)")
        if current_state["clients"][client_id].get("settings", {}).get("client_type", "local") != "local":
            raise BadRequest("Client type changed concurrently? Cannot add endpoint.")

        # Ensure lists/dicts exist before appending/adding
        if "endpoints" not in current_state["clients"][client_id]: current_state["clients"][client_id]["endpoints"] = []
        if "statuses" not in current_state["clients"][client_id]: current_state["clients"][client_id]["statuses"] = {}

        # Check for duplicate ID (highly unlikely, but good practice)
        if any(ep.get('id') == new_id for ep in current_state["clients"][client_id]["endpoints"]):
            raise InternalServerError("Generated duplicate endpoint ID, please try again.")

        current_state["clients"][client_id]["endpoints"].append(new_endpoint)
        current_state["clients"][client_id]["statuses"][new_id] = {"status": "PENDING", "last_check_ts": 0, "details": None}

        current_app.logger.info(f"API: Added endpoint '{new_id}' to client '{client_id}' memory.")

        # Prepare data for saving (use copies)
        global_settings_now = deepcopy(current_state["global_settings"])
        clients_data_now = deepcopy(current_state["clients"])

    # Save config file (outside lock)
    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
         # Return the data of the newly created endpoint
         return jsonify({"client_id": client_id, **new_endpoint}), 201
    else: # Rollback memory state if save fails
        with state_lock:
             # Check if client and endpoint still exist before rollback
             if client_id in current_state["clients"]:
                 current_state["clients"][client_id]["endpoints"] = [ep for ep in current_state["clients"][client_id]["endpoints"] if ep.get('id') != new_id]
                 if "statuses" in current_state["clients"][client_id]:
                     current_state["clients"][client_id]["statuses"].pop(new_id, None)
                 current_app.logger.error(f"API: Rolled back add endpoint '{new_id}' from client '{client_id}' due to save failure.")
        raise InternalServerError("Failed to save configuration after adding endpoint.")


# PUT /clients/<client_id>/endpoints/<endpoint_id>
@endpoints_api_bp.route('/clients/<client_id>/endpoints/<endpoint_id>', methods=['PUT'])
def update_client_endpoint(client_id, endpoint_id):
    """API endpoint to update an endpoint for a specific LOCAL client."""
    if not request.is_json: raise BadRequest("Request must be JSON")

    # Initial check outside lock
    with state_lock:
        client_exists = client_id in current_state.get("clients", {})
        client_type = current_state.get("clients", {}).get(client_id, {}).get("settings", {}).get("client_type", "local")

    if not client_exists: raise NotFound("Client not found")
    if client_type != "local":
        raise BadRequest("Endpoints can only be updated for 'local' clients.")

    data = request.get_json()
    name = data.get('name'); url = data.get('url'); group = data.get('group')
    timeout_str = data.get('check_timeout_seconds'); interval_str = data.get('check_interval_seconds')

    # Validation
    if not name or not url: raise BadRequest("Missing name or url")
    name = name.strip(); url = url.strip(); group = (group or 'Default Group').strip() # Allow empty group to reset to default
    if not name or not url: raise BadRequest("Name and URL cannot be empty")

    timeout_val = None; interval_val = None
    # Allow explicitly setting to null/empty string to remove override
    if timeout_str is not None:
        timeout_str_strip = str(timeout_str).strip()
        if timeout_str_strip == '': timeout_val = None
        else:
            try: timeout_val = int(timeout_str_strip); assert timeout_val >= 1
            except: raise BadRequest("Invalid timeout value (must be >= 1 or blank)")
    if interval_str is not None:
        interval_str_strip = str(interval_str).strip()
        if interval_str_strip == '': interval_val = None
        else:
            try: interval_val = int(interval_str_strip); assert interval_val >= 5
            except: raise BadRequest("Invalid interval value (must be >= 5 or blank)")

    # --- Update State and Save ---
    updated_endpoint_data = None; original_endpoint_data = None; endpoint_found = False; endpoint_index = -1
    with state_lock:
        # Re-check client exists and type inside lock
        if client_id not in current_state.get("clients", {}): raise NotFound("Client not found (concurrent modification?)")
        if current_state["clients"][client_id].get("settings", {}).get("client_type", "local") != "local":
            raise BadRequest("Client type changed concurrently? Cannot update endpoint.")

        endpoints_list = current_state["clients"][client_id].get("endpoints", [])
        for i, ep in enumerate(endpoints_list):
            if ep.get('id') == endpoint_id:
                # Store copy for rollback
                original_endpoint_data = deepcopy(ep)
                endpoint_index = i

                # Update the endpoint data in place
                ep['name'] = name
                ep['url'] = url
                ep['group'] = group # Already defaulted if empty

                # Handle optional fields - remove key if set to null/blank
                if timeout_str is not None: # Check if key was provided
                    if timeout_val is None: ep.pop('check_timeout_seconds', None)
                    else: ep['check_timeout_seconds'] = timeout_val
                if interval_str is not None: # Check if key was provided
                    if interval_val is None: ep.pop('check_interval_seconds', None)
                    else: ep['check_interval_seconds'] = interval_val

                # Store copy of final data to return
                updated_endpoint_data = deepcopy(ep)
                endpoint_found = True
                current_app.logger.info(f"API: Updated endpoint '{endpoint_id}' in client '{client_id}' memory.")
                break # Found and updated

        if not endpoint_found: raise NotFound("Endpoint not found within the client")

        # Prepare data for saving (use copies)
        global_settings_now = deepcopy(current_state["global_settings"])
        clients_data_now = deepcopy(current_state["clients"])

    # Save config file (outside lock)
    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
         return jsonify({"client_id": client_id, **updated_endpoint_data}), 200
    else: # Rollback memory state if save fails
        with state_lock:
             # Check if client, endpoint, and index are still valid before rollback
             if client_id in current_state["clients"] and \
                "endpoints" in current_state["clients"][client_id] and \
                len(current_state["clients"][client_id]["endpoints"]) > endpoint_index and \
                current_state["clients"][client_id]["endpoints"][endpoint_index].get('id') == endpoint_id and \
                original_endpoint_data:
                  current_state["clients"][client_id]["endpoints"][endpoint_index] = original_endpoint_data
                  current_app.logger.error(f"API: Rolled back update for endpoint '{endpoint_id}' in client '{client_id}' due to save failure.")
             else:
                   current_app.logger.error(f"API: Could not rollback update for endpoint '{endpoint_id}' in client '{client_id}' (state changed?).")
        raise InternalServerError("Failed to save configuration after updating endpoint.")


# DELETE /clients/<client_id>/endpoints/<endpoint_id>
@endpoints_api_bp.route('/clients/<client_id>/endpoints/<endpoint_id>', methods=['DELETE'])
def delete_client_endpoint(client_id, endpoint_id):
    """API endpoint to delete an endpoint from a specific LOCAL client."""
    # Initial check outside lock
    with state_lock:
        client_exists = client_id in current_state.get("clients", {})
        client_type = current_state.get("clients", {}).get(client_id, {}).get("settings", {}).get("client_type", "local")

    if not client_exists: raise NotFound("Client not found")
    if client_type != "local":
        raise BadRequest("Endpoints can only be deleted from 'local' clients.")

    # --- Update State and Save ---
    original_endpoint_data = None; endpoint_index = -1; original_status = None
    with state_lock:
        # Re-check client exists and type inside lock
        if client_id not in current_state.get("clients", {}): raise NotFound("Client not found (concurrent modification?)")
        if current_state["clients"][client_id].get("settings", {}).get("client_type", "local") != "local":
            raise BadRequest("Client type changed concurrently? Cannot delete endpoint.")

        endpoints_list = current_state["clients"][client_id].get("endpoints", [])
        for i, ep in enumerate(endpoints_list):
             if ep.get('id') == endpoint_id:
                 # Store copy for rollback
                 original_endpoint_data = deepcopy(ep)
                 endpoint_index = i
                 # Also store status for rollback
                 if "statuses" in current_state["clients"][client_id]:
                     original_status = deepcopy(current_state["clients"][client_id]["statuses"].get(endpoint_id))
                 break # Found

        if endpoint_index != -1:
            # Delete from endpoints list
            del current_state["clients"][client_id]["endpoints"][endpoint_index]
            # Delete from statuses dict
            if "statuses" in current_state["clients"][client_id]:
                 current_state["clients"][client_id]["statuses"].pop(endpoint_id, None)
            current_app.logger.info(f"API: Deleted endpoint '{endpoint_id}' from client '{client_id}' memory.")
        else:
            raise NotFound("Endpoint not found within the client")

        # Prepare data for saving (use copies)
        global_settings_now = deepcopy(current_state["global_settings"])
        clients_data_now = deepcopy(current_state["clients"])

    # Save config file (outside lock)
    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
        return jsonify({"message": f"Endpoint {endpoint_id} deleted from client {client_id}"}), 200
    else: # Rollback memory state if save fails
        with state_lock:
            # Check if client still exists and index is valid before rollback
             if client_id in current_state["clients"] and original_endpoint_data:
                 # Ensure endpoints list exists
                 if "endpoints" not in current_state["clients"][client_id]:
                     current_state["clients"][client_id]["endpoints"] = []
                 # Insert endpoint back at original index
                 current_state["clients"][client_id]["endpoints"].insert(endpoint_index, original_endpoint_data)
                 # Restore status if it existed
                 if original_status:
                     if "statuses" not in current_state["clients"][client_id]:
                         current_state["clients"][client_id]["statuses"] = {}
                     current_state["clients"][client_id]["statuses"][endpoint_id] = original_status
                 current_app.logger.error(f"API: Rolled back delete endpoint '{endpoint_id}' from client '{client_id}' due to save failure.")
             else:
                  current_app.logger.error(f"API: Could not rollback delete for endpoint '{endpoint_id}' in client '{client_id}' (state changed?).")
        raise InternalServerError("Failed to save configuration after deleting endpoint.")
