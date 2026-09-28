// Part detail. Reads from the local cache (offline-capable). Role-based
// actions: quantity +/- (chief_engineer, mechanic), edit fields and delete
// (chief_engineer). Delete uses an inline two-step confirm (no Alert).

import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCategories, usePart } from "@/src/hooks/useInventory";
import { useDeletePart, useUpdatePart } from "@/src/hooks/usePartMutations";
import { useSession } from "@/src/state/SessionContext";
import { localStore } from "@/src/database/store";
import { pickPartPhoto, remotePartPhotoUrl } from "@/src/services/photos/photoService";
import { useSync } from "@/src/state/SyncContext";
import { makeStyles, useTheme } from "@/src/theme";
import { SyncState } from "@/src/types";
import { canDeletePart, canEditFields, canEditQuantity } from "@/src/utils/permissions";

const SYNC_TEXT: Record<SyncState, string> = {
  synced: "Sincronizado",
  pending: "Pendiente de sincronizar",
  syncing: "Sincronizando",
  error: "Error de sincronización",
  conflict: "Conflicto (reconciliado por el servidor)",
};

export default function PartDetailScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { id } = useLocalSearchParams<{ id: string }>();
  const rowUid = String(id);
  const { data: part, isLoading } = usePart(rowUid);
  const { data: categories = [] } = useCategories();
  const { user, token } = useSession();
  const { syncNow } = useSync();

  const updatePart = useUpdatePart();
  const deletePart = useDeletePart();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const photoScale = useSharedValue(1);
  const savedPhotoScale = useSharedValue(1);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      const nextScale = savedPhotoScale.value * event.scale;
      photoScale.value = Math.min(4, Math.max(1, nextScale));
    })
    .onEnd(() => {
      savedPhotoScale.value = photoScale.value;
    });

  const photoZoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: photoScale.value }],
  }));

  const resetPhotoZoom = () => {
    photoScale.value = withTiming(1);
    savedPhotoScale.value = 1;
    setPhotoViewerOpen(false);
  };

  const categoryName =
    part?.category_id != null ? categories.find((c) => c.id === part.category_id)?.name ?? "—" : "—";

  const canQty = canEditQuantity(user?.role);
  const canEdit = canEditFields(user?.role);
  const canDelete = canDeletePart(user?.role);

  const changeQty = (delta: number) => {
    if (!part) return;
    const next = Math.max(0, part.quantity + delta);
    if (next === part.quantity) return;
    updatePart.mutate({ rowUid, fields: { quantity: next } });
  };

  const onDelete = () => {
    deletePart.mutate(rowUid, { onSuccess: () => router.back() });
  };
  const attachPhoto = async (source: "camera" | "library") => {
    if (!part) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const localPath = await pickPartPhoto(source);
      if (!localPath) return;
      await localStore.setLocalPhoto(rowUid, localPath);
      await queryClient.invalidateQueries({ queryKey: ["part", rowUid] });
      await syncNow();
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "No se pudo preparar la foto.");
    } finally {
      setPhotoBusy(false);
    }
  };


  const syncColor =
    part?.sync_state === "error" || part?.sync_state === "conflict"
      ? colors.error
      : part?.sync_state === "synced"
        ? colors.success
        : colors.warning;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="detail-back-button">
          <Text style={styles.back}>‹ Volver</Text>
        </Pressable>
        {canEdit && !!part && (
          <Pressable onPress={() => router.push(`/part-edit?mode=edit&rowUid=${rowUid}`)} testID="detail-edit-button">
            <Text style={styles.edit}>Editar</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {isLoading ? (
          <Text style={styles.muted}>Cargando…</Text>
        ) : !part ? (
          <Text style={styles.muted} testID="detail-not-found">
            Repuesto no encontrado en la cache local.
          </Text>
        ) : (
          <>
            <Text style={styles.name} testID="detail-name">
              {part.name}
            </Text>

            <View style={styles.qtyRow}>
              {canQty && (
                <Pressable style={styles.qtyBtn} onPress={() => changeQty(-1)} testID="detail-qty-dec">
                  <Text style={styles.qtyBtnText}>−</Text>
                </Pressable>
              )}
              <View style={styles.qtyCenter}>
                <Text style={styles.qtyValue} testID="detail-qty-value">
                  {part.quantity}
                </Text>
                <Text style={styles.qtyLabel}>unidades</Text>
              </View>
              {canQty && (
                <Pressable style={styles.qtyBtn} onPress={() => changeQty(+1)} testID="detail-qty-inc">
                  <Text style={styles.qtyBtnText}>+</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.card}>
              <Field label="Referencia" value={part.reference || "—"} />
              <Field label="Categoría" value={categoryName} />
              <Field label="Ubicación" value={part.location || "—"} />
              <Field label="Notas" value={part.notes || "—"} />
            </View>

            <View style={styles.card}>
              {part.local_photo_path || part.photo_path ? (
                <Pressable
                  onPress={() => { photoScale.value = 1; savedPhotoScale.value = 1; setPhotoViewerOpen(true); }}
                  style={styles.photoPressable}
                  accessibilityRole="button"
                  accessibilityLabel="Ampliar foto"
                  testID="detail-photo-button"
                >
                  <Image
                    source={
                      part.local_photo_path
                        ? { uri: part.local_photo_path }
                        : token && part.server_id
                          ? { uri: remotePartPhotoUrl(part.server_id), headers: { Authorization: `Bearer ${token}` } }
                          : undefined
                    }
                    style={styles.photo}
                    contentFit="contain"
                  />
                </Pressable>
              ) : (
                <Text style={styles.muted}>Sin foto</Text>
              )}
              {canEdit && (
                <View style={styles.photoActions}>
                  <Pressable style={styles.photoBtn} onPress={() => void attachPhoto("camera")} disabled={photoBusy}>
                    <Text style={styles.photoBtnText}>{photoBusy ? "Procesando…" : "📷 Cámara"}</Text>
                  </Pressable>
                  <Pressable style={styles.photoBtn} onPress={() => void attachPhoto("library")} disabled={photoBusy}>
                    <Text style={styles.photoBtnText}>🖼️ Galería</Text>
                  </Pressable>
                </View>
              )}
              {!!photoError && <Text style={styles.error}>{photoError}</Text>}
              <Field label="Foto" value={part.photo_path || part.local_photo_path ? "Adjunta" : "Sin foto"} />

              <Modal
                visible={photoViewerOpen}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={resetPhotoZoom}
              >
                <View style={styles.photoViewer}>
                  <Pressable
                    style={styles.photoViewerClose}
                    onPress={resetPhotoZoom}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Cerrar foto ampliada"
                    testID="detail-photo-close"
                  >
                    <Text style={styles.photoViewerCloseText}>×</Text>
                  </Pressable>
                  <Image
                    source={
                      part.local_photo_path
                        ? { uri: part.local_photo_path }
                        : token && part.server_id
                          ? { uri: remotePartPhotoUrl(part.server_id), headers: { Authorization: `Bearer ${token}` } }
                          : undefined
                    }
                    style={[styles.photoViewerImage, photoZoomStyle]}
                    contentFit="contain"
                  />
                </View>
              </Modal>
              <Field
                label="Actualizado"
                value={part.updated_at ? new Date(part.updated_at).toLocaleString() : "—"}
              />
              <Field label="Estado" value={SYNC_TEXT[part.sync_state]} valueColor={syncColor} />
            </View>

            {canDelete && (
              <View>
                {!confirmDelete ? (
                  <Pressable style={styles.deleteBtn} onPress={() => setConfirmDelete(true)} testID="detail-delete-button">
                    <Text style={styles.deleteText}>Eliminar repuesto</Text>
                  </Pressable>
                ) : (
                  <View style={styles.confirmBox} testID="detail-delete-confirm">
                    <Text style={styles.confirmText}>¿Eliminar este repuesto?</Text>
                    <View style={styles.confirmRow}>
                      <Pressable style={styles.confirmCancel} onPress={() => setConfirmDelete(false)} testID="detail-delete-cancel">
                        <Text style={styles.confirmCancelText}>Cancelar</Text>
                      </Pressable>
                      <Pressable style={styles.confirmDelete} onPress={onDelete} testID="detail-delete-confirm-button">
                        <Text style={styles.confirmDeleteText}>Eliminar</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );

  function Field({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={[styles.fieldValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      </View>
    );
  }
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: { fontSize: 16, fontWeight: "700", color: colors.brandPrimary },
  edit: { fontSize: 16, fontWeight: "700", color: colors.brandPrimary },
  content: { padding: 16, gap: 16 },
  name: { fontSize: 26, fontWeight: "800", color: colors.onSurface },
  qtyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 },
  qtyBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandTertiary,
  },
  qtyBtnText: { fontSize: 30, fontWeight: "800", color: colors.onBrandTertiary, lineHeight: 32 },
  qtyCenter: { alignItems: "center", minWidth: 90 },
  qtyValue: { fontSize: 44, fontWeight: "800", color: colors.brandPrimary },
  qtyLabel: { fontSize: 14, color: colors.muted },
  photoPressable: {
    width: "100%",
    height: 220,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  photo: { width: "100%", height: "100%", borderRadius: 12 },
  photoViewer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  photoViewerImage: { width: "100%", height: "100%" },
  photoViewerClose: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    zIndex: 2,
  },
  photoViewerCloseText: { color: "#FFFFFF", fontSize: 34, fontWeight: "400", lineHeight: 38 },
  photoActions: { flexDirection: "row", gap: 10 },
  photoBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  photoBtnText: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  error: { color: colors.error, fontSize: 13 },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  field: { gap: 2 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.muted },
  fieldValue: { fontSize: 16, color: colors.onSurface },
  muted: { fontSize: 15, color: colors.muted },
  deleteBtn: { borderWidth: 1, borderColor: colors.error, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  deleteText: { color: colors.error, fontSize: 16, fontWeight: "700" },
  confirmBox: { borderWidth: 1, borderColor: colors.error, borderRadius: 12, padding: 16, gap: 12 },
  confirmText: { fontSize: 15, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  confirmRow: { flexDirection: "row", gap: 12 },
  confirmCancel: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  confirmCancelText: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  confirmDelete: { flex: 1, backgroundColor: colors.error, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  confirmDeleteText: { fontSize: 15, fontWeight: "700", color: colors.onError },
}));
