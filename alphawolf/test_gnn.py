import torch
from envs.howl_env import HowlEnv
from models.net import AlphaWolfGNN, grid_tensor_to_pyg_data
from torch_geometric.data import Batch

def test_gnn_architecture():
    print("Initializing GNN...")
    net = AlphaWolfGNN(hidden_channels=64, num_layers=2)
    
    # 1. Test single tensor conversion
    env1 = HowlEnv(5, 5)
    obs1, _ = env1.reset()
    env1.step(5) # Make a cut to change topology
    obs1 = env1._get_obs()
    
    env2 = HowlEnv(7, 7)
    obs2, _ = env2.reset()
    
    print("\nTesting single tensor auto-conversion...")
    state_tensor = torch.tensor(obs1, dtype=torch.float32).unsqueeze(0)
    p_logits, v = net(state_tensor)
    
    assert p_logits.shape == (1, 100), f"Expected (1, 100), got {p_logits.shape}"
    assert v.shape == (1, 1), f"Expected (1, 1), got {v.shape}"
    print("Single tensor forward pass OK!")
    
    # 2. Test PyG Batching
    print("\nTesting PyG Batching...")
    pyg_data1 = grid_tensor_to_pyg_data(torch.tensor(obs1, dtype=torch.float32))
    pyg_data2 = grid_tensor_to_pyg_data(torch.tensor(obs2, dtype=torch.float32))
    
    batch = Batch.from_data_list([pyg_data1, pyg_data2])
    
    p_logits_batch, v_batch = net(batch)
    
    assert p_logits_batch.shape == (2, 100), f"Expected (2, 100), got {p_logits_batch.shape}"
    assert v_batch.shape == (2, 1), f"Expected (2, 1), got {v_batch.shape}"
    print("Batch forward pass OK!")
    
    # 3. Test Action Masking / Scatter
    print("\nTesting Action Masking (Scatter Mapping)...")
    # p_logits should be -1e9 for inactive vertices
    inactive_mask = (torch.tensor(obs1[0]) == 0).flatten()
    assert torch.all(p_logits[0][inactive_mask] == -1e9), "Action masking failed! Inactive vertices are not -1e9"
    
    active_mask = (torch.tensor(obs1[0]) == 1).flatten()
    assert torch.all(p_logits[0][active_mask] > -1e9), "Action masking failed! Active vertices are -1e9"
    print("Scatter mapping and Action Masking OK!")
    
    print("\nAll GNN tests passed successfully!")
    return net, pyg_data1, pyg_data2

if __name__ == "__main__":
    net, pyg_data1, pyg_data2 = test_gnn_architecture()

    import torch.nn.functional as F
    import torch.optim as optim
    from torch_geometric.loader import DataLoader
    
    print("\nTesting Backward Pass...")
    optimizer = optim.Adam(net.parameters(), lr=1e-3)
    loader = DataLoader([pyg_data1, pyg_data2], batch_size=2)
    
    for batch in loader:
        p_logits, v_pred = net(batch)
        
        # Dummy targets
        dummy_pi = torch.ones_like(p_logits) / 100
        dummy_v = torch.zeros_like(v_pred)
        
        p_loss = F.cross_entropy(p_logits, dummy_pi)
        v_loss = F.mse_loss(v_pred.squeeze(), dummy_v.squeeze())
        loss = p_loss + v_loss
        
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        
    print("Backward pass OK!")
