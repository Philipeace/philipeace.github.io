import os
import psycopg2
import time
from datetime import datetime, timedelta, timezone
from psycopg2 import pool, OperationalError, InterfaceError, sql # Import sql for safe identifiers

# --- Database Connection Pool ---
db_pool = None

def get_db_connection_pool():
    """Initializes and returns the connection pool."""
    global db_pool
    if db_pool is None:
        retries = 5; delay = 2
        while retries > 0:
            try:
                print("Initializing database connection pool...")
                db_pool = psycopg2.pool.SimpleConnectionPool(
                    1, 10,
                    user=os.getenv('DB_USER', 'uptimizer_user'),
                    password=os.getenv('DB_PASSWORD', 'supersecretpassword'),
                    host=os.getenv('DB_HOST', 'localhost'),
                    port=os.getenv('DB_PORT', '5432'),
                    database=os.getenv('DB_NAME', 'uptimizer_data')
                )
                print("Database connection pool initialized.")
                conn = db_pool.getconn(); print("Successfully connected to database."); db_pool.putconn(conn)
                break
            except OperationalError as e:
                retries -= 1; print(f"WARN: Database connection failed: {e}. Retrying in {delay}s... ({retries} retries left)")
                if retries == 0: print(f"FATAL: Could not connect to database after multiple retries."); db_pool = None; break
                time.sleep(delay)
            except Exception as e: print(f"FATAL: Unexpected error initializing database pool: {e}"); db_pool = None; break
    return db_pool

def get_connection():
    """Gets a connection from the pool."""
    pool = get_db_connection_pool()
    if pool:
        try: return pool.getconn()
        except Exception as e: print(f"Error getting DB connection: {e}"); return None
    return None

def release_connection(conn):
    """Releases a connection back to the pool."""
    pool = get_db_connection_pool()
    if pool and conn:
        try: pool.putconn(conn)
        except InterfaceError: pass # Connection likely closed
        except Exception as e: print(f"Error putting connection back to pool: {e}")

def close_db_pool():
     """Closes all connections in the pool."""
     global db_pool
     if db_pool:
        print("Closing database connection pool...");
        try: db_pool.closeall()
        except Exception as e: print(f"Error during db_pool.closeall(): {e}")
        db_pool = None; print("Database connection pool closed.")

# --- Database Schema Initialization ---
def init_db():
    """Initializes the database schema."""
    conn = get_connection()
    if not conn: print("ERROR: Cannot init DB schema, no connection."); return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS status_history (
                    id SERIAL PRIMARY KEY, timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    endpoint_id VARCHAR(255) NOT NULL, status VARCHAR(50) NOT NULL,
                    status_code INTEGER, response_time_ms INTEGER, details TEXT);
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_status_history_endpoint_ts ON status_history (endpoint_id, timestamp DESC);")
            conn.commit(); print("DB schema initialized.")
    except Exception as e:
        print(f"Error initializing DB schema: {e}")
        # *** Corrected Indentation Below ***
        try:
            conn.rollback()
        except Exception as re:
            print(f"Error during rollback: {re}")
    finally:
        release_connection(conn)

# --- Data Persistence ---
last_saved_status = {}
def save_status_change(endpoint_id, check_result):
    """Saves the status check result to the database if it changed meaningfully or is UP."""
    global last_saved_status; conn = get_connection()
    if not conn: print(f"ERROR: Cannot save status for {endpoint_id}, no DB connection."); return

    current_status = check_result.get('status', 'UNKNOWN')
    current_details = check_result.get('details'); current_status_code = check_result.get('status_code')
    current_response_time = check_result.get('response_time_ms')
    prev_saved_info = last_saved_status.get(endpoint_id)
    prev_saved_status = prev_saved_info.get('status') if prev_saved_info else None
    details_changed = (current_status not in ['UP', 'PENDING', 'UNKNOWN'] and
                       prev_saved_status == current_status and prev_saved_info.get('details') != current_details)
    should_save = (current_status == 'UP' or current_status != prev_saved_status or
                   prev_saved_info is None or details_changed)

    if not should_save: release_connection(conn); return
    try:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO status_history (endpoint_id, status, status_code, response_time_ms, details)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (endpoint_id, current_status, current_status_code, current_response_time, current_details))
            conn.commit(); last_saved_status[endpoint_id] = {'status': current_status, 'details': current_details}
    except Exception as e:
        print(f"Error saving status for {endpoint_id}: {e}")
        # *** Corrected Indentation Below ***
        try:
            conn.rollback()
        except Exception as re:
            print(f"Error during rollback: {re}")
    finally:
        release_connection(conn)

# --- Statistics & History Retrieval ---
def get_stats_last_24h(endpoint_id):
    """Calculates uptime percentage for the last 24 hours for a given endpoint."""
    conn = get_connection()
    if not conn: return {"error": "DB connection unavailable"}
    results = {"uptime_percentage_24h": None, "error": None}
    try:
        end_time = datetime.now(timezone.utc); start_time = end_time - timedelta(hours=24)
        with conn.cursor() as cur:
            cur.execute("""SELECT timestamp, status FROM status_history
                           WHERE endpoint_id = %s AND timestamp >= %s AND timestamp <= %s
                           ORDER BY timestamp ASC""", (endpoint_id, start_time, end_time))
            rows = cur.fetchall()
            if not rows: results["error"] = "No data in last 24h"; return results
            if len(rows) == 1: results["error"] = "Insufficient data points"; return results

            total_time_up = timedelta(0)
            for i in range(len(rows) - 1):
                if rows[i][1] == 'UP': duration = rows[i+1][0] - rows[i][0]; total_time_up += duration
            last_record_ts, last_record_status = rows[-1]
            if last_record_status == 'UP': duration_after_last = end_time - last_record_ts; total_time_up += duration_after_last
            total_duration = timedelta(hours=24)
            if total_duration.total_seconds() > 0:
                uptime_percentage = (total_time_up.total_seconds() / total_duration.total_seconds()) * 100
                results["uptime_percentage_24h"] = round(uptime_percentage, 2)
            else: results["error"] = "Zero duration"
    except Exception as e:
        print(f"Error calculating stats for {endpoint_id}: {e}")
        results["error"] = "Calculation error"
        # *** Corrected Indentation Below ***
        try:
            # Rollback might not be needed for SELECT, but good practice if complex query
            conn.rollback()
        except Exception as re:
            print(f"Error during rollback: {re}")
    finally: release_connection(conn)
    return results

def get_history_for_period(endpoint_id, start_time, end_time):
    """Fetches history records (timestamp, status, response_time_ms) for charting."""
    conn = get_connection()
    if not conn: return {"error": "DB connection unavailable", "data": []}
    results = {"data": [], "error": None}
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT timestamp, status, response_time_ms FROM status_history
                           WHERE endpoint_id = %s AND timestamp >= %s AND timestamp <= %s
                           ORDER BY timestamp ASC""", (endpoint_id, start_time, end_time))
            rows = cur.fetchall()
            results["data"] = [{"timestamp": row[0].isoformat(), "status": row[1], "response_time_ms": row[2]} for row in rows]
            print(f"Fetched {len(rows)} history points for {endpoint_id} in period.")
    except Exception as e:
        print(f"Error fetching history for {endpoint_id}: {e}")
        results["error"] = f"History fetch error: {e}"
        # *** Corrected Indentation Below ***
        try:
            conn.rollback()
        except Exception as re:
            print(f"Error during rollback: {re}")
    finally: release_connection(conn)
    return results