// Local-first mutations. Each writes SQLite immediately (part + queue in a
// transaction), invalidates the affected read queries, then kicks a sync pass
// (which is a no-op offline). The user sees the change instantly regardless of
// connectivity.

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { inventoryRepository } from "@/src/repositories/inventoryRepository";
import { useSync } from "@/src/state/SyncContext";
import { useSession } from "@/src/state/SessionContext";
import { CreatePartInput, EditablePartFields } from "@/src/types";
import { newLocalId } from "@/src/utils/id";

function useAfterMutation() {
  const qc = useQueryClient();
  const { syncNow, refreshPending } = useSync();
  return async (rowUid?: string) => {
    qc.invalidateQueries({ queryKey: ["parts"] });
    qc.invalidateQueries({ queryKey: ["counts"] });
    if (rowUid) qc.invalidateQueries({ queryKey: ["part", rowUid] });
    await refreshPending();
    void syncNow(); // fire-and-forget; guarded + offline-safe
  };
}

export function useCreatePart() {
  const { mode } = useSession();
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (input: Omit<CreatePartInput, "local_id">) => {
      if (mode === "readonly") throw new Error("El inventario está en modo solo lectura.");
      return inventoryRepository.createPart({ ...input, local_id: newLocalId() });
    },
    onSuccess: (part) => after(part.row_uid),
  });
}

export function useUpdatePart() {
  const { mode } = useSession();
  const after = useAfterMutation();
  return useMutation({
    mutationFn: ({ rowUid, fields }: { rowUid: string; fields: EditablePartFields }) => {
      if (mode === "readonly") throw new Error("El inventario está en modo solo lectura.");
      return inventoryRepository.updatePart(rowUid, fields);
    },
    onSuccess: (_r, vars) => after(vars.rowUid),
  });
}

export function useDeletePart() {
  const { mode } = useSession();
  const after = useAfterMutation();
  return useMutation({
    mutationFn: (rowUid: string) => {
      if (mode === "readonly") throw new Error("El inventario está en modo solo lectura.");
      return inventoryRepository.deletePart(rowUid);
    },
    onSuccess: (_r, rowUid) => after(rowUid),
  });
}
