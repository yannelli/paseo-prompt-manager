// Applies the one host change the iOS E2E build needs, to a checkout of getpaseo/paseo.
//
// The host's compact bottom sheet (components/ui/menu/menu-surface.tsx, which plugin popovers such as
// the prompt picker render in) keeps @gorhom/bottom-sheet's default accessible=true. iOS then folds the
// whole sheet into a single "Bottom Sheet" element and hides its contents from XCUITest and VoiceOver.
// AdaptiveModalSheet already passes accessible={false}; do the same here so Maestro can see the rows.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const file = join(process.argv[2], "packages/app/src/components/ui/menu/menu-surface.tsx");
const source = readFileSync(file, "utf8");
const anchor = /(keyboardBlurBehavior="restore"\n)(\s*)>\n(\s*)<BottomSheetScrollView/;
if (!anchor.test(source)) throw new Error(`${file}: bottom sheet props changed; update e2e/ios/patch-host.mjs.`);
writeFileSync(file, source.replace(anchor, (_, blur, close, scroll) => `${blur}${close}  accessible={false}\n${close}>\n${scroll}<BottomSheetScrollView`));
console.log(`Patched ${file}`);
