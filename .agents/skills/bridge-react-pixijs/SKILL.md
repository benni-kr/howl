---
name: bridge-react-pixijs
description: Guides the agent on how to manage state between Redux Toolkit and the PixiJS WebGL canvas. Use this when building new interactive UI elements on the game board in the frontend.
---

# Bridge React and PixiJS Skill

The HOWL frontend uses a hybrid architecture: React handles the UI shell and Redux state, while PixiJS (`@pixi/react`) handles the heavy 2D graph rendering.

## How to use it

### 1. State Flow Constraints
- **Redux is the Single Source of Truth**: PixiJS components should *never* hold their own source-of-truth state for the graph logic. They simply consume the `GridGraph` from Redux.
- **Click Handlers**: When a user clicks a vertex in PixiJS, do not mutate the node visually right away. Dispatch a Redux action (e.g., `toggleVertex`) and let the React reconciliation update the PixiJS props.

### 2. Component Layering
- **`PixiVisualizer.tsx`**: The bridge. Use `useSelector` here to grab state, then pass it down as simple props to the Pixi canvas.
- **`GridDrawer.tsx`**: The renderer. Takes raw nodes/edges and issues standard `@pixi/react` `<Graphics />` calls. Keep this purely presentational.

### 3. Avoiding Re-renders
- When updating hover states or temporary highlights (like the Magic Wand overlay), try to use local React state within the Pixi bridge rather than Redux if it doesn't affect the core math. Dispatching to Redux on `pointermove` will destroy performance.
