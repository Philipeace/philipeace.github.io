from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Index, MetaData
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session
from sqlalchemy.sql import func
import os
import time
from contextlib import contextmanager
from dotenv import load_dotenv
from sqlalchemy.exc import OperationalError
import logging # <<<--- Import logging

logger = logging.getLogger(__name__) # <<<--- Get logger

load_dotenv() # Load env vars for DB URL construction

DATABASE_URL = f"postgresql+psycopg2://{os.getenv('DB_USER', 'uptimizer_user')}:{os.getenv('DB_PASSWORD', 'supersecretpassword')}@{os.getenv('DB_HOST', 'localhost')}:{os.getenv('DB_PORT', '5432')}/{os.getenv('DB_NAME', 'uptimizer_data')}"

MAX_RETRIES = 5
RETRY_DELAY = 3
engine = None
ENGINE_INITIALIZED = False # Define flag BEFORE engine creation attempt
DB_ENABLED = False # Define flag BEFORE engine creation attempt
DB_TABLES_CREATED = False # This flag now indicates if Alembic migrations succeeded (or fallback create_all)

# --- Engine Initialization ---
for attempt in range(MAX_RETRIES):
    try:
        logger.info(f"Attempting to create SQLAlchemy engine (Attempt {attempt + 1}/{MAX_RETRIES})...")
        engine = create_engine(DATABASE_URL, pool_recycle=3600, pool_pre_ping=True, echo=False)
        # Test connection
        with engine.connect() as connection:
            logger.info("SQLAlchemy engine created and connection test successful.")
            ENGINE_INITIALIZED = True # Set flag on success
            DB_ENABLED = True # Set flag on success
            break # Exit loop on success
    except OperationalError as e:
        logger.warning(f"SQLAlchemy engine creation failed (Attempt {attempt + 1}): {e}")
        engine = None; ENGINE_INITIALIZED = False; DB_ENABLED = False # Ensure flags are False on failure
        if attempt < MAX_RETRIES - 1:
            logger.info(f"Retrying DB connection in {RETRY_DELAY} seconds...")
            time.sleep(RETRY_DELAY)
        else:
            logger.error("FATAL: Max retries reached for DB engine connection.")
            break # Exit loop after max retries
    except Exception as e:
         logger.error(f"FATAL: Unexpected error creating SQLAlchemy engine: {e}", exc_info=True)
         engine = None; ENGINE_INITIALIZED = False; DB_ENABLED = False
         break # Exit loop on unexpected error

if not ENGINE_INITIALIZED:
    logger.warning("SQLAlchemy engine is None. Database operations disabled.")

# --- Session Factory ---
if ENGINE_INITIALIZED: # Use the flag set during engine init
    session_factory = sessionmaker(bind=engine)
    Session = scoped_session(session_factory)
    logger.info("SQLAlchemy Session factory configured.")
else:
    logger.warning("Engine not initialized, providing dummy Session object.")
    # Provide a dummy session object that raises errors if used
    class DummySession:
        def __getattr__(self, name):
            raise RuntimeError("Database engine failed to initialize, session unavailable.")
        def remove(self): pass # Allow remove() to be called without error
    Session = DummySession()

# --- Base & Model Definition ---
# Use a consistent MetaData instance, required by Alembic env.py default config
metadata = MetaData()
Base = declarative_base(metadata=metadata) # <<<--- Associate Base with metadata

class StatusHistory(Base):
    __tablename__ = 'status_history'
    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    endpoint_id = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False)
    status_code = Column(Integer, nullable=True)
    response_time_ms = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)

    # Index for faster lookups by endpoint_id and timestamp
    __table_args__ = (
        Index('idx_status_history_endpoint_ts', 'endpoint_id', timestamp.desc()),
    )

    def __repr__(self):
        return f"<StatusHistory(id={self.id}, ep='{self.endpoint_id}', st='{self.status}')>"

logger.info("SQLAlchemy models defined (StatusHistory).")

# --- Session Scope ---
@contextmanager
def session_scope():
    """Provide a transactional scope around a series of operations."""
    if not ENGINE_INITIALIZED:
        logger.warning("session_scope: DB Engine not initialized, returning None.")
        yield None
        return

    session = Session()
    logger.debug("session_scope: Session created.")
    try:
        yield session
        session.commit()
        logger.debug("session_scope: Session committed.")
    except Exception as e:
        logger.error(f"session_scope: Exception occurred, rolling back session: {e}", exc_info=True)
        session.rollback()
        raise # Re-raise the exception after rollback
    finally:
        logger.debug("session_scope: Removing session.")
        Session.remove()

# --- Table Creation Function (Fallback / Less relevant with Alembic) ---
def create_db_tables():
    """
    Creates tables using the engine if it was initialized.
    NOTE: Primarily intended as a fallback if Alembic fails. Alembic should manage the schema.
    """
    global DB_TABLES_CREATED # We still update this flag
    if not ENGINE_INITIALIZED:
        logger.error("Cannot create tables, engine not initialized.")
        return False
    # Don't run if Alembic likely succeeded (flag already True)
    if DB_TABLES_CREATED:
        logger.info("Skipping create_db_tables: Tables already marked as created (likely by Alembic).")
        return True

    logger.warning("Attempting fallback table creation via Base.metadata.create_all()...")
    retries = 3; delay = 2; success = False
    for attempt in range(retries):
        try:
            Base.metadata.create_all(engine) # Use the metadata associated with Base
            logger.info("Fallback create_all executed successfully.")
            success = True
            break # Exit loop on success
        except OperationalError as e:
            logger.warning(f"Fallback create_all failed (Attempt {attempt + 1}/{retries}): {e}. Retrying in {delay}s...")
            time.sleep(delay)
        except Exception as e:
            logger.error(f"Unexpected error during fallback create_all: {e}", exc_info=True)
            break # Exit loop on unexpected error
    if success:
         logger.info("Fallback table creation successful.")
         DB_TABLES_CREATED = True # Mark as created even if by fallback
    else:
         logger.error("Fallback table creation failed after multiple retries.")
         DB_TABLES_CREATED = False # Ensure flag is false if fallback fails

    return success