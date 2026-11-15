/**
 * @dotmix/compiler-semantic/directives/project-auth — Type projection of the user bound by
 * `{auth [guard] as name}` and `<Auth guard="...">{(name: Type) => ...}</Auth>`.
 *
 * The bound user type is resolved in this order:
 *   1. the annotated callback parameter (checked against the guard user type when that is known);
 *   2. the nearest `<AuthProvider value={...}>` of the same file, per guard;
 *   3. the application's `Register.auth`, per guard;
 *   4. otherwise `unknown`.
 */

import type { AuthBlockNode, SourceSpan } from "@dotmix/ast";
import type { ProjectionCallbacks } from "./project-directives.js";

export const REGISTERED_AUTH_TYPE = `import("@dotmix/runtime/directives").RegisteredAuth`;

export const AUTH_USER_TYPE_HINT =
  "Type the auth user: register it in src/env.d.ts (interface Register { auth: ... }), wrap the block in <AuthProvider value={...}>, or annotate the parameter in <Auth>{(user: User) => ...}</Auth>.";

/** The guard name written as a string literal in the directive, or null for the default guard. */
export function readLiteralGuardName(node: AuthBlockNode): string | null {
  const guardExpression = node.guard as { readonly type?: string; readonly value?: unknown } | null;
  if (guardExpression && guardExpression.type === "Literal" && typeof guardExpression.value === "string") {
    return guardExpression.value;
  }
  return null;
}

/**
 * Emits the scoped declaration of the bound user and the template checks of the authenticated
 * branch. The caller has already checked that `node.asIdentifier` is set.
 */
export function projectAuthUserBinding(
  node: AuthBlockNode,
  bindingName: string,
  inSvg: boolean,
  callbacks: ProjectionCallbacks,
  internalId: number
): void {
  const emitOrigin = (text: string, originSpan: SourceSpan): void => {
    if (callbacks.appendOrigin) callbacks.appendOrigin(text, originSpan);
    else callbacks.appendInternal(text);
  };
  const instanceBinding = `__mix_auth_instance_${internalId}`;
  const guardUserBinding = `__mix_auth_guard_user_${internalId}`;
  const guardUserType = `Exclude<typeof ${guardUserBinding}, null | undefined>`;
  const provider = callbacks.activeAuthProviderExpr;

  callbacks.appendInternal(`  {\n    const ${instanceBinding} = `);
  if (provider) {
    callbacks.appendInternal(`(${provider.raw});\n`);
  } else {
    callbacks.appendInternal(`undefined as unknown as ${REGISTERED_AUTH_TYPE};\n`);
    callbacks.recordRegisteredAuthBinding?.(bindingName);
  }

  const guardName = readLiteralGuardName(node);
  callbacks.appendInternal(`    const ${guardUserBinding} = ${instanceBinding}.user(`);
  if (guardName !== null) emitOrigin(JSON.stringify(guardName), node.span);
  callbacks.appendInternal(`);\n    void ${guardUserBinding};\n    {\n      const `);
  emitOrigin(bindingName, node.span);

  const annotation = node.asTypeAnnotation;
  if (annotation) {
    callbacks.appendInternal(": ");
    callbacks.appendVerbatim(annotation.raw, annotation.start);
    callbacks.appendInternal(
      ` = undefined as unknown as (unknown extends ${guardUserType} ? (${annotation.raw}) : ${guardUserType});\n`
    );
  } else {
    callbacks.appendInternal(` = ${guardUserBinding} as ${guardUserType};\n`);
  }
  callbacks.appendInternal(`      void ${bindingName};\n`);
  callbacks.emitTemplateChecks(node.consequent, inSvg);
  callbacks.appendInternal("    }\n  }\n");
}
