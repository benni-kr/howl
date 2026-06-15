import sqlite3
import pandas as pd

conn = sqlite3.connect('../backend/howl.db')
query = """
SELECT m, n, best_rank
FROM grid_solutions
ORDER BY m * n ASC
"""
df = pd.read_sql_query(query, conn)
print("--- Best Ranks in DB (GNN + Human combined) ---")
print(df.to_string(index=False))
conn.close()
