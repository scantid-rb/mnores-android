// Read hooks over the LOCAL cache (SQLite). react-query only orchestrates the
// reads and re-renders on invalidation; SQLite is the real persistence.

import { useQuery } from "@tanstack/react-query";

import { inventoryRepository } from "@/src/repositories/inventoryRepository";

export function useParts(query: string, categoryId: number | null, boatId: number | null = null) {
  return useQuery({
    queryKey: ["parts", query, categoryId, boatId],
    queryFn: () => inventoryRepository.searchParts(query, categoryId, boatId),
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

export function usePart(rowUid: string) {
  return useQuery({
    queryKey: ["part", rowUid],
    queryFn: () => inventoryRepository.getPart(rowUid),
    enabled: !!rowUid,
  });
}

export function useCounts() {
  return useQuery({
    queryKey: ["counts"],
    queryFn: () => inventoryRepository.getCounts(),
  });
}


export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => inventoryRepository.getUsers(),
  });
}
