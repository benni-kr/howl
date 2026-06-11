import { useState } from "react";
import { useDispatch } from "react-redux";
import { store } from "../state/store";
import { Graph, Vertex, applyCutResult, removeSolvedSubgraphs, pullFromBankIfNeeded } from "../state/gameSlice";
import { executeCutLocal } from "../utils/graphUtils";

export function useCutExecution() {
  const dispatch = useDispatch();
  const [isExecuting, setIsExecuting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCut = async (
    activeGraph: Graph | null,
    pendingCutSet: Vertex[],
    setPendingCutSet: (set: Vertex[]) => void,
    setSelectedGraphIndex: (val: number | null) => void,
    setResetToken: React.Dispatch<React.SetStateAction<number>>
  ) => {
    if (!activeGraph || pendingCutSet.length === 0) return;

    setIsExecuting(true);
    setErrorMessage(null);
    try {
      const subgraphs = executeCutLocal(activeGraph, pendingCutSet);

      // PHASE 1: Cut Explosion
      setPendingCutSet([]);
      dispatch(applyCutResult({ subgraphs, cutSet: pendingCutSet }));

      setTimeout(() => {
        // PHASE 2: 1x1 Subgraph Explosion
        const stateBeforeRemove = store.getState().game;
        const has1x1s = stateBeforeRemove.recentCutGraphs.some((g: Graph) => g.vertices.length <= 1) || (stateBeforeRemove.activeGraph && stateBeforeRemove.activeGraph.vertices.length <= 1);
        const willReplaceFromBank = (stateBeforeRemove.activeGraph && stateBeforeRemove.activeGraph.vertices.length <= 1) && stateBeforeRemove.recentCutGraphs.length === 0 && stateBeforeRemove.bankedGraphs.length > 0;

        dispatch(removeSolvedSubgraphs());

        const afterPhase2 = () => {
          // PHASE 3: Layout Shift & Bank Replacement
          dispatch(pullFromBankIfNeeded());

          const stateAfter = store.getState().game;
          if (stateAfter.recentCutGraphs.length > 0) {
            setSelectedGraphIndex(null);
          }

          setResetToken((value) => value + 1);
          setIsExecuting(false);
        };

        if (has1x1s) {
          const delay = willReplaceFromBank ? 1200 : 600;
          setTimeout(afterPhase2, delay);
        } else {
          afterPhase2();
        }
      }, 600);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "An unexpected error occurred.");
      setIsExecuting(false);
    }
  };

  return { isExecuting, errorMessage, handleCut };
}
