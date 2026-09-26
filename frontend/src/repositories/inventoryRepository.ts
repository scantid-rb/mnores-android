// Inventory repository: read-only access to the local cache in Phase 1.
// CREATE/UPDATE/DELETE and the pending queue arrive in later phases.

import { localStore } from "@/src/database/store";
import { Boat, Category, Part } from "@/src/types";

export const inventoryRepository = {
  searchParts(query: string, categoryId: number | null): Promise<Part[]> {
    return localStore.searchParts({ query, categoryId });
  },
  getCategories(): Promise<Category[]> {
    return localStore.getCategories();
  },
  getBoats(): Promise<Boat[]> {
    return localStore.getBoats();
  },
  getPart(id: number): Promise<Part | null> {
    return localStore.getPart(id);
  },
  getCounts(): Promise<{ boats: number; categories: number; parts: number }> {
    return localStore.getCounts();
  },
};
