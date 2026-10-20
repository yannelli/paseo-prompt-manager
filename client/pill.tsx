import type { PluginButton, PluginButtonContentProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { previewLines } from "../shared/markdown";
import { searchPrompts } from "../shared/prompts";
import { fillTemplate, parseVariables } from "../shared/templates";
import { inputStyle, radius, useDebounced } from "./ui";
import { VariableForm } from "./variables";

const RESULT_LIMIT = 20;

type Agent = Awaited<ReturnType<PluginClientContext["paseo"]["agents"]["list"]>>["entries"][number]["agent"];

function PromptPicker({ theme, layout, close, ...target }: PluginButtonContentProps) {
  const colors = theme.colors;
  const paseo = usePaseo();
  const toast = useToast();
  const searchRpc = useRpc(searchPrompts);
  const [query, setQuery] = useState("");
  const [filling, setFilling] = useState<{ id: string; title: string; text: string } | null>(null);
  const search = useDebounced(query.trim(), 200);
  const results = useQuery({ queryKey: ["prompt-pill", search], queryFn: () => searchRpc({ query: search }), placeholderData: keepPreviousData });
  // The workspace header also shows on New Agent tabs, where no agent exists yet to send to.
  const copy = target.context === "workspace";
  const send = useMutation({
    mutationFn: async (item: { title: string; text: string }) => {
      if (target.context === "agent") await paseo.agents.ref(target.agentId).send(item.text);
      else await copyText(item.text);
      return item.title;
    },
    onSuccess: (title) => {
      toast.show(copy ? `Copied "${title}". Paste it into the composer.` : `Sent "${title}".`, { variant: "success" });
      close();
    },
  });
  const items = results.data?.items.slice(0, RESULT_LIMIT) ?? [];
  // Prompts without variables still go through fillTemplate, which turns `\{{ name }}` into literal braces.
  const choose = (item: { id: string; title: string; text: string }) => {
    if (!parseVariables(item.text).length) return send.mutate({ title: item.title, text: fillTemplate(item.text, {}) });
    send.reset();
    setFilling(item);
  };
  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  const rows = items.map((item) => (
    <Pressable
      key={item.id}
      accessibilityRole="button"
      accessibilityLabel={`${copy ? "Copy" : "Send"} ${item.title}`}
      disabled={send.isPending}
      onPress={() => choose(item)}
      style={({ pressed }) => ({ gap: 2, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius - 4, backgroundColor: pressed ? colors.surface2 : "transparent", opacity: send.isPending ? 0.5 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1, minWidth: 0 }}>{item.title}</Text>
        <Icon name={copy ? "Copy" : "Send"} size={12} color={colors.foregroundMuted} />
      </View>
      <Text numberOfLines={4} style={{ ...muted, lineHeight: 16 }}>{previewLines(item.text).join("\n") || item.subtitle}</Text>
    </Pressable>
  ));
  if (filling) return (
    <View testID="prompt-picker" style={{ width: layout.compact ? "100%" : 280, flexShrink: 1, minHeight: 0, gap: 8 }}>
      {send.error && <Text style={{ ...muted, color: colors.statusDanger }}>{send.error.message}</Text>}
      <VariableForm
        key={filling.id}
        title={filling.title}
        content={filling.text}
        colors={colors}
        action={copy ? "Copy" : "Send"}
        busy={send.isPending}
        autoFocus={!layout.compact}
        cancelLabel="Back"
        onCancel={() => { send.reset(); setFilling(null); }}
        onSubmit={(text) => send.mutate({ title: filling.title, text })}
      />
    </View>
  );
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

function pickerButton(title: string): PluginButton {
  return { title, icon: "NotebookPen", label: "Prompts", behavior: { kind: "popover", Content: PromptPicker } };
}

/** One button registration per agent or workspace ID. With a class here, the mobile E2E apps did not load the plugin. */
function buttons(signal: AbortSignal) {
  const entries = new Map<string, PluginButtonRegistration>();
  return {
    add(key: string, create: () => PluginButtonRegistration) {
      if (signal.aborted || entries.has(key)) return;
      entries.set(key, create());
    },
    remove(key: string) {
      entries.get(key)?.remove();
      entries.delete(key);
    },
    clear() {
      for (const button of entries.values()) button.remove();
      entries.clear();
    },
  };
}

/** A Prompts pill in each agent composer, and a Prompts header button in each workspace. */
export function contributePromptButtons(client: PluginClientContext) {
  const lifetime = new AbortController();
  const pills = buttons(lifetime.signal);
  const headers = buttons(lifetime.signal);
  const addPill = (agent: Agent) => {
    const workspaceId = agent.workspaceId;
    if (!workspaceId) return;
    pills.add(agent.id, () => client.addComposerPill({ id: "prompts", workspaceId, agentId: agent.id, button: pickerButton("Send a saved prompt") }));
  };
  const addHeader = (workspaceId: string) =>
    headers.add(workspaceId, () => client.addHeaderButton({ id: "prompts", workspaceId, button: pickerButton("Copy a saved prompt") }));
  const failed = (what: string) => (error: unknown) => {
    if (!lifetime.signal.aborted) console.error(`Prompt button ${what} observation failed`, error);
  };
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          pills.clear();
          for (const { agent } of entries) addPill(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") pills.remove(update.agentId);
          else addPill(update.agent);
        },
      });
      return undefined;
    })
    .catch(failed("agent"));
  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return subscription.release();
      lifetime.signal.addEventListener("abort", () => void subscription.release().catch(failed("workspace")), { once: true });
      subscription.subscribe({
        snapshot: ({ entries }) => {
          headers.clear();
          for (const workspace of entries) addHeader(workspace.id);
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          if (update.kind === "remove") headers.remove(update.id);
          else addHeader(update.workspace.id);
        },
      });
      return undefined;
    })
    .catch(failed("workspace"));
  return () => {
    lifetime.abort();
    pills.clear();
    headers.clear();
  };
}
