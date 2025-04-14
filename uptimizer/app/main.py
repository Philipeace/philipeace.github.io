import json
import os
import requests
import time
import atexit
import threading # For locking shared status data
from flask import Flask, render_template, jsonify
from apscheduler.schedulers.background import BackgroundScheduler

app = Flask(__name__)

CONFIG_PATH = os.getenv('UPTIMER_CONFIG_PATH', 'config.json')
CHECK_INTERVAL_SECONDS = 30 # Default check interval for the background task

# --- Global State for Status (Shared between scheduler and Flask requests) ---
# Structure:
# {
#   "endpoints": [ ... original config ... ],
#   "statuses": {
#       "endpoint_id_1": { "status": "UP", "last_check_ts": 12345, "details": {...} },
#       "endpoint_id_2": { "status": "DOWN", "last_check_ts": 12345, "details": {...} }
#   },
#   "last_updated": 0, # Timestamp of the last successful update cycle
#   "check_interval": CHECK_INTERVAL_SECONDS
# }
current_state = {
    "endpoints": [],
    "statuses": {},
    "last_updated": 0,
    "check_interval": CHECK_INTERVAL_SECONDS
}
state_lock = threading.Lock() # To protect access to current_state

# --- Configuration Loading ---
def load_config():
    """Loads configuration from the JSON file."""
    global CHECK_INTERVAL_SECONDS # Allow modification of global default
    try:
        with open(CONFIG_PATH, 'r') as f:
            config_data = json.load(f)
            # Basic validation
            endpoints = config_data.get("endpoints", [])
            settings = config_data.get("settings", {})
            interval = settings.get("check_interval_seconds", CHECK_INTERVAL_SECONDS) # Use default if not set
            CHECK_INTERVAL_SECONDS = interval # Update the global interval

            # Ensure endpoints have IDs and default group
            processed_endpoints = []
            seen_ids = set()
            for i, ep in enumerate(endpoints):
                ep_id = ep.get('id')
                if not ep_id:
                    ep_id = f"genid_{i}_{ep.get('url', 'no_url')[:20]}" # Generate a somewhat stable ID
                    ep['id'] = ep_id
                    print(f"Warning: Endpoint '{ep.get('name', ep_id)}' missing 'id'. Generated ID: {ep_id}")

                if ep_id in seen_ids:
                     print(f"Error: Duplicate endpoint ID '{ep_id}' found. Skipping duplicate.")
                     continue
                seen_ids.add(ep_id)

                if 'group' not in ep or not ep['group']:
                    ep['group'] = 'Default Group'
                processed_endpoints.append(ep)

            return {"endpoints": processed_endpoints, "settings": settings}

    except FileNotFoundError:
        print(f"Warning: Configuration file not found at {CONFIG_PATH}. Using empty defaults.")
        CHECK_INTERVAL_SECONDS = 30 # Reset interval to default
        return {"endpoints": [], "settings": {}}
    except json.JSONDecodeError:
        print(f"Error: Could not decode JSON from {CONFIG_PATH}. Using empty defaults.")
        CHECK_INTERVAL_SECONDS = 30 # Reset interval to default
        return {"endpoints": [], "settings": {}}

# --- Endpoint Checking Logic ---
def check_endpoint(endpoint):
    """Performs a basic HTTP GET check on a single endpoint. (Same as before)"""
    url = endpoint.get('url')
    if not url:
        return {"status": "ERROR", "details": "Missing URL in config"}

    start_time = time.time()
    try:
        # TODO: Make timeout configurable via settings
        response = requests.get(url, timeout=10) # 10 second timeout
        response_time = time.time() - start_time
        if 200 <= response.status_code < 400:
            status = "UP"
        else:
            status = "DOWN"
        return {
            "status": status,
            "status_code": response.status_code,
            "response_time_ms": round(response_time * 1000),
        }
    except requests.exceptions.Timeout:
        # response_time = time.time() - start_time # time() is tricky with timeouts
        return {
            "status": "DOWN",
            "details": "Request timed out",
            # "response_time_ms": round(response_time * 1000), # Avoid potentially inaccurate time
        }
    except requests.exceptions.ConnectionError:
        return {"status": "DOWN", "details": "Connection error"}
    except requests.exceptions.RequestException as e:
        return {"status": "DOWN", "details": str(e)}
    except Exception as e:
        print(f"Unexpected error checking {url}: {e}")
        return {"status": "ERROR", "details": "Unexpected check error"}

