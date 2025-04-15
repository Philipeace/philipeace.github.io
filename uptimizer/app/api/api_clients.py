# File Name: api_clients.py (Ensure this is placed in app/api/)
# Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\api\api_clients.py
import uuid
from flask import Blueprint, jsonify, request, current_app
from werkzeug.exceptions import NotFound, BadRequest, InternalServerError
from copy import deepcopy

# Use absolute imports (adjust based on actual project structure if needed)
from app.state import (current_state, state_lock, CONFIG_PATH, DEFAULT_CLIENT_ID,
                       DEFAULT_CLIENT_SETTINGS, DEFAULT_GLOBAL_SETTINGS)
from app.config_manager import save_config_to_file
from app.auth import token_required, generate_client_api_token # Import auth functions

# Create Blueprint for client-related API endpoints
# The url_prefix='/api' will be added during registration in main.py
clients_api_bp = Blueprint('api_clients', __name__)

# --- Helper Function ---
def _get_client_or_404(client_id):
    """Helper to get client data or return 404 if not found."""
    with state_lock:
        client_data = current_state.get("clients", {}).get(client_id)
        # Important: Create a deep copy before returning
        return deepcopy(client_data) if client_data else None

# --- Client Management API ---

# GET /clients - List all clients
@clients_api_bp.route('/clients', methods=['GET'])
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
    clients_list.sort(key=lambda x: x.get('name', x['id']))
    current_app.logger.debug("API: Responding to GET /clients request.")
    return jsonify({"clients": clients_list})

# POST /clients - Create a new client (local or linked)
@clients_api_bp.route('/clients', methods=['POST'])
def create_client():
    """API endpoint to create a new client."""
    if not request.is_json: raise BadRequest("Request must be JSON")
    data = request.get_json()

    client_name = data.get('name', '').strip()
    client_type = data.get('type', 'local').strip().lower()
    remote_url = data.get('remote_url', '').strip()
    api_token = data.get('api_token', '').strip()

    if not client_name: raise BadRequest("Client name is required.")
    if client_type not in ['local', 'linked']: raise BadRequest("Invalid client type.")

    new_client_id = f"client_{uuid.uuid4().hex[:12]}"

    if client_type == 'linked':
        if not remote_url or not api_token:
            raise BadRequest("For 'linked' clients, 'remote_url' and 'api_token' are required.")
        if not remote_url.startswith(('http://', 'https://')):
             raise BadRequest("Invalid remote_url format.")

    with state_lock:
        if new_client_id in current_state["clients"]:
             raise InternalServerError("Failed to generate unique client ID.")

        new_client_settings = deepcopy(DEFAULT_CLIENT_SETTINGS)
        new_client_settings.update({
            "name": client_name,
            "client_type": client_type,
            "remote_url": remote_url if client_type == 'linked' else None,
            "api_token": api_token if client_type == 'linked' else None,
            "api_enabled": False,
            "disable_floating_elements": False
        })

        current_state["clients"][new_client_id] = {
            "settings": new_client_settings,
            "endpoints": [],
            "statuses": {}
        }
        current_app.logger.info(f"API: Created new client '{client_name}' (ID: {new_client_id}, Type: {client_type}).")

        global_settings_now = deepcopy(current_state["global_settings"])
        clients_data_now = deepcopy(current_state["clients"])

    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
         return jsonify({
             "id": new_client_id,
             "settings": new_client_settings
         }), 201
    else:
        with state_lock:
             current_state["clients"].pop(new_client_id, None)
             current_app.logger.error(f"API: Rolled back creation of client '{new_client_id}' due to save failure.")
        raise InternalServerError("Failed to save configuration after creating client.")


# DELETE /clients/<client_id> - Delete a client
@clients_api_bp.route('/clients/<client_id>', methods=['DELETE'])
def delete_client(client_id):
    """API endpoint to delete a client."""
    if client_id == DEFAULT_CLIENT_ID:
         raise BadRequest("Cannot delete the default client.")

    original_client_data = None
    with state_lock:
        if client_id not in current_state["clients"]:
            raise NotFound("Client not found")
        original_client_data = deepcopy(current_state["clients"][client_id])
        del current_state["clients"][client_id]
        current_app.logger.info(f"API: Deleted client '{client_id}' from memory.")

        global_settings_now = deepcopy(current_state["global_settings"])
        clients_data_now = deepcopy(current_state["clients"])

    if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
        return jsonify({"message": f"Client '{client_id}' deleted successfully."}), 200
    else:
        with state_lock:
             current_state["clients"][client_id] = original_client_data
             current_app.logger.error(f"API: Rolled back deletion of client '{client_id}' due to save failure.")
        raise InternalServerError("Failed to save configuration after deleting client.")


# --- Client Settings API ---

# GET /config_api/client_settings/<client_id>
@clients_api_bp.route('/config_api/client_settings/<client_id>', methods=['GET'])
def get_client_settings(client_id):
    """API endpoint to get specific client settings."""
    client_data = _get_client_or_404(client_id)
    if client_data is None: raise NotFound("Client not found")

    settings_copy = client_data.get("settings", {})
    for key, default_value in DEFAULT_CLIENT_SETTINGS.items():
        if key not in settings_copy:
            settings_copy[key] = default_value
    settings_copy['name'] = settings_copy.get('name', f"Client {client_id}")
    settings_copy.pop('api_token', None)
    current_app.logger.debug(f"API: Responding to GET /config_api/client_settings/{client_id} request.")
    return jsonify({"client_settings": settings_copy})

