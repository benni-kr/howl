import torch
import torch.nn as nn
import torch.nn.functional as F

try:
    from torch_geometric.data import Data, Batch
    from torch_geometric.nn import SAGEConv, global_mean_pool
    HAS_PYG = True
except ImportError:
    HAS_PYG = False

def grid_tensor_to_pyg_data(state_tensor):
    """
    Converts a single (5, M, N) dense grid tensor into a sparse PyG Data object.
    state_tensor: (5, M, N)
    Channels: 0: mask, 1: degree, 2: border, 3: comp_id, 4: articulation
    """
    if not HAS_PYG:
        raise ImportError("torch_geometric is required for GNN representation.")
        
    channels, m, n = state_tensor.shape
    assert channels == 5, f"Expected 5 channels, got {channels}"
    
    # Active vertices where mask (channel 0) == 1
    active_indices_2d = torch.nonzero(state_tensor[0] == 1, as_tuple=False)  # shape (V, 2)
    V = active_indices_2d.size(0)
    
    if V == 0:
        x = torch.zeros((0, 4), dtype=torch.float32)
        edge_index = torch.zeros((2, 0), dtype=torch.long)
        flat_indices = torch.zeros((0,), dtype=torch.long)
        return Data(x=x, edge_index=edge_index, flat_indices=flat_indices, m=m, n=n)
    
    # 1D flattened positional indices (from 0 to M*N-1)
    flat_indices = active_indices_2d[:, 0] * n + active_indices_2d[:, 1]
    
    # Map from 2D coordinate -> vertex index in 0..V-1
    coord_to_idx = torch.full((m, n), -1, dtype=torch.long)
    coord_to_idx[active_indices_2d[:, 0], active_indices_2d[:, 1]] = torch.arange(V)
    
    # Extract topological node features (Channels 1 to 4) for active vertices
    x = state_tensor[1:, active_indices_2d[:, 0], active_indices_2d[:, 1]].T.clone().detach()
    
    # Build edge_index (4-way connectivity)
    edges = []
    directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    
    for v in range(V):
        r, c = active_indices_2d[v, 0].item(), active_indices_2d[v, 1].item()
        for dr, dc in directions:
            nr, nc = r + dr, c + dc
            if 0 <= nr < m and 0 <= nc < n:
                n_idx = coord_to_idx[nr, nc].item()
                if n_idx != -1:
                    edges.append([v, n_idx])
                    
    if edges:
        edge_index = torch.tensor(edges, dtype=torch.long).t().contiguous()
    else:
        edge_index = torch.zeros((2, 0), dtype=torch.long)
        
    return Data(x=x, edge_index=edge_index, flat_indices=flat_indices, m=m, n=n)

class AlphaWolfGNN(nn.Module):
    def __init__(self, m=None, n=None, in_channels=4, hidden_channels=128, num_layers=6):
        super().__init__()
        # Ensure compatibility with env.MAX_ROWS and MAX_COLS
        self.m = 10
        self.n = 10
        
        if not HAS_PYG:
            raise ImportError("torch_geometric is required for AlphaWolfGNN.")
            
        self.conv_in = SAGEConv(in_channels, hidden_channels)
        
        self.layers = nn.ModuleList([
            SAGEConv(hidden_channels, hidden_channels) for _ in range(num_layers)
        ])
        
        # Policy Head (Outputs a scalar logit per node)
        self.policy_fc1 = nn.Linear(hidden_channels, hidden_channels)
        self.policy_fc2 = nn.Linear(hidden_channels, 1)
        
        # Value Head (Outputs a single expected rank for the graph)
        self.value_fc1 = nn.Linear(hidden_channels, hidden_channels)
        self.value_fc2 = nn.Linear(hidden_channels, 1)
        
    def forward(self, batch_data):
        # Auto-convert raw dense tensors to PyG Batch objects
        if isinstance(batch_data, torch.Tensor):
            data_list = [grid_tensor_to_pyg_data(batch_data[i]) for i in range(batch_data.size(0))]
            batch_data = Batch.from_data_list(data_list)
            batch_data = batch_data.to(next(self.parameters()).device)
            
        x, edge_index, batch_idx = batch_data.x, batch_data.edge_index, batch_data.batch
        
        # 1. Message Passing
        x = F.relu(self.conv_in(x, edge_index))
        for layer in self.layers:
            residual = x
            x = F.relu(layer(x, edge_index))
            x = x + residual # Skip connection
            
        # 2. Policy Head
        p = F.relu(self.policy_fc1(x))
        p_logits = self.policy_fc2(p).squeeze(-1) # [V]
        
        B = batch_data.num_graphs
        max_size = self.m * self.n
        
        # Scatter initialization (Action Masking)
        policy_out = torch.full((B, max_size), -1e9, dtype=torch.float32, device=x.device)
        
        # Scatter logits back to fixed positional dimensions [Batch, M*N]
        if x.size(0) > 0:
            policy_out[batch_idx, batch_data.flat_indices] = p_logits
        
        # 3. Value Head (Global Mean Pooling)
        v = global_mean_pool(x, batch_idx) # [B, hidden_channels]
        v = F.relu(self.value_fc1(v))
        v = self.value_fc2(v) # [B, 1]
        
        return policy_out, v

class ResBlock(nn.Module):
    # Archived for reference
    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x):
        residual = x
        out = F.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out += residual
        out = F.relu(out)
        return out

class AlphaWolfCNN(nn.Module):
    # Archived V1.1 CNN Architecture
    def __init__(self, m=None, n=None, hidden_channels=128, num_res_blocks=6):
        super().__init__()
        # Force 10x10 zero-padded architecture
        self.m = 10
        self.n = 10
        
        # Input: 5 channels (binary mask, degree, border, component ID, articulation points)
        self.conv_in = nn.Conv2d(5, hidden_channels, kernel_size=3, padding=1)
        self.bn_in = nn.BatchNorm2d(hidden_channels)
        
        self.res_blocks = nn.ModuleList([
            ResBlock(hidden_channels) for _ in range(num_res_blocks)
        ])
        
        # Policy Head (Outputs probabilities over MAX_ROWS * MAX_COLS)
        self.policy_conv = nn.Conv2d(hidden_channels, 2, kernel_size=1)
        self.policy_bn = nn.BatchNorm2d(2)
        self.policy_fc = nn.Linear(2 * self.m * self.n, self.m * self.n)
        
        # Value Head (Outputs a scalar expected rank)
        self.value_conv = nn.Conv2d(hidden_channels, 1, kernel_size=1)
        self.value_bn = nn.BatchNorm2d(1)
        self.value_fc1 = nn.Linear(1 * self.m * self.n, hidden_channels)
        self.value_fc2 = nn.Linear(hidden_channels, 1)

    def forward(self, x):
        # x shape: (batch_size, 1, m, n)
        x = F.relu(self.bn_in(self.conv_in(x)))
        for block in self.res_blocks:
            x = block(x)
            
        # Policy
        p = F.relu(self.policy_bn(self.policy_conv(x)))
        p = p.view(p.size(0), -1)
        p = self.policy_fc(p)
        
        # Value
        v = F.relu(self.value_bn(self.value_conv(x)))
        v = v.view(v.size(0), -1)
        v = F.relu(self.value_fc1(v))
        v = self.value_fc2(v)
        
        return p, v

# Alias the active model
AlphaWolfNet = AlphaWolfGNN
