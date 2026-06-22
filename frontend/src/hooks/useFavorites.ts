import { useState, useCallback } from "react";
import type { Mode } from "../types";

const FAVORITES_KEY = "azure_favorite_modes";

function loadFavorites(): Mode[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw) return JSON.parse(raw) as Mode[];
  } catch { /* ignore */ }
  return [];
}

function saveFavorites(favs: Mode[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  } catch { /* ignore */ }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Mode[]>(loadFavorites);

  const toggleFavorite = useCallback((mode: Mode) => {
    setFavorites((prev) => {
      const next = prev.includes(mode)
        ? prev.filter((m) => m !== mode)
        : [...prev, mode];
      saveFavorites(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (mode: Mode) => favorites.includes(mode),
    [favorites]
  );

  return { favorites, toggleFavorite, isFavorite };
}
