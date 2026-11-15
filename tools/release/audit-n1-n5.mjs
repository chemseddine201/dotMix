/* global console */
import fs from 'node:fs';
import path from 'node:path';

function scan(dir) {
  const list = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') list.push(...scan(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      list.push(full);
    }
  }
  return list;
}

const files = scan('packages');
let lineViolations = 0;
let n5Hits = 0;

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n').length;
  if (lines > 500) {
    console.log('LINE VIOLATION:', f, lines);
    lineViolations++;
  }
  if (f.includes(path.sep + 'src' + path.sep) && !f.includes('test')) {
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '');
    const re = /\b(stub|mock|fake)\b/gi;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      console.log('N5 audit hit in code:', f, m[0]);
      n5Hits++;
    }
  }
}

console.log(`Packages scanned: ${files.length}, Line violations: ${lineViolations}, N5 hits: ${n5Hits}`);

