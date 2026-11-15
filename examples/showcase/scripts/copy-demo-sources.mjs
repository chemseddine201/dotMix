// Copies the demo sources into public/demo-sources so each page can show the real source of its live demo.
import fs from "node:fs";

const targetDirectory = "public/demo-sources";
const copiedFolders = [
  { from: "src/components/demos", to: targetDirectory },
  { from: "src/permissions", to: `${targetDirectory}/permissions` },
  { from: "src/stores", to: `${targetDirectory}/stores` },
];

fs.rmSync(targetDirectory, { recursive: true, force: true });
for (const folder of copiedFolders) {
  fs.cpSync(folder.from, folder.to, { recursive: true });
}
fs.copyFileSync("src/routes.ts", `${targetDirectory}/routes.ts`);
