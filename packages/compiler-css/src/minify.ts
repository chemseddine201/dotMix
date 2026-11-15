/**
 * @dotmix/compiler-css/minify — Stylesheet minification for production builds.
 *
 * Parses with css-tree and regenerates the stylesheet: comments and the whitespace between rules
 * and declarations are removed. Selectors, at-rule preludes and declaration values are kept as raw
 * text, so strings and url() stay byte-exact.
 */

import * as csstree from "css-tree";

export function minifyStylesheet(css: string): string {
  const stylesheetAst = csstree.parse(css, {
    parseValue: false,
    parseRulePrelude: false,
    parseAtrulePrelude: false,
    parseCustomProperty: false
  });
  return csstree.generate(stylesheetAst);
}
