import os
import json
import threading
import uuid
from copy import deepcopy

# Import central config path and defaults from state
from app.state import (CONFIG_PATH, DEFAULT_GLOBAL_SETTINGS, DEFAULT_CLIENT_SETTINGS,
                       DEFAULT_CLIENT_ID)

# Lock for file operations
config_file_lock = threading.Lock()

def load_config_from_file(config_path_arg=None):
    """Reads config from file, handles old format, returns data or raises error."""
    resolved_path = os.path.abspath(config_path_arg or CONFIG_PATH)
    print(f"Attempting to load config from: {resolved_path}")
    if not os.path.exists(resolved_path):
        print(f"WARN: Config file not found: {resolved_path}. Returning default structure.")
        # Return structure matching new state
        return {
            "global_settings": DEFAULT_GLOBAL_SETTINGS.copy(),
            "clients": {
                DEFAULT_CLIENT_ID: {
                    "settings": DEFAULT_CLIENT_SETTINGS.copy(),
                    "endpoints": []
                }
            }
        }

    with config_file_lock:
        try:
            with open(resolved_path, 'r') as f: config_data = json.load(f)

            # --- Gracefully handle old format (settings/endpoints at root) ---
            if "settings" in config_data and "endpoints" in config_data and "clients" not in config_data:
                print("WARN: Detected old config format. Migrating to new client structure.")
                old_settings = config_data.get("settings", {})
                old_endpoints = config_data.get("endpoints", [])

                new_config = {
                    "global_settings": {
                        "check_interval_seconds": old_settings.get("check_interval_seconds", DEFAULT_GLOBAL_SETTINGS['check_interval_seconds']),
                        "check_timeout_seconds": old_settings.get("check_timeout_seconds", DEFAULT_GLOBAL_SETTINGS['check_timeout_seconds'])
                    },
                    "clients": {
                        DEFAULT_CLIENT_ID: {
                            "settings": {
                                "name": DEFAULT_CLIENT_SETTINGS['name'],
                                # Move other potential old root settings here if needed
                                "disable_floating_elements": old_settings.get("disable_floating_elements", False)
                            },
                            "endpoints": old_endpoints # Assign old endpoints to default client
                        }
                    }
                }
                config_data = new_config
            # --- End old format handling ---

            # Ensure basic structure exists for new format
            if "global_settings" not in config_data:
                 config_data["global_settings"] = DEFAULT_GLOBAL_SETTINGS.copy()
            if "clients" not in config_data:
                 config_data["clients"] = {
                    DEFAULT_CLIENT_ID: { "settings": DEFAULT_CLIENT_SETTINGS.copy(), "endpoints": [] }
                 }
            # Ensure default client exists if clients block exists but default is missing
            elif DEFAULT_CLIENT_ID not in config_data["clients"]:
                 config_data["clients"][DEFAULT_CLIENT_ID] = {
                     "settings": DEFAULT_CLIENT_SETTINGS.copy(),
                     "endpoints": []
                 }

            # Ensure nested keys exist for all clients
            for client_id, client_data in config_data.get("clients", {}).items():
                if "settings" not in client_data: client_data["settings"] = DEFAULT_CLIENT_SETTINGS.copy()
                if "endpoints" not in client_data: client_data["endpoints"] = []

            return config_data

        except json.JSONDecodeError as e:
            print(f"ERROR: Invalid JSON in config file {resolved_path}: {e}")
            raise ValueError(f"Invalid JSON in config file: {e}") from e
        except Exception as e:
            print(f"ERROR: Unexpected error loading config from {resolved_path}: {e}")
            raise IOError(f"Failed to load config file: {e}") from e

