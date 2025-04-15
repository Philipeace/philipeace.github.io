from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Index, MetaData
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session
from sqlalchemy.sql import func
import os
import time
from contextlib import contextmanager
from dotenv import load_dotenv
from sqlalchemy.exc import OperationalError
import logging # Use standard logging

logger = logging.getLogger(__name__) # Get logger for this module

# No need to load .env here again if main.py does it early enough
# load_dotenv()

DATABASE_URL = f"postgresql+psycopg2://{os.getenv('DB_USER', 'uptimizer_user')}:{os.getenv('DB_PASSWORD', 'supersecretpassword')}@{os.getenv('DB_HOST', 'localhost')}:{os.getenv('DB_PORT', '5432')}/{os.getenv('DB_NAME', 'uptimizer_data')}"

MAX_RETRIES = 5
RETRY_DELAY = 3
engine = None
ENGINE_INITIALIZED = False
DB_ENABLED = False
DB_TABLES_CREATED = False

# --- Engine Initialization ---
for attempt in range(MAX_RETRIES):
    try:
        logger.info(f"Attempting to create SQLAlchemy engine (Attempt {attempt + 1}/{MAX_RETRIES})...")
        engine = create_engine(DATABASE_URL, pool_recycle=3600, pool_pre_ping=True, echo=False)
        with engine.connect() as connection: # Test connection
            logger.info("SQLAlchemy engine created and connection test successful.")
            ENGINE_INITIALIZED = True
            DB_ENABLED = True
            break
    except OperationalError as e:
        logger.warning(f"SQLAlchemy engine creation failed (Attempt {attempt + 1}): {e}")
        engine = None; ENGINE_INITIALIZED = False; DB_ENABLED = False
        if attempt < MAX_RETRIES - 1:
            logger.info(f"Retrying DB connection in {RETRY_DELAY} seconds...")
            time.sleep(RETRY_DELAY)
        else:
            logger.error("FATAL: Max retries reached for DB engine connection.")
            break
    except Exception as e:
         logger.error(f"FATAL: Unexpected error creating SQLAlchemy engine: {e}", exc_info=True)
         engine = None; ENGINE_INITIALIZED = False; DB_ENABLED = False
         break

if not ENGINE_INITIALIZED:
    logger.warning("SQLAlchemy engine is None. Database operations disabled.")

# --- Session Factory ---
if ENGINE_INITIALIZED:
    session_factory = sessionmaker(bind=engine)
    Session = scoped_session(session_factory)
    logger.info("SQLAlchemy Session factory configured.")
else:
    logger.warning("Engine not initialized, providing dummy Session object.")
    class DummySession:
        def __getattr__(self, name): raise RuntimeError("Database engine failed to initialize, session unavailable.")
        def remove(self): pass # Allow remove() to be called without error
        def __enter__(self): return self # Allow use in 'with' statement (but will fail on use)
        def __exit__(self, exc_type, exc_val, exc_tb): pass
    Session = DummySession() # Use the dummy session class instance

# --- Base & Model Definition ---
metadata = MetaData()
Base = declarative_base(metadata=metadata)

class StatusHistory(Base):
    __tablename__ = 'status_history'
    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    endpoint_id = Column(String(255), nullable=False) # Remains endpoint-specific ID
    status = Column(String(50), nullable=False)
    status_code = Column(Integer, nullable=True)
    response_time_ms = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)

    __table_args__ = (Index('idx_status_history_endpoint_ts', 'endpoint_id', timestamp.desc()),)
    def __repr__(self): return f"<StatusHistory(id={self.id}, ep='{self.endpoint_id}', st='{self.status}')>"

logger.info("SQLAlchemy models defined (StatusHistory).")

# --- Session Scope ---
@contextmanager
def session_scope():
    """Provide a transactional scope around a series of operations."""
    if not ENGINE_INITIALIZED:
        logger.warning("session_scope: DB Engine not initialized, yielding None.")
        yield None # Yield None so the 'with' block can execute but session is None
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
        raise
    finally:
        logger.debug("session_scope: Removing session.")
        Session.remove()

# --- Table Creation Function (Fallback) ---
def create_db_tables():
    """Creates tables using the engine if it was initialized. Fallback for Alembic."""
    global DB_TABLES_CREATED
    if not ENGINE_INITIALIZED:
        logger.error("Cannot create tables, engine not initialized.")
        return False
    if DB_TABLES_CREATED:
        logger.info("Skipping create_db_tables: Tables already marked as created.")
        return True

    logger.warning("Attempting fallback table creation via Base.metadata.create_all()...")
    retries = 3; delay = 2; success = False
    for attempt in range(retries):
        try:
            Base.metadata.create_all(engine)
            logger.info("Fallback create_all executed successfully.")
            success = True
            break
        except OperationalError as e:
            logger.warning(f"Fallback create_all failed (Attempt {attempt + 1}/{retries}): {e}. Retrying in {delay}s...")
            time.sleep(delay)
        except Exception as e:
            logger.error(f"Unexpected error during fallback create_all: {e}", exc_info=True)
            break
    if success:
         logger.info("Fallback table creation successful.")
         DB_TABLES_CREATED = True
    else:
         logger.error("Fallback table creation failed after multiple retries.")
         DB_TABLES_CREATED = False

    return success