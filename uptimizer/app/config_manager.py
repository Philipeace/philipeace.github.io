import os
import json
import threading
import uuid

# Import central config path and defaults from state
from app.state import CONFIG_PATH, DEFAULT_CHECK_INTERVAL, DEFAULT_CHECK_TIMEOUT, DEFAULT_SETTINGS

# Lock for file operations
config_file_lock = threading.Lock()

def load_config_from_file(config_path_arg=None):
    """Reads config from file, returns data or raises error."""
    resolved_path = os.path.abspath(config_path_arg or CONFIG_PATH)
    print(f"Attempting to load config from: {resolved_path}")
    if not os.path.exists(resolved_path):
        print(f"WARN: Config file not found: {resolved_path}. Returning default structure.")
        return {"settings": DEFAULT_SETTINGS.copy(), "endpoints": []}
    with config_file_lock:
        try:
            with open(resolved_path, 'r') as f: config_data = json.load(f)
            if "settings" not in config_data: config_data["settings"] = {}
            if "endpoints" not in config_data: config_data["endpoints"] = []
            return config_data
        except json.JSONDecodeError as e:
            print(f"ERROR: Invalid JSON in config file {resolved_path}: {e}")
            raise ValueError(f"Invalid JSON in config file: {e}") from e
        except Exception as e:
            print(f"ERROR: Unexpected error loading config from {resolved_path}: {e}")
            raise IOError(f"Failed to load config file: {e}") from e

def process_config_data(config_data):
    """Processes loaded config data, validates, sets defaults. Returns tuple: (settings, endpoints)."""
    processed_endpoints = []
    settings = {}
    try:
        loaded_settings = config_data.get("settings", {})
        settings['check_interval_seconds'] = max(5, loaded_settings.get("check_interval_seconds", DEFAULT_CHECK_INTERVAL))
        settings['check_timeout_seconds'] = max(1, loaded_settings.get("check_timeout_seconds", DEFAULT_CHECK_TIMEOUT))
        settings['disable_floating_elements'] = loaded_settings.get("disable_floating_elements", False)

        raw_endpoints = config_data.get("endpoints", [])
        seen_ids = set()
        for i, ep in enumerate(raw_endpoints):
            ep_id = ep.get('id'); name = ep.get('name'); url = ep.get('url')
            if not name or not url: print(f"WARN: Skipping endpoint index {i} missing name/url."); continue
            if not ep_id or ep_id in seen_ids: ep_id = f"loaded_{uuid.uuid4().hex[:8]}"; ep['id'] = ep_id; print(f"W: Generated unique ID '{ep_id}' for loaded '{name}'")
            seen_ids.add(ep_id); group = ep.get('group', 'Default Group') or 'Default Group'
            interval = ep.get('check_interval_seconds'); timeout = ep.get('check_timeout_seconds')
            # *** Corrected Indentation Applied ***
            if interval is not None:
                try:
                    interval = max(5, int(interval))
                except (ValueError, TypeError):
                    interval = None
            if timeout is not None:
                try:
                    timeout = max(1, int(timeout))
                except (ValueError, TypeError):
                    timeout = None

            cleaned_ep = {'id': ep_id, 'name': name, 'url': url, 'group': group}
            if interval is not None: cleaned_ep['check_interval_seconds'] = interval
            if timeout is not None: cleaned_ep['check_timeout_seconds'] = timeout
            processed_endpoints.append(cleaned_ep)

        print(f"Config processed. Global Interval={settings['check_interval_seconds']}s. {len(processed_endpoints)} endpoints processed.")
        return settings, processed_endpoints
    except Exception as e:
        print(f"ERROR processing config data: {e}. Returning defaults.")
        return DEFAULT_SETTINGS.copy(), []


def load_initial_config(config_path, current_state_ref, state_lock_ref):
    """Loads config on startup, processes it, and updates global state directly."""
    try:
        config_data = load_config_from_file(config_path)
        settings, initial_endpoints = process_config_data(config_data)
        with state_lock_ref:
            current_state_ref["settings"] = settings
            current_state_ref["endpoints"] = initial_endpoints
            current_state_ref["check_interval"] = settings.get("check_interval_seconds", DEFAULT_CHECK_INTERVAL)
            current_state_ref["statuses"] = {ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None} for ep in initial_endpoints if ep.get('id')}
            current_state_ref["last_updated"] = 0
    except Exception as e:
        print(f"ERROR during initial config load/process: {e}. Starting empty.")
        with state_lock_ref:
            current_state_ref["endpoints"] = []; current_state_ref["settings"] = DEFAULT_SETTINGS.copy(); current_state_ref["check_interval"] = DEFAULT_CHECK_INTERVAL; current_state_ref["statuses"] = {}


def save_config_to_file(config_path, settings, endpoints):
    """Saves the provided settings and endpoints to config.json."""
    resolved_path = os.path.abspath(config_path)
    print(f"Attempting to save config to: {resolved_path}")
    config_data = {"settings": settings, "endpoints": endpoints}
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