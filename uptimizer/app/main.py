# --- Force app directory onto path ---
import sys
import os
app_dir = os.path.dirname(os.path.abspath(__file__))
if app_dir not in sys.path: sys.path.insert(0, app_dir)

import json
import requests
import time
import atexit
import threading
import uuid # For generating IDs
from datetime import datetime, timedelta, timezone
from flask import Flask, render_template, jsonify, request
from apscheduler.schedulers.background import BackgroundScheduler

# --- Database Import ---
try:
    from database import (init_db, save_status_change, close_db_pool,
                          get_db_connection_pool, get_stats_last_24h,
                          get_history_for_period)
except ImportError as e:
    print(f"FATAL ERROR: Failed to import 'database': {e}. DB disabled.")
    # Define placeholder functions
    def init_db(): print("FATAL: init_db STUB")
    def save_status_change(*args): print("FATAL: save_status_change STUB")
    def close_db_pool(): print("FATAL: close_db_pool STUB")
    def get_db_connection_pool(): print("FATAL: get_db_connection_pool STUB"); return None
    def get_stats_last_24h(*args): return {"error": "DB N/A"}
    def get_history_for_period(*args): return {"error": "DB N/A", "data": []}

# --- Flask Setup ---
app = Flask(__name__)

# --- Configuration ---
CONFIG_PATH = os.getenv('UPTIMER_CONFIG_PATH', 'app/config.json')
DEFAULT_CHECK_INTERVAL = 30

# --- Global State ---
# Endpoints are now primarily managed in memory via API calls
# config.json is used for initial load only (unless a save mechanism is added)
current_state = {
    "endpoints": [], # List of endpoint dicts {id, name, url, group}
    "statuses": {},  # Dict mapping id -> {status, last_check_ts, details}
    "settings": {},  # Check interval, timeout, etc.
    "last_updated": 0,
    "check_interval": DEFAULT_CHECK_INTERVAL
}
state_lock = threading.Lock()

# --- Configuration Loading (Initial Load Only) ---
def load_initial_config():
    """Loads endpoints & settings from file ONLY on startup."""
    global current_state
    resolved_path = os.path.abspath(CONFIG_PATH)
    print(f"Attempting to load INITIAL config from: {resolved_path}")
    try:
        if not os.path.exists(resolved_path): raise FileNotFoundError(f"Not found: {resolved_path}")
        with open(resolved_path, 'r') as f: config_data = json.load(f)

        # --- Load Endpoints ---
        raw_endpoints = config_data.get("endpoints", [])
        initial_endpoints = []
        seen_ids = set()
        for i, ep in enumerate(raw_endpoints):
            ep_id = ep.get('id')
            if not ep_id or ep_id in seen_ids: # Ensure unique ID on load
                ep_id = f"loaded_{uuid.uuid4().hex[:8]}" # Generate unique ID if missing/duplicate
                ep['id'] = ep_id
                print(f"W: Generated unique ID '{ep_id}' for loaded endpoint '{ep.get('name', 'N/A')}'")
            seen_ids.add(ep_id);
            if 'group' not in ep or not ep['group']: ep['group'] = 'Default Group'
            initial_endpoints.append(ep)

        # --- Load Settings ---
        settings = config_data.get("settings", {})
        check_interval = max(5, settings.get("check_interval_seconds", DEFAULT_CHECK_INTERVAL))

        # --- Update Global State ---
        with state_lock:
            current_state["endpoints"] = initial_endpoints
            current_state["settings"] = settings
            current_state["check_interval"] = check_interval
        print(f"Initial Config loaded. Interval={check_interval}s. {len(initial_endpoints)} endpoints.")

    except Exception as e:
        print(f"ERROR loading initial config {resolved_path}: {e}. Starting with empty config.")
        # Ensure state is empty if load fails
        with state_lock:
            current_state["endpoints"] = []
            current_state["settings"] = {}
            current_state["check_interval"] = DEFAULT_CHECK_INTERVAL

