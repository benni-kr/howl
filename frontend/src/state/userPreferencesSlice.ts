import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UserPreferencesState {
  tutorialsSeen: Record<string, boolean>;
  activeTooltip: string | null;
}

const initialState: UserPreferencesState = {
  tutorialsSeen: {},
  activeTooltip: null,
};

export const userPreferencesSlice = createSlice({
  name: 'userPreferences',
  initialState,
  reducers: {
    markAsSeen: (state, action: PayloadAction<string>) => {
      const key = action.payload;
      state.tutorialsSeen[key] = true;
      if (state.activeTooltip === key) {
        state.activeTooltip = null;
      }
    },
    requestShowTooltip: (state, action: PayloadAction<string>) => {
      const key = action.payload;
      // Only set as active if not already seen AND no other tooltip is currently active
      if (!state.tutorialsSeen[key] && !state.activeTooltip) {
        state.activeTooltip = key;
      }
    },
    resetTutorials: (state) => {
      state.tutorialsSeen = {};
      state.activeTooltip = null;
    },
    clearActiveTooltip: (state, action: PayloadAction<string>) => {
      if (state.activeTooltip === action.payload) {
        state.activeTooltip = null;
      }
    },
  },
});

export const { markAsSeen, requestShowTooltip, resetTutorials, clearActiveTooltip } = userPreferencesSlice.actions;

export default userPreferencesSlice.reducer;
