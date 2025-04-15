import threading
import os

# Central definition of configuration paths and defaults
APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.getenv('UPTIMER_CONFIG_PATH', os.path.join(APP_DIR, 'config.json'))
APP_BASE_PATH = os.getenv('APP_BASE_PATH', '/') # Default to root if not set
DEFAULT_CHECK_INTERVAL = 30
DEFAULT_CHECK_TIMEOUT = 10

# --- ADDED DEFAULT_SETTINGS Definition ---
DEFAULT_SETTINGS = {
    'check_interval_seconds': DEFAULT_CHECK_INTERVAL,
    'check_timeout_seconds': DEFAULT_CHECK_TIMEOUT,
    'disable_floating_elements': False
}
# ------------------------------------------

# Shared application state dictionary
current_state = {
    "endpoints": [], # List of endpoint dicts
    "statuses": {},  # Dict mapping id -> status info
    # --- Initialize settings using DEFAULT_SETTINGS ---
    "settings": DEFAULT_SETTINGS.copy(),
    # -----------------------------------------------
    "last_updated": 0, # Timestamp of last successful check cycle run
    "check_interval": DEFAULT_CHECK_INTERVAL # Effective global check interval for scheduler
}

# Lock for accessing/modifying the shared state
state_lock = threading.Lock()

print("DEBUG: state.py loaded and initialized shared state.")
print(f"DEBUG: state.py determined APP_BASE_PATH: '{APP_BASE_PATH}'")