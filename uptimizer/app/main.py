# File Name: main.py
# Full Path: C:\Users\Admin\Documents\Public\philipeace.github.io\uptimizer\app\main.py
# --- Force app directory onto path ---
import sys
import os
app_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(app_dir)
if project_root not in sys.path: sys.path.insert(0, project_root)

# --- Standard Imports ---
import atexit
import time # Import time for sleep
from datetime import datetime, timezone
import logging # Import logging early

# --- Environment Loading ---
from dotenv import load_dotenv
load_dotenv(os.path.join(project_root, '.env')) # Load .env file from project root

# --- Flask and APScheduler Imports ---
from flask import Flask
from apscheduler.schedulers.background import BackgroundScheduler
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.exceptions import NotFound

# --- Application Module Imports ---
# Import shared state and config path from state.py
from app.state import current_state, state_lock, CONFIG_PATH, APP_BASE_PATH, DEFAULT_CLIENT_ID

# Import models first to define DB flags and table creation function
try:
    from app import models
    from app.models import DB_ENABLED, ENGINE_INITIALIZED, create_db_tables
except ImportError as e:
    print(f"FATAL: Could not import core components from app.models: {e}. Assuming DB Disabled.")
    class DummyModels: ENGINE_INITIALIZED = False; DB_TABLES_CREATED = False
    models = DummyModels(); DB_ENABLED = False; ENGINE_INITIALIZED = False
    def create_db_tables(): print("FATAL: create_tables STUB (models import failed)"); return False

# Import other components AFTER models and state
from app.config_manager import load_initial_config
from app.checker import run_checks_task

# --- Import NEW Blueprints --- CORRECTED IMPORTS ---
# Import the blueprint OBJECTS defined in your api_*.py and views.py files
from app.views import views_bp
from app.api.api_general import general_api_bp # Check this file exists and defines general_api_bp
from app.api.api_clients import clients_api_bp # Check this file exists and defines clients_api_bp
from app.api.api_endpoints import endpoints_api_bp # Check this file exists and defines endpoints_api_bp
from app.api.api_stats import stats_api_bp # Check this file exists and defines stats_api_bp
from app.api.api_config import config_api_bp # Check this file exists and defines config_api_bp
# --- End New Blueprint Imports ---

# --- Flask App Creation ---
app = Flask(__name__)

# --- Configuration ---
# Load SECRET_KEY from environment for token signing
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY')
if not app.config['SECRET_KEY']:
    app.logger.warning("SECURITY WARNING: SECRET_KEY is not set in environment variables. API token functionality will fail. Please set a strong, random SECRET_KEY in your .env file.")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s [%(name)s] %(message)s')
app.logger.setLevel(logging.INFO)
app.logger.info("Flask App configured. SECRET_KEY loaded (if set).")


# --- Register Blueprints --- CORRECTED REGISTRATIONS ---
app.register_blueprint(views_bp) # For HTML rendering (usually no prefix)
# Register all API blueprints with a common '/api' prefix
app.register_blueprint(general_api_bp, url_prefix='/api') # e.g., /api/status
app.register_blueprint(clients_api_bp, url_prefix='/api') # e.g., /api/clients, /api/v1/client/...
app.register_blueprint(endpoints_api_bp, url_prefix='/api') # e.g., /api/clients/<id>/endpoints
app.register_blueprint(stats_api_bp, url_prefix='/api') # e.g., /api/statistics, /api/history/...
app.register_blueprint(config_api_bp, url_prefix='/api') # e.g., /api/config_api/..., /api/config/reload
app.logger.info("All Blueprints registered.")

# --- Scheduler Setup ---
scheduler = BackgroundScheduler(daemon=True, timezone="UTC")

