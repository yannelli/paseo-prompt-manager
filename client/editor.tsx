import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Pressable, ScrollView, Text, View } from "react-native";

type Props = {
  folders: string[];
  selected: string | undefined;
  onSelect: (folder: string | undefined) => void;
  colors: PluginSurfaceProps["theme"]["colors"];
  disabled?: boolean;
  allowAll?: boolean;
};

export function FolderPicker({ folders, selected, onSelect, colors, disabled, allowAll }: Props) {
  const choices = [...new Set(["", ...folders])].sort();
  return <ScrollView style={{ maxHeight: 156, flexGrow: 0, minWidth: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 3, padding: 3 }}>
    {allowAll && <Pressable accessibilityRole="button" accessibilityLabel="All folders" accessibilityState={{ selected: selected === undefined, disabled }} disabled={disabled} onPress={() => onSelect(undefined)} style={{ padding: 9, borderRadius: 6, backgroundColor: selected === undefined ? colors.surface2 : colors.surface0 }}>
      <Text style={{ color: selected === undefined ? colors.accent : colors.foreground }}>All folders</Text>
    </Pressable>}
    {choices.map((folder) => <Pressable key={folder} accessibilityRole="button" accessibilityLabel={`Select folder ${folder || "Library root"}`} accessibilityState={{ selected: selected === folder, disabled }} disabled={disabled} onPress={() => onSelect(folder)} style={{ padding: 9, paddingLeft: 9 + Math.min(folder.split("/").length - 1, 6) * 12, borderRadius: 6, backgroundColor: selected === folder ? colors.surface2 : colors.surface0 }}>
      <Text numberOfLines={1} style={{ color: selected === folder ? colors.accent : colors.foreground, fontSize: 13 }}>{folder ? `▸ ${folder.split("/").at(-1)}` : "Library root"}</Text>
    </Pressable>)}
  </ScrollView>;
}

export function FolderBreadcrumb({ folder, colors }: { folder: string; colors: Props["colors"] }) {
  return <View style={{ minWidth: 0 }}><Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Library{folder ? ` / ${folder.split("/").join(" / ")}` : " / Root"}</Text></View>;
}
