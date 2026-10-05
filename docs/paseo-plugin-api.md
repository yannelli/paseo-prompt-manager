# Paseo plugin API notes

Created: 2026-10-05
Last updated: 2026-10-05

Sources:

- [Plugin quickstart](https://paseo.sh/docs/plugins.md)
- [Plugin reference](https://paseo.sh/docs/plugins/reference.md)
- [Publishing](https://paseo.sh/docs/plugins/publishing.md)

## Supported Paseo versions

`paseo-plugin.json` sets `requirements.paseo` to `>=0.11.0-beta.3`. The daemon checks this range before it loads the plugin. Each app checks it before it evaluates `index.client.tsx`, so an app older than 0.11 does not show the plugin UI.

`package.json` pins `@getpaseo/plugin` to `0.11.0-beta.3`. `npm run typecheck` checks the code against the minimum supported SDK.

## API availability

| API | Checked in | Use in this plugin |
| --- | --- | --- |
| `addScreen`, `addSidebarHeaderItem`, `openScreen`, `SidebarRow` | SDK 0.11.0-beta.1 through 0.11.0-beta.4; absent in 0.10.3 | Library screen, sidebar row, and Command Center item |
| `addSurface`, `addSidebarItem`, `openSurface` | SDK 0.8.0-beta.1 through 0.11.0-beta.4; `@deprecated` in 0.11 | Removed; release `v0.2.0` uses them |
| `addComposerPill` with `popover` behavior | SDK 0.10.3 and 0.11.0-beta.3 | **Prompts** pill in each agent composer |
| Manifest `description` | Daemon 0.9.2 and 0.10.3; rejected by 0.8.0-beta.1 | Summary in Settings → Plugins |

Checked against the published `@getpaseo/plugin` type declarations for 0.8.0-beta.1, 0.9.2, 0.10.3, and 0.11.0-beta.1 through 0.11.0-beta.4. The `@getpaseo/server` manifest schema for 0.8.0-beta.1 rejects unknown keys, including `description`; 0.9.2 and 0.10.3 accept it.

## When to update this note

Update this file when `requirements.paseo` changes or the plugin adopts an API newer than the current minimum.
