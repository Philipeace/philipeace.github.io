# File Name: api_stats.py (NEW FILE)
# Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\api_stats.py
from flask import Blueprint, jsonify, request, current_app
from werkzeug.exceptions import NotFound, ServiceUnavailable, InternalServerError
from datetime import datetime, timedelta, timezone
from copy import deepcopy

# Use absolute imports
from app.state import current_state, state_lock
# Import DB functions and the models module itself
try:
    from app.database import get_stats_last_24h, get_history_for_period
    from app import models # Access DB flags like ENGINE_INITIALIZED, DB_TABLES_CREATED
except ImportError:
     # Define dummy fallback if DB components fail to import
     class DummyModels: ENGINE_INITIALIZED = False; DB_TABLES_CREATED = False
     models = DummyModels()
     def get_stats_last_24h(*args): return {"error": "DB N/A", "uptime_percentage_24h": None}
     def get_history_for_period(*args): return {"error": "DB N/A", "data": []}

# Create Blueprint for stats/history API endpoints
stats_api_bp = Blueprint('api_stats', __name__)

# --- Stats & History API ---

@stats_api_bp.route('/statistics')
def get_statistics():
    """API endpoint to get 24h uptime statistics for all known endpoints."""
    stats_results = {}
    endpoint_ids_to_check = []

    # Get a consistent list of endpoint IDs from the current state
    with state_lock:
        # Create a list of IDs for endpoints belonging to 'local' clients only
        # Stats are calculated locally based on DB history, not relevant for linked clients.
        endpoint_ids_to_check = [
            ep.get('id')
            for client_data in current_state.get("clients", {}).values()
            if client_data.get("settings", {}).get("client_type", "local") == "local"
            for ep in client_data.get("endpoints", []) if ep.get('id')
        ]

    if not endpoint_ids_to_check:
        current_app.logger.debug("API: /statistics called, but no local endpoints found.")
        return jsonify({}) # Return empty if no local endpoints

    # Check DB readiness *once* before looping
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
        current_app.logger.warning(f"API WARN: /statistics returning DB N/A for all endpoints. Engine Init: {models.ENGINE_INITIALIZED}, Tables Created: {models.DB_TABLES_CREATED}")
        # Return DB N/A error for all requested local endpoints
        return jsonify({eid: {"error": "DB N/A", "uptime_percentage_24h": None} for eid in endpoint_ids_to_check}), 503

    # Calculate stats for each local endpoint
    for ep_id in endpoint_ids_to_check:
        try:
            stats = get_stats_last_24h(ep_id)
            # Handle potential errors returned from the DB function itself
            if stats.get("error"):
                current_app.logger.warning(f"Stats calc error for {ep_id}: {stats['error']}")
            stats_results[ep_id] = stats
        except Exception as calc_err:
            # Catch unexpected errors during calculation
            current_app.logger.error(f"Unexpected error calculating stats for {ep_id}: {calc_err}", exc_info=True)
            stats_results[ep_id] = {"error": "Calculation error", "uptime_percentage_24h": None}

    current_app.logger.debug(f"API: Responding to /statistics request for {len(stats_results)} endpoints.")
    return jsonify(stats_results)


@stats_api_bp.route('/history/<endpoint_id>')
def get_endpoint_history(endpoint_id):
    """API endpoint to get history data for a specific endpoint over a period."""
    period = request.args.get('period', '24h')
    end_time = datetime.now(timezone.utc)

    # Determine time window
    if period == '1h': start_time = end_time - timedelta(hours=1)
    elif period == '7d': start_time = end_time - timedelta(days=7)
    else: start_time = end_time - timedelta(hours=24); period = '24h' # Default to 24h

    # Verify the endpoint ID exists within any client (local or linked - history is local)
    # History is only stored locally, so we just check if the ID is known.
    endpoint_exists_locally = False
    with state_lock:
        for client_data in current_state.get("clients", {}).values():
             # Only check local clients, as history is stored based on local checks
             if client_data.get("settings", {}).get("client_type", "local") == "local":
                 if any(ep.get('id') == endpoint_id for ep in client_data.get("endpoints", [])):
                     endpoint_exists_locally = True
                     break

    if not endpoint_exists_locally:
        # If the ID doesn't belong to any known local endpoint, return 404
        current_app.logger.warning(f"API: History requested for unknown local endpoint ID '{endpoint_id}'.")
        raise NotFound("Unknown or non-local endpoint ID")

    # Check DB readiness
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
         current_app.logger.warning(f"API WARN: /history/{endpoint_id} returning DB N/A. Engine Init: {models.ENGINE_INITIALIZED}, Tables Created: {models.DB_TABLES_CREATED}")
         # Use 503 Service Unavailable for DB issues
         raise ServiceUnavailable("Database not available")

    # Fetch history data from the database
    try:
        history_data = get_history_for_period(endpoint_id, start_time, end_time)
        # Handle errors returned from the DB function
        if history_data.get("error"):
             current_app.logger.error(f"Error fetching history for {endpoint_id}: {history_data['error']}")
             # Distinguish between DB connection issues and other fetch errors
             if "DB N/A" in history_data["error"] or "DB Session N/A" in history_data["error"]:
                 raise ServiceUnavailable("Database error during history fetch")
             else:
                 raise InternalServerError("History fetch error")
        # Success
        current_app.logger.debug(f"API: Responding to /history/{endpoint_id}?period={period} request.")
        return jsonify(history_data)
    except Exception as hist_err:
        # Catch unexpected errors during history fetch
        current_app.logger.error(f"Unexpected error fetching history for {endpoint_id}: {hist_err}", exc_info=True)
        raise InternalServerError("Unexpected error fetching history")