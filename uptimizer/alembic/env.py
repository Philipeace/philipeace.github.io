import os
from logging.config import fileConfig
from dotenv import load_dotenv

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Load .env file from the project root (adjust path if necessary)
project_root = os.path.join(os.path.dirname(__file__), '..')
load_dotenv(os.path.join(project_root, '.env'))

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
# --- Import Base from your models ---
# Adjust the import path based on your project structure
# Assumes alembic folder is sibling to app folder
import sys
sys.path.insert(0, project_root) # Add project root to path
from app.models import Base, DATABASE_URL
target_metadata = Base.metadata
# ------------------------------------

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.

def get_database_url():
    """Constructs database URL from environment variables."""
    user = os.getenv('DB_USER', 'uptimizer_user')
    password = os.getenv('DB_PASSWORD', 'supersecretpassword')
    host = os.getenv('DB_HOST', 'localhost')
    port = os.getenv('DB_PORT', '5432')
    db_name = os.getenv('DB_NAME', 'uptimizer_data')
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db_name}"

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = get_database_url() # Use function to get URL from env
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    # --- Use DATABASE_URL from models.py or construct it ---
    # Ensure the section name matches your alembic.ini
    ini_section = config.get_section(config.config_ini_section)
    ini_section['sqlalchemy.url'] = get_database_url() # Use function to get URL from env

    connectable = engine_from_config(
        ini_section, # Use updated section
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    # ---------------------------------------------------------

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()