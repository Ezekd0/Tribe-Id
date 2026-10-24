import { execute, runChecks, checkPlan } from './ci-plan.mjs';

const names = process.argv.slice(2);
try {
  await runChecks(names.length ? names : Object.keys(checkPlan), execute);
} catch (error) {
  // Command errors may contain private environment details; emit only our known messages.
  console.error(error instanceof Error && /^CI \w+ failed \(exit \d+\)$|^Unknown CI check$/.test(error.message) ? error.message : 'CI runner failed to start a required check.');
  process.exitCode = 1;
}
