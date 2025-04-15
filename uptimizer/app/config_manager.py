import os
import json
import threading
import uuid
from copy import deepcopy
from flask import current_app # For logging

# Import central config path and defaults from state
from app.state import (CONFIG_PATH, DEFAULT_GLOBAL_SETTINGS, DEFAULT_CLIENT_SETTINGS,
                       DEFAULT_CLIENT_ID)

# Lock for file operations
config_file_lock = threading.Lock()

def load_config_from_file(config_path_arg=None):
    """Reads config from file, handles old format, ensures structure, returns data or raises error."""
    resolved_path = os.path.abspath(config_path_arg or CONFIG_PATH)
    current_app.logger.info(f"Attempting to load config from: {resolved_path}")
    if not os.path.exists(resolved_path):
        current_app.logger.warning(f"Config file not found: {resolved_path}. Returning default structure.")
        # Return structure matching new state, including default client settings
        return {
            "global_settings": DEFAULT_GLOBAL_SETTINGS.copy(),
            "clients": {
                DEFAULT_CLIENT_ID: {
                    "settings": DEFAULT_CLIENT_SETTINGS.copy(), # Use full default settings
                    "endpoints": []
                }
            }
        }

    with config_file_lock:
        try:
            with open(resolved_path, 'r') as f: config_data = json.load(f)

            # --- Gracefully handle old format (settings/endpoints at root) ---
            if "settings" in config_data and "endpoints" in config_data and "clients" not in config_data:
                current_app.logger.warning("Detected old config format. Migrating to new client structure.")
                old_settings = config_data.get("settings", {})
                old_endpoints = config_data.get("endpoints", [])

                # Create new structure
                new_config = {
                    "global_settings": {
                        "check_interval_seconds": old_settings.get("check_interval_seconds", DEFAULT_GLOBAL_SETTINGS['check_interval_seconds']),
                        "check_timeout_seconds": old_settings.get("check_timeout_seconds", DEFAULT_GLOBAL_SETTINGS['check_timeout_seconds'])
                    },
                    "clients": {
                        DEFAULT_CLIENT_ID: {
                            "settings": { # Populate default client settings from old global/defaults
                                "name": old_settings.get('name', DEFAULT_CLIENT_SETTINGS['name']), # Use old name if exists
                                "client_type": "local", # Assume old format is local
                                "disable_floating_elements": old_settings.get("disable_floating_elements", DEFAULT_CLIENT_SETTINGS['disable_floating_elements']),
                                "api_token": None, # Old format didn't have tokens
                                "remote_url": None,
                                "api_enabled": False # Explicitly disable API exposure
                            },
                            "endpoints": old_endpoints # Assign old endpoints
                        }
                    }
                }
                config_data = new_config
                current_app.logger.info("Old config format migrated.")
            # --- End old format handling ---

            # --- Ensure basic structure and default client exist for new format ---
            if "global_settings" not in config_data:
                 config_data["global_settings"] = DEFAULT_GLOBAL_SETTINGS.copy()
                 current_app.logger.warning("Config loaded: 'global_settings' key missing, added defaults.")
            if "clients" not in config_data:
                 config_data["clients"] = {
                    DEFAULT_CLIENT_ID: { "settings": DEFAULT_CLIENT_SETTINGS.copy(), "endpoints": [] }
                 }
                 current_app.logger.warning("Config loaded: 'clients' key missing, added default client structure.")
            elif DEFAULT_CLIENT_ID not in config_data["clients"]:
                 config_data["clients"][DEFAULT_CLIENT_ID] = {
                     "settings": DEFAULT_CLIENT_SETTINGS.copy(),
                     "endpoints": []
                 }
                 current_app.logger.warning(f"Config loaded: Default client '{DEFAULT_CLIENT_ID}' missing, added default structure.")

            # --- Ensure nested keys and default settings exist for all clients ---
            for client_id, client_data in config_data.get("clients", {}).items():
                if "settings" not in client_data:
                     client_data["settings"] = DEFAULT_CLIENT_SETTINGS.copy()
                     client_data["settings"]["name"] = f"Client {client_id}" # Default name
                     current_app.logger.warning(f"Client '{client_id}' missing 'settings', added defaults.")
                else:
                    # Ensure all default setting keys are present
                    for key, default_value in DEFAULT_CLIENT_SETTINGS.items():
                        if key not in client_data["settings"]:
                            client_data["settings"][key] = default_value
                            current_app.logger.debug(f"Client '{client_id}': Added missing setting '{key}'.")
                    # Ensure 'client_type' exists, default to 'local' if missing
                    if "client_type" not in client_data["settings"]:
                        client_data["settings"]["client_type"] = "local"
                    # Ensure api_enabled exists
                    if "api_enabled" not in client_data["settings"]:
                        client_data["settings"]["api_enabled"] = False # Default to disabled

                if "endpoints" not in client_data:
                    client_data["endpoints"] = []
                    current_app.logger.warning(f"Client '{client_id}' missing 'endpoints', added empty list.")

            current_app.logger.info("Config file loaded successfully.")
            return config_data

        except json.JSONDecodeError as e:
            current_app.logger.error(f"Invalid JSON in config file {resolved_path}: {e}")
            raise ValueError(f"Invalid JSON in config file: {e}") from e
        except Exception as e:
            current_app.logger.error(f"Unexpected error loading config from {resolved_path}: {e}", exc_info=True)
            raise IOError(f"Failed to load config file: {e}") from e

