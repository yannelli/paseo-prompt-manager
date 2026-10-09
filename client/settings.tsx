import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { Switch, Text, View } from "react-native";
import type { LibrarySettings, SyncMode, SyncState } from "../shared/prompts";
import { useRevealFocusedInput } from "./keyboard";
import { SyncModePicker } from "./sync";
import { Banner, Button, Card, Field, IconButton, Meta, SectionTitle, inputStyle, radius, relativeTime, type Colors } from "./ui";

type GitStatus = { initialized: boolean; branch: string; remote: string; changes: number; message: string };

type Props = {
  colors: Colors;
  busy: boolean;
  settings: LibrarySettings | undefined;
  git: { data: GitStatus | undefined; isLoading: boolean };
  directory: string;
  setDirectory: (value: string) => void;
  gitEnabled: boolean;
  setGitEnabled: (value: boolean) => void;
  remote: string;
  setRemote: (value: string) => void;
  branch: string;
  setBranch: (value: string) => void;
  syncState: SyncState | undefined;
  configDirty: boolean;
  onSave: () => void;
  onInit: () => void;
  onSync: () => void;
  onSyncMode: (mode: SyncMode, interval: number) => void;
  onBack: () => void;
};

export function LibrarySettingsScreen({ colors, busy, settings, git, directory, setDirectory, gitEnabled, setGitEnabled, remote, setRemote, branch, setBranch, syncState, configDirty, onSave, onInit, onSync, onSyncMode, onBack }: Props) {
  const status = git.data;
  const connectionChanged = Boolean(status && (remote.trim() !== status.remote || (branch.trim() !== "" && branch.trim() !== status.branch)));
  const blocked = busy || configDirty;
  const reveal = useRevealFocusedInput();
  return (
    <ScrollView {...reveal} keyboardShouldPersistTaps="handled" style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ gap: 14, paddingBottom: 28, width: "100%", maxWidth: 680 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <IconButton icon="ArrowLeft" label="Back to prompts" onPress={onBack} colors={colors} disabled={busy} />
        <SectionTitle title="Library settings" subtitle="Where prompts live on this host, and how they sync." colors={colors} />
      </View>
      <Card colors={colors}>
        <Field label="Library directory" hint="Changing the directory opens a different library. Existing files stay where they are." colors={colors}>
          <TextInput accessibilityLabel="Prompt library directory" value={directory} onChangeText={setDirectory} editable={!busy} autoCapitalize="none" autoCorrect={false} placeholder="~/.config/paseo/prompt-lib" placeholderTextColor={colors.foregroundMuted} style={{ ...inputStyle(colors), backgroundColor: colors.surface0, fontFamily: "monospace", fontSize: 13 }} />
        </Field>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>Git sync</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>Commit prompts and version history to a Git repository in the library directory.</Text>
          </View>
          <Switch accessibilityLabel="Git sync" value={gitEnabled} onValueChange={setGitEnabled} disabled={busy} trackColor={{ true: colors.accent, false: colors.surface2 }} thumbColor={colors.accentForeground} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
          {configDirty && <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Unsaved changes</Text>}
          <Button title="Save settings" icon="Save" variant="primary" onPress={onSave} colors={colors} disabled={busy || !directory.trim() || !configDirty} />
        </View>
      </Card>
      {settings?.gitEnabled && (
        <Card colors={colors}>
          <SectionTitle title="Repository" subtitle="Sync commits library changes, pulls, and pushes with this host's Git credentials." colors={colors} icon="GitBranch" />
          {git.isLoading && <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Reading repository…</Text>}
          {status && (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, padding: 12, borderRadius: radius - 2, backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.border }}>
                <Stat colors={colors} icon={status.initialized ? "CircleCheck" : "Circle"} label="Status" value={status.initialized ? "Initialized" : "Not initialized"} tone={status.initialized ? colors.statusSuccess : colors.foregroundMuted} />
                {status.initialized && <Stat colors={colors} icon="GitBranch" label="Branch" value={status.branch || "No branch"} />}
                {status.initialized && <Stat colors={colors} icon="FileDiff" label="Pending" value={`${status.changes} changed file${status.changes === 1 ? "" : "s"}`} tone={status.changes > 0 ? colors.statusWarning : undefined} />}
                {status.initialized && <Stat colors={colors} icon="Globe" label="Remote" value={status.remote || "No remote"} />}
              </View>
              {status.message !== "" && <Meta colors={colors} icon="Info">{status.message}</Meta>}
              {syncState?.lastError && !syncState.running && <Banner tone="danger" colors={colors} message={`Last sync failed: ${syncState.lastError}`} />}
              <Field label="Remote repository" hint="Paste an HTTPS or SSH URL, for example from GitHub. The repository can be empty or already hold prompts from another machine. Leave it blank for local checkpoints only." colors={colors}>
                <TextInput accessibilityLabel="Git remote URL" value={remote} onChangeText={setRemote} editable={!blocked} autoCapitalize="none" autoCorrect={false} placeholder="git@github.com:you/prompts.git" placeholderTextColor={colors.foregroundMuted} style={{ ...inputStyle(colors), backgroundColor: colors.surface0, fontFamily: "monospace", fontSize: 13 }} />
              </Field>
              <Field label="Branch" hint="Leave blank to use the remote's default branch." colors={colors}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <TextInput accessibilityLabel="Git branch" value={branch} onChangeText={setBranch} editable={!blocked} autoCapitalize="none" autoCorrect={false} placeholder="Remote default" placeholderTextColor={colors.foregroundMuted} style={{ ...inputStyle(colors), backgroundColor: colors.surface0, flex: 1, width: undefined, fontFamily: "monospace", fontSize: 13 }} />
                  <Button title={!status.initialized ? "Set up" : !status.remote ? "Connect" : remote.trim() ? "Update" : "Disconnect"} icon={status.initialized ? "Link" : "GitBranchPlus"} variant={status.initialized ? "secondary" : "primary"} onPress={onInit} colors={colors} disabled={blocked || (status.initialized && !connectionChanged)} />
                </View>
              </Field>
              {status.initialized && (
                <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
                  {syncState?.lastSyncedAt && <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Last synced {relativeTime(syncState.lastSyncedAt)}</Text>}
                  <Button title={syncState?.running ? "Syncing…" : "Sync now"} icon="RefreshCw" variant="primary" onPress={onSync} colors={colors} disabled={blocked || connectionChanged || Boolean(syncState?.running)} />
                </View>
              )}
              {configDirty && <Meta colors={colors} icon="TriangleAlert">Save settings before running Git actions.</Meta>}
            </>
          )}
        </Card>
      )}
      {settings?.gitEnabled && status?.initialized && (
        <Card colors={colors}>
          <SectionTitle title="When to sync" subtitle="Each sync commits prompt changes, merges changes from the remote, and pushes." colors={colors} icon="Clock" />
          <SyncModePicker colors={colors} mode={settings.syncMode} interval={settings.syncInterval} disabled={blocked} onChange={onSyncMode} />
          {settings.syncMode === "interval" && syncState?.nextSyncAt && <Meta colors={colors} icon="Clock">Next sync {new Date(syncState.nextSyncAt).toLocaleTimeString()}</Meta>}
        </Card>
      )}
    </ScrollView>
  );
}

function Stat({ colors, icon, label, value, tone }: { colors: Colors; icon: string; label: string; value: string; tone?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 140, flexShrink: 1 }}>
      <Icon name={icon} size={15} color={tone ?? colors.foregroundMuted} />
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{label}</Text>
        <Text numberOfLines={1} style={{ color: tone ?? colors.foreground, fontSize: 13, fontWeight: "600" }}>{value}</Text>
      </View>
    </View>
  );
}
