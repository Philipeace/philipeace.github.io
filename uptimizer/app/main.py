# --- Force app directory onto path ---
import sys
import os
app_dir = os.path.dirname(os.path.abspath(__file__))
if app_dir not in sys.path: sys.path.insert(0, app_dir)

# --- Standard Imports ---
import json
import requests
import time
import atexit
import threading
import uuid
from datetime import datetime, timedelta, timezone

# --- Flask and APScheduler Imports ---
from flask import Flask, render_template, jsonify, request
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.executors.pool import ThreadPoolExecutor

# --- Database Import (with error handling) ---
DB_ENABLED = False
try:
    from database import (init_db, save_status_change, close_db_pool,
                          get_db_connection_pool, get_stats_last_24h,
                          get_history_for_period)
    DB_ENABLED = True
    print("DEBUG: Successfully imported 'database' module.")
except ImportError as e:
    print(f"FATAL ERROR: Failed to import 'database': {e}. DB disabled.")
    def init_db(): 
        pass

    def save_status_change(*args): 
        pass

    def close_db_pool(): 
        pass

    def get_db_connection_pool(): 
        return None

    def get_stats_last_24h(*args): 
        return {"error": "DB N/A"}
    def get_history_for_period(*args): return {"error": "DB N/A", "data": []}

# --- Flask Setup ---
app = Flask(__name__)

# --- Configuration ---
CONFIG_PATH = os.getenv('UPTIMER_CONFIG_PATH', 'app/config.json')
DEFAULT_CHECK_INTERVAL = 30
DEFAULT_CHECK_TIMEOUT = 10

# --- Global State & Locks---
current_state = {
    "endpoints": [], "statuses": {}, "settings": {},
    "last_updated": 0, "check_interval": DEFAULT_CHECK_INTERVAL
}
state_lock = threading.Lock()
config_file_lock = threading.Lock()

# --- Configuration Loading & Saving ---
def load_initial_config():
    """Loads endpoints & settings from file ONLY on startup."""
    global current_state
    resolved_path = os.path.abspath(CONFIG_PATH)
    print(f"Attempting to load INITIAL config from: {resolved_path}")
    initial_endpoints = []
    settings = {}
    try:
        if not os.path.exists(resolved_path): raise FileNotFoundError(f"Not found: {resolved_path}")
        with config_file_lock:
            with open(resolved_path, 'r') as f: config_data = json.load(f)
        raw_endpoints = config_data.get("endpoints", [])
        seen_ids = set()
        for i, ep in enumerate(raw_endpoints):
            ep_id = ep.get('id')
            if not ep_id or ep_id in seen_ids: ep_id = f"loaded_{uuid.uuid4().hex[:8]}"; ep['id'] = ep_id; print(f"W: Generated unique ID '{ep_id}' for loaded endpoint '{ep.get('name', 'N/A')}'")
            seen_ids.add(ep_id);
            if 'group' not in ep or not ep['group']: ep['group'] = 'Default Group'
            cleaned_ep = {'id': ep_id, 'name': ep.get('name'), 'url': ep.get('url'), 'group': ep.get('group'), 'check_timeout_seconds': ep.get('check_timeout_seconds')}
            initial_endpoints.append(cleaned_ep)
        settings = config_data.get("settings", {})
        check_interval = max(5, settings.get("check_interval_seconds", DEFAULT_CHECK_INTERVAL))
        if 'check_timeout_seconds' not in settings: settings['check_timeout_seconds'] = DEFAULT_CHECK_TIMEOUT
        with state_lock:
            current_state["endpoints"] = initial_endpoints; current_state["settings"] = settings; current_state["check_interval"] = check_interval
        print(f"Initial Config loaded. Interval={check_interval}s. {len(initial_endpoints)} endpoints.")
    except Exception as e:
        print(f"ERROR loading initial config {resolved_path}: {e}. Starting empty.")
        with state_lock:
            current_state["endpoints"] = []; current_state["settings"] = {'check_timeout_seconds': DEFAULT_CHECK_TIMEOUT}; current_state["check_interval"] = DEFAULT_CHECK_INTERVAL