# --- Endpoint Checking Logic (Unchanged) ---
def check_endpoint(endpoint):
    url = endpoint.get('url');
    if not url: return {"status": "ERROR", "details": "Missing URL"}
    with state_lock: settings = current_state.get("settings", {})
    timeout = int(settings.get('check_timeout_seconds', 10))
    start_time = time.time(); headers = {'User-Agent': 'Uptimizer/1.7'}; details_msg = None
    try:
        response = requests.get(url, timeout=timeout, headers=headers, allow_redirects=True)
        response_time = time.time() - start_time
        status = "UP" if 200 <= response.status_code < 400 else "DOWN"
        if status == "DOWN": details_msg = f"HTTP {response.status_code}"
        return {"status": status, "status_code": response.status_code, "response_time_ms": round(response_time * 1000), "details": details_msg}
    except requests.exceptions.Timeout: details_msg = f"Timeout >{timeout}s"; status="DOWN"
    except requests.exceptions.TooManyRedirects: details_msg = "Too many redirects"; status="DOWN"
    except requests.exceptions.ConnectionError: details_msg = "Connection error"; status="DOWN"
    except requests.exceptions.RequestException as e: details_msg = str(e)[:200] + ("..." if len(str(e)) > 200 else ""); status="DOWN"
    except Exception as e: print(f"Check error {url}: {e}"); details_msg = "Check error"; status="ERROR"
    return { "status": status, "details": details_msg }

# --- Background Checking Task (Uses In-Memory State) ---
def run_checks():
    global current_state; print(f"BG Task: Checks @ {time.strftime('%Y-%m-%d %H:%M:%S')}")
    endpoints_to_check = []
    # Get a *copy* of the endpoint list under lock to avoid modification during iteration
    with state_lock:
        endpoints_to_check = list(current_state.get("endpoints", []))
        # Reload settings in case interval changed etc.
        # Consider moving settings load outside the loop if it's heavy, but it's fast here.
        try:
            with open(os.path.abspath(CONFIG_PATH), 'r') as f: # Re-read settings part only? Or rely on API to update settings?
                config_data = json.load(f)
                settings = config_data.get("settings", {})
                current_state["settings"] = settings
                current_state["check_interval"] = max(5, settings.get("check_interval_seconds", DEFAULT_CHECK_INTERVAL))
                print(f"BG Task: Refreshed settings. Interval: {current_state['check_interval']}s")
        except Exception as e:
             print(f"BG Task: WARN - Could not refresh settings from {CONFIG_PATH}: {e}")

    now = time.time(); new_statuses = {}
    if not endpoints_to_check: print("BG Task: No endpoints currently configured in memory.");
    else:
        pool = get_db_connection_pool();
        if not pool: print("BG Task: DB Pool NA. Skip DB saves.")
        for ep in endpoints_to_check:
            ep_id = ep.get('id');
            if not ep_id: continue # Should have ID from load/API add
            check_result = check_endpoint(ep)
            new_statuses[ep_id] = {"status": check_result.get("status", "UNKNOWN"), "last_check_ts": now, "details": check_result}
            if pool:
                try: save_status_change(ep_id, check_result)
                except NameError: print("WARN: save_status_change N/A (import fail)")
                except Exception as db_err: print(f"E: DB save error: {db_err}")

    # Update only statuses and last_updated time based on checks
    with state_lock:
        # Merge results - keep existing statuses if endpoint wasn't checked (e.g., temporarily removed?)
        # For simplicity, just overwrite with latest results for currently configured endpoints
        current_state["statuses"] = new_statuses
        current_state["last_updated"] = now
    print(f"BG Task: Updated memory status for {len(new_statuses)} endpoints.")

