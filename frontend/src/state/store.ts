import { configureStore } from "@reduxjs/toolkit";
import gameSliceReducer from "./gameSlice";
import settingsSliceReducer from "./settingsSlice";

const savedSettings = localStorage.getItem("howl_settings");
let preloadedState = {};
if (savedSettings) {
  try {
    preloadedState = { settings: JSON.parse(savedSettings) };
  } catch (e) {
    console.error("Failed to parse settings from localStorage", e);
  }
}

export const store = configureStore({
  reducer: {
    game: gameSliceReducer,
    settings: settingsSliceReducer,
  },
  preloadedState,
});

store.subscribe(() => {
  localStorage.setItem("howl_settings", JSON.stringify(store.getState().settings));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
