// Inventory repository: local-first reads and writes over the SQLite cache.

import { localStore } from "@/src/database/store";
import {
  Boat,
  Category,
  CreatePartInput,
  EditablePartFields,
  LocalPart,
  User,
} from "@/src/types";

export const inventoryRepository = {
  searchParts(query: string, categoryId: number | null, boatId: number | null = null): Promise<LocalPart[]> {
    return localStore.searchParts({ query, categoryId, boatId });
  },
  getCategories(): Promise<Category[]> {
    return localStore.getCategories();
  },
  getUsers(): Promise<User[]> {
    return localStore.getUsers();
  },
  getBoats(): Promise<Boat[]> {
    return localStore.getBoats();
  },
  getPart(rowUid: string): Promise<LocalPart | null> {
    return localStore.getPart(rowUid);
  },
  getCounts(): Promise<{ boats: number; categories: number; parts: number }> {
    return localStore.getCounts();
  },
  createPart(input: CreatePartInput): Promise<LocalPart> {
    return localStore.createPartLocal(input);
  },
  updatePart(rowUid: string, fields: EditablePartFields): Promise<LocalPart | null> {
    return localStore.updatePartLocal(rowUid, fields);
  },
  deletePart(rowUid: string): Promise<void> {
    return localStore.deletePartLocal(rowUid);
  },
};
