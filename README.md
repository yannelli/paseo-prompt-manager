# Paseo Prompt Manager

A Markdown prompt library for [Paseo](https://paseo.sh). Create, edit, search, and reuse prompts across agents, with local version history and optional Git sync.

## Install

Requires Paseo `0.8.0-beta.1` or later on the daemon and app. Git sync also requires Git on the daemon host.

Enable plugins in **Settings → Plugins**, then install the release:

```sh
paseo plugin add yannelli/paseo-prompt-manager --ref v0.2.0
```

Open **Prompts** in the sidebar to manage your library. Paseo provides the plugin's runtime dependencies.

## Use prompts with agents

- In the composer attachment menu, choose **Saved prompt**. Search by title, filename, or words in the prompt, then attach it to your message.
- Submit `/prompts` in an agent composer to open the prompt panel.
- Submit `/prompt code-review` to send `code-review.md` to the current agent and start a turn.
- From the prompt panel, use **Send saved prompt to agent** to send the selected prompt.

Attachment search matches multiple words across the title, filename, and content. Exact names and title matches appear first, with up to 50 results. Attachments contain a snapshot of the saved prompt.

## Edit and version prompts

Choose **New prompt**, enter a filename and Markdown content, then save. The first Markdown heading becomes the title. Files keep their normalized names when you edit their content.

Add a **Description** and comma-separated **Labels / tags** to explain and categorize a prompt. Search includes both fields; **Folders & tags** filters the library by folder or tag.

Folders and subfolders are directories inside the library. Create them from **Folders & tags** or the editor's **Folder** controls. Selecting another folder and saving moves the prompt and retains its version history. Nested prompts use paths such as `/prompt engineering/security/code-review`.

Choose **Expand editor** to use the available workspace, and **Preview Markdown** to switch between editing and a formatted preview. **Collapse editor** returns to the library layout.

By default, the library lives at `~/.config/paseo/prompt-lib/`:

```text
prompt-lib/
├── code-review.md
└── versions/
    └── code-review/
        ├── code-review.2026-09-09T12-00-00-000Z_v1.md
        └── code-review.2026-09-09T12-05-00-000Z_v2.md
```

Each save creates a full Markdown snapshot. **Version history** lets you inspect and restore a snapshot as a new version. **Archive** removes the current prompt and retains its history; use **Include archived** to find and restore it.

Descriptions and tags use a `paseo` JSON field in Markdown frontmatter and are included in snapshots. Agents receive the prompt body. Nested history follows `versions/<folder>/<prompt-name>/<prompt-name>.<timestamp>_v<number>.md`; existing flat prompts keep their paths.

You can also edit files with your own editor. Saving a stale draft in the plugin rejects the write so you can reload the changed file. The plugin preserves externally edited content before replacing or archiving it.

## Import Markdown files and folders

Open **Prompts → Import**.

- In a browser client, use **Choose Markdown files** or **Choose folder** to import from your device.
- On any client, enter absolute paths or `~/` paths under **Files or folders on the Paseo host**, one per line, then choose **Import paths**.

Folders include subfolders. Choose an import destination to copy `.md` files into that folder and create their first versions. Folder imports preserve the selected folder and its subfolders with normalized names. Existing paths, including archived prompts, are skipped and reported. Source files stay in place.

Each import supports up to 100 Markdown files totaling 8 MB, with a 512 KB limit per file. Hidden entries, symbolic links, and `versions` folders are excluded. Host folder scans stop at 5,000 entries.

## Choose a library directory

Open **Prompts → Settings**, enter an absolute directory or `~/` path, and choose **Save settings**. Changing the directory opens a different library; it does not move files.

Preferences live at `~/.config/paseo/prompt-manager.json`. If `XDG_CONFIG_HOME` is set, it replaces `~/.config` for the default library and preferences. The library belongs to the selected daemon host and is shared across its clients and agents.

## Optional Git sync

1. Configure your Git author name, email, and remote credentials on the daemon host.
2. Turn **Git sync** on in library settings and save.
3. Choose **Initialize Git**. Supply an origin URL to sync with a remote, or leave it blank for local Git checkpoints.
4. Choose **Sync now** to commit prompt files and version history, fetch the remote branch, fast-forward, and push.

Sync runs when requested. Branch divergence stops the sync and leaves local commits intact. Resolve it with Git, then sync again. The library must be the repository root. Unrelated staged files block sync.

## Development

Requires Node.js 24 or later and npm.

```sh
git clone https://github.com/yannelli/paseo-prompt-manager.git
cd paseo-prompt-manager
npm ci
npm run typecheck
npm test
paseo plugin install "$PWD"
```

After changing plugin code, run the checks and reload:

```sh
paseo plugin reload paseo-prompt-manager
paseo plugin ls paseo-prompt-manager
paseo plugin logs paseo-prompt-manager
```

The tests cover storage, imports, search, versioning, conflicts, and Git sync using temporary directories and local Git remotes. Browser file-picker and desktop/mobile UI checks remain manual.

## License

[MIT](LICENSE), copyright 2026 Ryan Yannelli.
