"""
Checkpoint Management for AlphaWolf.

Handles saving and loading of model weights and training states (optimizer,
scheduler, generation metadata) with full backward compatibility for legacy
raw state_dict files.
"""

import collections
import glob
import os
import re
import torch


DEFAULT_CHECKPOINT_DIR = os.path.join(os.path.dirname(__file__), "models/checkpoints")


def find_latest_checkpoint(ckpt_dir: str = DEFAULT_CHECKPOINT_DIR) -> str | None:
    """
        Finds the latest generation checkpoint file (highest integer generation)
    in the specified directory. Falls back to best_model.pt if no generation
    checkpoints exist.
    """
    if not os.path.exists(ckpt_dir):
        return None

    pattern = os.path.join(ckpt_dir, "alphawolf_gen_*.pt")
    files = glob.glob(pattern)

    gen_files = []
    for f in files:
        match = re.search(r"alphawolf_gen_(\d+)\.pt$", os.path.basename(f))
        if match:
            gen_files.append((int(match.group(1)), f))

    if gen_files:
        gen_files.sort(key=lambda x: x[0], reverse=True)
        return gen_files[0][1]

    # Fallback to best_model.pt
    best_path = os.path.join(ckpt_dir, "best_model.pt")
    if os.path.exists(best_path):
        return best_path

    return None


def resolve_checkpoint_path(resume_target: str | bool | None, ckpt_dir: str = DEFAULT_CHECKPOINT_DIR) -> str | None:
    """
    Resolves a user resume argument to an absolute checkpoint path.

    - True / "latest" / "auto" -> latest generation file or best_model.pt
    - "best" -> models/checkpoints/best_model.pt
    - path string -> explicit path
    - None / False -> None (fresh start)
    """
    if not resume_target or resume_target is False:
        return None

    if resume_target is True or resume_target in ("latest", "auto"):
        return find_latest_checkpoint(ckpt_dir)

    if resume_target == "best":
        best_path = os.path.join(ckpt_dir, "best_model.pt")
        return best_path if os.path.exists(best_path) else None

    # Explicit path (relative or absolute)
    if os.path.isabs(resume_target):
        path = resume_target
    else:
        if os.path.exists(resume_target):
            path = os.path.abspath(resume_target)
        else:
            cand = os.path.join(ckpt_dir, resume_target)
            if os.path.exists(cand):
                path = cand
            else:
                cand2 = os.path.join(os.path.dirname(__file__), resume_target)
                path = cand2 if os.path.exists(cand2) else os.path.abspath(resume_target)

    return path if os.path.exists(path) else None


def load_checkpoint(
    ckpt_path: str,
    net: torch.nn.Module,
    optimizer: torch.optim.Optimizer | None = None,
    scheduler: torch.optim.lr_scheduler.LRScheduler | None = None,
    device: torch.device | str = "cpu"
) -> tuple[int, dict]:
    """
    Loads a checkpoint into `net` (and optionally `optimizer` and `scheduler`).
    
    Supports:
    1. Full checkpoint dicts: {"generation": int, "model_state_dict": dict, "optimizer_state_dict": dict, ...}
    2. Raw PyTorch state_dict files: OrderedDict of layer weights.
    
    Returns:
        (last_completed_generation: int, metadata: dict)
    """
    if not os.path.exists(ckpt_path):
        raise FileNotFoundError(f"Checkpoint file not found: {ckpt_path}")

    try:
        ckpt_data = torch.load(ckpt_path, map_location=device, weights_only=True)
    except Exception:
        ckpt_data = torch.load(ckpt_path, map_location=device, weights_only=False)

    def _safe_load_state_dict(model, state_dict):
        try:
            model.load_state_dict(state_dict)
        except RuntimeError as e:
            if "size mismatch" in str(e) or "shape" in str(e):
                raise RuntimeError(
                    f"Checkpoint loading failed due to architecture/shape mismatch in '{ckpt_path}'. "
                    f"This indicates loading a legacy checkpoint into the upgraded 9-channel D4-invariant GNN. "
                    f"Please start a fresh training run using '--fresh' or specify an updated checkpoint."
                ) from e
            raise

    if isinstance(ckpt_data, dict) and "model_state_dict" in ckpt_data:
        _safe_load_state_dict(net, ckpt_data["model_state_dict"])

        if optimizer is not None and ckpt_data.get("optimizer_state_dict") is not None:
            try:
                optimizer.load_state_dict(ckpt_data["optimizer_state_dict"])
            except Exception as e:
                print(f"Warning: Could not restore optimizer state ({e}). Using fresh optimizer.")

        if scheduler is not None and ckpt_data.get("scheduler_state_dict") is not None:
            try:
                scheduler.load_state_dict(ckpt_data["scheduler_state_dict"])
            except Exception as e:
                print(f"Warning: Could not restore scheduler state ({e}).")

        generation = ckpt_data.get("generation", 0)
        return generation, ckpt_data

    elif isinstance(ckpt_data, (dict, collections.OrderedDict)):
        # Raw state dict
        _safe_load_state_dict(net, ckpt_data)
        match = re.search(r"alphawolf_gen_(\d+)\.pt$", os.path.basename(ckpt_path))
        generation = int(match.group(1)) if match else 0
        return generation, {"model_state_dict": ckpt_data}

    else:
        raise ValueError(f"Unrecognized checkpoint format in {ckpt_path}: {type(ckpt_data)}")


