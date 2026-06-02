import os
import sys
import hashlib
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Add parent directory to sys.path so we can import backend modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import SubgraphDictionary

# Get DATABASE_URL (or fallback to sqlite local)
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./howl.db")
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def migrate_to_md5():
    session = SessionLocal()
    try:
        # Fetch all entries
        entries = session.query(SubgraphDictionary).all()
        print(f"Found {len(entries)} total entries in subgraph_dictionary.")
        
        updated = 0
        deleted = 0
        skipped = 0

        # Build a set of hashes we already have to prevent N+1 queries
        seen_hashes = set()

        # First pass: record all entries that are ALREADY migrated
        for entry in entries:
            if len(entry.hash) == 32 and "|" not in entry.hash:
                seen_hashes.add(entry.hash)

        for entry in entries:
            old_hash = entry.hash
            
            # If the hash is already an MD5 hash (length 32, no pipes), skip it
            if len(old_hash) == 32 and "|" not in old_hash:
                skipped += 1
                continue
                
            # Compute new MD5
            new_hash = hashlib.md5(old_hash.encode('utf-8')).hexdigest()
            
            # Check if the new hash already exists in our local memory tracking
            if new_hash in seen_hashes:
                # If it already exists, the old one is redundant and should be deleted
                print(f"Collision detected for {new_hash}. Deleting old duplicate.")
                session.delete(entry)
                deleted += 1
            else:
                # Update the primary key
                entry.hash = new_hash
                seen_hashes.add(new_hash)
                updated += 1
                
                # Periodically print progress so the user knows it's working
                if updated % 100 == 0:
                    print(f"Processed {updated} updates...")
                
        # Commit the transaction
        session.commit()
        print(f"Migration complete: {updated} updated to MD5, {deleted} duplicates deleted, {skipped} skipped.")
    
    except Exception as e:
        session.rollback()
        print(f"Migration failed: {e}")
    finally:
        session.close()

if __name__ == "__main__":
    migrate_to_md5()
