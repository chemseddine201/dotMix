/**
 * @mix/cli — Comprehensive Project Template Generator (`mix create` / `mix init`)
 *
 * Implements the approved Mix Framework project architecture:
 * - layouts/, pages/, components/ (common/ & domain/), stores/, permissions/, styles/
 * - Automatic stylesheet preprocessor scoping (.scss, .less, .pcss, .css)
 * - Isomorphic RBAC/ABAC capability engine (@mix/runtime/permissions)
 * - Offline-First CRDT distributed state (@mix/sync)
 * - Reactive typed forms with cancellation (@mix/runtime/forms)
 * - Declarative client routing with pre-loader guards (@mix/router)
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface CreateOptions {
  projectName: string;
  targetDir?: string | undefined;
  typescript?: boolean | undefined;
  styleFormat?: ("scss" | "sass" | "less" | "pcss" | "css") | undefined;
  features?: {
    permissions?: boolean | undefined;
    sync?: boolean | undefined;
    forms?: boolean | undefined;
  } | undefined;
}


export interface CreateResult {
  readonly success: boolean;
  readonly targetDir: string;
  readonly createdFiles: readonly string[];
}

export function create(options: CreateOptions): CreateResult {
  const targetDir = path.resolve(options.targetDir || options.projectName);
  const styleExt = options.styleFormat ?? "scss";
  const isTs = options.typescript !== false; // TypeScript by default
  const compExt = isTs ? "tix" : "mix";

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
          check: "mix check src",
          test: "node --test tests/**/*.test.mjs"
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
          jsx: "preserve",
          skipLibCheck: true
        },
        include: ["src/**/*"]
      },
      null,
      2
    ) + "\n",

    "mix.config.ts": `export default {
  preprocessors: ["${styleExt}"],
  ssr: true,
  sync: true
};
`,

    "README.md": `# ${options.projectName}

Built with **Mix Framework** — Compiler-Native UI with Zero Virtual DOM, Fine-Grained Reactivity, Built-in RBAC/ABAC Permissions, and Offline CRDT State.

## Architecture Layout

\`\`\`text
src/
├── layouts/          # Persistent shell layouts (<Outlet /> retains state across routes)
├── pages/            # Target page views bound to declarative routes
├── components/       # Reusable UI primitives
│   ├── common/       # Design system primitives (Button, Input, Modal, Card)
│   └── domain/       # Feature components (TaskItem, SyncStatusPill)
├── permissions/      # Native isomorphic RBAC/ABAC capability matrix
├── stores/           # Reactive signals and offline CRDT sync collections
├── styles/           # Global tokens, resets, and typography
├── routes.ts         # Declarative route configuration with pre-loader security
└── main.mix          # Application bootstrap and permission provider
\`\`\`

## Getting Started

\`\`\`bash
# 1. Install dependencies
npm install

# 2. Start development compiler
npm run dev

# 3. Typecheck .tix and analyze .mix components
npm run check

# 4. Production build
npm run build
\`\`\`
`,

    [`src/styles/tokens.${styleExt}`]: `:root {
  --color-primary: #6366f1;
  --color-primary-hover: #4f46e5;
  --color-danger: #ef4444;
  --color-danger-hover: #dc2626;
  --color-bg: #0f172a;
  --color-surface: #1e293b;
  --color-border: #334155;
  --color-text: #f8fafc;
  --color-text-muted: #94a3b8;
}
`,

    [`src/styles/global.${styleExt}`]: `@import "./tokens.${styleExt}";

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
  min-height: 100vh;
}

a {
  color: inherit;
  text-decoration: none;
}
`,

    "src/permissions/subjects.ts": `export interface TaskSubject {
  id: string;
  title: string;
  completed: boolean;
  ownerId: number;
  isLocked?: boolean;
}
`,

    "src/permissions/abilities.ts": `import { defineAbility } from "@mix/runtime/permissions";

export interface UserSession {
  id: number;
  name: string;
  roles: string[];
}

export function defineAppAbility(user: UserSession | null) {
  return defineAbility((can, cannot) => {
    if (!user) {
      can("read", "PublicContent");
      return;
    }

    if (user.roles.includes("admin")) {
      can("manage", "all");
      return;
    }

    can("read", "Dashboard");
    can("read", "Task");
    can("create", "Task");

    // Dynamic signal-aware ABAC condition
    can("update", "Task", (task: any) => {
      const owner = typeof task.ownerId === "function" ? task.ownerId() : task.ownerId;
      const locked = typeof task.isLocked === "function" ? task.isLocked() : task.isLocked;
      return owner === user.id && !locked;
    });

    cannot("delete", "Task");
  });
}
`,

    "src/stores/authStore.ts": `import { signal } from "@mix/runtime";
import type { UserSession } from "../permissions/abilities.js";

export const activeUser = signal<UserSession | null>({
  id: 1,
  name: "Lead Architect",
  roles: ["editor"]
});

export function setRole(role: string) {
  activeUser.set(prev => prev ? { ...prev, roles: [role] } : null);
}

export function logout() {
  activeUser.set(null);
}
`,

    "src/stores/taskSyncStore.ts": `import { syncCollection } from "@mix/sync";

export interface TaskRecord {
  id: string;
  title: string;
  completed: boolean;
  ownerId: number;
}

export const taskStore = syncCollection<TaskRecord>({
  name: "app_tasks",
  initial: [
    { id: "task-1", title: "Build compiler frontend", completed: true, ownerId: 1 },
    { id: "task-2", title: "Fine-grained reactivity", completed: true, ownerId: 1 },
    { id: "task-3", title: "Ship isomorphic RBAC permissions", completed: false, ownerId: 1 }
  ]
});
`,

    [`src/components/common/Button.${compExt}`]: `import "./Button.${styleExt}";

export default function Button(props: any) {
  const variant = props.variant ?? "primary";
  return (
    <button
      class={\`mix-btn mix-btn-\${variant}\`}
      disabled={props.disabled}
      @click={props.onClick}
    >
      {props.children}
    </button>
  );
}
`,

    [`src/components/common/Button.${styleExt}`]: `.mix-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &-primary {
    background: var(--color-primary, #6366f1);
    color: #ffffff;
    &:hover:not(:disabled) {
      background: var(--color-primary-hover, #4f46e5);
    }
  }

  &-secondary {
    background: #334155;
    color: #f8fafc;
    &:hover:not(:disabled) {
      background: #475569;
    }
  }

  &-danger {
    background: var(--color-danger, #ef4444);
    color: #ffffff;
    &:hover:not(:disabled) {
      background: var(--color-danger-hover, #dc2626);
    }
  }
}
`,

    [`src/components/common/Input.${compExt}`]: `import "./Input.${styleExt}";

export default function Input(props: any) {
  return (
    <div class="input-field">
      {#if props.label}
        <label class="input-label">{props.label}</label>
      {/if}
      <input
        class="input-control"
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        @input={props.onInput}
      />
      {#if props.error}
        <span class="input-error">{props.error}</span>
      {/if}
    </div>
  );
}

`,

    [`src/components/common/Input.${styleExt}`]: `.input-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.input-label {
  font-size: 13px;
  color: var(--color-text-muted);
}
.input-control {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s ease;
  &:focus {
    border-color: var(--color-primary);
  }
}
.input-error {
  font-size: 12px;
  color: var(--color-danger);
}
`,

    [`src/components/domain/TaskItem.${compExt}`]: `import "./TaskItem.${styleExt}";
import { Can } from "@mix/runtime/permissions";

export default function TaskItem(props: any) {
  const task = props.task;
  return (
    <li class={\`task-item \${task.completed ? "completed" : ""}\`}>
      <label class="task-checkbox-label">
        <input
          type="checkbox"
          checked={task.completed}
          @change={() => props.onToggle && props.onToggle(task.id)}
        />
        <span class="task-title">{task.title}</span>
      </label>
      <Can I="delete" this={task}>
        <button
          class="btn-delete"
          @click={() => props.onDelete && props.onDelete(task.id)}
        >
          Delete
        </button>
      </Can>
    </li>
  );
}
`,

    [`src/components/domain/TaskItem.${styleExt}`]: `.task-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-bottom: 8px;
  transition: all 0.15s ease;

  &.completed .task-title {
    text-decoration: line-through;
    color: var(--color-text-muted);
  }
}
.task-checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.btn-delete {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-danger);
  background: transparent;
  color: var(--color-danger);
  font-size: 12px;
  cursor: pointer;
  &:hover {
    background: var(--color-danger);
    color: #ffffff;
  }
}
`,

    [`src/components/domain/SyncStatusPill.${compExt}`]: `import "./SyncStatusPill.${styleExt}";

export default function SyncStatusPill(props: any) {
  const pending = props.pendingCount ?? 0;
  return (
    <div class="sync-status-pill">
      <span class={\`status-dot \${pending > 0 ? "syncing" : "synced"}\`}></span>
      <span class="status-text">{pending > 0 ? \`\${pending} pending\` : "Synced"}</span>
    </div>
  );
}
`,

    [`src/components/domain/SyncStatusPill.${styleExt}`]: `.sync-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  font-size: 12px;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  &.synced {
    background: #22c55e;
  }
  &.syncing {
    background: #f59e0b;
  }
}
.status-text {
  color: var(--color-text-muted);
}
`,

    [`src/layouts/RootLayout.${compExt}`]: `import "./RootLayout.${styleExt}";
import { Outlet, NavLink } from "@mix/router";

export default function RootLayout() {
  return (
    <div class="root-layout">
      <header class="app-header">
        <div class="brand">
          <span class="logo">⚡</span>
          <span class="title">Mix Framework App</span>
        </div>
        <nav class="nav-links">
          <NavLink to="/" end class="nav-item">Home</NavLink>
          <NavLink to="/tasks" class="nav-item">Tasks (CRDT)</NavLink>
          <NavLink to="/forms" class="nav-item">Forms</NavLink>
          <NavLink to="/admin" class="nav-item">Admin</NavLink>
        </nav>
      </header>
      <main class="content-body">
        <Outlet />
      </main>
      <footer class="app-footer">
        <p>Powered by Mix Framework · Zero Virtual DOM · Fine-Grained Reactivity</p>
      </footer>
    </div>
  );
}
`,

    [`src/layouts/RootLayout.${styleExt}`]: `.root-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 16px;
}
.nav-links {
  display: flex;
  gap: 16px;
}
.nav-item {
  color: var(--color-text-muted);
  font-size: 14px;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
  &:hover, &.active {
    color: var(--color-text);
    background: rgba(255, 255, 255, 0.05);
  }
}
.content-body {
  flex: 1;
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
}
.app-footer {
  padding: 16px 24px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border);
}
`,

    [`src/pages/HomePage.${compExt}`]: `import "./HomePage.${styleExt}";
import Button from "../components/common/Button.${compExt}";
import { Can } from "@mix/runtime/permissions";

export default function HomePage() {
  return (
    <div class="home-page">
      <section class="hero-section">
        <h1>Compiler-Native Web Application</h1>
        <p>Built with fine-grained reactive signals, isomorphic permissions, and offline CRDT sync.</p>
        <div class="hero-actions">
          <Button variant="primary">Get Started</Button>
          <Can I="manage" a="AdminPanel" fallback="Guest Mode">
            <Button variant="secondary">Admin Settings</Button>
          </Can>
        </div>
      </section>
    </div>
  );
}
`,

    [`src/pages/HomePage.${styleExt}`]: `.home-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.hero-section {
  text-align: center;
  padding: 48px 16px;
}
.hero-section h1 {
  font-size: 32px;
  font-weight: 800;
  margin-bottom: 12px;
  color: #f8fafc;
}
.hero-section p {
  font-size: 16px;
  color: var(--color-text-muted);
  max-width: 600px;
  margin: 0 auto 24px;
}
.hero-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  align-items: center;
}
.badge-guest {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}
`,

    [`src/pages/TasksPage.${compExt}`]: `import "./TasksPage.${styleExt}";
import { taskStore } from "../stores/taskSyncStore.js";
import TaskItem from "../components/domain/TaskItem.${compExt}";
import SyncStatusPill from "../components/domain/SyncStatusPill.${compExt}";
import Button from "../components/common/Button.${compExt}";

export default function TasksPage() {
  const items = taskStore.items;
  const newTitle = signal("");

  function addTask() {
    const val = newTitle().trim();
    if (!val) return;
    taskStore.insert({
      id: \`task-\${Date.now()}\`,
      title: val,
      completed: false,
      ownerId: 1
    });
    newTitle.set("");
  }

  function toggleTask(id: string) {
    const found = items().find((t: any) => t.id === id);
    if (found) {
      taskStore.update(id, { completed: !found.completed });
    }
  }

  function deleteTask(id: string) {
    taskStore.delete(id);
  }

  return (
    <div class="tasks-page">
      <div class="tasks-header">
        <h2>Offline-First CRDT Tasks</h2>
        <SyncStatusPill pendingCount={taskStore.pendingMutations()} />
      </div>
      <div class="task-input-bar">
        <input
          class="task-input"
          value={newTitle()}
          placeholder="What needs to be done?"
          @input={(e: any) => newTitle.set(e.target.value)}
        />
        <Button variant="primary" onClick={addTask}>Add Task</Button>
      </div>
      <ul class="task-list">
        {#each items() as task (task.id)}
          <TaskItem task={task} onToggle={toggleTask} onDelete={deleteTask} />
        {/each}
      </ul>
    </div>
  );
}
`,

    [`src/pages/TasksPage.${styleExt}`]: `.tasks-page {
  max-width: 600px;
  margin: 0 auto;
}
.tasks-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.task-input-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}
.task-input {
  flex: 1;
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 14px;
  outline: none;
}
.task-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
`,

    [`src/pages/FormsPage.${compExt}`]: `import "./FormsPage.${styleExt}";
import { createForm, validators } from "@mix/runtime";
import Button from "../components/common/Button.${compExt}";

export default function FormsPage() {
  const submittedData = signal(null);

  const form = createForm({
    initialValues: {
      username: "",
      email: ""
    },
    validators: {
      username: [validators.required("Username is required")],
      email: [
        validators.required("Email is required"),
        validators.email("Must be a valid email format")
      ]
    },
    onSubmit(values) {
      submittedData.set(values);
    }
  });

  return (
    <div class="forms-page">
      <h2>Reactive Form Validation</h2>
      <form class="form-box" @submit={(e: any) => { e.preventDefault(); form.handleSubmit(); }}>
        <div class="field-row">
          <label>Username</label>
          <input
            class="input-control"
            value={form.fields.username.value()}
            @input={(e: any) => form.fields.username.setValue(e.target.value)}
          />
          {#if form.fields.username.error()}
            <span class="field-error">{form.fields.username.error()}</span>
          {/if}
        </div>
        <div class="field-row">
          <label>Email</label>
          <input
            class="input-control"
            value={form.fields.email.value()}
            @input={(e: any) => form.fields.email.setValue(e.target.value)}
          />
          {#if form.fields.email.error()}
            <span class="field-error">{form.fields.email.error()}</span>
          {/if}
        </div>
        <Button variant="primary">Submit Form</Button>
      </form>
      {#if submittedData()}
        <div class="submitted-result">
          <h3>Submitted Values:</h3>
          <pre>{JSON.stringify(submittedData(), null, 2)}</pre>
        </div>
      {/if}

    </div>
  );
}
`,

    [`src/pages/FormsPage.${styleExt}`]: `.forms-page {
  max-width: 500px;
  margin: 0 auto;
}
.form-box {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 24px;
  margin-top: 16px;
}
.field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.field-error {
  color: var(--color-danger);
  font-size: 12px;
}
.submitted-result {
  margin-top: 20px;
  padding: 16px;
  background: var(--color-surface);
  border-radius: 6px;
  font-size: 13px;
}
`,

    [`src/pages/UnauthorizedPage.${compExt}`]: `export default function UnauthorizedPage() {
  return (
    <div style="text-align: center; padding: 48px;">
      <h1 style="color: #ef4444;">403 - Forbidden</h1>
      <p style="color: #94a3b8; margin-top: 12px;">You lack the permissions required to access this resource.</p>
    </div>
  );
}
`,

    [`src/pages/NotFoundPage.${compExt}`]: `export default function NotFoundPage() {
  return (
    <div style="text-align: center; padding: 48px;">
      <h1>404 - Page Not Found</h1>
      <p style="color: #94a3b8; margin-top: 12px;">The requested route does not exist.</p>
    </div>
  );
}
`,

    "src/routes.ts": `import type { RouteRecord } from "@mix/router";
import RootLayout from "./layouts/RootLayout.${compExt}";
import HomePage from "./pages/HomePage.${compExt}";
import TasksPage from "./pages/TasksPage.${compExt}";
import FormsPage from "./pages/FormsPage.${compExt}";
import UnauthorizedPage from "./pages/UnauthorizedPage.${compExt}";
import NotFoundPage from "./pages/NotFoundPage.${compExt}";

export const routes: RouteRecord[] = [
  {
    path: "/",
    component: RootLayout,
    children: [
      {
        index: true,
        component: HomePage
      },
      {
        path: "tasks",
        component: TasksPage
      },
      {
        path: "forms",
        component: FormsPage
      },
      {
        path: "admin",
        component: UnauthorizedPage,
        permissions: {
          action: "manage",
          subject: "AdminPanel",
          redirectTo: "/unauthorized"
        }
      },
      {
        path: "unauthorized",
        component: UnauthorizedPage
      },
      {
        path: "*",
        component: NotFoundPage
      }
    ]
  }
];
`,

    "src/main.mix": `import "./styles/global.${styleExt}";
import { mount, computed } from "@mix/runtime";
import { RouterView, createBrowserRouter, createMemoryRouter } from "@mix/router";
import { PermissionProvider } from "@mix/runtime/permissions";
import { routes } from "./routes.js";
import { activeUser } from "./stores/authStore.js";
import { defineAppAbility } from "./permissions/abilities.js";

export default function Main() {
  const ability = computed(() => defineAppAbility(activeUser()));
  const router = typeof window !== "undefined" && window.history
    ? createBrowserRouter({ routes, ability })
    : createMemoryRouter({ routes, ability });

  return (
    <PermissionProvider ability={ability}>
      <RouterView router={router} />
    </PermissionProvider>
  );
}

if (typeof document !== "undefined") {
  mount(Main, document.getElementById("root"));
}
`,

    "tests/unit/abilities.test.mjs": `import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { defineAppAbility } from "../../src/permissions/abilities.js";

describe("Application Permission Capabilities", () => {
  test("Guest has read-only access to PublicContent", () => {
    const ability = defineAppAbility(null);
    assert.strictEqual(ability.can("read", "PublicContent"), true);
    assert.strictEqual(ability.can("read", "Task"), false);
  });

  test("User can read and create tasks", () => {
    const user = { id: 1, name: "Alice", roles: ["user"] };
    const ability = defineAppAbility(user);
    assert.strictEqual(ability.can("read", "Task"), true);
    assert.strictEqual(ability.can("create", "Task"), true);
    assert.strictEqual(ability.can("delete", "Task"), false);
  });

  test("Admin can manage all resources", () => {
    const admin = { id: 99, name: "Admin", roles: ["admin"] };
    const ability = defineAppAbility(admin);
    assert.strictEqual(ability.can("manage", "all"), true);
    assert.strictEqual(ability.can("delete", "Task"), true);
  });
});
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