def save_checkpoint(
    ckpt_path: str,
    net: torch.nn.Module,
    optimizer: torch.optim.Optimizer | None = None,
    scheduler: torch.optim.lr_scheduler.LRScheduler | None = None,
    generation: int = 0,
    solver_name: str = "alphawolf2",
    metrics: dict | None = None,
    curriculum_state: dict | None = None,
    extra: dict | None = None
) -> str:
    """
    Saves a comprehensive training checkpoint with weights, optimizer state,
    scheduler state, generation index, curriculum progression state, and metadata.
    """
    os.makedirs(os.path.dirname(os.path.abspath(ckpt_path)), exist_ok=True)

    payload = {
        "generation": generation,
        "model_state_dict": net.state_dict(),
        "optimizer_state_dict": optimizer.state_dict() if optimizer is not None else None,
        "scheduler_state_dict": scheduler.state_dict() if scheduler is not None else None,
        "solver_name": solver_name,
        "metrics": metrics or {},
        "curriculum_state": curriculum_state,
    }
    if extra:
        payload.update(extra)

    torch.save(payload, ckpt_path)
    return ckpt_path


def save_replay_buffer(buffer: list, buffer_path: str, max_samples: int | None = None) -> str:
    """
    Atomically saves the active replay buffer to disk.
    Tensors are ensured to be on CPU before saving.
    """
    os.makedirs(os.path.dirname(os.path.abspath(buffer_path)), exist_ok=True)
    samples = list(buffer)
    if max_samples is not None and len(samples) > max_samples:
        samples = samples[-max_samples:]
        
    for data in samples:
        if hasattr(data, "x") and data.x is not None:
            data.x = data.x.cpu()
        if hasattr(data, "edge_index") and data.edge_index is not None:
            data.edge_index = data.edge_index.cpu()
        if hasattr(data, "coords") and data.coords is not None:
            data.coords = data.coords.cpu()
        if hasattr(data, "node_pi") and data.node_pi is not None:
            data.node_pi = data.node_pi.cpu()
        if hasattr(data, "flat_indices") and data.flat_indices is not None:
            data.flat_indices = data.flat_indices.cpu()
        if hasattr(data, "pi") and data.pi is not None:
            data.pi = data.pi.cpu()
        if hasattr(data, "v") and data.v is not None:
            data.v = data.v.cpu()

    tmp_path = buffer_path + ".tmp"
    torch.save(samples, tmp_path)
    if os.path.exists(buffer_path):
        os.replace(tmp_path, buffer_path)
    else:
        os.rename(tmp_path, buffer_path)
    return buffer_path


def load_replay_buffer(buffer_path: str, max_samples: int | None = None, expected_features: int = 8) -> list:
    """
    Loads a persisted replay buffer from disk, filtering out samples with incompatible feature dimensions.
    """
    if not os.path.exists(buffer_path):
        return []
    try:
        samples = torch.load(buffer_path, map_location="cpu", weights_only=False)
        if isinstance(samples, list):
            valid_samples = []
            for s in samples:
                if hasattr(s, "x") and s.x is not None and s.x.numel() > 0:
                    if s.x.size(-1) == expected_features:
                        valid_samples.append(s)
                else:
                    valid_samples.append(s)
            if max_samples is not None and len(valid_samples) > max_samples:
                valid_samples = valid_samples[-max_samples:]
            return valid_samples
    except Exception as e:
        print(f"Warning: Could not load replay buffer from {buffer_path} ({e}). Starting with empty buffer.")
    return []