def save_config():
    """Saves the current in-memory endpoints and settings to config.json."""
    resolved_path = os.path.abspath(CONFIG_PATH)
    print(f"Attempting to save config to: {resolved_path}")
    endpoints_to_save = []
    settings_to_save = {}
    with state_lock:
        # Make copies to avoid holding lock during file IO
        endpoints_to_save = [ep.copy() for ep in current_state["endpoints"]]
        settings_to_save = current_state["settings"].copy()
    config_data = {"settings": settings_to_save, "endpoints": endpoints_to_save}
    with config_file_lock:
        try:
            temp_path = resolved_path + ".tmp"
            with open(temp_path, 'w') as f: json.dump(config_data, f, indent=4)
            os.replace(temp_path, resolved_path)
            print(f"Config successfully saved to {resolved_path}")
            return True
        except Exception as e:
            print(f"ERROR saving config to {resolved_path}: {e}")
            if os.path.exists(temp_path):
                try: os.remove(temp_path)
                except Exception as rm_e: print(f"Error removing temp config file: {rm_e}")
            return False

# --- Endpoint Checking Logic ---
def check_endpoint(endpoint):
    url = endpoint.get('url');
    if not url: return {"status": "ERROR", "details": "Missing URL"}
    global_timeout = int(current_state["settings"].get('check_timeout_seconds', DEFAULT_CHECK_TIMEOUT))
    endpoint_timeout_str = endpoint.get('check_timeout_seconds')
    try:
        timeout = int(endpoint_timeout_str) if endpoint_timeout_str is not None else global_timeout
        timeout = max(1, timeout)
    except (ValueError, TypeError): timeout = global_timeout
    start_time = time.time(); headers = {'User-Agent': 'Uptimizer/1.10'}; details_msg = None # Updated Agent
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

# --- Background Checking Task ---
def run_checks():
    global current_state; print(f"BG Task: Checks @ {time.strftime('%Y-%m-%d %H:%M:%S')}")
    endpoints_to_check = []; current_interval = DEFAULT_CHECK_INTERVAL
    with state_lock:
        endpoints_to_check = list(current_state.get("endpoints", []))
        current_interval = current_state.get("check_interval", DEFAULT_CHECK_INTERVAL)
    now = time.time(); new_statuses = {}
    if not endpoints_to_check: print("BG Task: No endpoints configured in memory.");
    else:
        pool = get_db_connection_pool() if DB_ENABLED else None
        if DB_ENABLED and not pool: print("BG Task: DB Pool NA. Skip DB saves.")
        start_check_cycle = time.time()
        for ep in endpoints_to_check:
            ep_id = ep.get('id');
            if not ep_id: continue
            check_result = check_endpoint(ep)
            new_statuses[ep_id] = {"status": check_result.get("status", "UNKNOWN"), "last_check_ts": now, "details": check_result}
            if pool:
                try: save_status_change(ep_id, check_result)
                except Exception as db_err: print(f"E: DB save error for {ep_id}: {db_err}")
        cycle_duration = time.time() - start_check_cycle
        print(f"BG Task: Checked {len(endpoints_to_check)} endpoints in {cycle_duration:.2f}s.")
        if cycle_duration > current_interval: print(f"BG Task: WARNING - Check cycle duration ({cycle_duration:.2f}s) exceeded interval ({current_interval}s).")
    with state_lock:
        # Update statuses only for endpoints that were actually checked in this cycle
        current_state["statuses"].update(new_statuses)
        current_state["last_updated"] = now
    print(f"BG Task: Updated memory status.")

# --- Flask Routes ---
@app.route('/')
def index():
    """Renders the main dashboard page."""
    with state_lock:
        endpoints_list = list(current_state.get('endpoints', []))
        app_settings = current_state.get('settings', {}).copy()
    endpoints_sorted = sorted(endpoints_list, key=lambda x: (x.get('group', 'Default Group'), x.get('name', '')))
    # Pass full endpoint data needed for Edit form population
    endpoint_data_for_template = {ep.get('id'): ep for ep in endpoints_list}
    return render_template('index.html', endpoints=endpoints_sorted, endpoint_data=endpoint_data_for_template, app_settings=app_settings)

@app.route('/status')
def get_status():
    """API endpoint for latest status from in-memory cache."""
    with state_lock: response_data = {"statuses": current_state.get("statuses", {}).copy(), "last_updated": current_state.get("last_updated", 0)}
    return jsonify(response_data)

@app.route('/config_api')
def get_config_api():
    """API endpoint for current in-memory settings."""
    with state_lock: settings_copy = current_state.get("settings", {}).copy()
    return jsonify({"settings": settings_copy})

@app.route('/endpoints', methods=['GET'])
def get_endpoints():
    """API endpoint to get the current list of configured endpoints."""
    with state_lock: endpoints_copy = list(current_state.get('endpoints', []))
    return jsonify({"endpoints": endpoints_copy})

