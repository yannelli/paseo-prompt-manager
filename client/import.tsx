import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { importPrompts, type ImportResult } from "../shared/prompts";
import { FolderPicker, FolderBreadcrumb } from "./editor";
import { useRevealFocusedInput } from "./keyboard";
import { Button, Card, Field, IconButton, Meta, SectionTitle, inputStyle, radius } from "./ui";
import { canPickFiles, pickMarkdown } from "./web";

type Props = {
  theme: PluginSurfaceProps["theme"];
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onImported: () => Promise<void>;
  onBack: () => void;
  folders: string[];
  initialFolder: string;
};

export function ImportPrompts({ theme, busy, run, onImported, onBack, folders, initialFolder }: Props) {
  const colors = theme.colors;
  const importRpc = useRpc(importPrompts);
  const [folder, setFolder] = useState(initialFolder);
  const [paths, setPaths] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const reveal = useRevealFocusedInput();
  const sources = paths.split("\n").map((path) => path.trim()).filter(Boolean);
  const pick = (directory: boolean) => run(async () => {
    const files = await pickMarkdown(directory);
    if (!files.length) return;
    setResult(null);
    const summary: ImportResult = { imported: [], skipped: [] };
    for (const file of files) {
      try {
        const batch = await importRpc({ paths: [], files: [file], folder });
        summary.imported.push(...batch.imported);
        summary.skipped.push(...batch.skipped);
      } catch (error) {
        summary.skipped.push({ source: file.name, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    setResult(summary);
    await onImported();
  });

  return (
    <ScrollView {...reveal} keyboardShouldPersistTaps="handled" style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ gap: 14, paddingBottom: 28, width: "100%", maxWidth: 680 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <IconButton icon="ArrowLeft" label="Back to library" onPress={onBack} colors={colors} disabled={busy} />
        <SectionTitle title="Import prompts" subtitle="Copy Markdown files into the library with a first saved version. Source files stay in place." colors={colors} />
      </View>
      <Card colors={colors}>
        <Field label="Destination folder" colors={colors} trailing={<FolderBreadcrumb folder={folder} colors={colors} />}>
          <FolderPicker folders={folders} selected={folder} onSelect={(value) => setFolder(value ?? "")} colors={colors} disabled={busy} maxHeight={160} />
        </Field>
        <Meta colors={colors} icon="Info">Folder imports keep their subfolder structure under the destination.</Meta>
      </Card>
      {canPickFiles() && (
        <Card colors={colors}>
          <SectionTitle title="From this device" subtitle="Pick Markdown files or a whole folder with the browser file picker." colors={colors} icon="MonitorUp" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button title="Choose Markdown files" icon="FileText" onPress={() => pick(false)} colors={colors} disabled={busy} />
            <Button title="Choose folder" icon="FolderInput" onPress={() => pick(true)} colors={colors} disabled={busy} />
          </View>
        </Card>
      )}
      <Card colors={colors}>
        <SectionTitle title="From the Paseo host" subtitle="Absolute or ~/ paths to files or folders on the daemon host, one per line." colors={colors} icon="Server" />
        <TextInput accessibilityLabel="Markdown file or folder paths" value={paths} onChangeText={setPaths} editable={!busy} multiline autoCapitalize="none" autoCorrect={false} textAlignVertical="top" placeholder={"~/prompts\n/home/user/code-review.md"} placeholderTextColor={colors.foregroundMuted} style={{ ...inputStyle(colors), backgroundColor: colors.surface0, minHeight: 110, fontFamily: "monospace", fontSize: 13, lineHeight: 20 }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, flex: 1, minWidth: 200, lineHeight: 17 }}>Up to 100 Markdown files and 8 MB per import. Hidden entries, symlinks, and version folders are skipped.</Text>
          <Button title={sources.length > 1 ? `Import ${sources.length} paths` : "Import paths"} icon="Upload" variant="primary" onPress={() => run(async () => {
            setResult(null);
            setResult(await importRpc({ paths: sources, files: [], folder }));
            await onImported();
          })} colors={colors} disabled={busy || !sources.length || sources.length > 100} />
        </View>
      </Card>
      {result && (
        <Card colors={colors}>
          <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Icon name={result.imported.length > 0 ? "CircleCheck" : "CircleAlert"} size={18} color={result.imported.length > 0 ? colors.statusSuccess : colors.statusWarning} />
            <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{result.imported.length} imported · {result.skipped.length} skipped</Text>
          </View>
          {result.imported.length > 0 && (
            <View style={{ gap: 4 }}>
              {result.imported.map((id) => (
                <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="FileText" size={13} color={colors.statusSuccess} />
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: "monospace" }}>{id}.md</Text>
                </View>
              ))}
            </View>
          )}
          {result.skipped.length > 0 && (
            <View style={{ gap: 6, padding: 10, borderRadius: radius - 2, backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.border }}>
              {result.skipped.map((item, index) => (
                <View key={`${item.source}-${index}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <Icon name="CircleAlert" size={13} color={colors.statusWarning} />
                  <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, flex: 1, minWidth: 0 }}><Text style={{ color: colors.foreground }}>{item.source}</Text> · {item.reason}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      )}
    </ScrollView>
  );
}
