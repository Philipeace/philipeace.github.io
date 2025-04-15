import time
import requests
import threading
from datetime import datetime, timedelta, timezone
import json # For parsing remote client responses
from flask import current_app # To access logger

# Use absolute imports
try:
    from app.database import save_status_change
    # No need to import DB flags here; database.py handles checks
except ImportError as e:
    print(f"Checker Import ERROR: {e}. DB ops disabled.")
    def save_status_change(*args): print("Checker WARN: save_status_change STUB")

# Import defaults and state objects
from app.state import current_state, state_lock, DEFAULT_CHECK_INTERVAL, DEFAULT_CHECK_TIMEOUT

# --- Endpoint Check Functions ---

def check_http_endpoint(endpoint, global_settings):
    """Performs a basic HTTP GET check on a single *local* endpoint."""
    url = endpoint.get('url')
    if not url: return {"status": "ERROR", "details": "Missing URL"}

    global_timeout = int(global_settings.get('check_timeout_seconds', DEFAULT_CHECK_TIMEOUT))
    endpoint_timeout_str = endpoint.get('check_timeout_seconds')
    try:
        timeout = int(endpoint_timeout_str) if endpoint_timeout_str is not None else global_timeout
        timeout = max(1, timeout)
    except (ValueError, TypeError):
        timeout = global_timeout

    start_time = time.time()
    headers = {'User-Agent': 'UptimizerChecker/1.15.0'} # Updated User-Agent
    details_msg = None
    status_code = None
    response_time_ms = None
    status = "UNKNOWN"

    try:
        response = requests.get(url, timeout=timeout, headers=headers, allow_redirects=True)
        response_time_ms = round((time.time() - start_time) * 1000)
        status_code = response.status_code
        status = "UP" if 200 <= response.status_code < 400 else "DOWN"
        if status == "DOWN": details_msg = f"HTTP {response.status_code}"
    except requests.exceptions.Timeout: details_msg = f"Timeout >{timeout}s"; status="DOWN"
    except requests.exceptions.TooManyRedirects: details_msg = "Too many redirects"; status="DOWN"
    except requests.exceptions.ConnectionError: details_msg = "Connection error"; status="DOWN"
    except requests.exceptions.RequestException as e: details_msg = str(e)[:200] + ("..." if len(str(e)) > 200 else ""); status="DOWN"
    except Exception as e:
        current_app.logger.error(f"Check error for {url}: {e}", exc_info=True)
        details_msg = "Check error"; status="ERROR"

    return {
        "status": status,
        "status_code": status_code,
        "response_time_ms": response_time_ms,
        "details": details_msg
    }

def fetch_remote_client_status(client_config, global_settings):
    """Fetches status data from a remote Uptimizer client API."""
    remote_url = client_config.get('remote_url')
    api_token = client_config.get('api_token') # The raw token needed for the request
    client_id_on_remote = client_config.get('id') # The client ID *on the remote* instance

    if not remote_url or not api_token or not client_id_on_remote:
        current_app.logger.error(f"Linked client check skipped: Missing remote_url, api_token, or client_id for local client '{client_config.get('id')}' config.")
        # Return a structure indicating an error for all endpoints *of this client*
        return {"error": "Configuration incomplete"}

    # Construct the specific API endpoint URL
    # Ensure no double slashes if remote_url already has one
    api_endpoint = f"{remote_url.rstrip('/')}/api/v1/client/{client_id_on_remote}/status"

    headers = {
        'Authorization': f'Bearer {api_token}',
        'User-Agent': 'UptimizerLinkChecker/1.15.0'
    }
    # Use global timeout for fetching remote status
    timeout = int(global_settings.get('check_timeout_seconds', DEFAULT_CHECK_TIMEOUT))
    timeout = max(5, timeout) # Give remote checks a bit more time

    start_time = time.time()
    try:
        response = requests.get(api_endpoint, headers=headers, timeout=timeout)
        response_time = time.time() - start_time
        response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)

        # Expecting JSON like: { "statuses": { "endpoint_id1": {...}, "endpoint_id2": {...} }, "last_updated": ... }
        remote_data = response.json()
        remote_statuses = remote_data.get('statuses')

        if not isinstance(remote_statuses, dict):
             current_app.logger.warning(f"Linked client check for {client_id_on_remote}@{remote_url}: Invalid 'statuses' format received.")
             return {"error": "Invalid remote data format"}

        current_app.logger.info(f"Successfully fetched status for {len(remote_statuses)} endpoints from linked client {client_id_on_remote}@{remote_url} in {response_time:.2f}s.")

        # Return the dictionary of endpoint statuses from the remote client
        return remote_statuses

    except requests.exceptions.Timeout:
        current_app.logger.warning(f"Linked client check for {client_id_on_remote}@{remote_url}: Timeout after {timeout}s.")
        return {"error": f"Timeout >{timeout}s"}
    except requests.exceptions.ConnectionError:
        current_app.logger.warning(f"Linked client check for {client_id_on_remote}@{remote_url}: Connection error.")
        return {"error": "Connection error"}
    except requests.exceptions.HTTPError as e:
        err_msg = f"HTTP {e.response.status_code}"
        try: # Try to get more details from response body
            err_detail = e.response.json().get('error', '')
            if err_detail: err_msg += f": {err_detail}"
        except json.JSONDecodeError: pass # Ignore if response is not JSON
        current_app.logger.warning(f"Linked client check for {client_id_on_remote}@{remote_url}: {err_msg}")
        return {"error": err_msg}
    except requests.exceptions.RequestException as e:
        err_msg = str(e)[:200] + ("..." if len(str(e)) > 200 else "")
        current_app.logger.warning(f"Linked client check for {client_id_on_remote}@{remote_url}: Request error - {err_msg}")
        return {"error": "Request error"}
    except json.JSONDecodeError:
        current_app.logger.warning(f"Linked client check for {client_id_on_remote}@{remote_url}: Could not decode JSON response.")
        return {"error": "Invalid JSON response"}
    except Exception as e:
        current_app.logger.error(f"Unexpected error fetching linked client status ({client_id_on_remote}@{remote_url}): {e}", exc_info=True)
        return {"error": "Unexpected fetch error"}