# --- Flask Routes ---
@app.route('/')
def index():
    with state_lock: endpoints_list = list(current_state.get('endpoints', []))
    endpoints_sorted = sorted(endpoints_list, key=lambda x: (x.get('group', 'Default Group'), x.get('name', '')))
    endpoint_names = {ep.get('id'): ep.get('name', 'Unknown Endpoint') for ep in endpoints_list}
    return render_template('index.html', endpoints=endpoints_sorted, endpoint_names=endpoint_names)

@app.route('/status')
def get_status():
    with state_lock: response_data = {"statuses": current_state.get("statuses", {}).copy(), "last_updated": current_state.get("last_updated", 0)}
    return jsonify(response_data)

# /config_api now only returns initial settings from file (less useful)
# Maybe return current_state["settings"] instead?
@app.route('/config_api')
def get_config_api():
    # Return current in-memory settings
    with state_lock: settings_copy = current_state.get("settings", {}).copy()
    return jsonify({"settings": settings_copy}) # Only return settings

@app.route('/endpoints', methods=['GET'])
def get_endpoints():
    """API endpoint to get the current list of configured endpoints."""
    with state_lock:
        endpoints_copy = list(current_state.get('endpoints', []))
    return jsonify({"endpoints": endpoints_copy})

@app.route('/endpoints', methods=['POST'])
def add_endpoint():
    """API endpoint to add a new endpoint configuration."""
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json()

    name = data.get('name')
    url = data.get('url')
    group = data.get('group', 'Default Group') # Optional group

    if not name or not url: return jsonify({"error": "Missing required fields: name, url"}), 400
    # Basic URL validation could be added here

    # Generate unique ID
    new_id = f"ep_{uuid.uuid4().hex[:10]}"

    new_endpoint = {"id": new_id, "name": name, "url": url, "group": group or 'Default Group'}

    with state_lock:
        # Check for duplicate URL/Name? Optional.
        current_state["endpoints"].append(new_endpoint)
        # Add initial PENDING status
        current_state["statuses"][new_id] = {"status": "PENDING", "last_check_ts": 0, "details": None}
        print(f"API: Added endpoint '{name}' with ID {new_id}")

    # Return the newly created endpoint info, including its ID
    return jsonify(new_endpoint), 201 # 201 Created

@app.route('/endpoints/<endpoint_id>', methods=['DELETE'])
def delete_endpoint(endpoint_id):
    """API endpoint to delete an endpoint configuration."""
    endpoint_found = False
    with state_lock:
        initial_len = len(current_state["endpoints"])
        # Filter out the endpoint with the matching ID
        current_state["endpoints"] = [ep for ep in current_state["endpoints"] if ep.get('id') != endpoint_id]
        endpoint_found = len(current_state["endpoints"]) < initial_len

        if endpoint_found:
            # Remove status entry as well
            current_state["statuses"].pop(endpoint_id, None) # Remove if exists, ignore if not
            print(f"API: Deleted endpoint with ID {endpoint_id}")
        else:
            print(f"API: Attempted to delete non-existent endpoint ID {endpoint_id}")

    if endpoint_found:
        return jsonify({"message": "Endpoint deleted successfully"}), 200
    else:
        return jsonify({"error": "Endpoint not found"}), 404


@app.route('/statistics')
def get_statistics():
    stats_results = {};
    with state_lock: endpoint_ids = [ep.get('id') for ep in current_state.get('endpoints', []) if ep.get('id')]
    if not endpoint_ids: return jsonify({"error": "No endpoints configured"})
    for ep_id in endpoint_ids:
        try: stats = get_stats_last_24h(ep_id)
        except NameError: stats = {"error": "Stats N/A (import fail)"}
        except Exception as calc_err: print(f"E: Stats calc {ep_id}: {calc_err}"); stats = {"error": "Calc error"}
        stats_results[ep_id] = stats
    return jsonify(stats_results)

