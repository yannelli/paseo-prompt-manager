# npm publishing

Created: 2026-10-05
Last updated: 2026-10-05

Sources:

- [Paseo publishing guide](https://paseo.sh/docs/plugins/publishing.md)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers)
- `npm help trust` (npm 12.0.2)

The **Release** workflow publishes `@yannelli/paseo-prompt-manager` to [npm](https://www.npmjs.com/package/@yannelli/paseo-prompt-manager). Paseo 0.9.0 and later install npm sources, including dist-tags:

```sh
paseo plugin add npm:@yannelli/paseo-prompt-manager        # latest
paseo plugin add npm:@yannelli/paseo-prompt-manager@beta   # beta channel
```

Paseo stores the selector and checks it again for updates, so a `@beta` install follows the `beta` dist-tag. Paseo runs `npm install --omit=dev --ignore-scripts` on the daemon host and compiles `index.client.tsx` and `index.server.ts` itself. The tarball holds the TypeScript source listed in `files` in `package.json`, without `server/*.test.ts`. Run `npm pack --dry-run` after you add a top-level file.

## Channels

| Branch | Version | npm dist-tag | GitHub release |
| --- | --- | --- | --- |
| `main` | `X.Y.Z` | `latest` | Latest |
| `beta` | `X.Y.Z-beta.N` | `beta` | Pre-release |

`scripts/release.mjs` computes `X.Y.Z` from the newest stable tag reachable from the branch and the Conventional Commits since that tag. On `beta`, `N` is one more than the highest existing `vX.Y.Z-beta.N` tag. A `beta` push without a `feat`, `fix`, `perf`, `revert`, or breaking commit since the last tag does not release. Merging `beta` into `main` releases `X.Y.Z` with the changes since the previous stable tag.

`package.json` and `package-lock.json` hold the version of the newest release tag reachable from the branch. The script commits `chore(release): <version>`, pushes an annotated tag, and creates the GitHub release with the repository's `GITHUB_TOKEN`.

## Workflow step

The **Publish npm package** step reads the name and version from `package.json` and runs `npm publish --tag beta` for beta versions and `npm publish --tag latest` for the rest. It skips the publish when npm already has that version, so a rerun completes a failed publish.

`publishConfig` sets public access and provenance. The job grants `id-token: write` for trusted publishing and the provenance statement.

## Authentication

The package uses a [trusted publisher](https://docs.npmjs.com/trusted-publishers) for `release.yml` in `yannelli/paseo-prompt-manager`. npm CLI 11.5.1 or newer on Node.js 22.14.0 or newer exchanges the job's OIDC token for a short-lived publish token. The workflow reads no npm secret.

`npm trust` requires an existing package, an account with 2FA, and a login that does not bypass 2FA. Version `0.2.0` was published from the `v0.2.0` tag on the maintainer's machine to create the package and set `latest`; it has no provenance statement.

The trust entry names the workflow file. When you rename `release.yml` or move the publish step, replace the entry:

```sh
npm login
npm trust list @yannelli/paseo-prompt-manager
npm trust revoke @yannelli/paseo-prompt-manager --id=<trust-id>
npm trust github @yannelli/paseo-prompt-manager --repo yannelli/paseo-prompt-manager --file release.yml --allow-publish
```

The npmjs.com equivalent is the package's **Settings → Trusted publishing**. Then set **Publishing access** to require 2FA and disallow tokens.
