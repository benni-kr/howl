import { configureStore } from "@reduxjs/toolkit";
import gameSliceReducer from "./gameSlice";
import settingsSliceReducer from "./settingsSlice";

export const store = configureStore({
  reducer: {
    game: gameSliceReducer,
    settings: settingsSliceReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
