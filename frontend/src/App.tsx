import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootState } from "./state/store";
import { selectActivePalette } from "./state/settingsSlice";

import Layout from "./components/Layout";
import GamePage from "./pages/GamePage";
import LeaderboardPage from "./pages/LeaderboardPage";
import SettingsPage from "./pages/SettingsPage";
import DocsPage from "./pages/DocsPage";
import LoginPage from "./pages/LoginPage";
import ReplayPage from "./pages/ReplayPage";

import "./styles/styles.css";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem("howl_auth_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const App: React.FC = () => {
  const settings = useSelector((state: RootState) => state.settings);

  // Sync theme mode to document element
  useEffect(() => {
    document.documentElement.dataset.theme = settings.mode;
  }, [settings.mode]);

  // Sync palette colors to CSS variables
  const activePalette = useSelector(selectActivePalette);
  useEffect(() => {
    const root = document.documentElement;
    const toHex = (num: number) => "#" + num.toString(16).padStart(6, '0');
    root.style.setProperty('--tile-primary', toHex(activePalette.tileA));
    root.style.setProperty('--tile-secondary', toHex(activePalette.tileB));
    root.style.setProperty('--tile-selected', toHex(activePalette.select));
    root.style.setProperty('--tile-highlight', toHex(activePalette.highlight));
    root.style.setProperty('--tile-border', toHex(activePalette.border));
    
    // Logo color: Tile A in dark mode, Tile B in light mode
    const logoColor = settings.mode === 'light' ? activePalette.tileB : activePalette.tileA;
    root.style.setProperty('--logo-color', toHex(logoColor));
  }, [activePalette, settings.mode]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route index element={<GamePage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="leaderboard/:m/:n" element={<LeaderboardPage />} />
          <Route path="replay/:m/:n/:solverName" element={<ReplayPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
