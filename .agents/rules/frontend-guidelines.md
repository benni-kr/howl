---
description: Guidelines for working in the frontend React application.
activation:
  type: glob
  pattern: "frontend/**"
---

# Frontend Guidelines

When operating within the `frontend/` directory of the HOWL project, follow these architectural constraints:

## 1. WebGL over DOM
Because the game handles grids up to $100 \times 100$, standard React DOM elements (`<div>`) will cause severe lag. **Always use PixiJS (`@pixi/react`)** for rendering nodes, edges, and hovers on the game board. Keep the DOM limited to UI shells (menus, buttons, sidebars).

## 2. DTO Payload Compaction
The frontend maintains two formats for cuts:
- **Local State (Verbose)**: Human-readable format stored in Redux (e.g., `{ type: "cut", vertices: [{x: 0, y: 0}] }`).
- **Network Protocol (Compact)**: Minified format for the FastAPI backend (e.g., `{ t: "c", v: [[0, 0]] }`).
When modifying API calls in `src/api/api.ts`, ensure proper compaction and decompaction.

## 3. Local Fingerprinting vs. Canonical Hashing
The frontend uses `getLocalGraphFingerprint` to track active shapes locally in a single render cycle. Do **not** confuse this with the backend's $D_4$ canonical hashing. Local fingerprinting is position-dependent and not rotationally invariant.

## 4. Color Palette Support
Always make sure everything works for the different color palettes including light and dark mode. When adding new styles or UI elements, use CSS variables (e.g., `var(--bg-card)`, `var(--text-main)`) instead of hardcoding colors to ensure compatibility across themes.

## 5. Verification and Testing
After working in the frontend, you must always verify the application builds correctly. Always run `npm run build` and `npx tsc --noEmit` (or equivalent type checks) to ensure your changes didn't introduce TypeScript or build errors.
