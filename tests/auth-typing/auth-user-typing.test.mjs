import test from "node:test";
import assert from "node:assert/strict";
import {
  appAuthModule,
  checkTixFile,
  checkTypeScriptProject,
  createAuthProject,
  handWrittenRegistration,
  registrationWithTypeof,
  removeProject,
  typeHint
} from "./auth-typing-project.mjs";

function blockComponent(templateBody) {
  return `export default function AccountPanel() {
  return (
    <section>
      ${templateBody}
    </section>
  );
}
`;
}

function errorsOf(diagnostics) {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

function withProject(files, run) {
  const projectDirectory = createAuthProject(files);
  try {
    run(projectDirectory);
  } finally {
    removeProject(projectDirectory);
  }
}

test("registered auth with typeof: {auth as user} reads the default guard user", () => {
  withProject(
    {
      "auth/appAuth.ts": appAuthModule,
      "env.d.ts": registrationWithTypeof,
      "AccountPanel.tix": blockComponent(`{auth as user}<p>{user.email}</p>{endauth}`)
    },
    (projectDirectory) => {
      assert.deepEqual(checkTixFile(projectDirectory, "AccountPanel.tix"), []);
    }
  );
});

test("registered auth with typeof: {auth \"admin\" as user} reads the admin guard user", () => {
  withProject(
    {
      "auth/appAuth.ts": appAuthModule,
      "env.d.ts": registrationWithTypeof,
      "AccountPanel.tix": blockComponent(`{auth "admin" as user}<p>{user.permissions.length}</p>{endauth}`)
    },
    (projectDirectory) => {
      assert.deepEqual(checkTixFile(projectDirectory, "AccountPanel.tix"), []);
    }
  );
});

test("registered auth with typeof: the default guard user has no admin fields", () => {
  withProject(
    {
      "auth/appAuth.ts": appAuthModule,
      "env.d.ts": registrationWithTypeof,
      "AccountPanel.tix": blockComponent(`{auth as user}<p>{user.permissions}</p>{endauth}`)
    },
    (projectDirectory) => {
      const errors = errorsOf(checkTixFile(projectDirectory, "AccountPanel.tix"));
      assert.equal(errors.length, 1, JSON.stringify(errors, null, 2));
      assert.match(errors[0].message, /permissions/);
      assert.match(errors[0].message, /Customer/);
    }
  );
});

test("hand-written AuthInstanceOf registration types user.email", () => {
  withProject(
    {
      "auth/appAuth.ts": appAuthModule,
      "env.d.ts": handWrittenRegistration,
      "AccountPanel.tix": blockComponent(`{auth as user}<p>{user.email}</p>{endauth}`)
    },
    (projectDirectory) => {
      assert.deepEqual(checkTixFile(projectDirectory, "AccountPanel.tix"), []);
    }
  );
});

test("same-file AuthProvider without registration gives per-guard user types", () => {
  const panelSource = `import { AuthProvider } from "@dotmix/runtime/directives";
import { appAuth } from "./auth/appAuth.js";

export default function AccountPanel() {
  return (
    <AuthProvider value={appAuth}>
      {auth as customer}<p>{customer.email}</p>{endauth}
      {auth "admin" as admin}<p>{admin.permissions.length}</p>{endauth}
    </AuthProvider>
  );
}
`;
  withProject(
    { "auth/appAuth.ts": appAuthModule, "AccountPanel.tix": panelSource },
    (projectDirectory) => {
      assert.deepEqual(checkTixFile(projectDirectory, "AccountPanel.tix"), []);
    }
  );
});

test("annotated <Auth> callback parameter types the user without registration", () => {
  const panelSource = `import { Auth } from "@dotmix/runtime/directives";
import type { AdminUser } from "./auth/appAuth.js";

export default function AccountPanel() {
  return (
    <section>
      <Auth guard="admin">{(user: AdminUser) => <p>{user.permissions.length}</p>}</Auth>
    </section>
  );
}
`;
  withProject(
    { "auth/appAuth.ts": appAuthModule, "AccountPanel.tix": panelSource },
    (projectDirectory) => {
      assert.deepEqual(checkTixFile(projectDirectory, "AccountPanel.tix"), []);
    }
  );
});

test("annotated <Auth> callback must accept the registered guard user", () => {
  const panelSource = `import { Auth } from "@dotmix/runtime/directives";
import type { AdminUser } from "./auth/appAuth.js";

export default function AccountPanel() {
  return (
    <section>
      <Auth guard="web">{(user: AdminUser) => <p>{user.permissions.length}</p>}</Auth>
    </section>
  );
}
`;
  withProject(
    {
      "auth/appAuth.ts": appAuthModule,
      "env.d.ts": registrationWithTypeof,
      "AccountPanel.tix": panelSource
    },
    (projectDirectory) => {
      const errors = errorsOf(checkTixFile(projectDirectory, "AccountPanel.tix"));
      assert.equal(errors.length, 1, JSON.stringify(errors, null, 2));
      assert.match(errors[0].message, /Customer/);
      assert.match(errors[0].message, /AdminUser/);
    }
  );
});

test("without registration or provider, property access on user reports the typing hint", () => {
  withProject(
    { "AccountPanel.tix": blockComponent(`{auth as user}<p>{user.name}</p>{endauth}`) },
    (projectDirectory) => {
      const errors = errorsOf(checkTixFile(projectDirectory, "AccountPanel.tix"));
      assert.equal(errors.length, 1, JSON.stringify(errors, null, 2));
      assert.ok(errors[0].message.includes(typeHint), errors[0].message);
    }
  );
});

test("useAuth().user(\"admin\") is typed from the registration in a .ts module", () => {
  const permissionCount = `import { useAuth } from "@dotmix/runtime/directives";

export function adminPermissionCount(): number {
  const auth = useAuth();
  const permissions: readonly string[] | undefined = auth.user("admin")?.permissions;
  return permissions?.length ?? 0;
}

export function customerEmail(): string | undefined {
  return useAuth().user()?.email;
}
`;
  withProject(
    {
      "auth/appAuth.ts": appAuthModule,
      "env.d.ts": registrationWithTypeof,
      "permissionCount.ts": permissionCount
    },
    (projectDirectory) => {
      assert.deepEqual(checkTypeScriptProject(projectDirectory), []);
    }
  );
});