# --- Background Checking Task ---
def run_checks():
    """Loads config, checks all endpoints, and updates global state."""
    global current_state
    print(f"Background task: Running checks at {time.strftime('%Y-%m-%d %H:%M:%S')}")
    config = load_config() # Load config fresh each time
    new_statuses = {}
    endpoints_to_check = config.get('endpoints', [])
    now = time.time()

    if not endpoints_to_check:
        print("Background task: No endpoints configured.")
    else:
        # You might want to use concurrent checks (threading, asyncio) here for many endpoints
        for ep in endpoints_to_check:
            ep_id = ep.get('id')
            if not ep_id: continue # Should have been handled by load_config

            check_result = check_endpoint(ep)
            new_statuses[ep_id] = {
                "status": check_result.get("status", "UNKNOWN"),
                "last_check_ts": now,
                "details": check_result
            }

    # --- Update shared state safely ---
    with state_lock:
        current_state["endpoints"] = config.get('endpoints', []) # Update endpoint list too
        current_state["statuses"] = new_statuses
        current_state["last_updated"] = now
        current_state["check_interval"] = config.get('settings', {}).get('check_interval_seconds', CHECK_INTERVAL_SECONDS)
        print(f"Background task: Updated status for {len(new_statuses)} endpoints.")

# --- Flask Routes ---
@app.route('/')
def index():
    """Renders the main dashboard page using the latest state."""
    with state_lock:
        # Get a copy of endpoints to avoid holding lock during render_template
        endpoints_list = list(current_state.get('endpoints', []))

    # Sort endpoints primarily by group, then by name for consistent display
    endpoints_sorted = sorted(endpoints_list, key=lambda x: (x.get('group', 'Default Group'), x.get('name', '')))

    # Initial statuses might be PENDING before first check completes
    return render_template('index.html', endpoints=endpoints_sorted)

@app.route('/status')
def get_status():
    """API endpoint to get the latest status from the background task."""
    with state_lock:
        # Return a copy of the relevant parts of the state
        response_data = {
            "statuses": current_state.get("statuses", {}).copy(),
            "last_updated": current_state.get("last_updated", 0)
        }
    return jsonify(response_data)

@app.route('/config')
def get_config_api():
    """API endpoint to view the current configuration as loaded by the app."""
    # Rerun load_config to show potentially *pending* config changes
    # The background task uses the config loaded during its run
    config = load_config()
    return jsonify(config)

# --- Scheduler Setup ---
scheduler = BackgroundScheduler(daemon=True)

# Function to initialize state and scheduler *once*
def initialize():
    global scheduler
    print("Initializing state and scheduler...")
    initial_config = load_config()
    initial_endpoints = initial_config.get('endpoints', [])
    initial_interval = initial_config.get('settings', {}).get('check_interval_seconds', CHECK_INTERVAL_SECONDS)

    with state_lock:
        current_state["endpoints"] = initial_endpoints
        # Set initial status to PENDING for all configured endpoints
        current_state["statuses"] = {
            ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None}
            for ep in initial_endpoints if ep.get('id')
        }
        current_state["last_updated"] = 0
        current_state["check_interval"] = initial_interval


    # Run checks immediately once, then schedule
    run_checks()
    scheduler.add_job(run_checks, 'interval', seconds=initial_interval, id='endpoint_checks', replace_existing=True)
    # Start scheduler *after* adding job
    try:
        scheduler.start()
        print(f"Scheduler started with interval: {initial_interval} seconds.")
        # Shut down the scheduler when exiting the app
        atexit.register(lambda: scheduler.shutdown())
    except Exception as e:
         print(f"Error starting scheduler: {e}")


# Ensure initialization runs only once, even with Flask debug reloader
if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not app.debug:
     initialize()
elif app.debug and not os.environ.get("WERKZEUG_RUN_MAIN"):
     # This branch runs in the *parent* process during debug mode reload
     # It shouldn't start the scheduler here, the child process will.
     print("Flask Debugger detected. Scheduler will start in the reloaded process.")
     pass


if __name__ == '__main__':
    # Flask's `app.run()` handles starting the server.
    # The `initialize()` function handles starting the scheduler correctly.
    # Host/port are controlled by `flask run` args or ENV vars like before.
    # The debug setting controls whether Werkzeug's reloader is active.
    app.run(debug=os.environ.get('FLASK_ENV') == 'development')