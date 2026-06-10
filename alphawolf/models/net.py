import torch
import torch.nn as nn
import torch.nn.functional as F

class ResBlock(nn.Module):
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

class AlphaWolfNet(nn.Module):
    def __init__(self, m=None, n=None, hidden_channels=64, num_res_blocks=3):
        super().__init__()
        # Force 10x10 zero-padded architecture
        self.m = 10
        self.n = 10
        
        # Input: 1 channel (the 2D grid)
        self.conv_in = nn.Conv2d(1, hidden_channels, kernel_size=3, padding=1)
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
