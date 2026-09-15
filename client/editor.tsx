import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { radius, type Colors } from "./ui";

type Props = {
  folders: string[];
  selected: string | undefined;
  onSelect: (folder: string | undefined) => void;
  colors: Colors;
  disabled?: boolean;
  allowAll?: boolean;
  maxHeight?: number;
};

type RowProps = { label: string; icon: string; depth: number; selected: boolean; disabled?: boolean; onPress: () => void; colors: Colors; accessibilityLabel: string };

function FolderRow({ label, icon, depth, selected, disabled, onPress, colors, accessibilityLabel }: RowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, paddingRight: 8, paddingLeft: 8 + Math.min(depth, 6) * 14,
        borderRadius: radius - 4, backgroundColor: selected ? colors.surface2 : pressed ? colors.surface2 : "transparent", opacity: disabled ? 0.5 : 1,
      })}
    >
      <Icon name={icon} size={14} color={selected ? colors.accent : colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ color: selected ? colors.accent : colors.foreground, fontSize: 13, fontWeight: selected ? "600" : "400", flex: 1, minWidth: 0 }}>{label}</Text>
      {selected && <Icon name="Check" size={14} color={colors.accent} />}
    </Pressable>
  );
}

export function FolderPicker({ folders, selected, onSelect, colors, disabled, allowAll, maxHeight = 180 }: Props) {
  const choices = [...new Set(["", ...folders])].sort();
  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight, flexGrow: 0, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: radius - 2, backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: 4, gap: 1 }}>
      {allowAll && <FolderRow label="All folders" icon="Library" depth={0} selected={selected === undefined} disabled={disabled} onPress={() => onSelect(undefined)} colors={colors} accessibilityLabel="All folders" />}
      {choices.map((folder) => (
        <FolderRow
          key={folder}
          label={folder ? folder.split("/").at(-1)! : "Library root"}
          icon={folder ? (selected === folder ? "FolderOpen" : "Folder") : "House"}
          depth={folder ? folder.split("/").length : 0}
          selected={selected === folder}
          disabled={disabled}
          onPress={() => onSelect(folder)}
          colors={colors}
          accessibilityLabel={`Select folder ${folder || "Library root"}`}
        />
      ))}
    </ScrollView>
  );
}

export function FolderBreadcrumb({ folder, colors }: { folder: string; colors: Colors }) {
  const parts = folder ? folder.split("/") : [];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, minWidth: 0 }}>
      <Icon name="House" size={12} color={colors.foregroundMuted} />
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Library</Text>
      {parts.map((part, index) => (
        <View key={`${index}-${part}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="ChevronRight" size={12} color={colors.foregroundMuted} />
          <Text numberOfLines={1} style={{ color: index === parts.length - 1 ? colors.foreground : colors.foregroundMuted, fontSize: 12, fontWeight: index === parts.length - 1 ? "600" : "400" }}>{part}</Text>
        </View>
      ))}
      {!parts.length && <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>· root</Text>}
    </View>
  );
}
