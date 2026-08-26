"""
Unit Tests for AlphaWolf GNN Architecture, Message Passing, Size-Agnostic Scaling, and Backward Pass.
"""

import pytest
import torch
import torch.nn.functional as F
import torch.optim as optim
import torch_geometric.utils as pyg_utils
from torch_geometric.data import Batch
from torch_geometric.loader import DataLoader

from envs.howl_env import HowlEnv
from models.net import AlphaWolfGNN, grid_tensor_to_pyg_data


def test_gnn_forward_and_node_level_logits():
    """Test size-agnostic forward pass through AlphaWolfGNN returning node logits."""
    net = AlphaWolfGNN(hidden_channels=64, num_layers=2)
    net.eval()

    env1 = HowlEnv(5, 5)
    obs1, _ = env1.reset()
    env1.step((2, 2))  # Cut middle vertex

    env2 = HowlEnv(7, 7)
    obs2, _ = env2.reset()

    # 1. Single PyG Data object from to_pyg_data()
    pyg_data1 = env1.to_pyg_data()
    assert pyg_data1.x.shape == (24, 4)  # 25 - 1 cut = 24 active nodes
    assert pyg_data1.coords.shape == (24, 2)
    
    p_logits1, v1 = net(pyg_data1)
    assert p_logits1.shape == (24,)
    assert v1.shape == (1, 1)

    # 2. PyG Batching with variable graph sizes
    pyg_data2 = env2.to_pyg_data()
    assert pyg_data2.x.shape == (49, 4)  # 7x7 = 49 active nodes
    
    batch = Batch.from_data_list([pyg_data1, pyg_data2])
    total_nodes = 24 + 49
    p_logits_batch, v_batch = net(batch)
    assert p_logits_batch.shape == (total_nodes,)
    assert v_batch.shape == (2, 1)

    # 3. Segmented Softmax over active vertices
    probs = pyg_utils.softmax(p_logits_batch, batch.batch)
    assert probs.shape == (total_nodes,)
    # Graph 1 probs sum to 1.0
    assert torch.isclose(probs[:24].sum(), torch.tensor(1.0), atol=1e-5)
    # Graph 2 probs sum to 1.0
    assert torch.isclose(probs[24:].sum(), torch.tensor(1.0), atol=1e-5)


def test_gnn_variable_sized_batch_forward_and_backward():
    """Test optimizer step and loss balancing across variable-sized graphs (4x4, 7x7, 15x15)."""
    net = AlphaWolfGNN(hidden_channels=64, num_layers=2)
    net.train()

    env_4x4 = HowlEnv(4, 4)
    env_7x7 = HowlEnv(7, 7)
    env_15x15 = HowlEnv(15, 15)

    data1 = env_4x4.to_pyg_data()    # 16 nodes
    data2 = env_7x7.to_pyg_data()    # 49 nodes
    data3 = env_15x15.to_pyg_data()  # 225 nodes

    # Set uniform target policies matching each graph's active node count
    data1.node_pi = torch.ones(16, dtype=torch.float32) / 16
    data1.v = torch.tensor([[7.0]], dtype=torch.float32)

    data2.node_pi = torch.ones(49, dtype=torch.float32) / 49
    data2.v = torch.tensor([[13.0]], dtype=torch.float32)

    data3.node_pi = torch.ones(225, dtype=torch.float32) / 225
    data3.v = torch.tensor([[28.0]], dtype=torch.float32)

    loader = DataLoader([data1, data2, data3], batch_size=3)
    optimizer = optim.Adam(net.parameters(), lr=1e-3)

    for batch in loader:
        node_p_logits, v_pred = net(batch)
        total_nodes = 16 + 49 + 225
        assert node_p_logits.shape == (total_nodes,)
        assert v_pred.shape == (3, 1)

        # PyG Segmented Softmax Loss across variable graph sizes
        log_probs = pyg_utils.softmax(node_p_logits, batch.batch).clamp(min=1e-12).log()
        policy_loss = -torch.sum(batch.node_pi * log_probs) / batch.num_graphs
        value_loss = F.mse_loss(v_pred.squeeze(-1), batch.v.squeeze(-1))
        
        # Maintain 0.5 value loss weighting ratio
        loss = policy_loss + 0.5 * value_loss

        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

    # Assert gradients exist and are finite
    for p in net.parameters():
        if p.requires_grad:
            assert p.grad is not None
            assert not torch.isnan(p.grad).any()


def test_dynamic_env_large_boards_and_coordinate_actions():
    """Verify that HowlEnv seamlessly handles 15x15 and 20x20 boards with coordinate actions."""
    env = HowlEnv(15, 15)
    obs, _ = env.reset()
    assert obs.shape == (5, 15, 15)
    assert len(env.graph.vertices) == 225

    # 1. Coordinate action
    obs, reward, terminated, _, info = env.step((7, 7))
    assert reward == -1
    assert not terminated
    assert len(env.graph.vertices) == 224
    assert (7, 7) not in env.graph.vertices

    # 2. Integer action backward compatibility (row * n + col)
    obs, reward, terminated, _, info = env.step(0)
    assert (0, 0) not in env.graph.vertices
    assert len(env.graph.vertices) == 223

    # 3. Direct PyG export
    pyg_data = env.to_pyg_data()
    assert pyg_data.x.shape == (223, 4)
    assert pyg_data.coords.shape == (223, 2)
    assert pyg_data.m == 15
    assert pyg_data.n == 15

    # 4. Even larger 20x20 board
    env20 = HowlEnv(20, 20)
    obs20, _ = env20.reset()
    assert obs20.shape == (5, 20, 20)
    assert len(env20.graph.vertices) == 400
