// Create / edit a part. chief_engineer edits all fields; other roles that
// reach it (edit) can only change quantity. Local-first: saving writes SQLite
// and queues the change immediately, then returns.
//
// NOTE: the Field wrapper is declared at MODULE scope (not inside the screen
// component). Declaring it inside caused React to see a new component type on
// every keystroke, remounting the TextInputs and dropping keyboard focus.

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBoats, useCategories, usePart } from "@/src/hooks/useInventory";
import { useCreatePart, useUpdatePart } from "@/src/hooks/usePartMutations";
import { useSession } from "@/src/state/SessionContext";
import { makeStyles, useTheme } from "@/src/theme";
import { EditablePartFields } from "@/src/types";
import { canCreatePart, canEditFields } from "@/src/utils/permissions";

export default function PartEditScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { mode: routeMode, rowUid } = useLocalSearchParams<{ mode: string; rowUid?: string }>();
  const isEdit = routeMode === "edit" && !!rowUid;

  const { user, token, session, mode: accessMode } = useSession();
  const fullEdit = canEditFields(user?.role);

  const { data: categories = [] } = useCategories();
  const { data: boats = [] } = useBoats();
  const { data: existing } = usePart(isEdit ? String(rowUid) : "");
  const createPart = useCreatePart();
  const updatePart = useUpdatePart();

  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [boatId, setBoatId] = useState<number | null>(null);
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isEdit && existing && !loaded) {
      // Hydrate local form state from asynchronously loaded SQLite data.
      // This is an intentional effect-side state update, not a render loop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(existing.name ?? "");
      setReference(existing.reference ?? "");
      setCategoryId(existing.category_id ?? null);
      setBoatId(existing.boat_id ?? null);
      setLocation(existing.location ?? "");
      setQuantity(String(existing.quantity ?? 0));
      setNotes(existing.notes ?? "");
      setLoaded(true);
    }
  }, [isEdit, existing, loaded]);

  const boatName = useMemo(() => {
    const bId = isEdit ? existing?.boat_id : (boatId ?? user?.boat_id);
    return boats.find((b) => b.id === bId)?.name ?? (bId != null ? `ID ${bId}` : "—");
  }, [boats, existing, user, isEdit, boatId]);

  const parsedQty = Math.max(0, parseInt(quantity || "0", 10) || 0);

  if (accessMode === "readonly") return <Redirect href="/inventory" />;
  if (!token || !session) return <Redirect href="/login" />;

  const onSave = () => {
    setError(null);
    if (fullEdit) {
      if (name.trim().length === 0) {
        setError("El nombre es obligatorio.");
        return;
      }
      // The backend requires a valid category on parts; enforce it here so we
      // never enqueue a create/update that the server would reject (HTTP 500).
      if (categoryId == null) {
        setError("Selecciona una categoría.");
        return;
      }
    }

    if (isEdit) {
      const fields: EditablePartFields = fullEdit
        ? {
            name: name.trim(),
            reference: reference.trim() || null,
            category_id: categoryId,
            location: location.trim() || null,
            quantity: parsedQty,
            notes: notes.trim() || null,
          }
        : { quantity: parsedQty };
      updatePart.mutate({ rowUid: String(rowUid), fields }, { onSuccess: () => router.back() });
    } else {
      if (!user || !canCreatePart(user.role)) {
        setError("No tienes permiso para crear repuestos.");
        return;
      }
      const createBoatId = user.role === "chief_engineer" ? user.boat_id : (boatId ?? user.boat_id);
      if (createBoatId == null) {
        setError("Selecciona un barco.");
        return;
      }
      createPart.mutate(
        {
          boat_id: createBoatId,
          name: name.trim(),
          reference: reference.trim() || null,
          category_id: categoryId,
          location: location.trim() || null,
          quantity: parsedQty,
          notes: notes.trim() || null,
        },
        { onSuccess: () => router.back() },
      );
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="edit-back-button">
          <Text style={styles.back}>‹ Cancelar</Text>
        </Pressable>
        <Text style={styles.title}>{isEdit ? "Editar repuesto" : "Nuevo repuesto"}</Text>
        <Pressable onPress={onSave} hitSlop={12} testID="edit-save-button">
          <Text style={styles.save}>Guardar</Text>
        </Pressable>
      </View>

      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Barco">
          {fullEdit && !isEdit ? (
            <View style={styles.chipsRow}>
              {boats.filter((b) => b.is_active).map((b) => {
                const active = (boatId ?? user?.boat_id) === b.id;
                return (
                  <Text
                    key={b.id}
                    onPress={() => setBoatId(active ? null : b.id)}
                    style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                  >
                    {b.name}
                  </Text>
                );
              })}
            </View>
          ) : (
            <Text style={styles.readonly}>{boatName}</Text>
          )}
        </Field>

        {fullEdit && (
          <>
            <Field label="Nombre *">
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nombre del repuesto" placeholderTextColor={colors.muted} testID="edit-name-input" />
            </Field>
            <Field label="Referencia">
              <TextInput style={styles.input} value={reference} onChangeText={setReference} placeholder="Referencia" placeholderTextColor={colors.muted} autoCapitalize="characters" testID="edit-reference-input" />
            </Field>
            <Field label="Categoría *">
              <View style={styles.chipsRow}>
                {categories.map((c) => {
                  const active = categoryId === c.id;
                  return (
                    <Text
                      key={c.id}
                      onPress={() => setCategoryId(active ? null : c.id)}
                      style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                      testID={`edit-category-${c.id}`}
                    >
                      {c.name}
                    </Text>
                  );
                })}
              </View>
            </Field>
            <Field label="Ubicación">
              <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Ubicación (ej. Taquilla 1)" placeholderTextColor={colors.muted} testID="edit-location-input" />
            </Field>
          </>
        )}

        <Field label="Cantidad">
          <View style={styles.qtyRow}>
            <Pressable style={styles.qtyBtn} onPress={() => setQuantity(String(Math.max(0, parsedQty - 1)))} testID="edit-qty-dec">
              <Text style={styles.qtyBtnText}>−</Text>
            </Pressable>
            <TextInput
              style={[styles.input, styles.qtyInput]}
              value={quantity}
              onChangeText={(t) => setQuantity(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              testID="edit-quantity-input"
            />
            <Pressable style={styles.qtyBtn} onPress={() => setQuantity(String(parsedQty + 1))} testID="edit-qty-inc">
              <Text style={styles.qtyBtnText}>+</Text>
            </Pressable>
          </View>
        </Field>

        {fullEdit && (
          <Field label="Notas">
            <TextInput
              style={[styles.input, styles.notes]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Notas"
              placeholderTextColor={colors.muted}
              multiline
              testID="edit-notes-input"
            />
          </Field>
        )}

        {!!error && (
          <Text style={styles.error} testID="edit-error">
            {error}
          </Text>
        )}

        <Pressable style={styles.saveBtn} onPress={onSave} testID="edit-save-primary">
          <Text style={styles.saveBtnText}>{isEdit ? "Guardar cambios" : "Crear repuesto"}</Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

// Module-scope so its identity is stable across renders (keeps TextInput focus).
function Field({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  back: { fontSize: 15, fontWeight: "700", color: colors.brandPrimary },
  title: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  save: { fontSize: 15, fontWeight: "800", color: colors.brandPrimary },
  content: { padding: 16, gap: 16 },
  fieldBlock: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary },
  readonly: { fontSize: 16, color: colors.onSurface, paddingVertical: 6 },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.onSurface,
  },
  notes: { minHeight: 90, textAlignVertical: "top" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    height: 36,
    lineHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    fontSize: 13,
    fontWeight: "600",
    overflow: "hidden",
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.brandPrimary, color: colors.onBrandPrimary, borderColor: colors.brandPrimary },
  chipInactive: { backgroundColor: colors.surfaceTertiary, color: colors.onSurfaceTertiary, borderColor: colors.border },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  qtyBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary },
  qtyBtnText: { fontSize: 26, fontWeight: "800", color: colors.onBrandTertiary, lineHeight: 28 },
  qtyInput: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "800" },
  error: { color: colors.error, fontSize: 14 },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  saveBtnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
}));
