/**
 * `mix create --template sync-crdt` and the `mix add sync` artifact.
 *
 * Generated code uses only the public @dotmix/sync API (syncCollection), whose signatures keeps
 * stable. Projects therefore run on whichever engine is the default: legacy until,
 * afterwards. No engine option is hard-coded.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DOTMIX_VERSION } from "./version.js";

export function toKebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase();
}

function writeAll(targetDir: string, files: Record<string, string>): string[] {
  const created: string[] = [];
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
    created.push(fullPath);
  }
  return created;
}

/** Source of one synced collection module (shared by the template and `mix add sync`). */
export function syncCollectionSource(name: string, isTs: boolean): string {
  const key = toKebabCase(name);
  const camel = name.charAt(0).toLowerCase() + name.slice(1);
  if (!isTs) {
    return `import { syncCollection } from "@dotmix/sync";

/** Offline-first replicated collection "${key}". Items need a unique string \`id\`. */
export const ${camel}Collection = syncCollection({ key: "${key}" });
`;
  }
  return `import { syncCollection } from "@dotmix/sync";

export interface ${name}Record {
  id: string;
}

/** Offline-first replicated collection "${key}". Items need a unique string \`id\`. */
export const ${camel}Collection = syncCollection<${name}Record>({ key: "${key}" });
`;
}

export function createSyncCrdtProject(targetDir: string, projectName: string, isTs: boolean): string[] {
  const compExt = isTs ? "tix" : "mix";
  const scriptExt = isTs ? "ts" : "js";
  const pkgJson = {
    name: projectName,
    version: "0.1.0",
    type: "module",
    scripts: { dev: "mix dev", build: "mix build src dist", check: "mix check src", test: "mix test" },
    dependencies: { "@dotmix/runtime": DOTMIX_VERSION, "@dotmix/sync": DOTMIX_VERSION },
    devDependencies: { "@dotmix/cli": DOTMIX_VERSION }
  };

  const store = isTs
    ? `import { syncCollection } from "@dotmix/sync";

export interface Task {
  id: string;
  title: string;
  done: boolean;
}

/**
 * Offline-first: every change applies locally at once, is persisted, and replicates to other
 * devices when a transport is connected (see the @dotmix/sync documentation).
 */
export const tasks = syncCollection<Task>({ key: "tasks" });
`
    : `import { syncCollection } from "@dotmix/sync";

/**
 * Offline-first: every change applies locally at once, is persisted, and replicates to other
 * devices when a transport is connected (see the @dotmix/sync documentation).
 */
export const tasks = syncCollection({ key: "tasks" });
`;

  const typed = (ts: string, js: string): string => (isTs ? ts : js);
  const app = `import "./App.css";
import { tasks${typed(", type Task", "")} } from "./stores/tasks.js";

export default function App() {
  const title = signal("");

  function add() {
    const value = title().trim();
    if (!value) return;
    tasks.insert({ id: \`task-\${Date.now()}\`, title: value, done: false });
    title.set("");
  }

  function toggle(id${typed(": string", "")}) {
    const task = tasks.items().find((t${typed(": Task", "")}) => t.id === id);
    if (task) tasks.update(id, { done: !task.done });
  }

  return (
    <main class="sync-app">
      <h1>${projectName}</h1>
      <p class="status">Pending changes: {tasks.pendingCount()}</p>
      <div class="bar">
        <input
          value={title()}
          placeholder="New task"
          @input={(e${typed(": Event", "")}) => title.set((e.target${typed(" as HTMLInputElement", "")}).value)}
        />
        <button @click={add}>Add</button>
      </div>
      <ul>
        {each (task, idx) in tasks.items()}
          <li class={task.done ? "done" : ""}>
            <input type="checkbox" checked={task.done} @change={() => toggle(task.id)} />
            <span>{task.title}</span>
            <button @click={() => tasks.delete(task.id)}>Remove</button>
          </li>
        {endeach}
      </ul>
    </main>
  );
}
`;
  const appStylesheet = `.sync-app { font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; }
.bar { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.done span { text-decoration: line-through; opacity: 0.6; }
.status { color: #555; }
`;

  const files: Record<string, string> = {
    "package.json": JSON.stringify(pkgJson, null, 2) + "\n",
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${projectName}</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.${scriptExt}"></script>
</body>
</html>
`,
    [`src/main.${scriptExt}`]: `import { mount } from "@dotmix/runtime";
import App from "./App.${compExt}";

const root = document.getElementById("app");
if (root) {
  mount(App, root);
}
`,
    [`src/App.${compExt}`]: app,
    "src/App.css": appStylesheet,
    [`src/stores/tasks.${scriptExt}`]: store
  };
  if (isTs) {
    files["tsconfig.json"] = JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, esModuleInterop: true, skipLibCheck: true },
      include: ["src/**/*"]
    }, null, 2) + "\n";
    // Lets TypeScript accept .tix/.mix component imports and stylesheet imports in .ts files.
    files["src/env.d.ts"] = "/// <reference types=\"@dotmix/runtime/client\" />\n";
  }
  return writeAll(targetDir, files);
}
