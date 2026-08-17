import { spawn } from 'node:child_process';

const child = spawn(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.overhead.config.ts'],
  { stdio: 'inherit', env: process.env },
);
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
