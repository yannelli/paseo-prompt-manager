import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { Prompt } from "../shared/prompts";
import { FolderPicker } from "./editor";
import { Card, Chip, IconButton, Meta, inputStyle, radius, relativeTime, type Colors } from "./ui";

type Summary = Omit<Prompt, "content">;

type Props = {
  colors: Colors;
  compact: boolean;
  disabled: boolean;
  query: string;
  setQuery: (value: string) => void;
  archived: boolean;
  setArchived: (value: boolean) => void;
  filterFolder: string | undefined;
  setFilterFolder: (value: string | undefined) => void;
  filterTag: string | undefined;
  setFilterTag: (value: string | undefined) => void;
  organize: boolean;
  setOrganize: (value: boolean) => void;
  folders: string[];
  tags: string[];
  prompts: Summary[] | undefined;
  loading: boolean;
  currentId: string | undefined;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  newFolder: string;
  setNewFolder: (value: string) => void;
  onCreateFolder: () => void;
  root: string | undefined;
  footer?: ReactNode;
};

export function LibrarySidebar(props: Props) {
  const { colors, compact, disabled, query, setQuery, archived, setArchived, filterFolder, setFilterFolder, filterTag, setFilterTag, organize, setOrganize, folders, tags, prompts, loading, currentId, onOpen, onRefresh, newFolder, setNewFolder, onCreateFolder, root, footer } = props;
  const filtered = filterFolder !== undefined || filterTag !== undefined || archived || query !== "";
  const count = prompts?.length ?? 0;
  return (
    <View style={{ width: compact ? undefined : 300, minWidth: 0, minHeight: 0, flex: compact ? 1 : undefined, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, ...inputStyle(colors), paddingVertical: 0, paddingHorizontal: 10 }}>
        <Icon name="Search" size={15} color={colors.foregroundMuted} />
        <TextInput accessibilityLabel="Search prompts" value={query} onChangeText={setQuery} placeholder="Search titles, tags, content…" placeholderTextColor={colors.foregroundMuted} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, paddingVertical: 10 }} />
        {query !== "" && <IconButton icon="X" label="Clear search" onPress={() => setQuery("")} colors={colors} size={26} />}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Chip icon={organize ? "FolderOpen" : "Folder"} label={filterFolder === undefined ? "All folders" : filterFolder ? filterFolder.split("/").at(-1)! : "Root"} active={organize || filterFolder !== undefined} onPress={() => setOrganize(!organize)} onClear={filterFolder !== undefined ? () => setFilterFolder(undefined) : undefined} colors={colors} disabled={disabled} />
        {filterTag && <Chip icon="Hash" label={filterTag} active onClear={() => setFilterTag(undefined)} colors={colors} disabled={disabled} />}
        <Chip icon="Archive" label="Archived" active={archived} onPress={() => setArchived(!archived)} colors={colors} disabled={disabled} />
        <View style={{ flex: 1 }} />
        <IconButton icon="RefreshCw" label="Refresh" onPress={onRefresh} colors={colors} disabled={disabled} size={30} />
      </View>
      {organize && (
        <Card colors={colors} style={{ padding: 8, gap: 8 }}>
          <FolderPicker folders={folders} selected={filterFolder} onSelect={setFilterFolder} colors={colors} disabled={disabled} allowAll maxHeight={170} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TextInput accessibilityLabel="New folder or subfolder" value={newFolder} onChangeText={setNewFolder} editable={!disabled} placeholder={filterFolder ? `New folder in ${filterFolder.split("/").at(-1)}` : "New folder or parent/child"} placeholderTextColor={colors.foregroundMuted} autoCapitalize="none" autoCorrect={false} onSubmitEditing={onCreateFolder} style={{ ...inputStyle(colors), backgroundColor: colors.surface0, flex: 1, width: undefined, paddingVertical: 8, fontSize: 13 }} />
            <IconButton icon="FolderPlus" label="Create folder" onPress={onCreateFolder} colors={colors} disabled={disabled || !newFolder.trim()} />
          </View>
          {tags.length > 0 && (
            <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
              {tags.map((tag) => <Chip key={tag} icon="Hash" label={tag} active={filterTag === tag} onPress={() => setFilterTag(filterTag === tag ? undefined : tag)} colors={colors} disabled={disabled} />)}
            </ScrollView>
          )}
        </Card>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "600" }}>{loading ? "Loading…" : `${count} prompt${count === 1 ? "" : "s"}`}</Text>
        {filtered && !loading && <Pressable accessibilityRole="button" accessibilityLabel="Clear filters" onPress={() => { setQuery(""); setFilterFolder(undefined); setFilterTag(undefined); setArchived(false); }}><Text style={{ color: colors.accent, fontSize: 11, fontWeight: "600" }}>Clear filters</Text></Pressable>}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minHeight: 0, minWidth: 0 }} contentContainerStyle={{ gap: 6, paddingBottom: 12 }}>
        {prompts?.map((prompt) => <PromptRow key={prompt.id} prompt={prompt} colors={colors} selected={currentId === prompt.id} disabled={disabled} onPress={() => onOpen(prompt.id)} />)}
        {prompts?.length === 0 && (
          <View style={{ alignItems: "center", gap: 6, paddingVertical: 28, paddingHorizontal: 12 }}>
            <Icon name={filtered ? "SearchX" : "NotebookPen"} size={22} color={colors.foregroundMuted} />
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", textAlign: "center" }}>{filtered ? "No matching prompts" : "No prompts yet"}</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, textAlign: "center", lineHeight: 17 }}>{filtered ? "Try another search or clear the filters." : "Create a prompt or import Markdown files to get started."}</Text>
          </View>
        )}
      </ScrollView>
      {footer}
      {root && <Meta colors={colors} icon="HardDrive">{root}</Meta>}
    </View>
  );
}

function PromptRow({ prompt, colors, selected, disabled, onPress }: { prompt: Summary; colors: Colors; selected: boolean; disabled: boolean; onPress: () => void }) {
  const shown = prompt.tags.slice(0, 3);
  const extra = prompt.tags.length - shown.length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${prompt.title}`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius, gap: 4, minWidth: 0,
        backgroundColor: selected ? colors.surface2 : pressed ? colors.surface2 : colors.surface1,
        borderWidth: 1, borderColor: selected ? colors.accent : colors.border, opacity: prompt.archived ? 0.75 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "600", fontSize: 14, flex: 1, minWidth: 0 }}>{prompt.title}</Text>
        {prompt.archived && <Icon name="Archive" size={13} color={colors.foregroundMuted} />}
      </View>
      {prompt.description !== "" && <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{prompt.description}</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Meta colors={colors} icon="Folder">{prompt.folder || "Root"}</Meta>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>·</Text>
        <Meta colors={colors}>{prompt.archived ? "Archived" : relativeTime(prompt.updatedAt)}</Meta>
      </View>
      {shown.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
          {shown.map((tag) => <Text key={tag} style={{ color: colors.accent, fontSize: 11, fontWeight: "600", paddingVertical: 1, paddingHorizontal: 6, borderRadius: 999, backgroundColor: colors.surface0 }}>#{tag}</Text>)}
          {extra > 0 && <Text style={{ color: colors.foregroundMuted, fontSize: 11, paddingVertical: 1 }}>+{extra}</Text>}
        </View>
      )}
    </Pressable>
  );
}
