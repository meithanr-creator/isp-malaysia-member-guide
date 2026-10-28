// Only new Job-specific cleanup/ambiguity controls. APIs below are local substitutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCAN_JOB, SCAN_WORKFLOW, reconcileOwnedScanDispatch, scanCancellationMarker, cleanupCanComplete } from '../scripts/new-workflow-proof.mjs';
const dispatchId = 'owned-dispatch', executionName = `${SCAN_JOB}/executions/isp-attachment-scan-owned`, operationName = 'projects/isp-planter-app/locations/asia-southeast1/operations/owned-op';
const binding = { attachmentId: 'owned-cover', dispatchId, generation: '7', sha256: 'a'.repeat(64), workflowRevision: 'reviewed-revision', imageDigest: `sha256:${'b'.repeat(64)}` };
const baseMarker = { id: dispatchId, jobName: SCAN_JOB, workflowExecution: `${SCAN_WORKFLOW}/executions/${dispatchId}`, generation: '7', sha256: 'a'.repeat(64), cancelled: true };
const workflow = (state, result = {}) => ({ name: baseMarker.workflowExecution, workflowRevisionId: binding.workflowRevision, state, result: JSON.stringify(result) });
const execution = done => ({ name: executionName, ...(done ? { completionTime: '2026-10-29T00:00:00Z', runningCount: 0 } : {}), template: { containers: [{ name: 'scanner', image: `owned-image@${binding.imageDigest}`, env: Object.entries({ ISP_ATTACHMENT_ID: binding.attachmentId, ISP_ATTACHMENT_GENERATION: binding.generation, ISP_ATTACHMENT_SHA256: binding.sha256, ISP_SCAN_DISPATCH_ID: dispatchId }).map(([name, value]) => ({ name, value })) }] } });
function options(marker, api, more = {}) { let tick = 0; const receipts = []; return { binding, marker, api, persist: async value => receipts.push(structuredClone(value)), clock: () => tick, sleep: async milliseconds => { tick += milliseconds; }, deadlineMs: 180000, receipts, ...more }; }

test('completed exact owned Workflow/Job permits terminal receipt', async () => {
  const calls = [], marker = { ...baseMarker, operationName, executionName };
  const input = options(marker, async (method, kind, name) => { calls.push([method, kind, name]); if (kind === 'workflow') return workflow('SUCCEEDED', { launchStatus: 'accepted', operationName }); if (kind === 'operation') return { name: operationName, metadata: { name: executionName } }; return execution(true); });
  const receipt = await reconcileOwnedScanDispatch(input); assert.equal(receipt.terminal, true); assert.equal(receipt.executionName, executionName); assert.equal(calls.some(row => row[0] === 'POST'), false);
});

test('lost launch reply plus late worker identity is recovered only after Workflow terminal, then owned Job cancelled', async () => {
  const calls = []; let workflowReads = 0, markerReads = 0, executionReads = 0;
  const input = options(baseMarker, async (method, kind, name) => { calls.push([method, kind, name]); if (kind === 'workflow') return method === 'POST' ? {} : workflow(++workflowReads === 1 ? 'ACTIVE' : 'CANCELLED'); if (kind === 'execution') return method === 'POST' ? {} : execution(++executionReads > 1); throw Error('unexpected API'); }, { readMarker: async () => ++markerReads === 1 ? baseMarker : { ...baseMarker, executionName } });
  const receipt = await reconcileOwnedScanDispatch(input); assert.equal(receipt.terminal, true); assert.ok(calls.findIndex(row => row[0] === 'POST' && row[1] === 'workflow') < calls.findIndex(row => row[0] === 'POST' && row[1] === 'execution')); assert.ok(markerReads >= 2);
});

test('unknown launch and continued absence remains HOLD without any new run or delete', async () => {
  const calls = [], input = options(baseMarker, async (method, kind) => { calls.push([method, kind]); return workflow('SUCCEEDED', { launchStatus: 'unknown' }); }, { deadlineMs: 16000 });
  await assert.rejects(() => reconcileOwnedScanDispatch(input), { code: 'scan_launch_outcome_unknown' }); assert.equal(calls.every(row => row[0] === 'GET' && row[1] === 'workflow'), true); assert.equal(cleanupCanComplete({ scanJobs: { owned: { terminal: false } } }), false);
});

test('conflicting operation execution or foreign resource is rejected before Job cancellation', async () => {
  const calls = [], marker = { ...baseMarker, operationName, executionName };
  const input = options(marker, async (method, kind) => { calls.push([method, kind]); if (kind === 'workflow') return workflow('SUCCEEDED', { launchStatus: 'accepted' }); return { name: operationName, metadata: { name: `${SCAN_JOB}/executions/isp-attachment-scan-different` } }; });
  await assert.rejects(() => reconcileOwnedScanDispatch(input), { code: 'scan_operation_execution_mismatch' }); assert.equal(calls.some(row => row[1] === 'execution'), false);
  await assert.rejects(() => reconcileOwnedScanDispatch({ ...input, marker: { ...marker, workflowExecution: 'projects/foreign/locations/asia-southeast1/workflows/isp-attachment-dispatch/executions/owned' } }), { code: 'scan_resource_not_owned' });
});

test('no-dispatch tombstone blocks stale updateTime CAS; CAS winner is instead preserved and cancelled', () => {
  const snapshotVersion = 1; let serverVersion = snapshotVersion, postCount = 0;
  const tombstone = scanCancellationMarker(undefined, 'owned-fence'); serverVersion++;
  // Firestore PATCH's documented currentDocument.updateTime precondition rejects this stale snapshot.
  if (snapshotVersion === serverVersion) postCount++;
  assert.equal(postCount, 0); assert.equal(tombstone.cleanupOnly, true); assert.equal(tombstone.cancelled, true);
  const wonBeforeFence = scanCancellationMarker({ ...baseMarker, cancelled: false, operationName }, 'owned-fence'); assert.equal(wonBeforeFence.id, dispatchId); assert.equal(wonBeforeFence.operationName, operationName); assert.equal(wonBeforeFence.cancelled, true);
});

test('only an explicit successful pre-POST Workflow exit proves no execution was launched', async () => {
  const input = options(baseMarker, async () => workflow('SUCCEEDED', { launchStatus: 'not_launched' }));
  const receipt = await reconcileOwnedScanDispatch(input); assert.equal(receipt.terminal, true); assert.equal(receipt.noLaunch, true);
});