import type { PluginButtonContentProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { previewLines } from "../shared/markdown";
import { searchPrompts } from "../shared/prompts";
import { inputStyle, radius, useDebounced } from "./ui";

const RESULT_LIMIT = 20;

type Agent = Awaited<ReturnType<PluginClientContext["paseo"]["agents"]["list"]>>["entries"][number]["agent"];

function PromptPicker({ theme, layout, close, ...target }: PluginButtonContentProps) {
  const colors = theme.colors;
  const paseo = usePaseo();
  const toast = useToast();
  const searchRpc = useRpc(searchPrompts);
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim(), 200);
  const results = useQuery({ queryKey: ["prompt-pill", search], queryFn: () => searchRpc({ query: search }), placeholderData: keepPreviousData });
  const send = useMutation({
    mutationFn: async (item: { title: string; text: string }) => {
      if (target.context !== "agent") throw new Error("Open this from an agent composer.");
      await paseo.agents.ref(target.agentId).send(item.text);
      return item.title;
    },
    onSuccess: (title) => {
      toast.show(`Sent "${title}".`, { variant: "success" });
      close();
    },
  });
  const items = results.data?.items.slice(0, RESULT_LIMIT) ?? [];
  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  const rows = items.map((item) => (
    <Pressable
      key={item.id}
      accessibilityRole="button"
      accessibilityLabel={`Send ${item.title}`}
      disabled={send.isPending}
      onPress={() => send.mutate(item)}
      style={({ pressed }) => ({ gap: 2, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius - 4, backgroundColor: pressed ? colors.surface2 : "transparent", opacity: send.isPending ? 0.5 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1, minWidth: 0 }}>{item.title}</Text>
        <Icon name="Send" size={12} color={colors.foregroundMuted} />
      </View>
      <Text numberOfLines={4} style={{ ...muted, lineHeight: 16 }}>{previewLines(item.text).join("\n") || item.subtitle}</Text>
    </Pressable>
  ));
  return (
    <View testID="prompt-picker" style={{ width: layout.compact ? "100%" : 280, flexShrink: 1, minHeight: 0, gap: 8 }}>
      <TextInput accessibilityLabel="Search saved prompts" value={query} onChangeText={setQuery} autoFocus={!layout.compact} autoCapitalize="none" autoCorrect={false} placeholder="Search prompts" placeholderTextColor={colors.foregroundMuted} style={{ ...inputStyle(colors), paddingVertical: 7, fontSize: 13 }} />
      {results.isLoading && <Text style={muted}>Loading…</Text>}
      {results.error && <Text style={{ ...muted, color: colors.statusDanger }}>{results.error.message}</Text>}
      {send.error && <Text style={{ ...muted, color: colors.statusDanger }}>{send.error.message}</Text>}
      {results.data && items.length === 0 && <Text style={muted}>{query.trim() ? "No matching prompts." : "No saved prompts yet."}</Text>}
      {/* Compact layouts open in the host's scrolling bottom sheet, which sizes itself to its
          content. A nested ScrollView there reports its own content height and shrinks the sheet. */}
      {layout.compact
        ? <View style={{ gap: 8 }}>{rows}</View>
        : <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1, maxHeight: 360, minHeight: 0 }} contentContainerStyle={{ gap: 8 }}>{rows}</ScrollView>}
      {(results.data?.items.length ?? 0) > RESULT_LIMIT && <Text style={muted}>Showing {RESULT_LIMIT} of {results.data!.items.length}. Refine the search.</Text>}
    </View>
  );
}

export function contributePromptPills(client: PluginClientContext) {
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  const register = (agent: Agent) => {
    if (lifetime.signal.aborted || !agent.workspaceId || pills.has(agent.id)) return;
    pills.set(agent.id, client.addComposerPill({
      id: "prompts",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: { title: "Send a saved prompt", icon: "NotebookPen", label: "Prompts", behavior: { kind: "popover", Content: PromptPicker } },
    }));
  };
  const remove = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  const removeAll = () => {
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAll();
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") remove(update.agentId);
          else register(update.agent);
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("Prompt pill agent observation failed", error);
    });
  return () => {
    lifetime.abort();
    removeAll();
  };
}
