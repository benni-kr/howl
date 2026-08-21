import hashlib

# In-process memoization of canonical data. The canonical result depends only
# on the multiset of coordinates, so the key is the sorted coordinate tuple —
# a hit is byte-identical to a fresh computation. Bounded so long-running
# processes (backend) stay safe; cleared wholesale on overflow.
_CANONICAL_CACHE_LIMIT = 200_000
_canonical_cache: dict = {}


def get_transformations():
    """Returns the 8 D4 transformations as lambda functions."""
    return [
        lambda x, y: (x, y),           # Identity
        lambda x, y: (-y, x),          # Rot 90
        lambda x, y: (-x, -y),         # Rot 180
        lambda x, y: (y, -x),          # Rot 270
        lambda x, y: (-x, y),          # Reflect X
        lambda x, y: (-y, -x),         # Reflect X + Rot 90
        lambda x, y: (x, -y),          # Reflect X + Rot 180
        lambda x, y: (y, x),           # Reflect X + Rot 270
    ]


def generate_canonical_data(vertices: list[dict]) -> dict:
    """
    Generate a canonical hash and the metadata required to transform 
    any other coordinates into this exact canonical space.
    """
    if not vertices:
        return {"hash": "", "transform_idx": 0, "shift_x": 0, "shift_y": 0}

    coords = [(v["x"], v["y"]) for v in vertices]

    cache_key = tuple(sorted(coords))
    cached = _canonical_cache.get(cache_key)
    if cached is not None:
        # Return a copy so callers can never mutate the cached entry
        return dict(cached)

    transforms = get_transformations()
    
    best_string = None
    best_meta = {}

    for idx, transform in enumerate(transforms):
        transformed = [transform(x, y) for x, y in coords]
        
        min_x = min_y = float('inf')
        for x, y in transformed:
            if x < min_x: min_x = x
            if y < min_y: min_y = y
        
        normalized = sorted((x - min_x, y - min_y) for x, y in transformed)
        candidate_string = "|".join(f"{x},{y}" for x, y in normalized)
        
        if best_string is None or candidate_string < best_string:
            best_string = candidate_string
            best_meta = {
                "transform_idx": idx,
                "shift_x": min_x,
                "shift_y": min_y
            }

    md5_hash = hashlib.md5(best_string.encode('utf-8')).hexdigest()
    best_meta["hash"] = md5_hash
    best_meta["shape_str"] = best_string

    if len(_canonical_cache) >= _CANONICAL_CACHE_LIMIT:
        _canonical_cache.clear()
    _canonical_cache[cache_key] = dict(best_meta)

    return best_meta


def generate_canonical_hash(vertices: list[dict]) -> str:
    """Wrapper that just returns the canonical hash string."""
    return generate_canonical_data(vertices)["hash"]
