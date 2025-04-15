import time
import requests
import threading
from datetime import datetime, timedelta, timezone

# Use absolute imports
try:
    from app.database import save_status_change
    # --- REMOVED Import of DB_ENABLED and DB_TABLES_CREATED ---
    # from app.models import DB_ENABLED, DB_TABLES_CREATED
except ImportError as e:
    print(f"Checker Import ERROR: {e}. DB ops disabled.")
    # DB_ENABLED = False # No longer needed here
    # DB_TABLES_CREATED = False # No longer needed here
    def save_status_change(*args): print("Checker WARN: save_status_change STUB")

# Import defaults from state module
from app.state import DEFAULT_CHECK_INTERVAL, DEFAULT_CHECK_TIMEOUT


def check_endpoint(endpoint, global_settings):
    """Performs a basic HTTP GET check on a single endpoint."""
    url = endpoint.get('url');
    if not url: return {"status": "ERROR", "details": "Missing URL"}

    global_timeout = int(global_settings.get('check_timeout_seconds', DEFAULT_CHECK_TIMEOUT))
    endpoint_timeout_str = endpoint.get('check_timeout_seconds')
    try:
        timeout = int(endpoint_timeout_str) if endpoint_timeout_str is not None else global_timeout
        timeout = max(1, timeout)
    except (ValueError, TypeError): timeout = global_timeout

    start_time = time.time(); headers = {'User-Agent': 'Uptimizer/1.13.5'}; details_msg = None
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
    endpoints_to_check_now = []; now = time.time(); new_statuses_this_cycle = {}

    # Access shared state under lock only when needed
    with state_lock:
        endpoints_list = list(current_state.get("endpoints", []))
        global_settings = current_state.get("settings", {})
        global_interval = int(global_settings.get("check_interval_seconds", DEFAULT_CHECK_INTERVAL))
        last_check_statuses_snapshot = current_state.get("statuses", {}).copy()

    if not endpoints_list: print("BG Task: No endpoints configured."); return

    # Determine which endpoints are due
    for ep in endpoints_list:
        ep_id = ep.get('id');
        if not ep_id: continue
        endpoint_interval_str = ep.get('check_interval_seconds')
        try: check_interval = int(endpoint_interval_str) if endpoint_interval_str is not None else global_interval; check_interval = max(5, check_interval)
        except (ValueError, TypeError): check_interval = global_interval
        last_check_ts = last_check_statuses_snapshot.get(ep_id, {}).get("last_check_ts", 0)
        if (now - last_check_ts) >= check_interval: endpoints_to_check_now.append(ep)

    if not endpoints_to_check_now: print("BG Task: No endpoints due this cycle."); return

    print(f"BG Task: Checking {len(endpoints_to_check_now)} endpoints now...")
    start_check_cycle = time.time()
    for ep in endpoints_to_check_now:
        ep_id = ep.get('id')
        check_result = check_endpoint(ep, global_settings)
        new_statuses_this_cycle[ep_id] = {"status": check_result.get("status", "UNKNOWN"), "last_check_ts": now, "details": check_result}
        # --- DB save call remains, relies on save_status_change internal check ---
        try:
             save_status_change(ep_id, check_result)
        except Exception as db_err:
             print(f"E: DB save error for {ep_id}: {db_err}")
        # ---------------------------------------------------------------------
    cycle_duration = time.time() - start_check_cycle
    print(f"BG Task: Checked {len(endpoints_to_check_now)} endpoints in {cycle_duration:.2f}s.")
    if cycle_duration > global_interval: print(f"BG Task: WARNING - Check cycle duration ({cycle_duration:.2f}s) exceeded SCHEDULER interval ({global_interval}s).")

    # Update statuses in shared state under lock
    with state_lock:
        current_state["statuses"].update(new_statuses_this_cycle)
        current_state["last_updated"] = now
    print(f"BG Task: Updated memory status for {len(new_statuses_this_cycle)} checked endpoints.")