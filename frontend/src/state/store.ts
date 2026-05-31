import { configureStore } from "@reduxjs/toolkit";
import gameSliceReducer from "./gameSlice";
import settingsSliceReducer from "./settingsSlice";
import userPreferencesSliceReducer from "./userPreferencesSlice";

const savedSettings = localStorage.getItem("howl_settings");
const savedPrefs = localStorage.getItem("howl_user_prefs");
let preloadedState: any = {};
if (savedSettings) {
  try {
    preloadedState.settings = JSON.parse(savedSettings);
  } catch (e) {
    console.error("Failed to parse settings from localStorage", e);
  }
}
if (savedPrefs) {
  try {
    preloadedState.userPreferences = JSON.parse(savedPrefs);
    // Reset activeTooltip on load so returning users don't get stuck with an active tooltip
    if (preloadedState.userPreferences) {
      preloadedState.userPreferences.activeTooltip = null;
    }
  } catch (e) {
    console.error("Failed to parse user preferences from localStorage", e);
  }
}

export const store = configureStore({
  reducer: {
    game: gameSliceReducer,
    settings: settingsSliceReducer,
    userPreferences: userPreferencesSliceReducer,
  },
  preloadedState,
});

store.subscribe(() => {
  const state = store.getState();
  localStorage.setItem("howl_settings", JSON.stringify(state.settings));
  localStorage.setItem("howl_user_prefs", JSON.stringify(state.userPreferences));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
