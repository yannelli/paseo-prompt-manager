# Promo images

Created: 2026-10-05
Last updated: 2026-10-05

`docs/promo/render.mjs` renders these files from HTML:

| Output | Size | Use |
| --- | --- | --- |
| `docs/images/github-banner.png` | 2560×1280 (1280×640 at 2x) | README banner and GitHub social preview |
| `docs/images/icon.png` | 512×512 | Avatar or listing icon |
| `docs/promo/{dark,light}/*.png` | 1920×1080 | Feature slides: library, composer, history, import, Git sync |
| `docs/promo/comparison.png`, `docs/promo/index.html` | 1600 wide | Gallery of all slides |

The slides show HTML illustrations of the plugin UI with sample data. Labels and layout come from `client/*.tsx`. The UI mock uses the brand palette below in both themes. If you change a label in the client, change it in `docs/promo/ui.mjs` too.

## Render

```sh
npm install -g playwright && npx playwright install chromium
node docs/promo/render.mjs
```

Set `PLAYWRIGHT_MODULE` to a Playwright `index.mjs` path to use another install. `--banner-only` renders only the banner and the icon. Playwright is not a project dependency.

The script fails when a brand font did not load, a headline overflows, the UI overlaps the copy, an image has the wrong size, or the banner is 1 MB or more. The UI mock uses the system `Noto Sans` font with a `system-ui` fallback.

## Brand

| Token | Value |
| --- | --- |
| Ink | `#0f1328` |
| Paper | `#eef0fa` |
| Violet | `#6d5efc` |
| Lilac | `#b3a9ff` |
| Amber | `#ffc04d` |

The icon (`docs/promo/icon.svg`) is three stacked pages for saved versions, with a prompt chevron and cursor on the front page. Headlines use Instrument Sans at weights 400 and 600. Code and labels use JetBrains Mono. Both fonts are in `docs/promo/assets` with their SIL Open Font License files. Icons in the UI mock come from [Lucide](https://lucide.dev/license) (ISC).

## GitHub social preview

GitHub requires a PNG, JPG, or GIF under 1 MB and recommends 1280×640 ([GitHub docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)). To set it, open the repository **Settings**, find **Social preview**, choose **Edit**, then **Upload an image...** and select `docs/images/github-banner.png`.
