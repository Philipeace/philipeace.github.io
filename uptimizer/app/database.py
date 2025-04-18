import os
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, desc, and_, func, distinct, delete # Added distinct, delete
from flask import current_app # For logging

# Use absolute imports and import the models module itself
from app import models # Import the module to access flags and functions directly
from app.models import Session, StatusHistory, session_scope # Keep specific imports

# --- Data Persistence ---
last_saved_status = {} # Stores last saved status *per endpoint_id*

def _ensure_tables_exist():
    """Internal helper to attempt table creation if not already done."""
    if models.DB_TABLES_CREATED: return True
    if models.ENGINE_INITIALIZED:
        current_app.logger.info("DB INFO: Attempting table creation from DB function...")
        return models.create_db_tables() # This will set DB_TABLES_CREATED if successful
    return False

def save_status_change(endpoint_id, check_result):
    """Saves the status check result to the database using SQLAlchemy if DB is ready."""
    # This function should ONLY be called for results from DIRECT checks (local endpoints),
    # not for statuses fetched from linked clients.
    if not _ensure_tables_exist(): return
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED: return

    global last_saved_status
    current_status = check_result.get('status', 'UNKNOWN')
    current_details = check_result.get('details'); current_status_code = check_result.get('status_code')
    current_response_time = check_result.get('response_time_ms')

    prev_saved_info = last_saved_status.get(endpoint_id)
    prev_saved_status = prev_saved_info.get('status') if prev_saved_info else None
    prev_saved_details = prev_saved_info.get('details') if prev_saved_info else None

    details_meaningfully_changed = False
    if current_status not in ['UP', 'PENDING', 'UNKNOWN'] and prev_saved_status == current_status:
        if prev_saved_details != current_details: details_meaningfully_changed = True

    should_save = ( current_status != prev_saved_status or current_status == 'UP' or prev_saved_info is None or details_meaningfully_changed )

    if not should_save: return

    try:
        with session_scope() as session:
            if session is None: return
            new_history = StatusHistory(
                endpoint_id=endpoint_id, # Storing globally unique endpoint ID
                status=current_status,
                status_code=current_status_code,
                response_time_ms=current_response_time,
                details=current_details
            )
            session.add(new_history)
            # Update last *saved* status cache only on successful commit
            last_saved_status[endpoint_id] = {'status': current_status, 'details': current_details}
            current_app.logger.debug(f"Saved status change for {endpoint_id}: {current_status}")

    except Exception as e:
        current_app.logger.error(f"SQLAlchemy Error saving status for {endpoint_id}: {e}", exc_info=True)

# --- Statistics & History Retrieval ---
def get_stats_last_24h(endpoint_id):
    """Calculates uptime percentage for the last 24 hours using SQLAlchemy, if DB is ready."""
    if not _ensure_tables_exist(): return {"error": "DB N/A", "uptime_percentage_24h": None}
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED: return {"error": "DB N/A", "uptime_percentage_24h": None}

    results = {"uptime_percentage_24h": None, "error": None}
    try:
        with session_scope() as session:
            if session is None:
                 results["error"] = "DB Session N/A"; return results

            end_time = datetime.now(timezone.utc); start_time = end_time - timedelta(hours=24)

            # Fetch events including the first event *before* the window starts
            subquery_prev = (select(StatusHistory.status, StatusHistory.timestamp)
                            .where(and_(StatusHistory.endpoint_id == endpoint_id, StatusHistory.timestamp < start_time))
                            .order_by(StatusHistory.timestamp.desc())
                            .limit(1)).subquery()

            query_within = (select(StatusHistory.timestamp, StatusHistory.status)
                         .where( and_( StatusHistory.endpoint_id == endpoint_id, StatusHistory.timestamp >= start_time, StatusHistory.timestamp <= end_time ) )
                         )

            # Combine previous status with statuses in the window
            query = select(subquery_prev.c.timestamp, subquery_prev.c.status).union_all(
                    select(query_within.c.timestamp, query_within.c.status)
                    ).order_by(subquery_prev.c.timestamp.asc()) # Order should reference unioned columns correctly, maybe alias needed if complex

            rows = session.execute(query).fetchall() # Execute the combined query

            total_time_up = timedelta(0)
            current_time = start_time # Start tracking from beginning of window
            current_status = 'UNKNOWN' # Default initial status

            # Find the effective status at the start of the window
            if rows and rows[0].timestamp < start_time:
                current_status = rows[0].status
                # Start processing from the first event *within* or *at* the window start
                process_rows = rows[1:] # Skip the one before the window start
            else:
                 process_rows = rows # Process all rows if none are before start_time

            for record in process_rows:
                record_time = record.timestamp
                record_status = record.status
                duration = record_time - current_time # Time since last event or window start

                if current_status == 'UP' and duration.total_seconds() > 0:
                     total_time_up += duration

                current_time = record_time # Update time to current event
                current_status = record_status # Update status

            # Account for time from the last event until the end of the window
            if current_status == 'UP':
                 duration_after_last = end_time - current_time
                 if duration_after_last.total_seconds() > 0:
                     total_time_up += duration_after_last

            total_duration = end_time - start_time
            if total_duration.total_seconds() > 0:
                uptime_percentage = (total_time_up.total_seconds() / total_duration.total_seconds()) * 100
                results["uptime_percentage_24h"] = round(uptime_percentage, 2)
            elif not rows:
                 results["error"] = "No data available" # No data at all
            else:
                 # Handle edge case: only data point(s) before the window
                 results["uptime_percentage_24h"] = 100.00 if current_status == 'UP' else 0.00


    except Exception as e:
        current_app.logger.error(f"SQLAlchemy Error calculating stats for {endpoint_id}: {e}", exc_info=True)
        results["error"] = "Calculation error"
    return results


