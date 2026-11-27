import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareExpressionTokens } from "../../packages/compiler-frontend/dist/index.js";
import { loadOracle } from "../fixtures/gate43/helpers.mjs";

const PAIRS = [
  // Whitespace & formatting
  ["a", "a"],
  ["a", "  a  "],
  ["a.b", "a . b"],
  ["a.b.c", "a\n.\tb\n.c"],
  ["fn(1, 2)", "fn( 1 , 2 )"],
  ["a + b", "a+b"],
  ["a + b * c", "a+b*c"],
  ["props.tag", "props . tag"],
  ["items[0]", "items[ 0 ]"],
  ["a?.b?.c", "a ?. b ?. c"],
  ["(a + b)", "( a + b )"],
  ["{ a: 1, b: 2 }", "{a:1,b:2}"],
  ["[1, 2, 3]", "[ 1 , 2 , 3 ]"],
  ["x => x + 1", "x=>x+1"],
  ["(x: number) => x", "( x : number ) => x"],
  ["a as string", "a   as   string"],
  ["a satisfies T", "a   satisfies   T"],
  ["a!", "a !"],
  ["<T>a", "< T > a"],
  ["import.meta.url", "import . meta . url"],
  // Comments ignored
  ["a + b", "a /* sum */ + b"],
  ["a + b", "/* lead */ a + b /* trail */"],
  ["a + b", "a // add\n + b"],
  ["props.tag", "props /* p */ . /* dot */ tag"],
  ["fn(1, 2)", "fn(1 /* a */, /* b */ 2)"],
  ["a ? b : c", "a /* ? */ ? b /* : */ : c"],
  ["{ a: 1 }", "{ /* } */ a: 1 }"],
  ["a && b", "a // }\n && b"],
  ["tagName()", "tagName( /* empty */ )"],
  ["a ?? b", "a /* nullish */ ?? b"],
  // Quotes & strings
  ["\"div\"", "'div'"],
  ["\"hello\"", "'hello'"],
  ["\"\"", "''"],
  ["\"a\\nb\"", "'a\\nb'"],
  ["\"a\\\"b\"", "'a\"b'"],
  ["'a\\'b'", "\"a'b\""],
  ["\"}\"", "'}'"],
  ["\"hello\"", "\"world\""],
  ["\"div\"", "`div`"],
  ["\"1\"", "1"],
  ["\"true\"", "true"],
  ["\"a\"", "\"A\""],
  ["'foo\\tbar'", "\"foo\\tbar\""],
  ["\"\\u0041\"", "'A'"],
  ["\"\\x41\"", "'A'"],
  // Numbers & BigInts
  ["1", "1"],
  ["1", "1.0"],
  ["10", "0xa"],
  ["10", "0b1010"],
  ["10", "0o12"],
  ["1000", "1_000"],
  ["1000", "1e3"],
  ["0.5", ".5"],
  ["1", "2"],
  ["1n", "1n"],
  ["10n", "0xan"],
  ["1000n", "1_000n"],
  ["1n", "1"],
  ["1n", "2n"],
  ["0", "-0"],
  // Templates
  ["`hello`", "`hello`"],
  ["`hello`", "`world`"],
  ["`a ${x} b`", "`a ${ x } b`"],
  ["`a ${x + 1}`", "`a ${ x /* c */ + 1 }`"],
  ["`a ${x}`", "`a ${y}`"],
  ["`a ${`b ${c}`}`", "`a ${ `b ${ c }` }`"],
  ["tag`a ${1}`", "tag `a ${ 1 }`"],
  ["`\\n`", "`\\n`"],
  ["`a}`", "`a}`"],
  ["`a}`", "`a)`"],
  // Regex vs division
  ["/abc/g", "/abc/g"],
  ["/abc/g", "/abc/i"],
  ["/abc/g", "/def/g"],
  ["a / b", "a/b"],
  ["a / b / c", "a / /* d */ b / c"],
  ["a / b", "a * b"],
  ["/}/g.test(s)", "/}/g . test( s )"],
  ["1 / /a/.source.length", "1 / /a/ . source . length"],
  // Keywords, identifiers, operators
  ["a", "b"],
  ["a.b", "a.c"],
  ["a.b", "a[b]"],
  ["a.b", "a['b']"],
  ["a == b", "a === b"],
  ["a != b", "a !== b"],
  ["a && b", "a || b"],
  ["a || b", "a ?? b"],
  ["a + b", "a - b"],
  ["++a", "a++"],
  ["a++", "a--"],
  ["a << b", "a >> b"],
  ["a >> b", "a >>> b"],
  ["a = b", "a == b"],
  ["a += b", "a -= b"],
  ["true", "false"],
  ["null", "undefined"],
  ["this.a", "this.a"],
  ["this.a", "self.a"],
  ["new A()", "new A( )"],
  ["new A()", "A()"],
  ["typeof a", "typeof (a)"],
  ["void 0", "void 1"],
  ["'k' in obj", "\"k\" in obj"],
  ["a instanceof B", "a instanceof C"],
  ["a, b", "a, b, c"],
  ["...a", "... a"],
  ["fn<A>(x)", "fn< A >( x )"],
  ["fn<A>(x)", "fn<B>(x)"],
  // Different lengths / empty / invalid
  ["", ""],
  ["", "   "],
  ["a", ""],
  ["a + b", "a +"],
  ["\"unterminated", "\"unterminated"],
  ["/* unterminated", "a"],
  ["`unterm", "`unterm"],
  ["a", "a;"]
];

describe("Gate 43 T4 — compareExpressionTokens Parity (R7)", () => {
  it("matches oracle true/false result on >= 100 pairs", () => {
    const oracle = loadOracle();
    assert.ok(PAIRS.length >= 100, `Expected >= 100 pairs, got ${PAIRS.length}`);
    assert.strictEqual(PAIRS.length, oracle.t4Pairs.length);

    for (let i = 0; i < PAIRS.length; i++) {
      const [exprA, exprB] = PAIRS[i];
      const expected = oracle.t4Pairs[i];
      assert.strictEqual(expected.a, exprA);
      assert.strictEqual(expected.b, exprB);

      const tsResult = compareExpressionTokens(exprA, exprB);
      assert.strictEqual(
        tsResult,
        expected.equal,
        `compareExpressionTokens mismatch on pair[${i}] (${JSON.stringify(exprA)} vs ${JSON.stringify(exprB)}): expected ${expected.equal}, got ${tsResult}`
      );
    }
  });
});
