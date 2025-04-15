# --- Force app directory onto path ---
import sys
import os
app_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(app_dir)
if project_root not in sys.path: sys.path.insert(0, project_root)

# --- Standard Imports ---
import atexit
from datetime import datetime, timezone # Removed timedelta, uuid as not used here

# --- Flask and APScheduler Imports ---
from flask import Flask
from apscheduler.schedulers.background import BackgroundScheduler
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.exceptions import NotFound

# --- Application Module Imports ---
# Import shared state and config path from state.py
from app.state import current_state, state_lock, CONFIG_PATH, APP_BASE_PATH

# Import models first to define DB flags and table creation function
try:
    # --- Import models module itself ---
    from app import models
    # ---------------------------------
    from app.models import DB_ENABLED, ENGINE_INITIALIZED, create_db_tables
except ImportError as e:
    print(f"FATAL: Could not import core components from app.models: {e}. Assuming DB Disabled.")
    # --- Ensure dummy models exists if import fails ---
    class DummyModels:
        ENGINE_INITIALIZED = False
        DB_TABLES_CREATED = False
    models = DummyModels()
    # --------------------------------------------------
    DB_ENABLED = False
    ENGINE_INITIALIZED = False
    def create_db_tables(): print("FATAL: create_tables STUB (models import failed)")

# Import other components AFTER models and state
from app.config_manager import load_initial_config
from app.checker import run_checks_task
from app.routes import api_bp # Import the blueprint

# --- Flask App Creation ---
app = Flask(__name__)

# --- Register Blueprints ---
app.register_blueprint(api_bp)

# --- Scheduler Setup ---
scheduler = BackgroundScheduler(daemon=True, timezone="UTC")

# --- Initialization and Cleanup ---
def initialize():
    """Initialize database, load config, start scheduler."""
    global scheduler # Need to modify scheduler
    print("="*30 + "\nInitializing Uptimizer...\n" + "="*30)

    # Step 1: Ensure DB Tables Exist (Initial Attempt)
    print("Step 1: Ensuring Database Tables Exist (Initial Attempt)...")
    # --- Use models module directly for flag check ---
    if models.ENGINE_INITIALIZED:
    # ----------------------------------------------
        if create_db_tables(): print("DB Initialization: Tables checked/created.")
        else: print("WARN: DB Initialization: Initial table creation attempt failed (may succeed later).")
    elif DB_ENABLED: print("WARN: DB enabled but engine failed init. Skipping table creation.")
    else: print("DB Disabled, skipping table creation.")

    # Step 2: Load initial config from file (populates current_state)
    print("\nStep 2: Loading Initial Configuration from file...");
    load_initial_config(CONFIG_PATH, current_state, state_lock) # Pass state, lock, and path
    # --- Added confirmation log ---
    print("Step 2: Initial configuration loading complete.")
    # ----------------------------
    initial_endpoints_count = len(current_state["endpoints"])
    # Get interval from state after loading config
    with state_lock: initial_interval = current_state.get("check_interval")
    print(f"\nInitial State: {initial_endpoints_count} endpoints loaded. Scheduler Freq={initial_interval}s")

    # Step 3: Run first check cycle
    print("\nStep 3: Running Initial Checks...");
    run_checks_task(current_state, state_lock)
    print("Initial checks complete.")

    # Step 4: Schedule recurring checks
    print(f"\nStep 4: Scheduling Recurring Checks (Scheduler Freq: {initial_interval}s)...")
    try:
        with state_lock: interval_to_use = current_state["check_interval"]
        job_defaults = {'coalesce': True, 'max_instances': 1, 'misfire_grace_time': 30}
        scheduler.add_job(run_checks_task, 'interval', seconds=interval_to_use,
                          id='endpoint_checks', replace_existing=True,
                          args=[current_state, state_lock], **job_defaults)
        if not scheduler.running: scheduler.start(); print("Scheduler started.")
        else: print("Scheduler already running."); scheduler.reschedule_job('endpoint_checks', trigger='interval', seconds=interval_to_use, **job_defaults)
    except Exception as e: print(f"Error starting/scheduling job: {e}")
    print("\nInitialization Complete.\n" + "="*30)

def cleanup():
    """Gracefully shut down scheduler."""
    print("\n" + "="*30 + "\nShutdown signal. Cleaning up...\n" + "="*30)
    print("Shutting down scheduler...");
    if scheduler.running:
        try: scheduler.shutdown(); print("Scheduler shut down.")
        except Exception as e: print(f"Error shutting down scheduler: {e}")
    else: print("Scheduler was not running.")
    print("\nCleanup finished.\n" + "="*30)

atexit.register(cleanup)

# --- WSGI Application Setup (with Base Path) ---
base_app = app
if APP_BASE_PATH and APP_BASE_PATH != '/':
    print(f"Applying DispatcherMiddleware for base path: {APP_BASE_PATH}")
    clean_base_path = '/' + APP_BASE_PATH.strip('/')
    def not_found(environ, start_response): error = NotFound(); response = error.get_response(environ); return response(environ, start_response)
    application = DispatcherMiddleware(not_found, {clean_base_path: base_app})
    print(f"App will be served under {clean_base_path}")
else:
    print("Running application at root path ('/').")
    application = base_app

# --- Main Execution ---
if __name__ == '__main__':
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        # Initialize only once, typically in the reloader's child process or when not debugging
        if not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
            initialize()
        else:
            print("(Reloader Active: Parent process monitoring, initialization deferred to child)")
    else:
        # This block runs in the child process when reloader is active
        initialize()

    from werkzeug.serving import run_simple
    print(f"Starting Werkzeug server on 0.0.0.0:5000 (Debug: {app.debug})...")
    # Use the 'application' object which might be the original app or the middleware wrapper
    run_simple(hostname='0.0.0.0', port=5000, application=application, use_reloader=app.debug, use_debugger=app.debug)