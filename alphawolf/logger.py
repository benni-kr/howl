"""
AlphaWolf Training Logger & Observability System
Provides two-tier logging:
1. High-detail timestamped file logs (alphawolf/logs/train_YYYYMMDD_HHMMSS.log)
2. Machine-readable structured metrics (alphawolf/logs/metrics_YYYYMMDD_HHMMSS.jsonl)
3. Compact, real-time live console UI with progress tracking and phase summaries.
"""

import os
import sys
import time
import json
import logging
import traceback
from datetime import datetime
from typing import Optional, Dict, Any


class TrainingLogger:
    def __init__(self, log_dir: Optional[str] = None, run_id: Optional[str] = None, console_enabled: bool = True):
        self.console_enabled = console_enabled
        self.is_interactive = sys.stdout.isatty() if hasattr(sys.stdout, "isatty") else False
        
        if log_dir is None:
            log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
        self.log_dir = log_dir
        os.makedirs(self.log_dir, exist_ok=True)
        
        if run_id is None:
            run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.run_id = run_id
        
        self.log_file_path = os.path.join(self.log_dir, f"train_{self.run_id}.log")
        self.metrics_file_path = os.path.join(self.log_dir, f"metrics_{self.run_id}.jsonl")
        self.latest_metrics_path = os.path.join(self.log_dir, "latest_metrics.jsonl")
        
        # Setup Python Logger for File Writing
        self.logger = logging.getLogger(f"alphawolf_train_{self.run_id}")
        self.logger.setLevel(logging.DEBUG)
        self.logger.handlers.clear()
        
        # File Handler (UTF-8)
        self.file_handler = logging.FileHandler(self.log_file_path, encoding="utf-8")
        self.file_handler.setLevel(logging.DEBUG)
        formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
        self.file_handler.setFormatter(formatter)
        self.logger.addHandler(self.file_handler)
        
        # Open metrics file pointer
        self._metrics_file = open(self.metrics_file_path, "a", encoding="utf-8")
        
        # Internal state tracking
        self._self_play_start_time = 0.0
        self._last_progress_str_len = 0
        self._self_play_ranks = []
        self._self_play_lengths = []
        
        self.log_file_only(f"=== AlphaWolf Training Run Initialized: {self.run_id} ===")
        self.log_file_only(f"Log File    : {self.log_file_path}")
        self.log_file_only(f"Metrics File: {self.metrics_file_path}")
        
    def log_file_only(self, message: str, level: int = logging.INFO):
        """Writes message strictly to the log file without console output."""
        self.logger.log(level, message)
        self.file_handler.flush()

    def info(self, message: str):
        """Logs info to file and prints directly to console."""
        self.logger.info(message)
        self.file_handler.flush()
        if self.console_enabled:
            self._clear_line_if_needed()
            print(message)

    def warning(self, message: str):
        self.logger.warning(message)
        self.file_handler.flush()
        if self.console_enabled:
            self._clear_line_if_needed()
            print(f"[WARNING] {message}")

    def error(self, message: str):
        self.logger.error(message)
        self.file_handler.flush()
        if self.console_enabled:
            self._clear_line_if_needed()
            print(f"[ERROR] {message}")

    def log_exception(self, exc: BaseException, context: str = "Training Loop"):
        tb = traceback.format_exc()
        msg = f"Unhandled exception in {context}: {exc}\n{tb}"
        self.logger.error(msg)
        self.file_handler.flush()
        if self.console_enabled:
            self._clear_line_if_needed()
            print(f"\n[FATAL ERROR in {context}] {exc}")
            print(f"Full stack trace saved to: {self.log_file_path}")

    def _clear_line_if_needed(self):
        if self.is_interactive and self._last_progress_str_len > 0:
            sys.stdout.write("\r" + " " * self._last_progress_str_len + "\r")
            sys.stdout.flush()
            self._last_progress_str_len = 0

    # ------------------------------------------------------------------------
    # Generation Lifecycle Callbacks
    # ------------------------------------------------------------------------

    def start_generation(self, gen: int, total_gens: int, stage_name: str, max_grid: int, buffer_size: int):
        self._clear_line_if_needed()
        divider = "=" * 80
        gen_header = f" GENERATION {gen}/{total_gens} | Stage: {stage_name} (Max: {max_grid}x{max_grid}) | Buffer: {buffer_size:,}"
        
        self.log_file_only(divider)
        self.log_file_only(gen_header)
        self.log_file_only(divider)
        
        if self.console_enabled:
            print("\n" + divider)
            print(gen_header)
            print(divider)

    def start_self_play(self, num_games: int, num_workers: int, solver_name: str):
        self._self_play_start_time = time.time()
        self._self_play_ranks = []
        self._self_play_lengths = []
        self._last_progress_str_len = 0
        
        self.log_file_only(f"[PHASE 1] Self-Play ({num_games} games | {num_workers} workers | solver: '{solver_name}')")
        self.log_file_only(f"{'Game':<9} | {'Time':<8} | {'Grid':<6} | {'Rank':<4} | {'Nodes':<5} | {'Worker':<7}")
        self.log_file_only("-" * 65)

    def log_game_completed(self, completed: int, total_games: int, m: int, n: int, rank: int, nodes: int, worker_id: int):
        self._self_play_ranks.append(rank)
        self._self_play_lengths.append(nodes)
        
        cur_time = time.strftime("%H:%M:%S")
        grid_str = f"{m}x{n}"
        self.log_file_only(f"[{completed:>2}/{total_games}] | {cur_time} | {grid_str:<6} | {rank:<4} | {nodes:<5} | #{worker_id}")
        
        if not self.console_enabled:
            return
            
        elapsed = time.time() - self._self_play_start_time
        pct = (completed / total_games) * 100.0 if total_games > 0 else 100.0
        avg_r = sum(self._self_play_ranks) / len(self._self_play_ranks)
        
        # Render a clean progress bar
        bar_len = 16
        filled = int(round(bar_len * (completed / total_games))) if total_games > 0 else bar_len
        bar = "=" * filled + "-" * (bar_len - filled)
        
        progress_str = f"  [1/3] Self-Play  : [{bar}] {completed:>2}/{total_games} ({pct:>5.1f}%) | {elapsed:.1f}s | Last: {grid_str} r={rank} | AvgR: {avg_r:.1f}"
        
        if self.is_interactive:
            sys.stdout.write("\r" + progress_str)
            sys.stdout.flush()
            self._last_progress_str_len = len(progress_str)
        else:
            # For redirected logs (tests/background), log milestone lines cleanly
            if completed == 1 or completed == total_games or completed % max(1, total_games // 4) == 0:
                print(progress_str)

    def end_self_play(self, elapsed: float, avg_rank: float, avg_nodes: float, data_collected: int,
                      met_cnt: Optional[int] = None, total_games: Optional[int] = None, mastery_pct: Optional[float] = None):
        self._clear_line_if_needed()
        tot = total_games if total_games is not None else len(self._self_play_ranks)
        mastery_str = f" | Mastery: {met_cnt}/{tot} ({mastery_pct:.1%})" if (met_cnt is not None and mastery_pct is not None) else ""
        
        summary_file = (
            f"Self-Play Summary: {elapsed:.1f}s | Avg Rank: {avg_rank:.1f} | Avg Nodes: {avg_nodes:.1f}{mastery_str} | Data: +{data_collected}"
        )
        self.log_file_only("-" * 65)
        self.log_file_only(summary_file)
        
        if self.console_enabled:
            bar = "=" * 16
            console_summary = (
                f"  [1/3] Self-Play  : [{bar}] {tot}/{tot} (100%) | {elapsed:.1f}s | "
                f"Avg Rank: {avg_rank:.1f} | Avg Nodes: {avg_nodes:.1f}{mastery_str}"
            )
            print(console_summary)

    def log_stage_promotion(self, reason: str, next_stage_name: str, next_max_size: int):
        self._clear_line_if_needed()
        promo_msg = f"  >>> STAGE PROMOTION! Reason: {reason} -> Advancing to: {next_stage_name} ({next_max_size}x{next_max_size})"
        self.log_file_only(promo_msg)
        if self.console_enabled:
            print(promo_msg)

    def start_training(self, buffer_size: int):
        self.log_file_only(f"[PHASE 2] Network Training ({buffer_size:,} total samples in buffer)")
        self.log_file_only("-" * 65)

    def log_epoch(self, epoch: int, total_epochs: int, p_loss: float, v_loss: float):
        self.log_file_only(f"  Epoch {epoch:>2}/{total_epochs:>2} | Policy Loss: {p_loss:8.4f} | Value Loss: {v_loss:8.4f}")

    def end_training(self, elapsed: float, epochs: int, final_p_loss: float, final_v_loss: float):
        self.log_file_only("-" * 65)
        self.log_file_only(f"Training Summary: {elapsed:.1f}s | Final P_Loss: {final_p_loss:8.4f} | Final V_Loss: {final_v_loss:8.4f}")
        
        if self.console_enabled:
            self._clear_line_if_needed()
            print(f"  [2/3] Training   : {epochs} Epochs in {elapsed:.1f}s | P-Loss: {final_p_loss:8.4f} | V-Loss: {final_v_loss:8.4f}")

    def log_checkpoint(self, ckpt_path: str):
        self.log_file_only(f"[PHASE 3] Validation & Checkpointing")
        self.log_file_only(f"  Saved Checkpoint: {ckpt_path}")
        if self.console_enabled:
            self._clear_line_if_needed()
            # Print relative path if possible for cleaner output
            display_path = os.path.relpath(ckpt_path, os.getcwd()) if os.path.isabs(ckpt_path) else ckpt_path
            print(f"  Checkpoint saved : {display_path}")

    def log_arena(self, status: str, challenger_rank: Optional[int] = None, baseline_rank: Optional[int] = None,
                  challenger_nodes: Optional[int] = None, baseline_nodes: Optional[int] = None,
                  arena_time: Optional[float] = None, reason: Optional[str] = None):
        if status.upper() == "SKIPPED":
            msg = f"  [3/3] Arena      : Skipped ({reason})"
            self.log_file_only(msg)
            if self.console_enabled:
                self._clear_line_if_needed()
                print(msg)
        else:
            time_str = f"{arena_time:.1f}s" if arena_time is not None else "0.0s"
            nodes_str = f"nodes: {challenger_nodes} vs {baseline_nodes}" if challenger_nodes is not None else ""
            console_msg = f"  [3/3] Arena      : {status.upper()} (Challenger: {challenger_rank} vs Baseline: {baseline_rank}) | {time_str}"
            file_msg = f"Arena Evaluation -> Status: {status.upper()} | Challenger: Rank {challenger_rank}, Nodes {challenger_nodes} | Baseline: Rank {baseline_rank}, Nodes {baseline_nodes} | Time: {time_str}"
            
            self.log_file_only(file_msg)
            if self.console_enabled:
                self._clear_line_if_needed()
                print(console_msg)

    def record_generation_metrics(self, metrics: Dict[str, Any]):
        """Appends a structured JSON object for the generation to metrics.jsonl."""
        line = json.dumps(metrics)
        self._metrics_file.write(line + "\n")
        self._metrics_file.flush()
        
        # Also maintain a symlink/copy of the latest metrics file
        try:
            with open(self.latest_metrics_path, "a", encoding="utf-8") as lf:
                lf.write(line + "\n")
        except Exception:
            pass

    def close(self):
        """Flushes and cleanly closes all file handlers."""
        self._clear_line_if_needed()
        if hasattr(self, "_metrics_file") and not self._metrics_file.closed:
            self._metrics_file.flush()
            self._metrics_file.close()
        if hasattr(self, "file_handler") and self.file_handler:
            self.file_handler.flush()
            self.file_handler.close()
            self.logger.removeHandler(self.file_handler)
