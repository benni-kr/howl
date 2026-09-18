import os
import sys
import json
import pytest
from alphawolf.logger import TrainingLogger

def test_logger_initialization_and_files(tmp_path):
    log_dir = str(tmp_path / "test_logs")
    logger = TrainingLogger(log_dir=log_dir, run_id="test_run_001", console_enabled=False)
    
    assert os.path.exists(logger.log_file_path)
    assert os.path.exists(logger.metrics_file_path)
    assert os.path.basename(logger.log_file_path) == "train_test_run_001.log"
    assert os.path.basename(logger.metrics_file_path) == "metrics_test_run_001.jsonl"
    
    logger.info("Test message info")
    logger.warning("Test message warning")
    logger.error("Test message error")
    logger.close()
    
    with open(logger.log_file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    assert "Test message info" in content
    assert "Test message warning" in content
    assert "Test message error" in content


def test_logger_generation_lifecycle_and_metrics(tmp_path):
    log_dir = str(tmp_path / "test_logs")
    logger = TrainingLogger(log_dir=log_dir, run_id="test_run_002", console_enabled=False)
    
    # 1. Start Gen
    logger.start_generation(gen=1, total_gens=10, stage_name="Foundations", max_grid=6, buffer_size=1200)
    
    # 2. Self Play
    logger.start_self_play(num_games=2, num_workers=2, solver_name="test_wolf")
    logger.log_game_completed(completed=1, total_games=2, m=5, n=5, rank=9, nodes=14, worker_id=1)
    logger.log_game_completed(completed=2, total_games=2, m=6, n=6, rank=11, nodes=18, worker_id=2)
    logger.end_self_play(elapsed=4.5, avg_rank=10.0, avg_nodes=16.0, data_collected=50, met_cnt=2, total_games=2, mastery_pct=1.0)
    
    # 3. Training
    logger.start_training(buffer_size=1250)
    logger.log_epoch(epoch=1, total_epochs=2, p_loss=1.2345, v_loss=0.5432)
    logger.log_epoch(epoch=2, total_epochs=2, p_loss=1.1234, v_loss=0.4321)
    logger.end_training(elapsed=2.1, epochs=2, final_p_loss=1.1234, final_v_loss=0.4321)
    
    # 4. Checkpoint & Arena
    logger.log_checkpoint("/path/to/alphawolf_gen_1.pt")
    logger.log_arena("PROMOTED", challenger_rank=840, baseline_rank=850, challenger_nodes=1100, baseline_nodes=1150, arena_time=12.3)
    
    # 5. Record JSONL metrics
    metrics_data = {
        "generation": 1,
        "stage": "Foundations",
        "self_play_time": 4.5,
        "avg_rank": 10.0,
        "final_policy_loss": 1.1234,
        "final_value_loss": 0.4321,
        "arena_status": "PROMOTED",
        "challenger_rank": 840,
        "baseline_rank": 850
    }
    logger.record_generation_metrics(metrics_data)
    logger.close()
    
    # Verify log content
    with open(logger.log_file_path, "r", encoding="utf-8") as f:
        log_text = f.read()
        assert "GENERATION 1/10" in log_text
        assert "Foundations" in log_text
        assert "5x5" in log_text
        assert "6x6" in log_text
        assert "Self-Play Summary" in log_text
        assert "Final P_Loss:   1.1234" in log_text
        assert "PROMOTED" in log_text
    
    # Verify metrics JSONL content
    with open(logger.metrics_file_path, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]
    
    assert len(lines) == 1
    loaded = json.loads(lines[0])
    assert loaded["generation"] == 1
    assert loaded["stage"] == "Foundations"
    assert loaded["arena_status"] == "PROMOTED"
    assert loaded["final_policy_loss"] == 1.1234


def test_logger_exception_handling(tmp_path):
    log_dir = str(tmp_path / "test_logs")
    logger = TrainingLogger(log_dir=log_dir, run_id="test_run_003", console_enabled=False)
    
    try:
        raise ValueError("Simulated training crash")
    except Exception as e:
        logger.log_exception(e, context="Unit Test Crash")
        
    logger.close()
    
    with open(logger.log_file_path, "r", encoding="utf-8") as f:
        log_text = f.read()
    
    assert "Unhandled exception in Unit Test Crash: Simulated training crash" in log_text
    assert "Traceback (most recent call last)" in log_text
    assert "ValueError: Simulated training crash" in log_text