def get_history_for_period(endpoint_id, start_time, end_time):
    """Fetches history records using SQLAlchemy, if DB is ready. No arbitrary limit."""
    if not _ensure_tables_exist(): return {"error": "DB N/A", "data": []}
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED: return {"error": "DB N/A", "data": []}

    results = {"data": [], "error": None}
    try:
        with session_scope() as session:
             if session is None:
                 results["error"] = "DB Session N/A"; return results

             # Fetch status, timestamp, and response time within the period
             # REMOVED any implicit/explicit LIMIT clause
             query = ( select( StatusHistory.timestamp, StatusHistory.status, StatusHistory.response_time_ms )
                      .where( and_( StatusHistory.endpoint_id == endpoint_id, StatusHistory.timestamp >= start_time, StatusHistory.timestamp <= end_time ) )
                      .order_by(StatusHistory.timestamp.asc()) ) # Order chronologically for charting

             rows = session.execute(query).fetchall()
             results["data"] = [
                 {"timestamp": row.timestamp.isoformat(), "status": row.status, "response_time_ms": row.response_time_ms}
                 for row in rows
            ]
             current_app.logger.debug(f"Fetched {len(rows)} history records for {endpoint_id} between {start_time} and {end_time}")

    except Exception as e:
        current_app.logger.error(f"SQLAlchemy Error fetching history for {endpoint_id}: {e}", exc_info=True)
        results["error"] = "History fetch error" # Corrected key
    return results

def get_all_historical_endpoint_ids():
    """Fetches all unique endpoint_ids that have ever appeared in the history table."""
    if not _ensure_tables_exist(): return set()
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED: return set()

    try:
        with session_scope() as session:
            if session is None: return set()
            query = select(distinct(StatusHistory.endpoint_id))
            rows = session.execute(query).fetchall()
            # rows will be a list of tuples like [('ep_id_1',), ('ep_id_2',)]
            return {row[0] for row in rows}
    except Exception as e:
        current_app.logger.error(f"SQLAlchemy Error fetching distinct endpoint IDs: {e}", exc_info=True)
        return set() # Return empty set on error

def purge_endpoint_history(endpoint_id):
    """Deletes all status history records for a given endpoint_id."""
    if not _ensure_tables_exist(): return False
    if not models.ENGINE_INITIALIZED or not models.DB_TABLES_CREATED: return False

    try:
        with session_scope() as session:
            if session is None: return False
            stmt = delete(StatusHistory).where(StatusHistory.endpoint_id == endpoint_id)
            result = session.execute(stmt)
            deleted_count = result.rowcount
            current_app.logger.info(f"Purged {deleted_count} history records for endpoint '{endpoint_id}'.")
            return deleted_count > 0 # Return True if any rows were deleted
    except Exception as e:
        current_app.logger.error(f"SQLAlchemy Error purging history for {endpoint_id}: {e}", exc_info=True)
        return False