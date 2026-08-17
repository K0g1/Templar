import { spawn } from 'node:child_process';

const runNumber = process.env.TEMPLAR_PROFILE_RUN ?? '1';
const child = spawn(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.profile.config.ts'],
  { stdio: 'inherit', env: { ...process.env, TEMPLAR_PROFILE_RUN: runNumber } },
);
child.on('exit', (code, signal) => {
  if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 1;
});
