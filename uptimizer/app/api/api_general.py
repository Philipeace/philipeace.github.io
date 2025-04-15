# File Name: api_general.py
# Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\api\api_general.py
from flask import Blueprint, jsonify, current_app
from copy import deepcopy

# Use absolute imports
from app.state import current_state, state_lock

# --- DEFINE THE BLUEPRINT ---
general_api_bp = Blueprint('api_general', __name__)
# ---------------------------

# --- General API Routes ---

# GET /status - Overall Status
@general_api_bp.route('/status') # Route attached to the blueprint
def get_status():
    """API endpoint for latest status from in-memory cache (per client)."""
    with state_lock:
        response_data = {
            "statuses": {
                client_id: deepcopy(client_data.get("statuses", {}))
                for client_id, client_data in current_state.get("clients", {}).items()
            },
            "last_updated": current_state.get("last_updated", 0)
        }
    current_app.logger.debug("API: Responding to /status request.")
    return jsonify(response_data)

# Add other general, non-resource-specific API endpoints here if needed