def process_config_data(config_data):
    """Processes loaded config data (new structure), validates, sets defaults.
       Returns tuple: (global_settings, clients_data).
       clients_data format: { client_id: {"settings": {...}, "endpoints": [...] } }
    """
    processed_clients = {}
    global_settings = {}
    try:
        loaded_global_settings = config_data.get("global_settings", {})
        global_settings['check_interval_seconds'] = max(5, loaded_global_settings.get("check_interval_seconds", DEFAULT_GLOBAL_SETTINGS['check_interval_seconds']))
        global_settings['check_timeout_seconds'] = max(1, loaded_global_settings.get("check_timeout_seconds", DEFAULT_GLOBAL_SETTINGS['check_timeout_seconds']))
        # 'disable_floating_elements' is now client-specific

        loaded_clients_data = config_data.get("clients", {})
        if not loaded_clients_data: # Ensure at least default client exists
            loaded_clients_data[DEFAULT_CLIENT_ID] = {"settings": DEFAULT_CLIENT_SETTINGS.copy(), "endpoints": []}

        for client_id, client_data in loaded_clients_data.items():
            client_settings = client_data.get("settings", DEFAULT_CLIENT_SETTINGS.copy())
            # Validate/default client settings here (e.g., name, disable_floating_elements)
            client_settings['name'] = client_settings.get('name', f"Client {client_id}")
            client_settings['disable_floating_elements'] = client_settings.get('disable_floating_elements', False)

            processed_endpoints = []
            raw_endpoints = client_data.get("endpoints", [])
            seen_ids = set() # Track IDs within this client

            for i, ep in enumerate(raw_endpoints):
                ep_id = ep.get('id')
                name = ep.get('name')
                url = ep.get('url')

                if not name or not url:
                    print(f"WARN: Client '{client_id}': Skipping endpoint index {i} missing name/url.")
                    continue

                # Ensure unique ID within the client (or generate one)
                if not ep_id or ep_id in seen_ids:
                    new_ep_id = f"ep_{uuid.uuid4().hex[:8]}"
                    print(f"WARN: Client '{client_id}': Endpoint '{name}' missing ID or ID '{ep_id}' duplicate. Generated new ID: {new_ep_id}")
                    ep_id = new_ep_id
                    ep['id'] = ep_id # Update dict if we generated ID
                seen_ids.add(ep_id)

                group = ep.get('group', 'Default Group') or 'Default Group'
                interval_str = ep.get('check_interval_seconds')
                timeout_str = ep.get('check_timeout_seconds')

                interval = None
                if interval_str is not None:
                    try:
                        interval = max(5, int(interval_str))
                    except (ValueError, TypeError):
                        interval = None # Use global if invalid

                timeout = None
                if timeout_str is not None:
                    try:
                        timeout = max(1, int(timeout_str))
                    except (ValueError, TypeError):
                        timeout = None # Use global if invalid

                cleaned_ep = {'id': ep_id, 'name': name, 'url': url, 'group': group}
                # Only add overrides if they are valid and provided
                if interval is not None:
                    cleaned_ep['check_interval_seconds'] = interval
                if timeout is not None:
                    cleaned_ep['check_timeout_seconds'] = timeout

                processed_endpoints.append(cleaned_ep)

            processed_clients[client_id] = {
                "settings": client_settings,
                "endpoints": processed_endpoints
            }
            print(f"Client '{client_id}' processed: {len(processed_endpoints)} endpoints.")

        print(f"Config processed. Global Interval={global_settings['check_interval_seconds']}s, Timeout={global_settings['check_timeout_seconds']}s.")
        return global_settings, processed_clients

    except Exception as e:
        print(f"ERROR processing config data: {e}. Returning defaults.")
        # Return default structure matching new state
        default_clients_data = {
             DEFAULT_CLIENT_ID: {"settings": DEFAULT_CLIENT_SETTINGS.copy(), "endpoints": []}
        }
        return DEFAULT_GLOBAL_SETTINGS.copy(), default_clients_data


def load_initial_config(config_path, current_state_ref, state_lock_ref):
    """Loads config on startup, processes it, and updates global state directly."""
    print("DEBUG: load_initial_config called.") # Added log
    try:
        config_data = load_config_from_file(config_path)
        global_settings, clients_data = process_config_data(config_data)

        with state_lock_ref:
            # Clear existing clients before loading new ones
            current_state_ref["clients"] = {}
            current_state_ref["global_settings"] = global_settings

            for client_id, client_info in clients_data.items():
                 # Ensure statuses key exists for each client being loaded
                 client_info["statuses"] = {ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None}
                                           for ep in client_info.get("endpoints", []) if ep.get('id')}
                 current_state_ref["clients"][client_id] = client_info # Load processed data

            # Set scheduler interval based on global settings
            current_state_ref["scheduler_interval"] = global_settings.get("check_interval_seconds", DEFAULT_GLOBAL_SETTINGS['check_interval_seconds'])
            current_state_ref["last_updated"] = 0
            print(f"DEBUG: Initial config loaded into state. Clients: {list(current_state_ref['clients'].keys())}")

    except Exception as e:
        print(f"ERROR during initial config load/process: {e}. Starting empty.")
        with state_lock_ref:
            # Reset state to defaults in case of error
            current_state_ref["global_settings"] = DEFAULT_GLOBAL_SETTINGS.copy()
            current_state_ref["clients"] = {
                DEFAULT_CLIENT_ID: {
                    "settings": DEFAULT_CLIENT_SETTINGS.copy(),
                    "endpoints": [],
                    "statuses": {}
                }
            }
            current_state_ref["scheduler_interval"] = DEFAULT_GLOBAL_SETTINGS['check_interval_seconds']
            current_state_ref["last_updated"] = 0

def save_config_to_file(config_path, global_settings, clients_data):
    """Saves the provided global settings and clients data (including endpoints) to config.json."""
    resolved_path = os.path.abspath(config_path)
    print(f"Attempting to save config to: {resolved_path}")

    # Prepare data in the new format, removing statuses
    config_to_save = {
        "global_settings": global_settings,
        "clients": {}
    }
    for client_id, client_info in clients_data.items():
        # Create a deep copy and remove 'statuses' before saving
        client_copy = deepcopy(client_info)
        client_copy.pop('statuses', None) # Remove statuses before saving
        config_to_save["clients"][client_id] = client_copy

    with config_file_lock:
        try:
            temp_path = resolved_path + ".tmp"
            with open(temp_path, 'w') as f: json.dump(config_to_save, f, indent=4)
            os.replace(temp_path, resolved_path)
            print(f"Config successfully saved to {resolved_path}")
            return True
        except Exception as e:
            print(f"ERROR saving config to {resolved_path}: {e}")
            if os.path.exists(temp_path):
                try: os.remove(temp_path)
                except Exception as rm_e: print(f"Error removing temp config file: {rm_e}")
            return False