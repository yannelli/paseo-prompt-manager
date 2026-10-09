import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Version } from "../shared/prompts";
import { MarkdownPreview } from "./markdown";
import { Button, Chip, IconButton, Segmented, radius, relativeTime } from "./ui";

type Snapshot = { content: string; description: string; tags: string[] };

type Props = {
  theme: PluginSurfaceProps["theme"];
  versions: Version[] | undefined;
  loading: boolean;
  selected: string | null;
  onSelect: (filename: string) => void;
  snapshot: Snapshot | undefined;
  snapshotLoading: boolean;
  onRestore: () => void;
  onClose: () => void;
  disabled: boolean;
  archived: boolean;
};

export function VersionHistory({ theme, versions, loading, selected, onSelect, snapshot, snapshotLoading, onRestore, onClose, disabled, archived }: Props) {
  const colors = theme.colors;
  const [view, setView] = useState<"raw" | "preview">("raw");
  const latest = versions?.[0];
  return (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: radius, backgroundColor: colors.surface1, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingLeft: 12, paddingRight: 6, borderBottomWidth: 1, borderColor: colors.border }}>
        <Icon name="History" size={15} color={colors.accent} />
        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>Version history</Text>
        {versions && <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{versions.length}</Text>}
        <IconButton icon="X" label="Hide history" onPress={onClose} colors={colors} size={28} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: 8, gap: 8 }}>
        {loading && <Text style={{ color: colors.foregroundMuted, fontSize: 12, padding: 6 }}>Loading versions…</Text>}
        {versions?.length === 0 && <Text style={{ color: colors.foregroundMuted, fontSize: 12, padding: 6 }}>No saved versions yet. Each save adds one.</Text>}
        {versions?.map((item) => {
          const active = selected === item.filename;
          return (
            <Pressable
              key={item.filename}
              accessibilityRole="button"
              accessibilityLabel={`Version ${item.version}`}
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onSelect(item.filename)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius - 2, backgroundColor: active || pressed ? colors.surface2 : "transparent", borderWidth: 1, borderColor: active ? colors.accent : "transparent" })}
            >
              <View style={{ minWidth: 34, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6, backgroundColor: colors.surface0, alignItems: "center" }}>
                <Text style={{ color: active ? colors.accent : colors.foreground, fontSize: 12, fontWeight: "700" }}>v{item.version}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.foreground, fontSize: 13 }}>{relativeTime(item.createdAt)}{item === latest ? " · latest" : ""}</Text>
                <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>{new Date(item.createdAt).toLocaleString()}</Text>
              </View>
              <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
            </Pressable>
          );
        })}
        {selected && (
          <View style={{ gap: 10, paddingTop: 8, borderTopWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <Segmented options={[{ value: "raw", label: "Source", icon: "Code" }, { value: "preview", label: "Preview", icon: "Eye" }]} value={view} onChange={setView} colors={colors} />
              <Button title={archived ? "Restore prompt" : "Restore as new version"} icon="RotateCcw" variant="primary" size="sm" onPress={onRestore} colors={colors} disabled={disabled || !snapshot} />
            </View>
            {snapshotLoading && <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Loading version…</Text>}
            {snapshot && (
              <>
                {snapshot.description !== "" && <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{snapshot.description}</Text>}
                {snapshot.tags.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>{snapshot.tags.map((tag) => <Chip key={tag} label={tag} icon="Hash" colors={colors} />)}</View>}
                <View style={{ padding: 12, borderRadius: radius - 2, backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.border, minWidth: 0 }}>
                  {view === "raw"
                    ? <Text selectable style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 19 }}>{snapshot.content}</Text>
                    : <MarkdownPreview content={snapshot.content} theme={theme} />}
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
