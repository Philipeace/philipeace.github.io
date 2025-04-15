import threading
import os

# --- Constants ---
APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.getenv('UPTIMER_CONFIG_PATH', os.path.join(APP_DIR, 'config.json'))
APP_BASE_PATH = os.getenv('APP_BASE_PATH', '/')
DEFAULT_CHECK_INTERVAL = 30
DEFAULT_CHECK_TIMEOUT = 10
DEFAULT_CLIENT_ID = "default_client" # Define a default client ID

DEFAULT_GLOBAL_SETTINGS = {
    'check_interval_seconds': DEFAULT_CHECK_INTERVAL,
    'check_timeout_seconds': DEFAULT_CHECK_TIMEOUT,
}

DEFAULT_CLIENT_SETTINGS = { # Default structure for client-specific settings
    'name': 'Default Client',
    'disable_floating_elements': False
    # Add more client-specific settings here later (e.g., theme, specific alert contacts)
}


# --- Shared Application State ---
# Structure:
# {
#   "global_settings": { ... },
#   "clients": {
#       "client_id_1": {
#           "settings": { "name": "...", "disable_floating_elements": false, ... },
#           "endpoints": [ { "id": ..., "name": ..., ... } ],
#           "statuses": { "endpoint_id": { ... } }
#       },
#       "client_id_2": { ... }
#   },
#   "last_updated": 0,
#   "scheduler_interval": 30 # Effective interval for the background job
# }
current_state = {
    "global_settings": DEFAULT_GLOBAL_SETTINGS.copy(),
    "clients": {
        DEFAULT_CLIENT_ID: {
            "settings": DEFAULT_CLIENT_SETTINGS.copy(), # Use the defined default client settings
            "endpoints": [],
            "statuses": {}
        }
    },
    "last_updated": 0,
    "scheduler_interval": DEFAULT_CHECK_INTERVAL # Effective global check interval for scheduler
}

# Lock for accessing/modifying the shared state
state_lock = threading.Lock()

print("DEBUG: state.py loaded and initialized shared state.")
print(f"DEBUG: state.py determined APP_BASE_PATH: '{APP_BASE_PATH}'")
print(f"DEBUG: Initial state structure ready. Default Client ID: {DEFAULT_CLIENT_ID}")