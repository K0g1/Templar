import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const tag = process.argv[2];
if (!tag) throw new Error('Pass the release version to verify:ship.');

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

run('npm', ['run', 'lint']);
run('npm', ['run', 'typecheck:runtime']);
run('npm', ['run', 'typecheck:test']);
run('npm', ['run', 'typecheck:tooling']);
run('npm', ['test']);
run('npm', ['run', 'build']);
run('npm', ['run', 'verify:mobile']);
run('npm', ['run', 'verify:privacy']);
run('npm', ['audit', '--audit-level=moderate']);
run('npm', ['audit', '--omit=dev', '--audit-level=moderate']);

const artifactNames = ['main.js', 'manifest.json', 'styles.css'];
for (const name of artifactNames) {
  const path = resolve(name);
  if (!existsSync(path)) throw new Error(`Missing release artifact: ${name}`);
}
const checksums = artifactNames.map((name) => {
  const hash = createHash('sha256').update(readFileSync(name)).digest('hex');
  return `${hash}  ${name}`;
});
writeFileSync('SHA256SUMS.txt', `${checksums.join('\n')}\n`);

run('npm', ['run', 'verify:release', '--', tag]);
run('npm', ['run', 'verify:brat', '--', tag]);
run('git', ['diff', '--check']);
console.log('Ship gate verified and SHA256SUMS.txt generated.');
