import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { parseInlineMarkdown, parseMarkdown, type MarkdownInline } from "../shared/markdown";

type Props = { content: string; theme: PluginSurfaceProps["theme"] };

function Inline({ tokens, theme }: { tokens: MarkdownInline[]; theme: Props["theme"] }) {
  const colors = theme.colors;
  return tokens.map((token, index) => {
    if (token.kind === "text") return <Text key={index} style={{ color: colors.foreground }}>{token.text}</Text>;
    if (token.kind === "code") return <Text key={index} style={{ color: colors.foreground, backgroundColor: colors.surface2, fontFamily: "monospace" }}>{token.text}</Text>;
    return (
      <Text key={index} style={{ color: colors.foreground, fontWeight: token.kind === "bold" ? "700" : undefined, fontStyle: token.kind === "italic" ? "italic" : undefined, textDecorationLine: token.kind === "link" ? "underline" : undefined }}>
        <Inline tokens={token.children} theme={theme} />
      </Text>
    );
  });
}

export function MarkdownPreview({ content, theme }: Props) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  const colors = theme.colors;
  return (
    <View style={{ minWidth: 0, width: "100%", gap: 12 }}>
      {!blocks.length && <Text style={{ color: colors.foregroundMuted }}>Nothing to preview.</Text>}
      {blocks.map((block, index) => {
        if (block.kind === "rule") return <View key={index} style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />;
        if (block.kind === "code") return (
          <View key={index} style={{ minWidth: 0, padding: 12, borderRadius: 6, backgroundColor: colors.surface2 }}>
            <Text selectable style={{ color: colors.foreground, fontSize: 13, lineHeight: 20, fontFamily: "monospace", flexShrink: 1 }}>{block.text || " "}</Text>
          </View>
        );
        const inline = <Inline tokens={parseInlineMarkdown(block.text)} theme={theme} />;
        if (block.kind === "list") return (
          <View key={index} style={{ flexDirection: "row", gap: 8, minWidth: 0, paddingLeft: block.depth * 12 }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 14, lineHeight: 22 }}>{block.marker}</Text>
            <Text selectable style={{ color: colors.foreground, fontSize: 14, lineHeight: 22, flex: 1, minWidth: 0 }}>{inline}</Text>
          </View>
        );
        if (block.kind === "quote") return (
          <View key={index} style={{ minWidth: 0, borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 12 }}>
            <Text selectable style={{ color: colors.foreground, fontSize: 14, lineHeight: 22 }}>{inline}</Text>
          </View>
        );
        const fontSize = block.kind === "heading" ? [26, 22, 19, 17, 15, 14][block.level - 1] : 14;
        return <Text key={index} selectable style={{ color: colors.foreground, fontSize, lineHeight: fontSize + 9, fontWeight: block.kind === "heading" ? "700" : "400", minWidth: 0 }}>{inline}</Text>;
      })}
    </View>
  );
}
