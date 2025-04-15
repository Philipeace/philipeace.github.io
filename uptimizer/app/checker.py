import time
import requests
import threading
from datetime import datetime, timedelta, timezone

# Use absolute imports
try:
    from app.database import save_status_change
    # No need to import DB flags here; database.py handles checks
except ImportError as e:
    print(f"Checker Import ERROR: {e}. DB ops disabled.")
    def save_status_change(*args): print("Checker WARN: save_status_change STUB")

# Import defaults from state module
from app.state import DEFAULT_CHECK_INTERVAL, DEFAULT_CHECK_TIMEOUT # Keep these

def check_endpoint(endpoint, global_settings):
    """Performs a basic HTTP GET check on a single endpoint."""
    url = endpoint.get('url');
    if not url: return {"status": "ERROR", "details": "Missing URL"}

    # Use global timeout from global_settings
    global_timeout = int(global_settings.get('check_timeout_seconds', DEFAULT_CHECK_TIMEOUT))

    # Check for per-endpoint timeout override
    endpoint_timeout_str = endpoint.get('check_timeout_seconds')
    try:
        # Use endpoint timeout if valid, otherwise global
        timeout = int(endpoint_timeout_str) if endpoint_timeout_str is not None else global_timeout
        timeout = max(1, timeout) # Ensure timeout is at least 1
    except (ValueError, TypeError):
        timeout = global_timeout # Fallback to global on invalid format

    start_time = time.time(); headers = {'User-Agent': 'Uptimizer/1.13.0'}; details_msg = None # Updated User-Agent
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


def run_checks_task(current_state, state_lock):
    """Background task logic: determines which endpoints to check, runs checks, updates state."""
    print(f"BG Task: Cycle Start @ {time.strftime('%Y-%m-%d %H:%M:%S')}")
    endpoints_to_check_now = []
    new_statuses_this_cycle = {} # Store statuses per client: { client_id: { endpoint_id: {...} } }
    now = time.time()

    # Access shared state under lock only when needed
    with state_lock:
        # Deep copy relevant parts of state to avoid holding lock during checks
        global_settings = current_state.get("global_settings", {}).copy()
        clients_snapshot = {
            client_id: {
                "endpoints": list(client_data.get("endpoints", [])),
                "statuses": client_data.get("statuses", {}).copy()
            }
            for client_id, client_data in current_state.get("clients", {}).items()
        }
        global_interval = int(global_settings.get("check_interval_seconds", DEFAULT_CHECK_INTERVAL))

    if not any(client.get("endpoints") for client in clients_snapshot.values()):
        print("BG Task: No endpoints configured across all clients.")
        return

    # Determine which endpoints are due across all clients
    endpoints_checked_count = 0
    for client_id, client_data in clients_snapshot.items():
        endpoints_list = client_data.get("endpoints", [])
        last_check_statuses_snapshot = client_data.get("statuses", {})
        new_statuses_this_cycle[client_id] = {} # Init status dict for this client

        for ep in endpoints_list:
            ep_id = ep.get('id')
            if not ep_id: continue

            # Use global interval from global_settings
            # Check for per-endpoint interval override
            endpoint_interval_str = ep.get('check_interval_seconds')
            try:
                 # Use endpoint interval if valid, otherwise global
                check_interval = int(endpoint_interval_str) if endpoint_interval_str is not None else global_interval
                check_interval = max(5, check_interval) # Ensure interval is at least 5s
            except (ValueError, TypeError):
                check_interval = global_interval # Fallback to global on invalid format

            last_check_ts = last_check_statuses_snapshot.get(ep_id, {}).get("last_check_ts", 0)
            if (now - last_check_ts) >= check_interval:
                # Add client_id to endpoint data for check_endpoint if needed later,
                # or pass it to save_status_change
                endpoints_to_check_now.append({**ep, "client_id": client_id}) # Add client ID context

    if not endpoints_to_check_now:
        print("BG Task: No endpoints due this cycle.")
        return

    print(f"BG Task: Checking {len(endpoints_to_check_now)} endpoints now...")
    start_check_cycle = time.time()
    for ep_with_context in endpoints_to_check_now:
        ep_id = ep_with_context.get('id')
        client_id = ep_with_context.get('client_id')
        if not client_id: continue # Should not happen

        check_result = check_endpoint(ep_with_context, global_settings) # Pass global_settings
        # Store result under the correct client
        new_statuses_this_cycle[client_id][ep_id] = {
            "status": check_result.get("status", "UNKNOWN"),
            "last_check_ts": now,
            "details": check_result # Store full result including potential response_time etc.
        }
        endpoints_checked_count += 1

        # DB save call remains, relies on save_status_change internal check
        try:
             # Pass endpoint_id only, save_status_change doesn't need client context
             save_status_change(ep_id, check_result)
        except Exception as db_err:
             print(f"E: DB save error for {client_id}/{ep_id}: {db_err}")

    cycle_duration = time.time() - start_check_cycle
    print(f"BG Task: Checked {endpoints_checked_count} endpoints in {cycle_duration:.2f}s.")
    if cycle_duration > global_interval:
        print(f"BG Task: WARNING - Check cycle duration ({cycle_duration:.2f}s) exceeded SCHEDULER interval ({global_interval}s).")

    # Update statuses in shared state under lock
    with state_lock:
        for client_id, client_statuses in new_statuses_this_cycle.items():
            if client_id in current_state["clients"]:
                 # Update statuses for the specific client
                 current_state["clients"][client_id]["statuses"].update(client_statuses)
            else:
                 print(f"WARN: Client '{client_id}' not found in state during status update.")
        current_state["last_updated"] = now
    print(f"BG Task: Updated memory status for {endpoints_checked_count} checked endpoints across {len(new_statuses_this_cycle)} clients.")