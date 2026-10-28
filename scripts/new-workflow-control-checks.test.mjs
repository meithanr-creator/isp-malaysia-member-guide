// Only local substituted runner-control checks. No Firebase imports, credentials or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { acquireWorkflowLocks, pendingAdmission, executionBudget, trackedMutation, unresolvedMutations, cleanupCanComplete, applyTerminalEvidence, markInterruptedMutations } from './new-workflow-proof.mjs';

const planSha256 = '0'.repeat(64);
test('normal terminal response closes its durable intent; explicit atomic rejection is terminal', async () => {
  const attempt = { number: 1 }, states = [];
  const persist = async () => states.push(structuredClone(attempt));
  let calls = 0, storedReceipt;
  const response = await trackedMutation(attempt, persist, planSha256, 'client-signup', { email: 'owned-local@example.invalid' }, async () => {
    calls++; assert.equal(states.at(-1).mutations[0].state, 'in-flight'); return { uid: 'owned-local' };
  }, result => { storedReceipt = result.uid; });
  assert.equal(response.uid, storedReceipt); assert.equal(calls, 1); assert.equal(states.at(-1).mutations[0].state, 'acknowledged'); assert.equal(cleanupCanComplete(attempt), true);
  await assert.rejects(() => trackedMutation(attempt, persist, planSha256, 'call:publishContentDraft', { recordId: 'owned-local' }, async () => { throw Object.assign(new Error('substituted'), { code: 'functions/failed-precondition' }); }));
  assert.equal(attempt.mutations.at(-1).state, 'rejected'); assert.equal(cleanupCanComplete(attempt), true);
});

test('exclusive project/journal lock rejects concurrent admission; pending marker blocks another journal', async () => {
  const base = resolve(process.env.TEMP ?? ''); assert.match(base, /^D:[\\/]/i);
  const temporary = await mkdtemp(join(base, 'isp-workflow-controls-'));
  const inside = relative(base, resolve(temporary)); assert.ok(!inside.startsWith('..') && !isAbsolute(inside) && inside.startsWith('isp-workflow-controls-'));
  let lock;
  try {
    const journal = join(temporary, 'journal.json'), other = join(temporary, 'other.json'), marker = join(temporary, 'pending.json');
    lock = await acquireWorkflowLocks(journal, temporary);
    await Promise.all([assert.rejects(() => acquireWorkflowLocks(journal, temporary), { code: 'workflow_execution_lock_held' }), assert.rejects(() => acquireWorkflowLocks(other, temporary), { code: 'workflow_execution_lock_held' })]);
    await pendingAdmission(marker, journal, false); await lock.release(); lock = null;
    lock = await acquireWorkflowLocks(other, temporary);
    await assert.rejects(() => pendingAdmission(marker, other, false), { code: 'project_has_unfinished_owned_workflow' });
    await pendingAdmission(marker, journal, true); await unlink(marker);
  } finally { if (lock) await lock.release(); await rm(temporary, { recursive: true, force: true }); }
});

test('delayed signup/upload after first absence stay UNKNOWN without exact operation terminal evidence', async () => {
  const attempt = { number: 2 }, remote = new Set(), delayed = [], calls = {};
  for (const name of ['client-signup', 'client-upload']) {
    await assert.rejects(() => trackedMutation(attempt, async () => {}, planSha256, name, { owned: name }, async () => {
      calls[name] = (calls[name] ?? 0) + 1; delayed.push(() => remote.add(name)); throw Object.assign(new Error('substituted lost reply'), { code: 'network-error' });
    }));
    assert.equal(remote.has(name), false); assert.equal(cleanupCanComplete(attempt), false);
  }
  delayed.forEach(complete => complete()); assert.equal(remote.size, 2); assert.equal(cleanupCanComplete(attempt), false); assert.deepEqual(Object.values(calls), [1, 1]);
  applyTerminalEvidence(attempt, planSha256, [{ id: 'generic-root-claim', terminalEvidenceSha256: 'a'.repeat(64) }]); assert.equal(unresolvedMutations(attempt).length, 2);
  const evidence = attempt.mutations.map((item, index) => ({ id: item.id, attempt: attempt.number, planSha256, intentSha256: item.intentSha256, terminalResponse: true, outcome: 'succeeded', terminalEvidenceSha256: String(index + 1).repeat(64), providerEvidenceId: `substituted-terminal-${index}`, observedAt: new Date().toISOString() }));
  applyTerminalEvidence(attempt, planSha256, evidence); remote.clear(); assert.equal(cleanupCanComplete(attempt), true);
  attempt.mutations.push({ state: 'in-flight', id: 'interrupted' });
  const journal = { attempts: [attempt], results: Object.fromEntries(['enrollment_registry', 'events_interest', 'discover', 'consultation', 'suspension_restoration', 'private_files'].map(area => [area, { status: 'RUNNING' }])) };
  markInterruptedMutations(journal); assert.equal(attempt.mutations.at(-1).state, 'unknown'); assert.equal(journal.cleanupRequired, true); assert.equal(attempt.cleanupComplete, false); assert.equal(cleanupCanComplete(attempt), false);
});

test('one total budget includes internal cleanup and the single recovery window', () => {
  const budget = executionBudget(1800, 180);
  assert.equal(budget.main + budget.recovery, budget.total); assert.equal(budget.work + budget.recovery, budget.main);
  assert.equal(budget.total, 1800000); assert.throws(() => executionBudget(300, 180), { code: 'execution_bound_must_reserve_work_and_cleanup' });
});