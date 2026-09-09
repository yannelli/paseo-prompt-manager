import type { PluginAgentPanelProps, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { MarkdownPreview } from "./markdown";
import { FolderPicker, FolderBreadcrumb } from "./editor";
import { ImportPrompts } from "./import";
import {
  archivePrompt, createFolder, listFolders, getGitStatus, getSettings, initGit, listPrompts, listVersions,
  readPrompt, readVersion, restoreVersion, savePrompt, saveSettings, syncGit,
  type Prompt,
} from "../shared/prompts";

type Props = PluginSurfaceProps & { agentId?: string };
type ButtonProps = {
  title: string;
  onPress: () => void;
  colors: PluginSurfaceProps["theme"]["colors"];
  disabled?: boolean;
  primary?: boolean;
  destructive?: boolean;
};

function Button({ title, onPress, colors, disabled, primary, destructive }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8,
        backgroundColor: primary ? colors.accent : colors.surface2,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ color: primary ? colors.accentForeground : destructive ? colors.statusDanger : colors.foreground, fontWeight: "600", fontSize: 13 }}>{title}</Text>
    </Pressable>
  );
}

export function PromptPanel(props: PluginAgentPanelProps) {
  return <PromptLibrary {...props} />;
}

export function PromptLibrary({ theme, layout, agentId }: Props) {
  const colors = theme.colors;
  const paseo = usePaseo();
  const cache = useQueryClient();
  const settingsRpc = useRpc(getSettings);
  const configureRpc = useRpc(saveSettings);
  const foldersRpc = useRpc(listFolders);
  const createFolderRpc = useRpc(createFolder);
  const listRpc = useRpc(listPrompts);
  const readRpc = useRpc(readPrompt);
  const saveRpc = useRpc(savePrompt);
  const archiveRpc = useRpc(archivePrompt);
  const versionsRpc = useRpc(listVersions);
  const versionRpc = useRpc(readVersion);
  const restoreRpc = useRpc(restoreVersion);
  const gitStatusRpc = useRpc(getGitStatus);
  const initRpc = useRpc(initGit);
  const syncRpc = useRpc(syncGit);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [mode, setMode] = useState<"list" | "editor" | "settings" | "import">("list");
  const [current, setCurrent] = useState<Prompt | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [folder, setFolder] = useState("");
  const [filterFolder, setFilterFolder] = useState<string | undefined>(undefined);
  const [filterTag, setFilterTag] = useState<string | undefined>(undefined);
  const [newFolder, setNewFolder] = useState("");
  const [organize, setOrganize] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [history, setHistory] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [directory, setDirectory] = useState("");
  const [gitEnabled, setGitEnabled] = useState(false);
  const [remote, setRemote] = useState("");
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const operationLock = useRef(false);

  const settings = useQuery({ queryKey: ["prompt-settings"], queryFn: () => settingsRpc({}) });
  const root = settings.data?.directory;
  const folders = useQuery({ queryKey: ["prompt-folders", root], queryFn: () => foldersRpc({}), enabled: Boolean(root) });
  const tagSources = useQuery({ queryKey: ["prompt-library", root, "tags", archived], queryFn: () => listRpc({ archived }), enabled: Boolean(root) });
  const availableTags = [...new Set(tagSources.data?.flatMap((prompt) => prompt.tags) ?? [])].sort();
  const prompts = useQuery({
    queryKey: ["prompt-library", root, query, archived, filterFolder, filterTag],
    queryFn: () => listRpc({ query, archived, folder: filterFolder, tag: filterTag }), enabled: Boolean(root),
  });
  const versions = useQuery({
    queryKey: ["prompt-versions", root, current?.id],
    queryFn: () => versionsRpc({ id: current!.id }), enabled: history && Boolean(current),
  });
  const preview = useQuery({
    queryKey: ["prompt-version", root, current?.id, version],
    queryFn: () => versionRpc({ id: current!.id, filename: version! }),
    enabled: Boolean(current && version && history),
  });
  const git = useQuery({
    queryKey: ["prompt-git", root], queryFn: () => gitStatusRpc({}),
    enabled: mode === "settings" && Boolean(settings.data?.gitEnabled),
  });
  const mutation = useMutation({
    mutationFn: async (action: () => Promise<void>) => { await action(); },
    onError: () => setNotice(""),
    onSettled: () => { operationLock.current = false; },
  });
  const busy = mutation.isPending;
  const tags = [...new Set(tagsText.split(",").map((tag) => tag.trim()).filter(Boolean))];
  const draftDirty = name !== (current?.title ?? "") || content !== (current?.content ?? "") ||
    description !== (current?.description ?? "") || tagsText !== (current?.tags.join(", ") ?? "") || Boolean(current && folder !== current.folder);
  const configDirty = mode === "settings" && Boolean(settings.data) &&
    (directory !== settings.data?.directory || gitEnabled !== settings.data?.gitEnabled);
  const dirty = draftDirty || configDirty;
  const run = (action: () => Promise<void>) => {
    if (operationLock.current) return;
    operationLock.current = true;
    setNotice("");
    mutation.mutate(action);
  };
  const guard = (action: () => void) => {
    if (busy) return;
    if (dirty) setPending(() => action);
    else action();
  };
  const accept = (prompt: Prompt | null) => {
    setCurrent(prompt);
    setName(prompt?.title ?? "");
    setContent(prompt?.content ?? "");
    setDescription(prompt?.description ?? "");
    setTagsText(prompt?.tags.join(", ") ?? "");
    setFolder(prompt?.folder ?? filterFolder ?? "");
    setOrganize(false);
    setVersion(null);
    setHistory(false);
    setArchiveConfirm(false);
    setMode("editor");
  };
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["prompt-library"] }),
      cache.invalidateQueries({ queryKey: ["prompt-versions"] }),
      cache.invalidateQueries({ queryKey: ["prompt-folders"] }),
      cache.invalidateQueries({ queryKey: ["prompt-git"] }),
    ]);
  };
  const error = mutation.error ?? settings.error ?? folders.error ?? tagSources.error ?? prompts.error ?? versions.error ?? preview.error ?? git.error;
  const text = { color: colors.foreground };
  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  const input = {
    color: colors.foreground, backgroundColor: colors.surface2, borderColor: colors.border,
    width: "100%" as const, minWidth: 0, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 14,
  };
  const row = { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, alignItems: "center" as const };
  const button = (title: string, onPress: () => void, options: Partial<ButtonProps> = {}) =>
    <Button title={title} onPress={onPress} colors={colors} disabled={busy || Boolean(pending)} {...options} />;

  const save = () => run(async () => {
    const saved = await saveRpc({ id: current?.id, name: current ? current.id.split("/").at(-1)! : name, content, revision: current?.revision ?? null, description, tags, folder });
    accept(saved);
    await refresh();
    setNotice("Prompt saved with a new local version.");
  });
  const saveDisabled = busy || Boolean(pending) || !draftDirty || !name.trim() || !content.trim() || Boolean(current?.archived);
  const fullEditor = mode === "editor" && expanded;

  return (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0, backgroundColor: colors.surface0, padding: fullEditor ? 10 : layout.compact ? 14 : 24, gap: 14 }}>
      {!fullEditor && <View style={{ ...row, justifyContent: "space-between" }}>
        <View style={{ gap: 4, flexShrink: 1 }}>
          <Text style={{ ...text, fontSize: layout.compact ? 22 : 28, fontWeight: "700" }}>Prompt library</Text>
          <Text style={muted}>{agentId ? "Save your instructions. Send them to this agent." : "Markdown prompts, shared across your agents on this host."}</Text>
        </View>
        <View style={row}>
          {button("New prompt", () => guard(() => accept(null)), { primary: true })}
          {button("Import", () => guard(() => setMode("import")), { disabled: busy || Boolean(pending) || !settings.data })}
          {button("Settings", () => guard(() => {
            setDirectory(settings.data?.directory ?? "");
            setGitEnabled(settings.data?.gitEnabled ?? false);
            setRemote("");
            setMode("settings");
          }), { disabled: busy || Boolean(pending) || !settings.data })}
        </View>
      </View>}
      {pending && <View style={{ padding: 14, borderRadius: 8, backgroundColor: colors.surface1, gap: 10 }}>
        <Text style={text}>You have unsaved changes. Discard them to continue?</Text>
        <View style={row}>
          <Button title="Keep editing" colors={colors} onPress={() => setPending(null)} />
          <Button title="Discard changes" destructive colors={colors} onPress={() => {
            const action = pending;
            setPending(null);
            setName(current?.title ?? "");
            setContent(current?.content ?? "");
            setDescription(current?.description ?? "");
            setTagsText(current?.tags.join(", ") ?? "");
            setFolder(current?.folder ?? filterFolder ?? "");
            setDirectory(settings.data?.directory ?? "");
            setGitEnabled(settings.data?.gitEnabled ?? false);
            action();
          }} />
        </View>
      </View>}
      {error && <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>{error instanceof Error ? error.message : String(error)}</Text>}
      {notice !== "" && <Text accessibilityRole="alert" style={{ color: colors.statusSuccess }}>{notice}</Text>}
      {busy && <Text style={muted}>Working…</Text>}
      {mode === "import" ? <ImportPrompts theme={theme} busy={busy || Boolean(pending)} run={run} onImported={refresh} onBack={() => setMode(current ? "editor" : "list")} folders={folders.data ?? []} initialFolder={filterFolder ?? ""} /> : mode === "settings" ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ gap: 16, padding: 3, paddingBottom: 28, width: "100%", maxWidth: 720 }}>
          <View style={row}>{button("Back to prompts", () => guard(() => setMode(current || draftDirty ? "editor" : "list")))}</View>
          <Text style={{ ...text, fontSize: 20, fontWeight: "600" }}>Library settings</Text>
          <View style={{ gap: 7 }}>
            <Text style={text}>Directory on this host</Text>
            <TextInput accessibilityLabel="Prompt library directory" value={directory} onChangeText={setDirectory} editable={!busy && !pending} autoCapitalize="none" autoCorrect={false} placeholder="~/.config/paseo/prompt-lib" placeholderTextColor={colors.foregroundMuted} style={input} />
            <Text style={muted}>Changing the directory opens a different library. Existing files stay in their directory.</Text>
          </View>
          <View style={row}>
            {button(gitEnabled ? "Git sync: on" : "Git sync: off", () => setGitEnabled(!gitEnabled))}
            {button("Save settings", () => run(async () => {
              const result = await configureRpc({ directory, gitEnabled });
              cache.setQueryData(["prompt-settings"], result);
              setDirectory(result.directory);
              setGitEnabled(result.gitEnabled);
              setCurrent(null); setName(""); setContent(""); setDescription(""); setTagsText(""); setFolder(""); setFilterFolder(undefined); setFilterTag(undefined); setHistory(false); setVersion(null);
              await refresh();
              setNotice("Settings saved.");
            }), { primary: true, disabled: busy || Boolean(pending) || !directory.trim() || !configDirty })}
          </View>
          {settings.data?.gitEnabled && <View style={{ gap: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 18 }}>
            <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>Git sync</Text>
            <Text style={muted}>Sync runs when you press Sync now. It commits library changes, pulls, and pushes using this host’s Git credentials.</Text>
            {git.isLoading && <Text style={muted}>Reading repository…</Text>}
            {git.data && <>
              <Text style={text}>{git.data.message}</Text>
              {git.data.initialized && <Text style={muted}>{git.data.branch || "No branch"} · {git.data.changes} changed files{"\n"}{git.data.remote || "No remote configured"}</Text>}
              {(!git.data.initialized || !git.data.remote) && <>
                <TextInput accessibilityLabel="Git remote URL" value={remote} onChangeText={setRemote} editable={!busy && !configDirty && !pending} autoCapitalize="none" autoCorrect={false} placeholder="Git remote URL (optional)" placeholderTextColor={colors.foregroundMuted} style={input} />
                <View style={row}>{button(git.data.initialized ? "Set remote" : "Initialize Git", () => run(async () => {
                  const result = await initRpc({ remote });
                  cache.setQueryData(["prompt-git", root], result);
                  setNotice(result.message);
                }), { disabled: busy || Boolean(pending) || configDirty || (git.data.initialized && !remote.trim()) })}</View>
              </>}
              {git.data.initialized && <View style={row}>{button("Sync now", () => run(async () => {
                const result = await syncRpc({});
                cache.setQueryData(["prompt-git", root], result);
                await refresh();
                setNotice(result.message);
              }), { primary: true, disabled: busy || Boolean(pending) || configDirty })}</View>}
            </>}
          </View>}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, minHeight: 0, minWidth: 0, flexDirection: layout.compact ? "column" : "row", gap: 22 }}>
          {!fullEditor && (!layout.compact || mode === "list") && <View style={{ width: layout.compact ? undefined : 270, minWidth: 0, minHeight: 0, flex: layout.compact ? 1 : undefined, gap: 10, paddingHorizontal: 3 }}>
            <TextInput accessibilityLabel="Search prompts" value={query} onChangeText={setQuery} placeholder="Search prompts, tags, descriptions…" placeholderTextColor={colors.foregroundMuted} style={input} />
            <View style={row}>
              {button(archived ? "Hide archived" : "Include archived", () => setArchived(!archived))}
              {button("Refresh", () => guard(() => run(async () => {
                if (current) accept(await readRpc({ id: current.id }));
                await refresh();
              })))}
            </View>
            <View style={{ gap: 6 }}>
              <View style={{ ...row, justifyContent: "space-between" }}>
                <Text style={muted}>{filterFolder === undefined ? "All folders" : `Library / ${filterFolder || "Root"}`}{filterTag ? ` · #${filterTag}` : ""}</Text>
                {button(organize ? "Hide filters" : "Folders & tags", () => setOrganize(!organize))}
              </View>
              {organize && <View style={{ gap: 8 }}>
                <FolderPicker folders={folders.data ?? []} selected={filterFolder} onSelect={setFilterFolder} colors={colors} disabled={busy || Boolean(pending)} allowAll />
                <TextInput accessibilityLabel="New folder or subfolder" value={newFolder} onChangeText={setNewFolder} editable={!busy && !pending} placeholder="Folder or parent/subfolder" placeholderTextColor={colors.foregroundMuted} autoCapitalize="none" style={input} />
                <View style={row}>{button("Create folder", () => run(async () => {
                  const created = await createFolderRpc({ path: [filterFolder, newFolder.trim()].filter(Boolean).join("/") });
                  setNewFolder(""); setFilterFolder(created.path); await refresh();
                }), { disabled: busy || Boolean(pending) || !newFolder.trim() })}</View>
                <Text style={muted}>Created inside {filterFolder || "Library root"}. Use / for subfolders.</Text>
                <ScrollView style={{ maxHeight: 108, flexGrow: 0 }} contentContainerStyle={{ ...row, padding: 3 }}>
                  {filterTag && button("Clear tag", () => setFilterTag(undefined))}
                  {availableTags.map((tag) => <Button key={tag} title={`#${tag}`} colors={colors} primary={filterTag === tag} disabled={busy || Boolean(pending)} onPress={() => setFilterTag(filterTag === tag ? undefined : tag)} />)}
                </ScrollView>
              </View>}
            </View>
            {prompts.isLoading && <Text style={muted}>Loading prompts…</Text>}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minHeight: 0, minWidth: 0 }} contentContainerStyle={{ gap: 6, padding: 3, paddingBottom: 18 }}>
              {prompts.data?.map((prompt) => <Pressable key={prompt.id} accessibilityRole="button" accessibilityLabel={`Open ${prompt.title}`} accessibilityState={{ selected: current?.id === prompt.id }} disabled={busy || Boolean(pending)} onPress={() => guard(() => run(async () => accept(await readRpc({ id: prompt.id }))))} style={{ padding: 14, borderRadius: 8, gap: 6, borderLeftWidth: 3, borderLeftColor: current?.id === prompt.id ? colors.accent : colors.surface0, backgroundColor: current?.id === prompt.id ? colors.surface2 : colors.surface1 }}>
                <Text numberOfLines={2} style={{ ...text, fontWeight: "600" }}>{prompt.title}</Text>
                {prompt.description !== "" && <Text numberOfLines={2} style={muted}>{prompt.description}</Text>}
                {prompt.tags.length > 0 && <Text numberOfLines={1} style={{ ...muted, color: colors.accent }}>{prompt.tags.map((tag) => `#${tag}`).join("  ")}</Text>}
                <Text numberOfLines={1} style={muted}>{prompt.id}.md{prompt.archived ? " · Archived" : ""}</Text>
              </Pressable>)}
              {prompts.data?.length === 0 && <Text style={{ ...muted, paddingVertical: 20 }}>{query ? "No matching prompts." : "Create your first prompt or add Markdown files to your library directory."}</Text>}
            </ScrollView>
            <Text numberOfLines={2} style={muted}>{root}</Text>
          </View>}
          {(!layout.compact || mode === "editor") && <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            {mode === "list" ? <View style={{ paddingTop: 30, gap: 10 }}>
              <Text style={{ ...text, fontSize: 22, fontWeight: "600" }}>Instructions worth keeping</Text>
              <Text style={muted}>Choose a prompt to edit its Markdown and browse saved versions.</Text>
              <Text style={muted}>In any composer, open attachments and choose Saved prompt to include a prompt with your message.</Text>
            </View> : <View style={{ flex: 1, minHeight: 0, minWidth: 0, gap: 10, paddingHorizontal: 3 }}>
              <View style={{ ...row, justifyContent: "space-between" }}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text numberOfLines={1} style={{ ...text, fontSize: 20, fontWeight: "600" }}>{current ? current.title : "New prompt"}</Text>
                  <Text style={muted}>{draftDirty ? "Unsaved changes" : current?.archived ? "Archived" : current ? "Saved" : ""}</Text>
                </View>
                {button(expanded ? "Collapse editor" : "Expand editor", () => setExpanded(!expanded))}
              </View>
              <View style={row}>
                {(layout.compact || expanded) && button("Back to library", () => guard(() => { setExpanded(false); setMode("list"); }))}
                {button("Save prompt", save, { primary: true, disabled: saveDisabled })}
                {button(markdownPreview ? "Edit Markdown" : "Preview Markdown", () => setMarkdownPreview(!markdownPreview))}
                {draftDirty && button("Discard draft", () => guard(() => accept(current)))}
              </View>
              {expanded && !current && <TextInput accessibilityLabel="Prompt filename" value={name} onChangeText={setName} editable={!busy && !pending} placeholder="Filename, for example code-review" placeholderTextColor={colors.foregroundMuted} style={input} />}
              {!expanded && <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1, maxHeight: layout.compact ? 220 : 330, minWidth: 0 }} contentContainerStyle={{ gap: 12, padding: 3, paddingBottom: 8 }}>
                {!current && <TextInput accessibilityLabel="Prompt filename" value={name} onChangeText={setName} editable={!busy && !pending} placeholder="Filename, for example code-review" placeholderTextColor={colors.foregroundMuted} style={input} />}
                <Text style={muted}>The first Markdown heading becomes the prompt title.</Text>
                <View style={{ gap: 6 }}>
                  <Text style={text}>Description</Text>
                  <TextInput accessibilityLabel="Prompt description" value={description} onChangeText={setDescription} editable={!busy && !current?.archived && !pending} maxLength={2000} multiline placeholder="When to use this prompt" placeholderTextColor={colors.foregroundMuted} style={{ ...input, minHeight: 66 }} />
                </View>
                <View style={{ gap: 6 }}>
                  <Text style={text}>Labels / tags</Text>
                  <TextInput accessibilityLabel="Prompt tags" value={tagsText} onChangeText={setTagsText} editable={!busy && !current?.archived && !pending} autoCapitalize="none" placeholder="review, coding, writing" placeholderTextColor={colors.foregroundMuted} style={input} />
                  <Text style={muted}>Separate tags with commas.</Text>
                  {tags.length > 0 && <View style={row}>{tags.map((tag) => <Button key={tag} title={`#${tag} ×`} colors={colors} disabled={busy || Boolean(pending) || Boolean(current?.archived)} onPress={() => setTagsText(tags.filter((value) => value !== tag).join(", "))} />)}</View>}
                </View>
                <View style={{ gap: 6 }}>
                  <Text style={text}>Folder</Text>
                  <FolderBreadcrumb folder={folder} colors={colors} />
                  <FolderPicker folders={folders.data ?? []} selected={folder} onSelect={(value) => setFolder(value ?? "")} colors={colors} disabled={busy || Boolean(pending) || Boolean(current?.archived)} />
                  {!current?.archived && <>
                    <TextInput accessibilityLabel="Create editor subfolder" value={newFolder} onChangeText={setNewFolder} editable={!busy && !pending} placeholder="New folder or nested/path" placeholderTextColor={colors.foregroundMuted} autoCapitalize="none" style={input} />
                    <View style={row}>{button("Create in selected folder", () => run(async () => {
                      const created = await createFolderRpc({ path: [folder, newFolder.trim()].filter(Boolean).join("/") });
                      setNewFolder(""); setFolder(created.path); await refresh();
                    }), { disabled: busy || Boolean(pending) || !newFolder.trim() })}</View>
                  </>}
                </View>
                {current && <Text style={muted}>{current.id}.md · Updated {new Date(current.updatedAt).toLocaleString()}</Text>}
              </ScrollView>}
              <View style={{ flex: 1, minHeight: expanded ? 0 : 140, minWidth: 0, padding: 3 }}>
                {markdownPreview ? <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface1 }} contentContainerStyle={{ padding: 14, minWidth: 0 }}>
                  <MarkdownPreview content={content} theme={theme} />
                </ScrollView> : <TextInput accessibilityLabel="Prompt Markdown" value={content} onChangeText={setContent} editable={!busy && !current?.archived && !pending} multiline textAlignVertical="top" autoCapitalize="none" autoCorrect={false} placeholder="Write your prompt in Markdown…" placeholderTextColor={colors.foregroundMuted} style={{ ...input, flex: 1, minHeight: 0, fontFamily: "monospace", lineHeight: 21 }} />}
              </View>
              {!expanded && <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: history ? 260 : 140, flexGrow: 0, minWidth: 0 }} contentContainerStyle={{ gap: 14, padding: 3, paddingBottom: 12 }}>
                <View style={row}>
                  {current && button(history ? "Hide history" : "Version history", () => { setHistory(!history); setVersion(null); })}
                  {current && !current.archived && button("Archive", () => guard(() => setArchiveConfirm(true)), { destructive: true })}
                </View>
              {archiveConfirm && current && <View style={{ gap: 10, padding: 14, borderRadius: 8, backgroundColor: colors.surface1 }}>
                <Text style={text}>Archive “{current.title}”? Its versions remain available for restore.</Text>
                <View style={row}>
                  {button("Cancel", () => setArchiveConfirm(false))}
                  {button("Confirm archive", () => run(async () => {
                    await archiveRpc({ id: current.id, revision: current.revision });
                    accept(null); setMode("list"); await refresh(); setNotice("Prompt archived.");
                  }), { destructive: true })}
                </View>
              </View>}
              {agentId && current && !current.archived && <View style={{ gap: 8, borderTopWidth: 1, borderColor: colors.border, paddingTop: 14 }}>
                <View style={row}>{button("Send saved prompt to agent", () => run(async () => {
                  const saved = await readRpc({ id: current.id });
                  if (saved.archived) throw new Error("This prompt is archived. Restore it before sending.");
                  await paseo.agents.ref(agentId).send(saved.content);
                  setNotice("Prompt sent to this agent.");
                }), { primary: true, disabled: busy || Boolean(pending) || draftDirty })}</View>
                <Text style={muted}>{draftDirty ? "Save your changes before sending." : "Starts an agent turn with this prompt."}</Text>
              </View>}
              <Text style={muted}>To add a prompt to a draft, choose Saved prompt from the composer’s attachment menu.</Text>
              {history && current && <View style={{ gap: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 16 }}>
                <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>Version history</Text>
                {versions.isLoading && <Text style={muted}>Loading versions…</Text>}
                {versions.data?.length === 0 && <Text style={muted}>No saved versions yet.</Text>}
                <View style={row}>{versions.data?.map((item) => <Button key={item.filename} title={`v${item.version} · ${new Date(item.createdAt).toLocaleString()}`} colors={colors} primary={version === item.filename} disabled={busy || Boolean(pending)} onPress={() => setVersion(item.filename)} />)}</View>
                {preview.isLoading && version && <Text style={muted}>Loading version…</Text>}
                {version && preview.data && <>
                  {preview.data.description !== "" && <Text style={muted}>{preview.data.description}</Text>}
                  {preview.data.tags.length > 0 && <Text style={muted}>{preview.data.tags.map((tag) => `#${tag}`).join(" · ")}</Text>}
                  <Text selectable style={{ ...text, fontFamily: "monospace", lineHeight: 21, padding: 14, backgroundColor: colors.surface1, borderRadius: 8 }}>{preview.data.content}</Text>
                  <View style={row}>{button("Restore as new version", () => guard(() => run(async () => {
                    const restored = await restoreRpc({ id: current.id, filename: version, revision: current.revision });
                    accept(restored); await refresh(); setNotice("Version restored as a new revision.");
                  })))}</View>
                </>}
              </View>}
              </ScrollView>}
            </View>}
          </View>}
        </View>
      )}
    </View>
  );
}
