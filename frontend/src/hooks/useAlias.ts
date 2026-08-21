import { useState, useEffect, useCallback } from "react";

const ALIAS_KEY = "howl_alias";

export function isReservedAlias(alias: string | null | undefined): boolean {
  if (!alias) return false;
  const lower = alias.trim().toLowerCase();
  return lower === "computer" || lower === "god" || lower.includes("alphawolf");
}

export function useAlias() {
  const [alias, setAliasState] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const storedAlias = localStorage.getItem(ALIAS_KEY);
    if (storedAlias && isReservedAlias(storedAlias)) {
      localStorage.removeItem(ALIAS_KEY);
      setAliasState(null);
    } else {
      setAliasState(storedAlias);
    }
    setIsLoaded(true);
  }, []);

  const setAlias = useCallback((newAlias: string) => {
    const trimmed = newAlias.trim();
    if (trimmed && !isReservedAlias(trimmed)) {
      localStorage.setItem(ALIAS_KEY, trimmed);
      setAliasState(trimmed);
    } else {
      localStorage.removeItem(ALIAS_KEY);
      setAliasState(null);
    }
  }, []);

  return { alias, setAlias, isLoaded };
}