# --- Main Background Task ---

def run_checks_task(current_state_ref, state_lock_ref):
    """Background task logic: runs checks for local endpoints and fetches status for linked clients."""
    current_app.logger.info(f"BG Task: Cycle Start @ {time.strftime('%Y-%m-%d %H:%M:%S')}")
    endpoints_to_check_now = []
    clients_to_fetch_now = []
    results_this_cycle = {} # Store results per client: { client_id: { endpoint_id: {...} } or {"error": ...} }
    now = time.time()
    start_cycle_time = time.time()

    # Access shared state under lock only when needed
    with state_lock_ref:
        # Deep copy relevant parts of state to avoid holding lock during checks/fetches
        global_settings = current_state_ref.get("global_settings", {}).copy()
        # Snapshot client configurations and last check times
        clients_snapshot = {}
        for client_id, client_data in current_state_ref.get("clients", {}).items():
             clients_snapshot[client_id] = {
                 "id": client_id, # Add client_id for remote fetch context
                 "type": client_data.get("settings", {}).get("client_type", "local"),
                 "endpoints": list(client_data.get("endpoints", [])), # For local checks
                 "statuses": client_data.get("statuses", {}).copy(), # For last check times
                 "remote_url": client_data.get("settings", {}).get("remote_url"), # For remote fetch
                 "api_token": client_data.get("settings", {}).get("api_token") # For remote fetch
             }
        global_interval = int(global_settings.get("check_interval_seconds", DEFAULT_CHECK_INTERVAL))

    if not clients_snapshot:
        current_app.logger.info("BG Task: No clients configured.")
        return

    # Determine which local endpoints and remote clients are due
    local_endpoints_due_count = 0
    remote_clients_due_count = 0

    for client_id, client_config in clients_snapshot.items():
        results_this_cycle[client_id] = {} # Init results dict for this client
        client_type = client_config.get("type", "local")
        last_check_statuses = client_config.get("statuses", {})

        if client_type == "local":
            endpoints_list = client_config.get("endpoints", [])
            if not endpoints_list: continue

            for ep in endpoints_list:
                ep_id = ep.get('id')
                if not ep_id: continue

                endpoint_interval_str = ep.get('check_interval_seconds')
                try:
                    check_interval = int(endpoint_interval_str) if endpoint_interval_str is not None else global_interval
                    check_interval = max(5, check_interval)
                except (ValueError, TypeError):
                    check_interval = global_interval

                last_check_ts = last_check_statuses.get(ep_id, {}).get("last_check_ts", 0)
                if (now - last_check_ts) >= check_interval:
                    endpoints_to_check_now.append({**ep, "client_id": client_id}) # Add client ID context
                    local_endpoints_due_count += 1

        elif client_type == "linked":
            # Check interval for linked clients is based on the *global* interval for simplicity
            # Or could add a 'fetch_interval_seconds' to client settings later
            fetch_interval = global_interval
            # Use the last update time of *any* endpoint within the client as the check time
            last_fetch_ts = 0
            if last_check_statuses:
                 # Find the latest timestamp among all endpoints for this client
                 last_fetch_ts = max(ep_status.get("last_check_ts", 0) for ep_status in last_check_statuses.values())

            if (now - last_fetch_ts) >= fetch_interval:
                clients_to_fetch_now.append(client_config)
                remote_clients_due_count += 1
        else:
             current_app.logger.warning(f"BG Task: Unknown client type '{client_type}' for client '{client_id}'. Skipping.")


    if not endpoints_to_check_now and not clients_to_fetch_now:
        current_app.logger.info("BG Task: No local endpoints or linked clients due this cycle.")
        return

    current_app.logger.info(f"BG Task: Checking {local_endpoints_due_count} local endpoints and fetching {remote_clients_due_count} linked clients.")

    # --- Perform Checks and Fetches ---
    checked_count = 0
    fetched_count = 0

    # 1. Check local endpoints
    for ep_with_context in endpoints_to_check_now:
        ep_id = ep_with_context.get('id')
        client_id = ep_with_context.get('client_id')
        if not ep_id or not client_id: continue

        check_result = check_http_endpoint(ep_with_context, global_settings)
        # Store result under the correct client and endpoint ID
        if client_id not in results_this_cycle: results_this_cycle[client_id] = {} # Should exist, but safety check
        results_this_cycle[client_id][ep_id] = {
            **check_result, # Spread the check result (status, details, code, time)
            "last_check_ts": now,
        }
        checked_count += 1

        # --- Save to Database ---
        # Only save results from direct checks, not aggregated remote results
        try:
             # Pass endpoint_id only, save_status_change doesn't need client context
             save_status_change(ep_id, check_result)
        except Exception as db_err:
             current_app.logger.error(f"DB save error for local endpoint {client_id}/{ep_id}: {db_err}", exc_info=True)
        # ----------------------


    # 2. Fetch remote client statuses
    for client_config in clients_to_fetch_now:
        client_id = client_config.get('id')
        if not client_id: continue

        fetch_result = fetch_remote_client_status(client_config, global_settings)

        if isinstance(fetch_result, dict) and "error" in fetch_result:
             # Store the error globally for this client fetch attempt
             results_this_cycle[client_id] = {"error": fetch_result["error"], "last_check_ts": now}
             current_app.logger.warning(f"Failed to fetch status for linked client '{client_id}': {fetch_result['error']}")
        elif isinstance(fetch_result, dict):
             # Success! Store the fetched statuses. Timestamps should come from remote.
             # Overwrite the entire client's results with the fetched data
             # Add our current timestamp to indicate when *we* fetched it
             results_this_cycle[client_id] = {
                 ep_id: {**status_data, "last_check_ts": now}
                 for ep_id, status_data in fetch_result.items()
             }
             fetched_count += 1
             # DO NOT save these fetched statuses to the local DB history.
        else:
            # Handle unexpected fetch_result format
            error_msg = "Unknown error or invalid format during fetch"
            results_this_cycle[client_id] = {"error": error_msg, "last_check_ts": now}
            current_app.logger.error(f"BG Task: Unexpected fetch result format for linked client '{client_id}'. Result: {fetch_result}")


    cycle_duration = time.time() - start_cycle_time
    current_app.logger.info(f"BG Task: Checked {checked_count} local endpoints, Fetched {fetched_count} linked clients in {cycle_duration:.2f}s.")
    if cycle_duration > global_interval:
        current_app.logger.warning(f"BG Task: WARNING - Check cycle duration ({cycle_duration:.2f}s) exceeded SCHEDULER interval ({global_interval}s). Consider increasing interval or optimizing checks.")

    # --- Update State ---
    updates_applied = 0
    with state_lock_ref:
        for client_id, client_results in results_this_cycle.items():
            if client_id in current_state_ref["clients"]:
                 # Ensure statuses dict exists
                 if "statuses" not in current_state_ref["clients"][client_id]:
                     current_state_ref["clients"][client_id]["statuses"] = {}

                 if "error" in client_results:
                     # If the fetch failed, update all existing endpoints for this client with an error status
                     # This provides feedback in the UI that the link is broken
                     error_status = {
                         "status": "ERROR",
                         "details": f"Link Error: {client_results['error']}",
                         "last_check_ts": client_results.get("last_check_ts", now)
                     }
                     # We need the list of expected endpoints for this client from the config snapshot
                     expected_endpoints = clients_snapshot.get(client_id, {}).get('endpoints', [])
                     for ep in expected_endpoints:
                          ep_id = ep.get('id')
                          if ep_id:
                              current_state_ref["clients"][client_id]["statuses"][ep_id] = error_status
                              updates_applied += 1
                 elif isinstance(client_results, dict):
                      # For successful local checks or remote fetches, update statuses
                      current_state_ref["clients"][client_id]["statuses"].update(client_results)
                      updates_applied += len(client_results) # Count individual endpoint updates
                 # Else: do nothing if format is weird (already logged error)

            else:
                 current_app.logger.warning(f"BG Task: Client '{client_id}' not found in state during status update (might have been deleted?).")
        current_state_ref["last_updated"] = now
    current_app.logger.info(f"BG Task: Updated memory status for {updates_applied} total endpoint entries across {len(results_this_cycle)} clients processed.")