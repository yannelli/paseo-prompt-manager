import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PromptLibrary, PromptPanel } from "./client/prompts";
import { promptAttachment, readPrompt } from "./shared/prompts";

export default function contribute(client: PluginClientContext) {
  client.addSurface("library", PromptLibrary);
  client.addSidebarItem({ id: "library", title: "Prompts", icon: "NotebookPen", surface: "library" });
  client.addWorkspacePanel({ id: "prompts", title: "Prompts", icon: "NotebookPen", context: "agent", Component: PromptPanel });
  client.addCommandCenterItem({ id: "open-library", title: "Open prompt library", icon: "NotebookPen", context: "global", onSelect: ({ openSurface }) => openSurface("library") });
  client.addCommandCenterItem({ id: "agent-prompts", title: "Use saved prompts", icon: "NotebookPen", context: "agent", onSelect: ({ openPanel }) => openPanel("prompts") });
  client.addSlashCommand({ name: "prompts", description: "Open your prompt library", argumentHint: "", context: "agent", onSubmit: ({ openPanel }) => openPanel("prompts") });
  client.addSlashCommand({
    name: "prompt", description: "Send a saved prompt to this agent", argumentHint: "<prompt-id>", context: "agent",
    async onSubmit({ args, agent, rpc, paseo }) {
      if (!args) throw new Error("Enter a prompt ID, for example /prompt code-review. Use /prompts to browse.");
      const prompt = await rpc(readPrompt, { id: args });
      if (prompt.archived) throw new Error("This prompt is archived. Restore it from the library first.");
      await paseo.agents.ref(agent.id).send(prompt.content);
    },
  });
  client.addAttachmentSource(promptAttachment);
  return () => {};
}