def process_config_data(config_data):
    """Processes loaded config data, validates, sets defaults. Returns tuple: (global_settings, clients_data)."""
    processed_clients = {}
    global_settings = {}
    current_app.logger.info("Processing loaded config data...")
    try:
        # Process Global Settings
        loaded_global_settings = config_data.get("global_settings", {})
        global_settings['check_interval_seconds'] = max(5, loaded_global_settings.get("check_interval_seconds", DEFAULT_GLOBAL_SETTINGS['check_interval_seconds']))
        global_settings['check_timeout_seconds'] = max(1, loaded_global_settings.get("check_timeout_seconds", DEFAULT_GLOBAL_SETTINGS['check_timeout_seconds']))

        # Process Clients
        loaded_clients_data = config_data.get("clients", {})
        if not loaded_clients_data: # Ensure at least default client exists
            loaded_clients_data[DEFAULT_CLIENT_ID] = {"settings": DEFAULT_CLIENT_SETTINGS.copy(), "endpoints": []}
            current_app.logger.warning("No clients found in config data, added default client.")

        for client_id, client_data in loaded_clients_data.items():
            # Process Client Settings (ensure all defaults are present)
            client_settings = client_data.get("settings", {}).copy() # Start with loaded settings
            for key, default_value in DEFAULT_CLIENT_SETTINGS.items():
                if key not in client_settings:
                    client_settings[key] = default_value
            # Specific validation/defaults
            client_settings['name'] = client_settings.get('name', f"Client {client_id}").strip() or f"Client {client_id}"
            client_settings['client_type'] = client_settings.get('client_type', 'local')
            client_settings['disable_floating_elements'] = client_settings.get('disable_floating_elements', False)
            client_settings['api_enabled'] = client_settings.get('api_enabled', False)
            client_settings['remote_url'] = client_settings.get('remote_url') if client_settings['client_type'] == 'linked' else None
            # **Security Note:** api_token is loaded as is, but avoid logging it directly
            client_settings['api_token'] = client_settings.get('api_token') # Load token if present

            processed_endpoints = []
            raw_endpoints = client_data.get("endpoints", [])
            # Only process endpoints for 'local' clients
            if client_settings['client_type'] == 'local':
                seen_ids = set() # Track IDs within this client
                for i, ep in enumerate(raw_endpoints):
                    ep_id = ep.get('id')
                    name = ep.get('name')
                    url = ep.get('url')

                    if not name or not url:
                        current_app.logger.warning(f"Client '{client_id}': Skipping endpoint index {i} missing name/url.")
                        continue

                    if not ep_id or ep_id in seen_ids:
                        new_ep_id = f"ep_{uuid.uuid4().hex[:8]}"
                        current_app.logger.warning(f"Client '{client_id}': Endpoint '{name}' missing ID or ID '{ep_id}' duplicate. Generated new ID: {new_ep_id}")
                        ep_id = new_ep_id
                        ep['id'] = ep_id
                    seen_ids.add(ep_id)

                    group = ep.get('group', 'Default Group') or 'Default Group'
                    interval_str = ep.get('check_interval_seconds')
                    timeout_str = ep.get('check_timeout_seconds')
                    interval = None; timeout = None

                    if interval_str is not None:
                        try: interval = max(5, int(interval_str))
                        except (ValueError, TypeError): interval = None
                    if timeout_str is not None:
                        try: timeout = max(1, int(timeout_str))
                        except (ValueError, TypeError): timeout = None

                    cleaned_ep = {'id': ep_id, 'name': name, 'url': url, 'group': group}
                    if interval is not None: cleaned_ep['check_interval_seconds'] = interval
                    if timeout is not None: cleaned_ep['check_timeout_seconds'] = timeout
                    processed_endpoints.append(cleaned_ep)

            # Store processed client data
            processed_clients[client_id] = {
                "settings": client_settings,
                "endpoints": processed_endpoints # Will be empty for linked clients
            }
            current_app.logger.info(f"Client '{client_id}' (Type: {client_settings['client_type']}) processed: {len(processed_endpoints)} local endpoints.")

        current_app.logger.info(f"Config processed. Global Interval={global_settings['check_interval_seconds']}s, Timeout={global_settings['check_timeout_seconds']}s.")
        return global_settings, processed_clients

    except Exception as e:
        current_app.logger.error(f"ERROR processing config data: {e}. Returning defaults.", exc_info=True)
        # Return default structure matching new state
        default_clients_data = {
             DEFAULT_CLIENT_ID: {"settings": DEFAULT_CLIENT_SETTINGS.copy(), "endpoints": []}
        }
        return DEFAULT_GLOBAL_SETTINGS.copy(), default_clients_data