# PUT /config_api/client_settings/<client_id> - Update settings
@clients_api_bp.route('/config_api/client_settings/<client_id>', methods=['PUT'])
def update_client_settings(client_id):
    """API endpoint to update specific client settings (name, floating, api_enabled, regenerate token)."""
    if not request.is_json: raise BadRequest("Request must be JSON")
    data = request.get_json()
    updated_settings_log = {}
    settings_changed = False
    original_client_settings = None

    with state_lock:
        if client_id not in current_state["clients"]:
            raise NotFound("Client not found")

        if "settings" not in current_state["clients"][client_id]:
            current_state["clients"][client_id]["settings"] = deepcopy(DEFAULT_CLIENT_SETTINGS)
            current_state["clients"][client_id]["settings"]['name'] = f"Client {client_id}"
        original_client_settings = deepcopy(current_state["clients"][client_id]["settings"])

        current_settings_ref = current_state["clients"][client_id]["settings"]

        if 'name' in data and isinstance(data['name'], str):
            new_name = data['name'].strip()
            if new_name and current_settings_ref.get('name') != new_name:
                current_settings_ref['name'] = new_name
                updated_settings_log['name'] = new_name
                settings_changed = True

        if 'disable_floating_elements' in data and isinstance(data['disable_floating_elements'], bool):
            if current_settings_ref.get('disable_floating_elements') != data['disable_floating_elements']:
                current_settings_ref['disable_floating_elements'] = data['disable_floating_elements']
                updated_settings_log['disable_floating_elements'] = data['disable_floating_elements']
                settings_changed = True

        if current_settings_ref.get('client_type', 'local') == 'local' and 'api_enabled' in data and isinstance(data['api_enabled'], bool):
             if current_settings_ref.get('api_enabled') != data['api_enabled']:
                current_settings_ref['api_enabled'] = data['api_enabled']
                updated_settings_log['api_enabled'] = data['api_enabled']
                settings_changed = True

        if current_settings_ref.get('client_type', 'local') == 'local' and data.get('regenerate_token') is True:
             if not current_app.config.get('SECRET_KEY'):
                  current_app.logger.error(f"Cannot regenerate token for client '{client_id}': SECRET_KEY not set.")
             else:
                 new_token = generate_client_api_token(client_id)
                 if current_settings_ref.get('api_token') != new_token:
                      current_settings_ref['api_token'] = new_token
                      updated_settings_log['api_token'] = 'REGENERATED'
                      settings_changed = True
                 current_app.logger.info(f"API: Regenerated API token for client '{client_id}'.")

        if settings_changed:
            global_settings_now = deepcopy(current_state["global_settings"])
            clients_data_now = deepcopy(current_state["clients"])

    if settings_changed:
        if save_config_to_file(CONFIG_PATH, global_settings_now, clients_data_now):
            current_app.logger.info(f"API: Updated settings for client '{client_id}': {updated_settings_log}")
            with state_lock:
                final_settings = deepcopy(current_state["clients"][client_id]["settings"])
            final_settings.pop('api_token', None)
            return jsonify({"message": "Client settings updated", "client_settings": final_settings}), 200
        else:
            with state_lock:
                if client_id in current_state["clients"]:
                     current_state["clients"][client_id]["settings"] = original_client_settings
            current_app.logger.error(f"API Error: Failed save after updating settings for client '{client_id}'. Rolled back.");
            raise InternalServerError("Failed to save configuration after updating client settings.")
    else:
        return jsonify({"message": "No valid or changed client settings provided"}), 200


# GET /clients/<client_id>/api_token - Get the current API token
@clients_api_bp.route('/clients/<client_id>/api_token', methods=['GET'])
def get_client_api_token(client_id):
    """API endpoint to retrieve the API token for a LOCAL client."""
    client_data = _get_client_or_404(client_id)
    if client_data is None: raise NotFound("Client not found")

    settings = client_data.get("settings", {})
    if settings.get("client_type", "local") != "local":
         raise BadRequest("API tokens are only applicable to 'local' clients.")
    if not settings.get("api_enabled", False):
        return jsonify({"error": "API access is not enabled for this client."}), 403

    current_token = settings.get("api_token")
    if not current_token:
         return jsonify({"api_token": None, "message": "API token has not been generated yet."}), 200

    current_app.logger.warning(f"API: Retrieving API token for client '{client_id}'.")
    return jsonify({"api_token": current_token}), 200


# GET /v1/client/<client_id>/status - Get status for a specific client (Authenticated)
@clients_api_bp.route('/v1/client/<client_id>/status', methods=['GET'])
@token_required
def get_exposed_client_status(client_id, verified_client_id, **kwargs):
    """API endpoint for external access to a specific client's status data."""
    with state_lock:
        client_data = deepcopy(current_state.get("clients", {}).get(client_id))
        last_updated = current_state.get("last_updated", 0)

    if not client_data:
        raise NotFound("Client not found")

    settings = client_data.get("settings", {})
    if not settings.get("api_enabled", False):
         current_app.logger.warning(f"API access attempt for disabled client '{client_id}' passed token check.")
         return jsonify({"error": "API access not enabled for this client."}), 403

    statuses = client_data.get("statuses", {})

    current_app.logger.info(f"Authenticated API request successful for client '{client_id}' status.")
    return jsonify({
        "client_id": client_id,
        "client_name": settings.get("name", client_id),
        "statuses": statuses,
        "last_updated": last_updated
    })
