import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PromptLibrary } from "./server/library";
import { gitStatus, hasRepository, initializeGit, synchronizeGit } from "./server/git";
import { SyncScheduler } from "./server/sync";
import * as rpc from "./shared/prompts";

export default function contribute(server: PluginServerContext) {
  const library = new PromptLibrary();
  const scheduler = new SyncScheduler({
    settings: () => library.settings(),
    initialized: (settings) => hasRepository(settings.directory),
    sync: (settings) => {
      if (!settings.gitEnabled) throw new Error("Enable Git sync in library settings first.");
      return synchronizeGit(settings.directory, (operation) => library.exclusive(operation));
    },
    synced: () => library.invalidate(),
  });
  library.onChange = () => scheduler.changed();
  scheduler.reload().catch((error: unknown) => console.error("Prompt sync scheduler failed to start", error));
  server.handle(rpc.getSettings, () => library.settings());
  server.handle(rpc.saveSettings, async (input) => {
    const settings = await library.configure(input);
    await scheduler.reload();
    return settings;
  });
  server.handle(rpc.listPrompts, (input) => library.list(input));
  server.handle(rpc.listFolders, () => library.folders());
  server.handle(rpc.createFolder, ({ path }) => library.createFolder(path));
  server.handle(rpc.readPrompt, ({ id }) => library.read(id));
  server.handle(rpc.savePrompt, (input) => library.save(input));
  server.handle(rpc.importPrompts, (input) => library.import(input));
  server.handle(rpc.archivePrompt, (input) => library.archive(input));
  server.handle(rpc.listVersions, ({ id }) => library.versions(id));
  server.handle(rpc.readVersion, (input) => library.version(input));
  server.handle(rpc.restoreVersion, (input) => library.restore(input));
  server.handle(rpc.getGitStatus, () => library.withRoot((root) => gitStatus(root)));
  server.handle(rpc.initGit, ({ remote, branch }) => scheduler.exclusive(() => library.withRoot((root, settings) => {
    if (!settings.gitEnabled) throw new Error("Enable Git sync in library settings first.");
    return initializeGit(root, remote, branch);
  })));
  server.handle(rpc.syncGit, () => scheduler.syncNow());
  server.handle(rpc.getSyncState, () => scheduler.snapshot());
  server.handle(rpc.openSync, () => scheduler.opened());
  server.handle(rpc.searchPrompts, ({ query }) => library.search(query));
  return () => scheduler.dispose();
}
