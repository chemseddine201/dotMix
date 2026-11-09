import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import * as runtimeExports from "@mix/runtime";
import * as permissionsExports from "@mix/runtime/permissions";
import * as formsExports from "@mix/runtime/forms";
import * as routerExports from "@mix/router";
import * as syncExports from "@mix/sync";

describe("Gate 27 (T-27.4 / D-131): Real Package .d.ts & Relative Module Resolution in typecheckTix", () => {
  test("1. Resolves @mix/runtime, @mix/runtime/permissions, @mix/router, @mix/sync, relative .ts, and sibling .tix from disk with 0 diagnostics", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-real-types-"));
    try {
      const buttonPath = path.join(tmpDir, "Button.tix");
      const buttonSrc = `export interface ButtonProps {
  label: string;
  variant?: "primary" | "ghost";
}

export default function Button(props: ButtonProps) {
  return <button class={props.variant ?? "primary"}>{props.label}</button>;
}
`;
      fs.writeFileSync(buttonPath, buttonSrc, "utf8");

      const storePath = path.join(tmpDir, "store.ts");
      const storeSrc = `import { syncCollection } from "@mix/sync";
export interface ItemRecord {
  id: string;
  title: string;
}
export const itemStore = syncCollection<ItemRecord>({
  key: "items",
  initialItems: [{ id: "1", title: "First" }]
});
`;
      fs.writeFileSync(storePath, storeSrc, "utf8");

      const pagePath = path.join(tmpDir, "Page.tix");
      const pageSrc = `import { signal, createForm, validators } from "@mix/runtime";
import { Can, defineAbility } from "@mix/runtime/permissions";
import { NavLink } from "@mix/router";
import Button from "./Button.tix";
import { itemStore } from "./store.js";

export default function Page() {
  const count = signal(0);
  const ability = defineAbility((can) => {
    can("create", "Item");
  });
  const form = createForm({
    initialValues: { title: "" },
    validators: {
      title: [validators.required("Title is required")]
    },
    onSubmit: async () => {}
  });
  const items = itemStore.items;

  return (
    <section>
      <NavLink to="/items" end={true}>Items ({count()})</NavLink>
      <Can I="create" a="Item" ability={ability}>
        <Button label={form.fields.title.value()} variant="primary" />
      </Can>
      <ul>
        {each (item, idx) in items()}
          <li key={item.id}>{idx}: {item.title}</li>
        {endeach}
      </ul>
    </section>
  );
}
`;
      fs.writeFileSync(pagePath, pageSrc, "utf8");

      const ast = parse(pageSrc, { filename: pagePath.replace(/\\/g, "/") });
      const desc = analyze(ast, { filename: pagePath.replace(/\\/g, "/"), source: pageSrc, throwOnError: false });
      const res = typecheckTix(desc, pageSrc, { filename: pagePath.replace(/\\/g, "/"), throwOnError: false });

      assert.strictEqual(
        res.diagnostics.length,
        0,
        `Expected 0 diagnostics, got:\n${JSON.stringify(res.diagnostics, null, 2)}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("2. Diagnoses MIX_ERR_INVALID_PROP_TYPE when passing invalid prop types to a disk-resolved sibling .tix component", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-real-types-err-"));
    try {
      const buttonPath = path.join(tmpDir, "Button.tix");
      const buttonSrc = `export interface ButtonProps {
  label: string;
}

export default function Button(props: ButtonProps) {
  return <button>{props.label}</button>;
}
`;
      fs.writeFileSync(buttonPath, buttonSrc, "utf8");

      const parentPath = path.join(tmpDir, "Parent.tix");
      const parentSrc = `import Button from "./Button.tix";

export default function Parent() {
  return (
    <div>
      <Button label={42} />
    </div>
  );
}
`;
      fs.writeFileSync(parentPath, parentSrc, "utf8");

      const ast = parse(parentSrc, { filename: parentPath });
      const desc = analyze(ast, { filename: parentPath, source: parentSrc, throwOnError: false });
      const res = typecheckTix(desc, parentSrc, { filename: parentPath, throwOnError: false });

      assert.ok(res.diagnostics.length > 0, "Expected at least 1 prop type diagnostic");
      assert.ok(
        res.diagnostics.some((d) => d.code === "MIX_ERR_INVALID_PROP_TYPE"),
        `Expected MIX_ERR_INVALID_PROP_TYPE in ${JSON.stringify(res.diagnostics)}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("3. Runtime export surface parity guard: every runtime export in @mix/runtime, /permissions, /forms, @mix/router, and @mix/sync resolves in typecheckTix", () => {
    const packages = [
      { spec: "@mix/runtime", mod: runtimeExports },
      { spec: "@mix/runtime/permissions", mod: permissionsExports },
      { spec: "@mix/runtime/forms", mod: formsExports },
      { spec: "@mix/router", mod: routerExports },
      { spec: "@mix/sync", mod: syncExports },
    ];

    for (const pkg of packages) {
      const exportNames = Object.keys(pkg.mod).filter((k) => k !== "default");
      assert.ok(exportNames.length > 0, `Expected non-empty exports for ${pkg.spec}`);

      const aliases = exportNames.map((name, idx) => `${name} as _exp_${idx}`);
      const voidRefs = exportNames.map((_, idx) => `void _exp_${idx};`).join("\n  ");

      const tixSrc = `import { ${aliases.join(", ")} } from "${pkg.spec}";

export default function ParityCheck() {
  ${voidRefs}
  return <div>ok</div>;
}
`;
      const ast = parse(tixSrc, { filename: "ParityCheck.tix" });
      const desc = analyze(ast, { filename: "ParityCheck.tix", source: tixSrc, throwOnError: false });
      const res = typecheckTix(desc, tixSrc, { filename: "ParityCheck.tix", throwOnError: false });

      assert.strictEqual(
        res.diagnostics.length,
        0,
        `Runtime export surface drift detected in ${pkg.spec}:\n${JSON.stringify(res.diagnostics, null, 2)}`
      );
    }
  });
});
