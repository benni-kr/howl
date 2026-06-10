import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface Palette {
  tileA: number;
  tileB: number;
  border: number;
  highlight: number;
  select: number;
  selectBorder: number;
  selectGlow: number;
}

export interface ThemeConfig {
  id: string;
  name: string;
  light: Palette;
  dark: Palette;
}

export const THEMES: ThemeConfig[] = [
  {
    id: "green",
    name: "Emerald",
    light: {
      tileA: 0x22c55e, // green-500
      tileB: 0x16a34a, // green-600
      border: 0x14532d, // green-900
      highlight: 0x4ade80, // green-400
      select: 0x06b6d4, // cyan-500
      selectBorder: 0x0891b2, // cyan-600
      selectGlow: 0x22d3ee, // cyan-400
    },
    dark: {
      tileA: 0x22c55e,
      tileB: 0x166534, // green-800
      border: 0x052e16, // green-950
      highlight: 0x4ade80,
      select: 0x06b6d4,
      selectBorder: 0x0891b2,
      selectGlow: 0x22d3ee,
    },
  },
  {
    id: "blue",
    name: "Lapis",
    light: {
      tileA: 0x0ea5e9, // sky-500
      tileB: 0x0284c7, // sky-600
      border: 0x0c4a6e, // sky-900
      highlight: 0x38bdf8, // sky-400
      select: 0xef4444, // red-500
      selectBorder: 0xdc2626, // red-600
      selectGlow: 0xf87171, // red-400
    },
    dark: {
      tileA: 0x38bdf8, // sky-400
      tileB: 0x0369a1, // sky-700
      border: 0x082f49, // sky-900
      highlight: 0x7dd3fc, // sky-300
      select: 0xef4444,
      selectBorder: 0xdc2626,
      selectGlow: 0xf87171,
    },
  },
  {
    id: "red",
    name: "Rubin",
    light: {
      tileA: 0xef4444, // red-500
      tileB: 0xdc2626, // red-600
      border: 0x7f1d1d, // red-900
      highlight: 0xf87171, // red-400
      select: 0xeab308, // yellow-500
      selectBorder: 0xca8a04, // yellow-600
      selectGlow: 0xfacc15, // yellow-400
    },
    dark: {
      tileA: 0xf87171, // red-400
      tileB: 0x991b1b, // red-800
      border: 0x450a0a, // red-950
      highlight: 0xfca5a5, // red-300
      select: 0xeab308, // yellow-500
      selectBorder: 0xca8a04, // yellow-600
      selectGlow: 0xfacc15, // yellow-400
    },
  },
  {
    id: "purple",
    name: "Amethyst",
    light: {
      tileA: 0xa855f7, // purple-500
      tileB: 0x9333ea, // purple-600
      border: 0x581c87, // purple-900
      highlight: 0xc084fc, // purple-400
      select: 0xf97316, // orange-500
      selectBorder: 0xea580c, // orange-600
      selectGlow: 0xfb923c, // orange-400
    },
    dark: {
      tileA: 0xc084fc, // purple-400
      tileB: 0x6b21a8, // purple-800
      border: 0x3b0764, // purple-950
      highlight: 0xd8b4fe, // purple-300
      select: 0xf97316,
      selectBorder: 0xea580c,
      selectGlow: 0xfb923c,
    },
  },
];

export interface SettingsState {
  mode: "light" | "dark";
  colorId: string;
  showGridIndices: boolean;
  showCoordinateSystem: boolean;
  showGridLines: boolean;
}

const initialState: SettingsState = {
  mode: "dark",
  colorId: "purple",
  showGridIndices: false,
  showCoordinateSystem: false,
  showGridLines: false,
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setMode(state, action: PayloadAction<"light" | "dark">) {
      state.mode = action.payload;
    },
    setColorTheme(state, action: PayloadAction<string>) {
      state.colorId = action.payload;
    },
    setShowGridIndices(state, action: PayloadAction<boolean>) {
      state.showGridIndices = action.payload;
    },
    setShowCoordinateSystem(state, action: PayloadAction<boolean>) {
      state.showCoordinateSystem = action.payload;
    },
    setShowGridLines(state, action: PayloadAction<boolean>) {
      state.showGridLines = action.payload;
    },
  },
});

export const { setMode, setColorTheme, setShowGridIndices, setShowCoordinateSystem, setShowGridLines } = settingsSlice.actions;

export const selectActivePalette = (state: { settings: SettingsState }): Palette => {
  const theme = THEMES.find((t) => t.id === state.settings.colorId) || THEMES[0];
  return state.settings.mode === "light" ? theme.light : theme.dark;
};

export default settingsSlice.reducer;
