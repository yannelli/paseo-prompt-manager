import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PromptLibrary } from "./server/library";
import { gitStatus, initializeGit, synchronizeGit } from "./server/git";
import * as rpc from "./shared/prompts";

export default function contribute(server: PluginServerContext) {
  const library = new PromptLibrary();
  server.handle(rpc.getSettings, () => library.settings());
  server.handle(rpc.saveSettings, (input) => library.configure(input));
  server.handle(rpc.listPrompts, (input) => library.list(input));
  server.handle(rpc.listFolders, () => library.folders());
  server.handle(rpc.createFolder, ({ path }) => library.createFolder(path));
  server.handle(rpc.readPrompt, ({ id }) => library.read(id));
  server.handle(rpc.savePrompt, (input) => library.save(input));
  server.handle(rpc.importPrompts, (input) => library.import(input));
  server.handle(rpc.archivePrompt, async (input) => { await library.archive(input); return {}; });
  server.handle(rpc.listVersions, ({ id }) => library.versions(id));
  server.handle(rpc.readVersion, (input) => library.version(input));
  server.handle(rpc.restoreVersion, (input) => library.restore(input));
  server.handle(rpc.getGitStatus, () => library.withRoot((root) => gitStatus(root)));
  server.handle(rpc.initGit, ({ remote }) => library.withRoot((root, settings) => {
    if (!settings.gitEnabled) throw new Error("Enable Git sync in library settings first.");
    return initializeGit(root, remote);
  }));
  server.handle(rpc.syncGit, () => library.withRoot((root, settings) => {
    if (!settings.gitEnabled) throw new Error("Enable Git sync in library settings first.");
    return synchronizeGit(root);
  }));
  server.handle(rpc.searchPrompts, ({ query }) => library.search(query));
  return () => {};
}
