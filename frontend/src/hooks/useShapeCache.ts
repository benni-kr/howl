import { useRef, useCallback } from "react";
import type { Graph } from "../state/gameSlice";
import { getLocalGraphFingerprint } from "../state/gameSlice";
import { checkShapes, type ShapeResult } from "../api/api";

export const useShapeCache = () => {
  // Stores previously seen results, keyed by deterministic local fingerprints
  const cacheRef = useRef<Map<string, ShapeResult>>(new Map());

  const checkShapesCached = useCallback(async (graphs: Graph[]): Promise<ShapeResult[]> => {
    const missingGraphs: Graph[] = [];
    const missingFingerprints: { fingerprint: string; originalIndex: number }[] = [];
    const finalResults: ShapeResult[] = new Array(graphs.length);

    // 1. Identify which graphs are missing from the cache
    graphs.forEach((graph, originalIndex) => {
      const fingerprint = getLocalGraphFingerprint(graph);
      
      if (cacheRef.current.has(fingerprint)) {
        // Cache hit: place it exactly where it belongs in the results array
        finalResults[originalIndex] = cacheRef.current.get(fingerprint)!;
      } else {
        // Cache miss: queue it for the backend API call
        missingGraphs.push(graph);
        missingFingerprints.push({ fingerprint, originalIndex });
      }
    });

    // 2. Fetch the missing shapes from the backend
    if (missingGraphs.length > 0) {
      const fetchedResults = await checkShapes(missingGraphs);
      
      // 3. Merge new results into the final array AND save them to the cache
      fetchedResults.forEach((result, idx) => {
        const { fingerprint, originalIndex } = missingFingerprints[idx];
        cacheRef.current.set(fingerprint, result);
        finalResults[originalIndex] = result;
      });
    }

    return finalResults;
  }, []);
  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  return { checkShapesCached, clearCache };
};
