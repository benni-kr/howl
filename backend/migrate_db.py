import os
from sqlalchemy import create_engine, text

# Get DATABASE_URL (or fallback to sqlite local)
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./howl.db")
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(SQLALCHEMY_DATABASE_URL)

def run_migration():
    # Use JSONB if running on postgres, else fallback to SQLite parsing or JSON
    is_postgres = "postgresql" in SQLALCHEMY_DATABASE_URL
    col_type = "JSONB" if is_postgres else "JSON"
    
    with engine.begin() as conn:
        try:
            print(f"Adding best_cut_sequence column as {col_type}...")
            conn.execute(text(f"ALTER TABLE subgraph_dictionary ADD COLUMN best_cut_sequence {col_type};"))
            print("best_cut_sequence column added.")
        except Exception as e:
            print(f"Migration for best_cut_sequence skipped: {e}")
            
        try:
            print(f"Adding discovered_by column as VARCHAR...")
            conn.execute(text(f"ALTER TABLE subgraph_dictionary ADD COLUMN discovered_by VARCHAR;"))
            print("discovered_by column added.")
        except Exception as e:
            print(f"Migration for discovered_by skipped: {e}")

        try:
            print(f"Adding last_updated column as TIMESTAMP...")
            if is_postgres:
                conn.execute(text(f"ALTER TABLE subgraph_dictionary ADD COLUMN last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP;"))
            else:
                conn.execute(text(f"ALTER TABLE subgraph_dictionary ADD COLUMN last_updated TIMESTAMP;"))
                conn.execute(text(f"UPDATE subgraph_dictionary SET last_updated = CURRENT_TIMESTAMP;"))
            print("last_updated column added.")
        except Exception as e:
            print(f"Migration for last_updated skipped: {e}")

if __name__ == "__main__":
    run_migration()
