// Applies the one host change the iOS E2E build needs, to a checkout of getpaseo/paseo.
//
// Sheets built on IsolatedBottomSheetModal (the prompt picker's popover, the attachment combobox, ...)
// keep @gorhom/bottom-sheet's default accessible=true. iOS then folds a whole sheet into a single
// "Bottom Sheet" element and hides its contents from XCUITest and VoiceOver. AdaptiveModalSheet and the
// command center already pass accessible={false}; make that the default for every isolated sheet so
// Maestro can reach the rows. Props passed by a caller still win.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const file = join(process.argv[2], "packages/app/src/components/ui/isolated-bottom-sheet-modal/index.tsx");
const source = readFileSync(file, "utf8");
const anchor = /(<GorhomBottomSheetModal\n)(\s*)(\{\.\.\.bottomSheetProps\})/;
if (!anchor.test(source)) throw new Error(`${file}: the Gorhom modal element changed; update e2e/ios/patch-host.mjs.`);
writeFileSync(file, source.replace(anchor, (_, open, indent, spread) => `${open}${indent}accessible={false}\n${indent}${spread}`));
console.log(`Patched ${file}`);
