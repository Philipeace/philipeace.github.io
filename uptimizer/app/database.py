import os
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, desc, and_, func
# Use absolute imports and import the models module itself
from app import models # Import the module to access flags and functions directly
from app.models import Session, StatusHistory, session_scope # Keep specific imports

# --- Data Persistence ---
last_saved_status = {}

def _ensure_tables_exist():
    """Internal helper to attempt table creation if not already done."""
    if models.ENGINE_INITIALIZED and not models.DB_TABLES_CREATED:
        print("DB INFO: Attempting table creation from DB function...")
        models.create_db_tables() # This will set DB_TABLES_CREATED if successful

def save_status_change(endpoint_id, check_result):
    """Saves the status check result to the database using SQLAlchemy if DB is ready."""
    _ensure_tables_exist() # Attempt table creation if needed

    # Check readiness flags directly from the models module at runtime
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
        return # Silently return if DB not ready or tables couldn't be created
    # ----------------------------------------------------------------------
    global last_saved_status
    current_status = check_result.get('status', 'UNKNOWN')
    current_details = check_result.get('details'); current_status_code = check_result.get('status_code')
    current_response_time = check_result.get('response_time_ms')
    prev_saved_info = last_saved_status.get(endpoint_id)
    prev_saved_status = prev_saved_info.get('status') if prev_saved_info else None
    details_changed = (current_status not in ['UP', 'PENDING', 'UNKNOWN'] and
                       prev_saved_status == current_status and prev_saved_info.get('details') != current_details)
    should_save = (current_status == 'UP' or current_status != prev_saved_status or
                   prev_saved_info is None or details_changed)
    if not should_save: return
    try:
        with session_scope() as session:
            # Check session explicitly inside scope
            if session is None:
                 # Warning already printed by session_scope if engine is down
                 return # Return if session couldn't be created
            # ---------------------------------------------
            new_history = StatusHistory( endpoint_id=endpoint_id, status=current_status, status_code=current_status_code, response_time_ms=current_response_time, details=current_details )
            session.add(new_history)
            last_saved_status[endpoint_id] = {'status': current_status, 'details': current_details}
    except Exception as e: print(f"SQLAlchemy Error saving status for {endpoint_id}: {e}")

# --- Statistics & History Retrieval ---
def get_stats_last_24h(endpoint_id):
    """Calculates uptime percentage for the last 24 hours using SQLAlchemy, if DB is ready."""
    _ensure_tables_exist() # Attempt table creation if needed

    # Check readiness flags directly from the models module at runtime
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
        return {"error": "DB N/A", "uptime_percentage_24h": None}
    # ----------------------------------------------------------------------
    results = {"uptime_percentage_24h": None, "error": None}
    try:
        with session_scope() as session:
             # Check session explicitly inside scope
            if session is None:
                 results["error"] = "DB Session N/A"
                 return results
            # ---------------------------------------------
            end_time = datetime.now(timezone.utc); start_time = end_time - timedelta(hours=24)
            query = ( select(StatusHistory.timestamp, StatusHistory.status)
                     .where( and_( StatusHistory.endpoint_id == endpoint_id, StatusHistory.timestamp >= start_time, StatusHistory.timestamp <= end_time ) )
                     .order_by(StatusHistory.timestamp.asc()) )
            rows = session.execute(query).fetchall()

            if not rows: results["error"] = "No data in last 24h"; return results
            # Calculation requires at least one point to determine state at boundaries
            # if len(rows) < 1: # Allow calculation with >= 1 points
            #     results["error"] = "Insufficient data points"; return results

            total_time_up = timedelta(0)
            current_time = start_time # Start tracking from the beginning of the 24h window

            # Consider state *before* the first record within the window
            # Need the last record *before* start_time to know initial state
            first_record_time = rows[0].timestamp
            query_prev = (select(StatusHistory.status)
                          .where(and_(StatusHistory.endpoint_id == endpoint_id, StatusHistory.timestamp < start_time))
                          .order_by(StatusHistory.timestamp.desc())
                          .limit(1))
            prev_row = session.execute(query_prev).fetchone()
            initial_status = prev_row.status if prev_row else 'UNKNOWN' # Assume UNKNOWN if no prior data

            if initial_status == 'UP':
                # If state before window was UP, count time from start_time to first record
                duration = first_record_time - start_time
                if duration.total_seconds() > 0: total_time_up += duration

            current_time = first_record_time # Advance time to the first record

            # Iterate through records within the window
            for i in range(len(rows)):
                record_time = rows[i].timestamp
                record_status = rows[i].status

                # Duration from previous event (or start_time/initial_status) to this one
                time_since_last_event = record_time - current_time

                # Add to uptime if the status *during* this interval was UP
                # The status *before* this record determines the state of the interval
                status_during_interval = rows[i-1].status if i > 0 else initial_status
                if status_during_interval == 'UP' and time_since_last_event.total_seconds() > 0:
                    total_time_up += time_since_last_event

                current_time = record_time # Update current time

            # Consider state *after* the last record until end_time
            last_record_status = rows[-1].status
            if last_record_status == 'UP':
                duration_after_last = end_time - current_time
                if duration_after_last.total_seconds() > 0: total_time_up += duration_after_last

            total_duration = end_time - start_time
            if total_duration.total_seconds() > 0:
                uptime_percentage = (total_time_up.total_seconds() / total_duration.total_seconds()) * 100
                results["uptime_percentage_24h"] = round(uptime_percentage, 2)
            else: results["error"] = "Zero duration"

    except Exception as e:
        print(f"SQLAlchemy Error calculating stats for {endpoint_id}: {e}")
        results["error"] = "Calculation error: " + str(e)
    return results

def get_history_for_period(endpoint_id, start_time, end_time):
    """Fetches history records using SQLAlchemy, if DB is ready."""
    _ensure_tables_exist() # Attempt table creation if needed

    # Check readiness flags directly from the models module at runtime
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED:
        return {"error": "DB N/A", "data": []}
    # ----------------------------------------------------------------------
    results = {"data": [], "error": None}
    try:
        with session_scope() as session:
             # Check session explicitly inside scope
            if session is None:
                 results["error"] = "DB Session N/A"
                 return results
            # ---------------------------------------------
            query = ( select( StatusHistory.timestamp, StatusHistory.status, StatusHistory.response_time_ms )
                      .where( and_( StatusHistory.endpoint_id == endpoint_id, StatusHistory.timestamp >= start_time, StatusHistory.timestamp <= end_time ) )
                      .order_by(StatusHistory.timestamp.asc()) )
            rows = session.execute(query).fetchall()
            results["data"] = [ {"timestamp": row.timestamp.isoformat(), "status": row.status, "response_time_ms": row.response_time_ms} for row in rows ]
    except Exception as e:
        print(f"SQLAlchemy Error fetching history for {endpoint_id}: {e}")
        results["error"] = f"History fetch error: {e}"
    return results