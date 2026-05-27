import { useState, useEffect, useCallback } from "react";

const ALIAS_KEY = "howl_alias";

export function useAlias() {
  const [alias, setAliasState] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const storedAlias = localStorage.getItem(ALIAS_KEY);
    setAliasState(storedAlias);
    setIsLoaded(true);
  }, []);

  const setAlias = useCallback((newAlias: string) => {
    const trimmed = newAlias.trim();
    if (trimmed) {
      localStorage.setItem(ALIAS_KEY, trimmed);
      setAliasState(trimmed);
    } else {
      localStorage.removeItem(ALIAS_KEY);
      setAliasState(null);
    }
  }, []);

  return { alias, setAlias, isLoaded };
}