@app.route('/endpoints', methods=['POST'])
def add_endpoint():
    """API endpoint to add a new endpoint configuration."""
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(); name = data.get('name'); url = data.get('url'); group = data.get('group', 'Default Group'); timeout_str = data.get('check_timeout_seconds')
    if not name or not url: return jsonify({"error": "Missing required fields: name, url"}), 400
    timeout_val = None
    if timeout_str is not None and timeout_str != '':
        try:
            timeout_val = int(timeout_str)
            if timeout_val < 1:
                raise ValueError("Timeout must be >= 1")
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid check_timeout_seconds value"}), 400
        
    new_id = f"ep_{uuid.uuid4().hex[:10]}"
    new_endpoint = {"id": new_id, "name": name, "url": url, "group": group or 'Default Group'}
    if timeout_val is not None: 
        new_endpoint['check_timeout_seconds'] = timeout_val
    with state_lock:
        current_state["endpoints"].append(new_endpoint)
        current_state["statuses"][new_id] = {"status": "PENDING", "last_check_ts": 0, "details": None}
        print(f"API: Added endpoint '{name}' (ID {new_id}) to memory.")
    if save_config(): return jsonify(new_endpoint), 201
    else: # Rollback if save fails
        with state_lock: current_state["endpoints"] = [ep for ep in current_state["endpoints"] if ep.get('id') != new_id]; current_state["statuses"].pop(new_id, None); print(f"API: Rolled back add for {new_id}.")
        return jsonify({"error": "Failed to save configuration file."}), 500

@app.route('/endpoints/<endpoint_id>', methods=['PUT'])
def update_endpoint(endpoint_id):
    """API endpoint to update an existing endpoint configuration."""
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json()

    # Fields that can be updated
    name = data.get('name')
    url = data.get('url')
    group = data.get('group')
    timeout_str = data.get('check_timeout_seconds')

    if not name or not url: return jsonify({"error": "Missing required fields: name, url"}), 400

    timeout_val = None
    if timeout_str is not None: # Allow empty string to clear timeout
        if timeout_str == '':
            timeout_val = None # Explicitly clear
        else:
            try:
                timeout_val = int(timeout_str)
                if timeout_val < 1:
                    raise ValueError("Timeout must be >= 1")
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid check_timeout_seconds value"}), 400

    updated_endpoint = None
    with state_lock:
        endpoint_found = False
        for i, ep in enumerate(current_state["endpoints"]):
            if ep.get('id') == endpoint_id:
                # Update fields
                original_endpoint = ep.copy() # Keep original in case save fails? Maybe not needed.
                ep['name'] = name
                ep['url'] = url
                ep['group'] = group or 'Default Group' # Ensure group is set
                if timeout_str is not None: # Only update if provided (empty string clears)
                    if timeout_val is None: ep.pop('check_timeout_seconds', None) # Remove key if cleared
                    else: ep['check_timeout_seconds'] = timeout_val
                updated_endpoint = ep.copy() # Get the updated version
                endpoint_found = True
                print(f"API: Updated endpoint ID {endpoint_id} in memory.")
                break # Found and updated, exit loop

        if not endpoint_found:
            return jsonify({"error": "Endpoint not found"}), 404

    # Attempt to save outside state lock
    if save_config():
        return jsonify(updated_endpoint), 200
    else:
        # Rollback difficult here, state already modified. Log inconsistency.
        print(f"API Error: Failed to save config after updating {endpoint_id}. In-memory state updated, file state inconsistent!")
        return jsonify({"error": "Failed to save configuration file after update."}), 500


@app.route('/endpoints/<endpoint_id>', methods=['DELETE'])
def delete_endpoint(endpoint_id):
    """API endpoint to delete an endpoint configuration."""
    endpoint_to_delete = None
    with state_lock:
        initial_len = len(current_state["endpoints"])
        new_endpoints = []
        for ep in current_state["endpoints"]:
             if ep.get('id') == endpoint_id:
                  endpoint_to_delete = ep # Found it
             else:
                  new_endpoints.append(ep)

        if endpoint_to_delete:
            current_state["endpoints"] = new_endpoints
            current_state["statuses"].pop(endpoint_id, None)
            print(f"API: Deleted endpoint ID {endpoint_id} from memory.")
        else:
            print(f"API: Attempted to delete non-existent endpoint ID {endpoint_id}")
            return jsonify({"error": "Endpoint not found"}), 404

    if save_config():
        return jsonify({"message": "Endpoint deleted and config saved"}), 200
    else:
        # Attempt to rollback in-memory deletion if save fails
        with state_lock:
             current_state["endpoints"].append(endpoint_to_delete) # Add it back
             # Status was already popped, might be slightly inconsistent but better than nothing
             print(f"API: Rolled back in-memory delete for {endpoint_id} due to save failure.")
        print(f"API Error: Failed to save config after deleting {endpoint_id}.")
        return jsonify({"error": "Failed to save configuration file after deleting endpoint."}), 500


