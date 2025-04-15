from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Index, MetaData
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session
from sqlalchemy.sql import func
import os
import time
from contextlib import contextmanager
from dotenv import load_dotenv
from sqlalchemy.exc import OperationalError

load_dotenv()

DATABASE_URL = f"postgresql+psycopg2://{os.getenv('DB_USER', 'uptimizer_user')}:{os.getenv('DB_PASSWORD', 'supersecretpassword')}@{os.getenv('DB_HOST', 'localhost')}:{os.getenv('DB_PORT', '5432')}/{os.getenv('DB_NAME', 'uptimizer_data')}"

MAX_RETRIES = 5
RETRY_DELAY = 3
engine = None
ENGINE_INITIALIZED = False # Define flag BEFORE engine creation attempt
DB_ENABLED = False # Define flag BEFORE engine creation attempt
DB_TABLES_CREATED = False

# --- Engine Initialization ---
for attempt in range(MAX_RETRIES):
    try:
        print(f"Attempting to create SQLAlchemy engine (Attempt {attempt + 1}/{MAX_RETRIES})...")
        engine = create_engine(DATABASE_URL, pool_recycle=3600, pool_pre_ping=True, echo=False)
        with engine.connect() as connection:
            print("SQLAlchemy engine created and connection test successful.")
            ENGINE_INITIALIZED = True # Set flag on success
            DB_ENABLED = True # Set flag on success
            break
    except OperationalError as e:
        print(f"SQLAlchemy engine creation failed (Attempt {attempt + 1}): {e}")
        engine = None; ENGINE_INITIALIZED = False; DB_ENABLED = False # Ensure flags are False on failure
        if attempt < MAX_RETRIES - 1: time.sleep(RETRY_DELAY)
        else: print("FATAL: Max retries reached for DB engine."); break
    except Exception as e:
         print(f"FATAL: Unexpected error creating SQLAlchemy engine: {e}"); engine = None; ENGINE_INITIALIZED = False; DB_ENABLED = False; break

if not ENGINE_INITIALIZED: print("WARNING: SQLAlchemy engine is None. Database operations disabled.")

# --- Session Factory ---
if ENGINE_INITIALIZED: # Use the flag set during engine init
    session_factory = sessionmaker(bind=engine)
    Session = scoped_session(session_factory)
else:
    print("WARNING: Engine not initialized, providing dummy Session.")
    class DummySession:
        def __getattr__(self, name): raise RuntimeError("DB engine failed")
        def remove(self): pass
    Session = DummySession()

# --- Base & Model Definition ---
Base = declarative_base()
metadata = MetaData()

class StatusHistory(Base):
    __tablename__ = 'status_history'
    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    endpoint_id = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False)
    status_code = Column(Integer, nullable=True)
    response_time_ms = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)
    __table_args__ = ( Index('idx_status_history_endpoint_ts', 'endpoint_id', timestamp.desc()), )
    def __repr__(self): return f"<StatusHistory(id={self.id}, ep='{self.endpoint_id}', st='{self.status}')>"

# --- Session Scope ---
@contextmanager
def session_scope():
    """Provide a transactional scope around a series of operations."""
    if not ENGINE_INITIALIZED: yield None; return
    session = Session()
    try: yield session; session.commit()
    except Exception as e: print(f"Session rollback: {e}"); session.rollback(); raise
    finally: Session.remove()

# --- Table Creation Function ---
def create_db_tables():
    """Creates tables using the engine if it was initialized."""
    global DB_TABLES_CREATED
    if not ENGINE_INITIALIZED: print("ERROR: Cannot create tables, engine not initialized."); return False
    if DB_TABLES_CREATED: print("DEBUG: Tables already marked as created."); return True
    print("Attempting to create database tables...")
    retries = 3; delay = 2; success = False
    while retries > 0:
        try:
            Base.metadata.create_all(engine)
            print("Database tables checked/created.")
            success = True
            break
        except OperationalError as e:
            print(f"WARN: create_tables failed: {e}. Retrying...")
            retries -= 1
            if retries == 0:
                print("ERROR: Max retries for create_tables.")
                break
            time.sleep(delay)
        except Exception as e:
            print(f"ERROR: Unexpected error creating tables: {e}")
            break
    DB_TABLES_CREATED = success
    return success