import { Platform } from "react-native";

type SelectedFile = { name: string; webkitRelativePath?: string; size: number; text(): Promise<string> };
type FileInput = {
  type: string;
  accept: string;
  multiple: boolean;
  style: { display: string };
  files: ArrayLike<SelectedFile> | null;
  onchange: (() => void) | null;
  oncancel: (() => void) | null;
  setAttribute(name: string, value: string): void;
  click(): void;
  remove(): void;
};
declare const document: {
  createElement(tag: "input"): FileInput;
  body: { appendChild(input: FileInput): void };
};

export function canPickFiles() {
  return Platform.OS === "web" && typeof document !== "undefined";
}

export function pickMarkdown(folder: boolean): Promise<{ name: string; content: string }[]> {
  if (Platform.OS !== "web" || typeof document === "undefined") return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,text/markdown";
    input.multiple = true;
    input.style.display = "none";
    if (folder) input.setAttribute("webkitdirectory", "");
    const cleanup = () => { input.onchange = null; input.oncancel = null; input.remove(); };
    input.oncancel = () => { cleanup(); resolve([]); };
    input.onchange = () => {
      const files = Array.from(input.files ?? []).filter((file) => {
        const path = file.webkitRelativePath || file.name;
        return /\.md$/i.test(file.name) && !path.split("/").some((part) => part.startsWith(".") || part === "versions");
      });
      cleanup();
      if (files.length > 100 || files.reduce((total, file) => total + file.size, 0) > 8_000_000) {
        reject(new Error("Select up to 100 Markdown files totaling 8 MB per import."));
        return;
      }
      if (files.some((file) => file.size > 512_000)) {
        reject(new Error("Each Markdown file must be 512 KB or smaller."));
        return;
      }
      if (!files.length) { reject(new Error("No Markdown files found in the selection.")); return; }
      Promise.all(files.map(async (file) => ({ name: file.webkitRelativePath || file.name, content: await file.text() }))).then(resolve, reject);
    };
    document.body.appendChild(input);
    input.click();
  });
}