@app.route('/statistics')
def get_statistics():
    """API endpoint to calculate and return statistics (e.g., 24h uptime)."""
    stats_results = {};
    with state_lock: endpoint_ids = [ep.get('id') for ep in current_state.get('endpoints', []) if ep.get('id')]
    if not endpoint_ids: return jsonify({"error": "No endpoints configured"})
    if not DB_ENABLED: return jsonify({eid: {"error": "DB N/A"} for eid in endpoint_ids})
    for ep_id in endpoint_ids:
        try: stats = get_stats_last_24h(ep_id)
        except Exception as calc_err: print(f"E: Stats calc {ep_id}: {calc_err}"); stats = {"error": "Calc error"}
        stats_results[ep_id] = stats
    return jsonify(stats_results)

@app.route('/history/<endpoint_id>')
def get_endpoint_history(endpoint_id):
    """API endpoint to fetch historical data for a specific endpoint."""
    period = request.args.get('period', '24h'); end_time = datetime.now(timezone.utc)
    if period == '1h': start_time = end_time - timedelta(hours=1)
    elif period == '7d': start_time = end_time - timedelta(days=7)
    else: start_time = end_time - timedelta(hours=24); period = '24h'
    with state_lock: known_ids = {ep.get('id') for ep in current_state.get('endpoints', [])}
    if endpoint_id not in known_ids: return jsonify({"error": "Unknown endpoint ID", "data": []}), 404
    print(f"Fetching history for {endpoint_id} period {period}")
    if not DB_ENABLED: return jsonify({"error": "DB N/A", "data": []}), 503
    try: history_data = get_history_for_period(endpoint_id, start_time, end_time)
    except Exception as hist_err: print(f"E: History fetch {endpoint_id}: {hist_err}"); return jsonify({"error": "History fetch error", "data": []}), 500
    if history_data.get("error"): return jsonify(history_data), 500
    return jsonify(history_data)

# --- Scheduler Setup ---
scheduler = BackgroundScheduler(daemon=True, timezone="UTC")

# --- Initialization and Cleanup ---
def initialize():
    global scheduler, current_state; print("="*30 + "\nInitializing Uptimizer...\n" + "="*30)
    print("Step 1: Initializing Database...");
    if DB_ENABLED: pool = get_db_connection_pool();
    if DB_ENABLED and pool: init_db()
    else: print("WARN: DB Pool NA or DB Disabled. DB features unavailable.")
    print("\nStep 2: Loading Initial Configuration from file..."); load_initial_config()
    initial_endpoints_count = len(current_state["endpoints"]); initial_interval = current_state.get("check_interval")
    with state_lock: current_state["statuses"] = {ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None} for ep in current_state["endpoints"] if ep.get('id')}; current_state["last_updated"] = 0
    print(f"\nInitial State: {initial_endpoints_count} endpoints loaded, PENDING. Interval={initial_interval}s")
    print("\nStep 3: Running Initial Checks..."); run_checks(); print("Initial checks complete.")
    print(f"\nStep 4: Scheduling Recurring Checks (Interval: {initial_interval}s)...")
    try:
        with state_lock: interval_to_use = current_state["check_interval"]
        job_defaults = {'coalesce': True, 'max_instances': 1, 'misfire_grace_time': 30} # Allow 30s misfire time
        if scheduler.get_job('endpoint_checks'): scheduler.reschedule_job('endpoint_checks', trigger='interval', seconds=interval_to_use, **job_defaults)
        else: scheduler.add_job(run_checks, 'interval', seconds=interval_to_use, id='endpoint_checks', replace_existing=True, **job_defaults)
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
    if DB_ENABLED: close_db_pool()
    else: print("DB was disabled, skipping pool closure.")
    print("\nCleanup finished.\n" + "="*30)

atexit.register(cleanup)

# --- Main Execution ---
if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
    if not app.debug: initialize()
    else: print("(Reloader Active: Parent process monitoring)")
else: initialize()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('FLASK_ENV') == 'development')