# --- Initialization and Cleanup ---
# ... (initialize function remains the same) ...
def initialize():
    """Initialize database, load config, start scheduler."""
    global scheduler
    app.logger.info("="*30 + "\nInitializing Uptimizer...\n" + "="*30)

    # Step 1: Ensure DB Engine is Ready
    if not models.ENGINE_INITIALIZED and DB_ENABLED:
        app.logger.warning("DB Engine not ready yet, waiting briefly...")
        time.sleep(5) # Wait 5 seconds
        if not models.ENGINE_INITIALIZED:
             app.logger.error("DB Engine still not initialized after wait. DB Ops may fail.")

    # Step 2: Ensure DB Tables Exist
    app.logger.info("Step 1: Ensuring Database Tables Exist...")
    if models.ENGINE_INITIALIZED:
        if create_db_tables(): app.logger.info("DB Initialization: Tables checked/created.")
        else: app.logger.warning("DB Initialization: Table creation/check failed.")
    elif DB_ENABLED: app.logger.warning("DB enabled but engine failed init. Skipping table creation.")
    else: app.logger.info("DB Disabled, skipping table creation.")

    # Step 3: Load initial config
    app.logger.info("\nStep 2: Loading Initial Configuration from file...");
    load_initial_config(CONFIG_PATH, current_state, state_lock)
    app.logger.info("Step 2: Initial configuration loading complete.")

    # Log the state *after* loading config and *before* first check
    with state_lock:
        initial_clients = list(current_state["clients"].keys())
        initial_endpoints_count = sum(len(c.get("endpoints", [])) for c in current_state["clients"].values() if c.get("settings", {}).get("client_type", "local") == "local")
        initial_linked_clients = sum(1 for c in current_state["clients"].values() if c.get("settings", {}).get("client_type") == "linked")
        initial_interval = current_state.get("scheduler_interval")
    app.logger.info(f"\nState After Config Load: Clients={initial_clients}, Local Endpoints={initial_endpoints_count}, Linked Clients={initial_linked_clients}, Scheduler Freq={initial_interval}s")
    app.logger.info(f"DB Status Before Initial Check: Engine Initialized={models.ENGINE_INITIALIZED}, Tables Created={models.DB_TABLES_CREATED}")

    # Step 4: Run first check cycle
    app.logger.info("\nStep 3: Running Initial Checks/Fetches...");
    try:
        # Pass state by reference (it's a dict)
        run_checks_task(current_state, state_lock)
        app.logger.info("Step 3: Initial check/fetch cycle finished.")
    except Exception as e:
        app.logger.error(f"ERROR during initial check cycle: {e}", exc_info=True)
    app.logger.info(f"DB Status After Initial Check: Engine Initialized={models.ENGINE_INITIALIZED}, Tables Created={models.DB_TABLES_CREATED}")

    # Step 5: Schedule recurring checks
    app.logger.info(f"\nStep 4: Scheduling Recurring Checks (Freq: {initial_interval}s)...")
    try:
        with state_lock: interval_to_use = current_state["scheduler_interval"]
        job_defaults = {'coalesce': True, 'max_instances': 1, 'misfire_grace_time': 30}
        # Pass current_state and state_lock to the scheduled job
        scheduler.add_job(run_checks_task, 'interval', seconds=interval_to_use,
                          id='endpoint_checks', replace_existing=True,
                          args=[current_state, state_lock], **job_defaults)
        if not scheduler.running: scheduler.start(); app.logger.info("Scheduler started.")
        else:
            app.logger.info("Scheduler already running. Rescheduling job...")
            scheduler.reschedule_job('endpoint_checks', trigger='interval', seconds=interval_to_use) # Reschedule only needs trigger/interval
            app.logger.info("Job rescheduled.")
    except Exception as e: app.logger.error(f"Error starting/scheduling job: {e}", exc_info=True)
    app.logger.info("\nInitialization Complete.\n" + "="*30)

# ... (cleanup function remains the same) ...
def cleanup():
    """Gracefully shut down scheduler."""
    app.logger.info("\n" + "="*30 + "\nShutdown signal. Cleaning up...\n" + "="*30)
    app.logger.info("Shutting down scheduler...");
    if scheduler and scheduler.running:
        try: scheduler.shutdown(); app.logger.info("Scheduler shut down.")
        except Exception as e: app.logger.error(f"Error shutting down scheduler: {e}", exc_info=True)
    else: app.logger.info("Scheduler was not running or not initialized.")
    app.logger.info("\nCleanup finished.\n" + "="*30)

atexit.register(cleanup)

# --- WSGI Application Setup (with Base Path) ---
base_app = app
if APP_BASE_PATH and APP_BASE_PATH != '/':
    app.logger.info(f"Applying DispatcherMiddleware for base path: {APP_BASE_PATH}")
    clean_base_path = '/' + APP_BASE_PATH.strip('/')
    def not_found(environ, start_response): error = NotFound(); response = error.get_response(environ); return response(environ, start_response)
    application = DispatcherMiddleware(not_found, {clean_base_path: base_app})
    app.logger.info(f"App will be served under {clean_base_path}")
else:
    app.logger.info("Running application at root path ('/').")
    application = base_app

# --- Main Execution ---
if __name__ == '__main__':
    # Determine if running in Werkzeug reloader's main process or child process
    is_main_process = not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true"

    if is_main_process:
        app.logger.info("Main process detected. Performing initialization.")
        # Check critical components before initializing
        secret_key_ok = bool(app.config['SECRET_KEY'])
        models_ok = ('models' in locals() or 'models' in globals()) and models is not None

        if not secret_key_ok:
            app.logger.critical("FATAL: SECRET_KEY not set. Initialization aborted. Cannot run application securely.")
        elif not models_ok:
            app.logger.critical("FATAL: Core 'models' module failed to load. Cannot initialize.")
        else:
            # Only initialize if checks pass
            initialize()
    else:
         app.logger.info("(Reloader Active: Parent process monitoring, initialization deferred to child)")


    # Start the Flask development server (or WSGI server in production)
    # Only run the server if the SECRET_KEY is configured AND models loaded
    # (Initialization function wouldn't run otherwise)
    if app.config['SECRET_KEY'] and ('models' in locals() or 'models' in globals()) and models is not None:
         from werkzeug.serving import run_simple
         app.logger.info(f"Starting Werkzeug server on 0.0.0.0:5000 (Debug: {app.debug})...")
         try:
            # Use the 'application' object which might be the original app or the middleware wrapper
            run_simple(hostname='0.0.0.0', port=5000, application=application, use_reloader=app.debug, use_debugger=app.debug)
         except Exception as run_err:
             app.logger.critical(f"Failed to start server: {run_err}", exc_info=True)
    else:
        app.logger.critical("Server not started because SECRET_KEY is missing or core modules failed.")
