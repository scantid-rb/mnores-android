// Read hooks over the LOCAL cache (SQLite). The inventory shown always comes
// from local persistence, never from an in-memory-only cache — react-query is
// used only to orchestrate the reads and re-render on invalidation.

import { useQuery } from "@tanstack/react-query";

import { inventoryRepository } from "@/src/repositories/inventoryRepository";

export function useParts(query: string, categoryId: number | null) {
  return useQuery({
    queryKey: ["parts", query, categoryId],
    queryFn: () => inventoryRepository.searchParts(query, categoryId),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => inventoryRepository.getCategories(),
  });
}

export function useBoats() {
  return useQuery({
    queryKey: ["boats"],
    queryFn: () => inventoryRepository.getBoats(),
  });
}

export function usePart(id: number) {
  return useQuery({
    queryKey: ["part", id],
    queryFn: () => inventoryRepository.getPart(id),
  });
}

export function useCounts() {
  return useQuery({
    queryKey: ["counts"],
    queryFn: () => inventoryRepository.getCounts(),
  });
}
