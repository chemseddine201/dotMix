/**
 * @mix/cli — Project Template Generator (`mix create`)
 *
 * Scaffolds the standardized React-inspired folder layout:
 * layouts/, pages/, components/, stores/, permissions/, styles/
 * with automatic stylesheet preprocessor ingestion (.scss) and native RBAC/ABAC.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface CreateOptions {
  projectName: string;
  targetDir?: string;
}

export interface CreateResult {
  readonly success: boolean;
  readonly targetDir: string;
  readonly createdFiles: readonly string[];
}

export function create(options: CreateOptions): CreateResult {
  const targetDir = path.resolve(options.targetDir || options.projectName);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const files: Record<string, string> = {
    "package.json": JSON.stringify(
      {
        name: options.projectName,
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "mix build src dist --watch",
          build: "mix build src dist",
          check: "mix check src"
        },
        dependencies: {
          "@mix/runtime": "0.1.0",
          "@mix/router": "0.1.0",
          "@mix/sync": "0.1.0"
        }
      },
      null,
      2
    ) + "\n",

    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          jsx: "preserve"
        },
        include: ["src/**/*"]
      },
      null,
      2
    ) + "\n",

    "mix.config.ts": `export default {
  preprocessors: ["scss", "less", "pcss"],
  ssr: true,
  sync: true
};
`,

    "src/styles/tokens.scss": `:root {
  --color-primary: #6366f1;
  --color-primary-hover: #4f46e5;
  --color-bg: #0f172a;
  --color-surface: #1e293b;
  --color-text: #f8fafc;
}
`,

    "src/styles/global.scss": `@import "./tokens.scss";

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
}
`,

    "src/permissions/abilities.ts": `import { defineAbility } from "@mix/runtime/permissions";

export interface UserSession {
  id: number;
  role: "admin" | "editor" | "user" | "guest";
}

export function defineAppAbility(user: UserSession | null) {
  return defineAbility((can, cannot) => {
    if (!user || user.role === "guest") {
      can("read", "all");
      return;
    }
    if (user.role === "admin") {
      can("manage", "all");
      return;
    }
    can("read", "all");
    can("create", "Post");
    can("update", "Post", (post: any) => post.authorId === user.id);
    cannot("delete", "Post");
  });
}
`,

    "src/stores/authStore.ts": `import { signal } from "@mix/runtime";
import type { UserSession } from "../permissions/abilities.js";

export const activeUser = signal<UserSession | null>({
  id: 1,
  role: "user"
});

export function setRole(role: UserSession["role"]) {
  activeUser.set({ id: 1, role });
}
`,

    "src/components/common/Button.mix": `import "./Button.scss";

export default function Button(props: any) {
  const variant = props.variant ?? "primary";
  return (
    <button class={\`btn btn-\${variant}\`} @click={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  );
}
`,

    "src/components/common/Button.scss": `.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;

  &-primary {
    background: var(--color-primary, #6366f1);
    color: white;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
`,

    "src/layouts/RootLayout.mix": `import "./RootLayout.scss";
import { Outlet, Link } from "@mix/router";

export default function RootLayout() {
  return (
    <div class="app-layout">
      <nav class="nav-bar">
        <Link to="/">Home</Link>
        <Link to="/admin">Admin</Link>
      </nav>
      <main class="main-outlet">
        <Outlet />
      </main>
    </div>
  );
}
`,

    "src/layouts/RootLayout.scss": `.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.nav-bar {
  display: flex;
  gap: 16px;
  padding: 16px 24px;
  background: var(--color-surface, #1e293b);
}
.main-outlet {
  flex: 1;
  padding: 24px;
}
`,

    "src/pages/HomePage.mix": `import "./HomePage.scss";
import Button from "../components/common/Button.mix";
import { Can } from "@mix/runtime/permissions";

export default function HomePage() {
  return (
    <div class="home-page">
      <h1>Welcome to Mix Framework</h1>
      <p>Compiler-native, zero Virtual DOM, fine-grained reactivity, and built-in RBAC.</p>
      <Can I="create" a="Post" fallback={<p>Log in as editor to create posts.</p>}>
        <Button variant="primary">Create Post</Button>
      </Can>
    </div>
  );
}
`,

    "src/pages/HomePage.scss": `.home-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
`,

    "src/routes.ts": `import RootLayout from "./layouts/RootLayout.mix";
import HomePage from "./pages/HomePage.mix";

export const routes = [
  {
    path: "/",
    component: RootLayout,
    children: [
      { index: true, component: HomePage }
    ]
  }
];
`,

    "src/main.mix": `import "./styles/global.scss";
import { mount, computed } from "@mix/runtime";
import { RouterView, createRouter } from "@mix/router";
import { PermissionProvider } from "@mix/runtime/permissions";
import { routes } from "./routes.js";
import { activeUser } from "./stores/authStore.js";
import { defineAppAbility } from "./permissions/abilities.js";

export default function Main() {
  const ability = computed(() => defineAppAbility(activeUser()));
  const router = createRouter({ routes, ability });

  return (
    <PermissionProvider ability={ability}>
      <RouterView router={router} />
    </PermissionProvider>
  );
}

mount(Main, document.getElementById("root"));
`
  };

  const createdFiles: string[] = [];

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf-8");
    createdFiles.push(fullPath);
  }

  return {
    success: true,
    targetDir,
    createdFiles
  };
}
