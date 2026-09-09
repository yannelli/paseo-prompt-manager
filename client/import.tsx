import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { importPrompts, type ImportResult } from "../shared/prompts";
import { canPickFiles, pickMarkdown } from "./web";

type Props = {
  theme: PluginSurfaceProps["theme"];
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onImported: () => Promise<void>;
  onBack: () => void;
};

export function ImportPrompts({ theme, busy, run, onImported, onBack }: Props) {
  const colors = theme.colors;
  const importRpc = useRpc(importPrompts);
  const [paths, setPaths] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const text = { color: colors.foreground };
  const muted = { color: colors.foregroundMuted, fontSize: 13 };
  const sources = paths.split("\n").map((path) => path.trim()).filter(Boolean);
  const button = (title: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled} onPress={onPress} style={{ padding: 12, borderRadius: 8, backgroundColor: colors.surface2, opacity: busy || disabled ? 0.45 : 1 }}>
      <Text style={{ ...text, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
  const pick = (folder: boolean) => run(async () => {
    const files = await pickMarkdown(folder);
    if (!files.length) return;
    setResult(null);
    const summary: ImportResult = { imported: [], skipped: [] };
    for (const file of files) {
      try {
        const batch = await importRpc({ paths: [], files: [file] });
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
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16, paddingBottom: 28, maxWidth: 720 }}>
      <View style={{ alignItems: "flex-start" }}>{button("Back to library", onBack)}</View>
      <Text style={{ ...text, fontSize: 20, fontWeight: "600" }}>Import prompts</Text>
      <Text style={muted}>Copy Markdown files into this library with a first saved version. Folders include their subfolders. Existing names are skipped; source files stay in place.</Text>
      {canPickFiles() && <View style={{ gap: 10 }}>
        <Text style={text}>From this device</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {button("Choose Markdown files", () => pick(false))}
          {button("Choose folder", () => pick(true))}
        </View>
      </View>}
      <View style={{ gap: 10 }}>
        <Text style={text}>Files or folders on the Paseo host</Text>
        <TextInput accessibilityLabel="Markdown file or folder paths" value={paths} onChangeText={setPaths} editable={!busy} multiline autoCapitalize="none" autoCorrect={false} textAlignVertical="top" placeholder={"~/prompts\n/home/user/code-review.md"} placeholderTextColor={colors.foregroundMuted} style={{ ...text, minHeight: 120, padding: 12, backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, borderRadius: 8 }} />
        <Text style={muted}>One absolute path per line. Up to 100 Markdown files and 8 MB per import. Hidden entries, symbolic links, and version-history folders are skipped.</Text>
        <View style={{ alignItems: "flex-start" }}>{button("Import paths", () => run(async () => {
          setResult(null);
          setResult(await importRpc({ paths: sources, files: [] }));
          await onImported();
        }), !sources.length || sources.length > 100)}</View>
      </View>
      {result && <View style={{ gap: 8 }}>
        <Text accessibilityRole="alert" style={{ ...text, fontWeight: "600" }}>{result.imported.length} imported · {result.skipped.length} skipped</Text>
        {result.imported.map((id) => <Text key={id} style={text}>{id}.md</Text>)}
        {result.skipped.map((item, index) => <Text key={`${item.source}-${index}`} style={muted}>{item.source}: {item.reason}</Text>)}
      </View>}
    </ScrollView>
  );
}
