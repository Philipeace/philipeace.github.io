import threading
import os

# --- Constants ---
APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.getenv('UPTIMER_CONFIG_PATH', os.path.join(APP_DIR, 'config.json'))
APP_BASE_PATH = os.getenv('APP_BASE_PATH', '/')
SECRET_KEY = os.getenv('SECRET_KEY') # Load secret key for token signing
DEFAULT_CHECK_INTERVAL = 30
DEFAULT_CHECK_TIMEOUT = 10
DEFAULT_CLIENT_ID = "default_client"

DEFAULT_GLOBAL_SETTINGS = {
    'check_interval_seconds': DEFAULT_CHECK_INTERVAL,
    'check_timeout_seconds': DEFAULT_CHECK_TIMEOUT,
}

DEFAULT_CLIENT_SETTINGS = { # Default structure for client-specific settings
    'name': 'Default Client',
    'client_type': 'local',  # 'local' or 'linked'
    'disable_floating_elements': False,
    'api_enabled': False,    # Is API exposure allowed for this client? (Only relevant for 'local')
    'api_token': None,       # Signed token for API access (for 'local' type, generated) or token TO USE (for 'linked' type, provided)
    'remote_url': None       # URL of the remote Uptimizer instance (for 'linked' type)
}


# --- Shared Application State ---
# Structure:
# {
#   "global_settings": { ... },
#   "clients": {
#       "client_id_1": {
#           "settings": { "name": "...", "client_type": "local", "disable_floating_elements": ..., "api_enabled": ..., "api_token": "signed_token_if_local", "remote_url": null },
#           "endpoints": [ ... ], // Only populated for 'local' clients
#           "statuses": { ... }
#       },
#       "client_id_2": {
#           "settings": { "name": "...", "client_type": "linked", ..., "api_token": "token_for_remote", "remote_url": "http://..." },
#           "endpoints": [], // Always empty for 'linked' clients
#           "statuses": { ... } // Populated by fetching from remote_url
#       }
#   },
#   "last_updated": 0,
#   "scheduler_interval": 30
# }
current_state = {
    "global_settings": DEFAULT_GLOBAL_SETTINGS.copy(),
    "clients": {
        DEFAULT_CLIENT_ID: {
            "settings": DEFAULT_CLIENT_SETTINGS.copy(),
            "endpoints": [],
            "statuses": {}
        }
    },
    "last_updated": 0,
    "scheduler_interval": DEFAULT_CHECK_INTERVAL
}

# Lock for accessing/modifying the shared state
state_lock = threading.Lock()

print("DEBUG: state.py loaded and initialized shared state.")
print(f"DEBUG: state.py determined APP_BASE_PATH: '{APP_BASE_PATH}'")
if not SECRET_KEY: print("DEBUG: WARNING - SECRET_KEY not found in environment.")
else: print("DEBUG: SECRET_KEY loaded.")
print(f"DEBUG: Initial state structure ready. Default Client ID: {DEFAULT_CLIENT_ID}")