def load_initial_config(config_path, current_state_ref, state_lock_ref):
    """Loads config on startup, processes it, and updates global state directly."""
    current_app.logger.debug("load_initial_config called.")
    try:
        config_data = load_config_from_file(config_path)
        global_settings, clients_data = process_config_data(config_data)

        with state_lock_ref:
            # Clear existing clients before loading new ones
            current_state_ref["clients"] = {}
            current_state_ref["global_settings"] = global_settings

            for client_id, client_info in clients_data.items():
                 client_info["statuses"] = {} # Initialize empty statuses
                 # Set initial statuses for local endpoints only
                 if client_info.get("settings", {}).get("client_type", "local") == "local":
                     client_info["statuses"] = {
                         ep.get('id'): {"status": "PENDING", "last_check_ts": 0, "details": None}
                         for ep in client_info.get("endpoints", []) if ep.get('id')
                     }
                 # Else: Linked clients start with empty statuses, populated by fetch

                 current_state_ref["clients"][client_id] = client_info # Load processed data

            # Set scheduler interval based on global settings
            current_state_ref["scheduler_interval"] = global_settings.get("check_interval_seconds", DEFAULT_GLOBAL_SETTINGS['check_interval_seconds'])
            current_state_ref["last_updated"] = 0
            current_app.logger.debug(f"Initial config loaded into state. Clients: {list(current_state_ref['clients'].keys())}")

    except Exception as e:
        current_app.logger.error(f"ERROR during initial config load/process: {e}. Starting empty/defaults.", exc_info=True)
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
    """Saves the provided global settings and clients data (incl settings, endpoints) to config.json."""
    resolved_path = os.path.abspath(config_path)
    current_app.logger.info(f"Attempting to save config to: {resolved_path}")

    # Prepare data for saving: deep copy and remove runtime 'statuses'
    config_to_save = {
        "global_settings": global_settings,
        "clients": {}
    }
    for client_id, client_info in clients_data.items():
        # Create a deep copy and remove 'statuses' before saving
        client_copy = deepcopy(client_info)
        client_copy.pop('statuses', None) # Remove statuses
        # **Security Warning:** Saving raw API tokens to config.json is insecure.
        # Consider environment variables or a proper secrets management solution for production.
        if client_copy.get("settings", {}).get("api_token"):
             current_app.logger.warning(f"SECURITY WARNING: Saving client API token directly to config file for client '{client_id}'. This is not recommended for production.")

        config_to_save["clients"][client_id] = client_copy

    with config_file_lock:
        try:
            temp_path = resolved_path + ".tmp"
            with open(temp_path, 'w') as f: json.dump(config_to_save, f, indent=4)
            os.replace(temp_path, resolved_path)
            current_app.logger.info(f"Config successfully saved to {resolved_path}")
            return True
        except Exception as e:
            current_app.logger.error(f"ERROR saving config to {resolved_path}: {e}", exc_info=True)
            # Attempt to remove temp file if it exists
            if os.path.exists(temp_path):
                try: os.remove(temp_path)
                except Exception as rm_e: current_app.logger.error(f"Error removing temp config file: {rm_e}")
            return False