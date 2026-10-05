import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { contributePromptPills } from "./client/pill";
import { PromptLibrary, PromptPanel } from "./client/prompts";
import { promptAttachment, readPrompt } from "./shared/prompts";

function LibraryItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="NotebookPen" active={currentScreen?.screenId === "library"} onPress={() => openScreen({ screenId: "library" })} />;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "library", title: "Prompts", Component: PromptLibrary });
  client.addSidebarHeaderItem({ id: "library", title: "Prompts", Component: LibraryItem });
  client.addWorkspacePanel({ id: "prompts", title: "Prompts", icon: "NotebookPen", context: "agent", Component: PromptPanel });
  client.addCommandCenterItem({ id: "open-library", title: "Open prompt library", icon: "NotebookPen", context: "global", onSelect: ({ openScreen }) => openScreen({ screenId: "library" }) });
  client.addCommandCenterItem({ id: "agent-prompts", title: "Use saved prompts", icon: "NotebookPen", context: "agent", onSelect: ({ openPanel }) => openPanel("prompts") });
  client.addSlashCommand({ name: "prompts", description: "Open your prompt library", argumentHint: "", context: "agent", onSubmit: ({ openPanel }) => openPanel("prompts") });
  client.addSlashCommand({
    name: "prompt", description: "Send a saved prompt to this agent", argumentHint: "<prompt-id>", context: "agent",
    async onSubmit({ args, agent, rpc, paseo }) {
      if (!args) throw new Error("Enter a prompt ID, for example /prompt code-review. Use /prompts to browse.");
      const prompt = await rpc(readPrompt, { id: args.replace(/\.md$/i, "") });
      if (prompt.archived) throw new Error("This prompt is archived. Restore it from the library first.");
      await paseo.agents.ref(agent.id).send(prompt.content);
    },
  });
  client.addAttachmentSource(promptAttachment);
  return contributePromptPills(client);
}
