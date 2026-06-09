import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootState } from "./state/store";
import { selectActivePalette } from "./state/settingsSlice";
import rawWolfLogo from "./assets/wolf-logo.svg?raw";

import Layout from "./components/layout/Layout";
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
    const logoHex = toHex(logoColor);
    root.style.setProperty('--logo-color', logoHex);

    // Dynamically update the favicon
    const coloredSvg = rawWolfLogo.replace(/#000000/g, logoHex);
    const encodedSvg = encodeURIComponent(coloredSvg);
    const dataUrl = `data:image/svg+xml;utf8,${encodedSvg}`;
    
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      document.head.appendChild(link);
    }
    link.href = dataUrl;
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
