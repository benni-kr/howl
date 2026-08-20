"""
Unit Tests for AlphaWolf GNN Architecture, Message Passing, and Backward Pass.
"""

import pytest
import torch
import torch.nn.functional as F
import torch.optim as optim
from torch_geometric.data import Batch
from torch_geometric.loader import DataLoader

from envs.howl_env import HowlEnv
from models.net import AlphaWolfGNN, grid_tensor_to_pyg_data


def test_gnn_forward_and_action_masking():
    """Test single observation and batched forward pass through AlphaWolfGNN."""
    net = AlphaWolfGNN(hidden_channels=64, num_layers=2)
    net.eval()

    env1 = HowlEnv(5, 5)
    obs1, _ = env1.reset()
    env1.step(5)
    obs1 = env1._get_obs()

    env2 = HowlEnv(7, 7)
    obs2, _ = env2.reset()

    # 1. Single tensor auto-conversion
    state_tensor = torch.tensor(obs1, dtype=torch.float32).unsqueeze(0)
    p_logits, v = net(state_tensor)
    assert p_logits.shape == (1, 100)
    assert v.shape == (1, 1)

    # 2. PyG Batching
    pyg_data1 = grid_tensor_to_pyg_data(torch.tensor(obs1, dtype=torch.float32))
    pyg_data2 = grid_tensor_to_pyg_data(torch.tensor(obs2, dtype=torch.float32))
    batch = Batch.from_data_list([pyg_data1, pyg_data2])

    p_logits_batch, v_batch = net(batch)
    assert p_logits_batch.shape == (2, 100)
    assert v_batch.shape == (2, 1)

    # 3. Action Masking (Scatter Mapping)
    inactive_mask = (torch.tensor(obs1[0]) == 0).flatten()
    assert torch.all(p_logits[0][inactive_mask] == -1e9)

    active_mask = (torch.tensor(obs1[0]) == 1).flatten()
    assert torch.all(p_logits[0][active_mask] > -1e9)


def test_gnn_backward_pass():
    """Test optimizer step and gradient flow through AlphaWolfGNN."""
    net = AlphaWolfGNN(hidden_channels=64, num_layers=2)
    net.train()

    env = HowlEnv(5, 5)
    obs, _ = env.reset()
    pyg_data1 = grid_tensor_to_pyg_data(torch.tensor(obs, dtype=torch.float32))
    pyg_data2 = grid_tensor_to_pyg_data(torch.tensor(obs, dtype=torch.float32))

    optimizer = optim.Adam(net.parameters(), lr=1e-3)
    loader = DataLoader([pyg_data1, pyg_data2], batch_size=2)

    for batch in loader:
        p_logits, v_pred = net(batch)

        dummy_pi = torch.ones_like(p_logits) / 100
        dummy_v = torch.zeros_like(v_pred)

        p_loss = F.cross_entropy(p_logits, dummy_pi)
        v_loss = F.mse_loss(v_pred.squeeze(), dummy_v.squeeze())
        loss = p_loss + v_loss

        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

    # Assert gradients exist
    for p in net.parameters():
        if p.requires_grad:
            assert p.grad is not None
