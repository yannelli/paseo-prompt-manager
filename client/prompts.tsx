import type { PluginAgentPanelProps, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MarkdownPreview } from "./markdown";
import { FolderPicker, FolderBreadcrumb } from "./editor";
import { VersionHistory } from "./history";
import { ImportPrompts } from "./import";
import { LibrarySettingsScreen } from "./settings";
import { LibrarySidebar } from "./sidebar";
import { SyncBadge, describeMode } from "./sync";
import { Banner, Button, Card, Chip, ConfirmModal, EmptyState, Field, IconButton, Meta, Segmented, StatusDot, Tip, inputStyle, radius, relativeTime, row, useDebounced, wordCount } from "./ui";
import {
  archivePrompt, createFolder, listFolders, getGitStatus, getSettings, getSyncState, initGit, listPrompts, listVersions,
  openSync, readPrompt, readVersion, restoreVersion, savePrompt, saveSettings, syncGit,
  type Prompt, type SyncMode,
} from "../shared/prompts";

const FRESH_MS = 30_000;

type Props = PluginSurfaceProps & { agentId?: string };

export function PromptPanel(props: PluginAgentPanelProps) {
  return <PromptLibrary {...props} />;
}

export function PromptLibrary({ theme, layout, agentId }: Props) {
  const colors = theme.colors;
  const paseo = usePaseo();
  const toast = useToast();
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
  const syncStateRpc = useRpc(getSyncState);
  const openSyncRpc = useRpc(openSync);
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
  const [details, setDetails] = useState(true);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [history, setHistory] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [directory, setDirectory] = useState("");
  const [gitEnabled, setGitEnabled] = useState(false);
  const [remote, setRemote] = useState("");
  const [branch, setBranch] = useState("");
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const operationLock = useRef(false);

  const settings = useQuery({ queryKey: ["prompt-settings"], queryFn: () => settingsRpc({}) });
  const root = settings.data?.directory;
  const searchQuery = useDebounced(query, 200);
  const folders = useQuery({ queryKey: ["prompt-folders", root], queryFn: () => foldersRpc({}), enabled: Boolean(root), staleTime: FRESH_MS });
  // Shares the unfiltered list query, so tags cost no extra request until a filter is applied.
  const tagSources = useQuery({
    queryKey: ["prompt-library", root, "", archived, undefined, undefined],
    queryFn: () => listRpc({ query: "", archived }), enabled: Boolean(root), staleTime: FRESH_MS,
  });
  const availableTags = [...new Set(tagSources.data?.flatMap((prompt) => prompt.tags) ?? [])].sort();
  const prompts = useQuery({
    queryKey: ["prompt-library", root, searchQuery, archived, filterFolder, filterTag],
    queryFn: () => listRpc({ query: searchQuery, archived, folder: filterFolder, tag: filterTag }), enabled: Boolean(root),
    staleTime: FRESH_MS, placeholderData: keepPreviousData,
  });
  const versions = useQuery({
    queryKey: ["prompt-versions", root, current?.id],
    queryFn: () => versionsRpc({ id: current!.id }), enabled: history && Boolean(current),
  });
  const snapshot = useQuery({
    queryKey: ["prompt-version", root, current?.id, version],
    queryFn: () => versionRpc({ id: current!.id, filename: version! }),
    enabled: Boolean(current && version && history),
  });
  const git = useQuery({
    queryKey: ["prompt-git", root], queryFn: () => gitStatusRpc({}),
    enabled: mode === "settings" && Boolean(settings.data?.gitEnabled),
  });
  const gitEnabledSaved = Boolean(settings.data?.gitEnabled);
  const syncState = useQuery({
    queryKey: ["prompt-sync", root], queryFn: () => syncStateRpc({}), enabled: gitEnabledSaved,
    refetchInterval: (state) => state.state.data?.running ? 2_000 : state.state.data?.mode === "manual" ? false : 30_000,
  });
  const lastSyncedAt = syncState.data?.lastSyncedAt;
  const seenSync = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // A sync can pull prompts from the remote, so reload lists whenever a new sync lands.
    if (seenSync.current !== undefined && lastSyncedAt !== seenSync.current) void refresh();
    seenSync.current = lastSyncedAt;
  }, [lastSyncedAt]);
  const listed = prompts.isSuccess;
  useEffect(() => {
    // Wait for the first list so the background pull never delays it.
    if (!gitEnabledSaved || !root || !listed) return;
    openSyncRpc({}).then((state) => cache.setQueryData(["prompt-sync", root], state)).catch(() => undefined);
  }, [gitEnabledSaved, root, listed]);
  useEffect(() => {
    if (mode !== "settings" || !git.data) return;
    setRemote(git.data.remote);
    setBranch(git.data.branch);
  }, [mode, git.data?.remote, git.data?.branch]);
  const mutation = useMutation({
    mutationFn: async (action: () => Promise<void>) => { await action(); },
    onSettled: () => { operationLock.current = false; },
  });
  const busy = mutation.isPending;
  const tags = [...new Set(tagsText.split(",").map((tag) => tag.trim()).filter(Boolean))];
  const draftDirty = name !== (current?.title ?? "") || content !== (current?.content ?? "") ||
    description !== (current?.description ?? "") || tagsText !== (current?.tags.join(", ") ?? "") || Boolean(current && folder !== current.folder);
  const configDirty = mode === "settings" && Boolean(settings.data) &&
    (directory !== settings.data?.directory || gitEnabled !== settings.data?.gitEnabled);
  const dirty = draftDirty || configDirty;
  const locked = busy || Boolean(pending);
  const readOnly = locked || Boolean(current?.archived);
  const run = (action: () => Promise<void>) => {
    if (operationLock.current) return;
    operationLock.current = true;
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
    setDetails(!prompt);
    setView("edit");
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
      cache.invalidateQueries({ queryKey: ["prompt-sync"] }),
    ]);
  };
  const success = (message: string) => toast.show(message, { variant: "success" });
  const queryError = settings.error ?? folders.error ?? tagSources.error ?? prompts.error ?? versions.error ?? snapshot.error ?? git.error;
  const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
  const openSettings = () => guard(() => {
    setDirectory(settings.data?.directory ?? "");
    setGitEnabled(settings.data?.gitEnabled ?? false);
    setRemote(git.data?.remote ?? "");
    setBranch(git.data?.branch ?? "");
    setMode("settings");
  });
  const syncNow = () => run(async () => {
    const result = await syncRpc({});
    cache.setQueryData(["prompt-git", root], result);
    await refresh();
    success(result.message);
  });
  const openPrompt = (id: string) => guard(() => run(async () => accept(await readRpc({ id }))));
  const createFolderAt = (parent: string, assign: (path: string) => void) => run(async () => {
    const created = await createFolderRpc({ path: [parent, newFolder.trim()].filter(Boolean).join("/") });
    setNewFolder("");
    assign(created.path);
    await refresh();
    success(`Folder "${created.path}" created.`);
  });
  const save = () => run(async () => {
    const saved = await saveRpc({ id: current?.id, name: current ? current.id.split("/").at(-1)! : name, content, revision: current?.revision ?? null, description, tags, folder });
    accept(saved);
    setDetails(false);
    await refresh();
    success(`Saved ${saved.id}.md as a new version.`);
  });
  const restore = (filename: string) => guard(() => run(async () => {
    const restored = await restoreRpc({ id: current!.id, filename, revision: current!.revision });
    accept(restored);
    setDetails(false);
    await refresh();
    success(current?.archived ? "Prompt restored from the archive." : "Version restored as a new revision.");
  }));
  const restoreArchived = () => run(async () => {
    const list = await versionsRpc({ id: current!.id });
    const latest = list[0];
    if (!latest) throw new Error("This prompt has no saved versions to restore.");
    const restored = await restoreRpc({ id: current!.id, filename: latest.filename, revision: current!.revision });
    accept(restored);
    setDetails(false);
    await refresh();
    success("Prompt restored from the archive.");
  });
  const sendToAgent = () => run(async () => {
    const saved = await readRpc({ id: current!.id });
    if (saved.archived) throw new Error("This prompt is archived. Restore it before sending.");
    await paseo.agents.ref(agentId!).send(saved.content);
    success("Prompt sent to this agent.");
  });
  const saveDisabled = locked || !draftDirty || !name.trim() || !content.trim() || Boolean(current?.archived);
  const fullEditor = mode === "editor" && expanded;
  const showSidebar = !fullEditor && (!layout.compact || mode === "list");
  const showMain = !layout.compact || mode === "editor";
  const status = draftDirty ? { label: "Unsaved changes", color: colors.statusWarning } : current?.archived ? { label: "Archived", color: colors.foregroundMuted } : current ? { label: "Saved", color: colors.statusSuccess } : { label: "Draft", color: colors.foregroundMuted };
  const text = { color: colors.foreground };
  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  const input = inputStyle(colors);
  const padding = fullEditor ? 10 : layout.compact ? 12 : 20;

  const detailsSummary = [folder ? folder : "Library root", tags.length ? `${tags.length} tag${tags.length === 1 ? "" : "s"}` : "no tags", description.trim() ? "described" : "no description"].join(" · ");

  const detailsPanel = (
    <Card colors={colors} style={{ padding: 0, gap: 0 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={details ? "Hide details" : "Show details"} accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 12 }}>
        <Icon name={details ? "ChevronDown" : "ChevronRight"} size={15} color={colors.foregroundMuted} />
        <Text style={{ ...text, fontSize: 13, fontWeight: "600" }}>Details</Text>
        <Text numberOfLines={1} style={{ ...muted, flex: 1, minWidth: 0 }}>{detailsSummary}</Text>
      </Pressable>
      {details && (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1, maxHeight: layout.compact ? 240 : 320, minWidth: 0, borderTopWidth: 1, borderColor: colors.border }} contentContainerStyle={{ gap: 12, padding: 12 }}>
          {!current && (
            <Field label="Filename" hint="Lowercase letters, numbers, and dashes. The first Markdown heading becomes the title." colors={colors}>
              <TextInput accessibilityLabel="Prompt filename" value={name} onChangeText={setName} editable={!locked} autoCapitalize="none" autoCorrect={false} placeholder="code-review" placeholderTextColor={colors.foregroundMuted} style={{ ...input, backgroundColor: colors.surface0, fontFamily: "monospace", fontSize: 13 }} />
            </Field>
          )}
          <Field label="Description" hint="Shown in the library and searchable. Explain when to use this prompt." colors={colors}>
            <TextInput accessibilityLabel="Prompt description" value={description} onChangeText={setDescription} editable={!readOnly} maxLength={2000} multiline placeholder="When to use this prompt" placeholderTextColor={colors.foregroundMuted} style={{ ...input, backgroundColor: colors.surface0, minHeight: 60 }} />
          </Field>
          <Field label="Tags" hint="Separate tags with commas." colors={colors}>
            <TextInput accessibilityLabel="Prompt tags" value={tagsText} onChangeText={setTagsText} editable={!readOnly} autoCapitalize="none" autoCorrect={false} placeholder="review, coding, writing" placeholderTextColor={colors.foregroundMuted} style={{ ...input, backgroundColor: colors.surface0 }} />
            {tags.length > 0 && <View style={{ ...row, gap: 6 }}>{tags.map((tag) => <Chip key={tag} icon="Hash" label={tag} active colors={colors} disabled={readOnly} onClear={() => setTagsText(tags.filter((value) => value !== tag).join(", "))} />)}</View>}
          </Field>
          <Field label="Folder" colors={colors} trailing={<FolderBreadcrumb folder={folder} colors={colors} />}>
            <FolderPicker folders={folders.data ?? []} selected={folder} onSelect={(value) => setFolder(value ?? "")} colors={colors} disabled={readOnly} maxHeight={150} />
            {!current?.archived && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <TextInput accessibilityLabel="Create editor subfolder" value={newFolder} onChangeText={setNewFolder} editable={!locked} placeholder={folder ? `New subfolder in ${folder.split("/").at(-1)}` : "New folder or nested/path"} placeholderTextColor={colors.foregroundMuted} autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => newFolder.trim() && createFolderAt(folder, setFolder)} style={{ ...input, backgroundColor: colors.surface0, flex: 1, width: undefined, paddingVertical: 8, fontSize: 13 }} />
                <IconButton icon="FolderPlus" label="Create folder" onPress={() => createFolderAt(folder, setFolder)} colors={colors} disabled={locked || !newFolder.trim()} />
              </View>
            )}
          </Field>
        </ScrollView>
      )}
    </Card>
  );

  const historyPanel = current && history && (
    <VersionHistory
      theme={theme}
      versions={versions.data}
      loading={versions.isLoading}
      selected={version}
      onSelect={setVersion}
      snapshot={snapshot.data}
      snapshotLoading={snapshot.isLoading}
      onRestore={() => version && restore(version)}
      onClose={() => { setHistory(false); setVersion(null); }}
      disabled={locked}
      archived={current.archived}
    />
  );

  const editor = (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {(layout.compact || expanded) && <IconButton icon="ArrowLeft" label="Back to library" onPress={() => guard(() => { setExpanded(false); setMode("list"); })} colors={colors} disabled={busy} />}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ ...text, fontSize: 18, fontWeight: "700" }}>{current ? current.title : name.trim() || "New prompt"}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
            <StatusDot color={status.color} />
            <Text style={muted}>{status.label}</Text>
            {current && <Text numberOfLines={1} style={{ ...muted, flexShrink: 1 }}>· {current.id}.md · {relativeTime(current.updatedAt)}</Text>}
          </View>
        </View>
        <Segmented options={[{ value: "edit", label: "Edit", icon: "Pencil" }, { value: "preview", label: "Preview", icon: "Eye" }]} value={view} onChange={setView} colors={colors} />
        <IconButton icon={expanded ? "Minimize2" : "Maximize2"} label={expanded ? "Collapse editor" : "Expand editor"} onPress={() => setExpanded(!expanded)} colors={colors} active={expanded} />
      </View>
      <View style={{ ...row, gap: 6 }}>
        <Button title={draftDirty ? "Save" : "Saved"} icon={draftDirty ? "Save" : "Check"} variant="primary" onPress={save} colors={colors} disabled={saveDisabled} accessibilityLabel="Save prompt" />
        {draftDirty && <Button title="Discard" icon="RotateCcw" variant="ghost" onPress={() => guard(() => accept(current))} colors={colors} disabled={locked} accessibilityLabel="Discard draft" />}
        {current && <Button title="History" icon="History" variant="ghost" active={history} onPress={() => { setHistory(!history); setVersion(null); }} colors={colors} disabled={locked} accessibilityLabel={history ? "Hide history" : "Version history"} />}
        {agentId && current && !current.archived && <Button title="Send to agent" icon="Send" onPress={sendToAgent} colors={colors} disabled={locked || draftDirty} accessibilityLabel="Send saved prompt to agent" />}
        <View style={{ flex: 1 }} />
        {current && !current.archived && <IconButton icon="Archive" label="Archive prompt" tone="danger" onPress={() => guard(() => setArchiveConfirm(true))} colors={colors} disabled={locked} />}
      </View>
      {current?.archived && <Banner tone="warning" colors={colors} message="This prompt is archived. Restore it to edit or send it." action={<Button title="Restore" icon="ArchiveRestore" size="sm" onPress={restoreArchived} colors={colors} disabled={locked} />} />}
      {agentId && current && draftDirty && !current.archived && <Meta colors={colors} icon="Info">Save your changes before sending this prompt to the agent.</Meta>}
      {expanded && !current && <TextInput accessibilityLabel="Prompt filename" value={name} onChangeText={setName} editable={!locked} autoCapitalize="none" autoCorrect={false} placeholder="Filename, for example code-review" placeholderTextColor={colors.foregroundMuted} style={{ ...input, fontFamily: "monospace", fontSize: 13 }} />}
      {!expanded && detailsPanel}
      <View style={{ flex: 1, minHeight: expanded ? 0 : 160, minWidth: 0, flexDirection: layout.compact ? "column" : "row", gap: 10 }}>
        <View style={{ flex: 1, minHeight: 0, minWidth: 0, gap: 6 }}>
          {view === "preview" ? (
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: radius, backgroundColor: colors.surface1 }} contentContainerStyle={{ padding: 16, minWidth: 0 }}>
              <MarkdownPreview content={content} theme={theme} />
            </ScrollView>
          ) : (
            <TextInput accessibilityLabel="Prompt Markdown" value={content} onChangeText={setContent} editable={!readOnly} multiline textAlignVertical="top" autoCapitalize="none" autoCorrect={false} placeholder={"# Title\n\nWrite your prompt in Markdown…"} placeholderTextColor={colors.foregroundMuted} style={{ ...input, flex: 1, minHeight: 0, padding: 14, fontFamily: "monospace", fontSize: 13, lineHeight: 21 }} />
          )}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 2 }}>
            <Text style={{ ...muted, fontSize: 11 }}>{wordCount(content)} words · {content.length} characters</Text>
            {!content.trim() && <Text style={{ ...muted, fontSize: 11 }}>Content is required to save</Text>}
          </View>
        </View>
        {historyPanel && <View style={{ width: layout.compact ? undefined : 320, minWidth: 0, minHeight: 0, maxHeight: layout.compact ? 320 : undefined, flexShrink: layout.compact ? 0 : undefined }}>{historyPanel}</View>}
      </View>
    </View>
  );

  const welcome = (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", gap: 18, paddingVertical: 24 }}>
      <EmptyState
        icon="NotebookPen"
        title={prompts.data?.length ? "Select a prompt" : "Your library is empty"}
        body={prompts.data?.length ? "Open a prompt from the list to edit its Markdown, manage tags and folders, and browse saved versions." : "Save the instructions you keep repeating. Prompts are Markdown files on this host, versioned on every save."}
        colors={colors}
      >
        <Button title="New prompt" icon="Plus" variant="primary" onPress={() => guard(() => accept(null))} colors={colors} disabled={locked} />
        <Button title="Import Markdown" icon="Upload" onPress={() => guard(() => setMode("import"))} colors={colors} disabled={locked || !settings.data} />
      </EmptyState>
      <Card colors={colors} style={{ width: "100%", maxWidth: 520, gap: 12 }}>
        <Tip icon="Paperclip" colors={colors}>Attach a prompt to any message from the composer's attachment menu under Saved prompt.</Tip>
        <Tip icon="SquareSlash" colors={colors}>Type /prompt code-review in an agent composer to send that prompt and start a turn.</Tip>
        <Tip icon="GitBranch" colors={colors}>Turn on Git sync in Settings to back up prompts and their history to a repository.</Tip>
      </Card>
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0, backgroundColor: colors.surface0, padding, gap: 12 }}>
      {!fullEditor && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1, minWidth: 0 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border }}>
              <Icon name="NotebookPen" size={18} color={colors.accent} />
            </View>
            <View style={{ minWidth: 0, flexShrink: 1 }}>
              <Text style={{ ...text, fontSize: layout.compact ? 18 : 22, fontWeight: "700" }}>Prompts</Text>
              <Text numberOfLines={1} style={muted}>{agentId ? "Save instructions and send them to this agent." : "Markdown prompts shared across agents on this host."}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Button title="New prompt" icon="Plus" variant="primary" onPress={() => guard(() => accept(null))} colors={colors} disabled={locked} />
            {layout.compact
              ? <IconButton icon="Upload" label="Import" onPress={() => guard(() => setMode("import"))} colors={colors} active={mode === "import"} disabled={locked || !settings.data} />
              : <Button title="Import" icon="Upload" variant="ghost" active={mode === "import"} onPress={() => guard(() => setMode("import"))} colors={colors} disabled={locked || !settings.data} />}
            <IconButton icon="Settings" label="Settings" onPress={openSettings} colors={colors} active={mode === "settings"} disabled={locked || !settings.data} />
          </View>
        </View>
      )}
      {queryError && <Banner tone="danger" colors={colors} message={describe(queryError)} />}
      {mutation.error && <Banner tone="danger" colors={colors} message={describe(mutation.error)} onDismiss={() => mutation.reset()} />}
      {busy && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="LoaderCircle" size={13} color={colors.foregroundMuted} />
          <Text style={muted}>Working…</Text>
        </View>
      )}
      {mode === "import" ? (
        <ImportPrompts theme={theme} busy={locked} run={run} onImported={refresh} onBack={() => setMode(current ? "editor" : "list")} folders={folders.data ?? []} initialFolder={filterFolder ?? ""} />
      ) : mode === "settings" ? (
        <LibrarySettingsScreen
          colors={colors}
          busy={locked}
          settings={settings.data}
          git={{ data: git.data, isLoading: git.isLoading }}
          directory={directory}
          setDirectory={setDirectory}
          gitEnabled={gitEnabled}
          setGitEnabled={setGitEnabled}
          remote={remote}
          setRemote={setRemote}
          branch={branch}
          setBranch={setBranch}
          syncState={syncState.data}
          configDirty={configDirty}
          onBack={() => guard(() => setMode(current || draftDirty ? "editor" : "list"))}
          onSave={() => run(async () => {
            const result = await configureRpc({ directory, gitEnabled });
            cache.setQueryData(["prompt-settings"], result);
            setDirectory(result.directory);
            setGitEnabled(result.gitEnabled);
            setCurrent(null); setName(""); setContent(""); setDescription(""); setTagsText(""); setFolder(""); setFilterFolder(undefined); setFilterTag(undefined); setHistory(false); setVersion(null);
            await refresh();
            success("Settings saved.");
          })}
          onInit={() => run(async () => {
            // An untouched branch field lets the server pick the remote's default branch.
            const result = await initRpc({ remote, branch: branch.trim() === (git.data?.branch ?? "") ? "" : branch });
            cache.setQueryData(["prompt-git", root], result);
            await cache.invalidateQueries({ queryKey: ["prompt-sync"] });
            success(result.message);
          })}
          onSync={syncNow}
          onSyncMode={(syncMode: SyncMode, syncInterval: number) => run(async () => {
            const result = await configureRpc({ ...settings.data!, syncMode, syncInterval });
            cache.setQueryData(["prompt-settings"], result);
            await cache.invalidateQueries({ queryKey: ["prompt-sync"] });
            success(describeMode(result.syncMode, result.syncInterval));
          })}
        />
      ) : (
        <View style={{ flex: 1, minHeight: 0, minWidth: 0, flexDirection: layout.compact ? "column" : "row", gap: 18 }}>
          {showSidebar && (
            <LibrarySidebar
              colors={colors}
              compact={layout.compact}
              disabled={locked}
              query={query}
              setQuery={setQuery}
              archived={archived}
              setArchived={setArchived}
              filterFolder={filterFolder}
              setFilterFolder={setFilterFolder}
              filterTag={filterTag}
              setFilterTag={setFilterTag}
              organize={organize}
              setOrganize={setOrganize}
              folders={folders.data ?? []}
              tags={availableTags}
              prompts={prompts.data}
              loading={prompts.isLoading}
              currentId={current?.id}
              onOpen={openPrompt}
              onRefresh={() => guard(() => run(async () => {
                if (current) accept(await readRpc({ id: current.id }));
                await refresh();
              }))}
              newFolder={newFolder}
              setNewFolder={setNewFolder}
              onCreateFolder={() => newFolder.trim() && createFolderAt(filterFolder ?? "", setFilterFolder)}
              root={root}
              footer={gitEnabledSaved && syncState.data?.initialized ? <SyncBadge colors={colors} state={syncState.data} disabled={locked} onSync={syncNow} /> : undefined}
            />
          )}
          {showMain && <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{mode === "list" ? welcome : editor}</View>}
        </View>
      )}
      <ConfirmModal
        open={Boolean(pending)}
        title="Discard unsaved changes?"
        message="You have unsaved changes. Discarding them restores the last saved state."
        confirmLabel="Discard changes"
        icon="TriangleAlert"
        destructive
        colors={colors}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const action = pending;
          setPending(null);
          setName(current?.title ?? "");
          setContent(current?.content ?? "");
          setDescription(current?.description ?? "");
          setTagsText(current?.tags.join(", ") ?? "");
          setFolder(current?.folder ?? filterFolder ?? "");
          setDirectory(settings.data?.directory ?? "");
          setGitEnabled(settings.data?.gitEnabled ?? false);
          action?.();
        }}
      />
      <ConfirmModal
        open={archiveConfirm && Boolean(current)}
        title="Archive this prompt?"
        message={`"${current?.title ?? ""}" will be removed from the library. Its version history stays available, and you can restore it from Archived.`}
        confirmLabel="Archive"
        icon="Archive"
        destructive
        colors={colors}
        onCancel={() => setArchiveConfirm(false)}
        onConfirm={() => run(async () => {
          await archiveRpc({ id: current!.id, revision: current!.revision });
          setArchiveConfirm(false);
          accept(null); setMode("list"); await refresh();
          success("Prompt archived.");
        })}
      />
    </View>
  );
}