@app.route('/history/<endpoint_id>')
def get_endpoint_history(endpoint_id):
    period = request.args.get('period', '24h'); end_time = datetime.now(timezone.utc)
    if period == '1h': start_time = end_time - timedelta(hours=1)
    elif period == '7d': start_time = end_time - timedelta(days=7)
    else: start_time = end_time - timedelta(hours=24); period = '24h'
    with state_lock: known_ids = {ep.get('id') for ep in current_state.get('endpoints', [])}
    if endpoint_id not in known_ids: return jsonify({"error": "Unknown endpoint ID", "data": []}), 404
    print(f"Fetching history for {endpoint_id} period {period}")
    try: history_data = get_history_for_period(endpoint_id, start_time, end_time)
    except NameError: return jsonify({"error": "History N/A (import fail)", "data": []}), 500
    except Exception as hist_err: print(f"E: History fetch {endpoint_id}: {hist_err}"); return jsonify({"error": "History fetch error", "data": []}), 500
    if history_data.get("error"): return jsonify(history_data), 500
    return jsonify(history_data)

# --- Scheduler Setup ---
scheduler = BackgroundScheduler(daemon=True, timezone="UTC")

# --- Initialization and Cleanup ---
def initialize():
    global scheduler, current_state; print("="*30 + "\nInitializing Uptimizer...\n" + "="*30)
    print("Step 1: Initializing Database..."); pool = get_db_connection_pool()
    if pool:
        try: init_db()
        except NameError: print("WARN: init_db N/A (import fail)")
        except Exception as db_init_err: print(f"ERROR during init_db call: {db_init_err}")
    else: print("WARN: DB Pool NA. DB features disabled.")
    # --- Load initial config from file ---
    print("\nStep 2: Loading Initial Configuration from file...")
    load_initial_config() # Populates current_state["endpoints"] and settings
    initial_endpoints_count = len(current_state["endpoints"])
    initial_interval = current_state.get("check_interval")
    # Set initial PENDING status for loaded endpoints
    with state_lock:
        current_state["statuses"] = {ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None}
                                    for ep in current_state["endpoints"] if ep.get('id')}
        current_state["last_updated"] = 0
    print(f"\nInitial State: {initial_endpoints_count} endpoints loaded, marked PENDING. Interval={initial_interval}s")
    # --- End initial load ---
    print("\nStep 3: Running Initial Checks..."); run_checks(); print("Initial checks complete.")
    print(f"\nStep 4: Scheduling Recurring Checks (Interval: {initial_interval}s)...")
    try:
        with state_lock: interval_to_use = current_state["check_interval"]
        if scheduler.get_job('endpoint_checks'): scheduler.reschedule_job('endpoint_checks', trigger='interval', seconds=interval_to_use)
        else: scheduler.add_job(run_checks, 'interval', seconds=interval_to_use, id='endpoint_checks', replace_existing=True)
        if not scheduler.running: scheduler.start(); print("Scheduler started.")
        else: print("Scheduler already running.")
    except Exception as e: print(f"Error starting/scheduling job: {e}")
    print("\nInitialization Complete.\n" + "="*30)

def cleanup():
    print("\n" + "="*30 + "\nShutdown signal. Cleaning up...\n" + "="*30)
    print("Shutting down scheduler...");
    if scheduler.running:
        try: scheduler.shutdown(); print("Scheduler shut down.")
        except Exception as e: print(f"Error shutting down scheduler: {e}")
    else: print("Scheduler was not running.")
    print("\nClosing database pool...");
    try: close_db_pool()
    except NameError: print("WARN: close_db_pool N/A (import fail)")
    except Exception as db_close_err: print(f"ERROR during close_db_pool call: {db_close_err}")
    print("\nCleanup finished.\n" + "="*30)

atexit.register(cleanup)

# --- Main Execution ---
if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
    if not app.debug: initialize()
    else: print("(Reloader Active: Parent process monitoring)")
else: initialize()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('FLASK_ENV') == 'development')