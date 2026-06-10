---
name: update-canonical-hashing
description: Step-by-step instructions for safely modifying the D4 canonical hashing algorithm. Use this when modifying core_engine/hashing.py.
---

# Update Canonical Hashing Skill

The canonical hashing algorithm maps any 2D grid shape to a unique string that is invariant under the Dihedral group $D_4$ (translations, 4 rotations, and 2 reflections). This is crucial for the Subgraph Dictionary cache hit rate.

## When to use this skill
- Modifying `core_engine/hashing.py`
- Altering the shape representation string
- Optimizing database query keys

## How to execute safely

1. **Understand the Pipeline**:
   - Translate shape to origin `(0,0)`.
   - Apply the 8 symmetry transformations.
   - Sort the vertices lexicographically for each transformation.
   - The canonical hash is the *hash of the minimum* lexicographical string out of the 8. We already hash the string to maintain compactness.

2. **Run Tests First**:
   - Before modifying, ensure you run existing tests. Any change to the hash format will invalidate the entire production `subgraph_dictionary` database.
   
3. **Drafting Changes**:
   - If you change the underlying logic of what determines symmetry or hashing, you must write a migration script to update existing `howl.db` entries.

4. **Verify Symmetries**:
   - Create a test shape (e.g., an L-shape) and assert that its 90-degree rotation yields the exact same hash string after your changes.
