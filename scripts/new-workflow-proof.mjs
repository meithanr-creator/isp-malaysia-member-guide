/** Source-only focused workflow proof. Default is a local plan; never run on import. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, realpath, unlink, rmdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE = resolve(ROOT, 'audit/private');
const PROJECT = 'isp-planter-app', REGION = 'asia-southeast1';
const BUCKET = `${PROJECT}.firebasestorage.app`;
const AREAS = ['enrollment_registry', 'events_interest', 'discover', 'consultation', 'suspension_restoration', 'private_files'];
const LABEL = 'TEST - transient proof only; not a real ISP event or publication';
const SOURCE_FILES = ['functions/src/index.ts', 'functions/src/runtime.ts', 'functions/src/content.ts', 'functions/src/download.ts', 'functions/src/enrollment.ts', 'functions/src/registry.ts', 'functions/src/validation.ts', 'firestore.rules', 'storage.rules', 'scanner/scanner.py', 'scanner/mirror.py', 'scanner/policy.py', 'scanner/validate_file.py', 'scanner/Dockerfile', 'scanner/requirements.txt', 'scanner/job_entry.py', 'infra/scanner-dispatch-workflow.yaml', 'scripts/new-workflow-proof.mjs'];
const args = process.argv.slice(2);
const mode = args.find(value => ['--plan', '--prepare', '--execute', '--cleanup', '--worker', '--cleanup-worker'].includes(value)) ?? '--plan';
assert.equal(args.filter(value => value.startsWith('--') && !value.includes('=')).length, mode === '--plan' && !args.length ? 0 : 1, 'Choose one explicit mode.');
assert.ok(args.every(value => ['--plan', '--prepare', '--execute', '--cleanup', '--worker', '--cleanup-worker'].includes(value) || /^--(?:journal|release)=.+/.test(value)), 'Unknown argument.');
const option = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => digest(canonical(value));
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
function check(condition, code) { if (!condition) { const error = new Error(code); error.code = code; throw error; } }
function safeCode(error) { return /^[a-zA-Z0-9_/-]{1,100}$/.test(error?.code ?? '') ? error.code : 'proof_assertion_failed'; }
async function privatePath(input, exists = true) {
  check(typeof input === 'string' && /^D:[\\/]/i.test(input), 'private_path_must_be_on_D');
  const path = resolve(input), parent = await realpath(exists ? path : dirname(path));
  const root = await realpath(PRIVATE), inside = relative(root, parent);
  check(path.toLowerCase().endsWith('.json'), 'private_JSON_file_required');
  check(!inside.startsWith('..') && !isAbsolute(inside), 'private_path_escape');
  if (exists) check(path.toLowerCase() === parent.toLowerCase(), 'private_symlink_not_allowed');
  return path;
}
async function atomicJson(path, value, createOnly = false) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  if (createOnly) {
    // wx prevents overwriting another journal; a partial file remains private if interrupted.
    await writeFile(path, await readFile(temporary), { mode: 0o600, flag: 'wx' });
    const { unlink } = await import('node:fs/promises'); await unlink(temporary);
  } else await rename(temporary, path);
}
export async function acquireWorkflowLocks(journalPath, privateRoot = PRIVATE) {
  const nonce = randomBytes(16).toString('hex'), acquired = [];
  const paths = [resolve(privateRoot, `workflow-project-${PROJECT}.lock`), `${journalPath}.workflow.lock`];
  const owner = { nonce, supervisorPid: process.pid, journalPath, projectId: PROJECT, acquiredAt: new Date().toISOString() };
  const release = async () => {
    for (const path of [...acquired].reverse()) {
      const recorded = JSON.parse(await readFile(resolve(path, 'owner.json'), 'utf8'));
      check(recorded.nonce === nonce && recorded.supervisorPid === process.pid && recorded.journalPath === journalPath, 'workflow_lock_ownership_changed');
      await unlink(resolve(path, 'owner.json')); await rmdir(path);
    }
  };
  try {
    for (const path of paths) {
      try { await mkdir(path); } catch (error) { if (error.code === 'EEXIST') check(false, 'workflow_execution_lock_held'); throw error; }
      await writeFile(resolve(path, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 }); acquired.push(path);
    }
  } catch (error) { await release(); throw error; }
  return { nonce, paths, release };
}
export async function pendingAdmission(markerPath, journalPath, cleanupOnly) {
  let pending;
  try { pending = JSON.parse(await readFile(markerPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  check(!pending || cleanupOnly && pending.journalPath === journalPath && pending.projectId === PROJECT, 'project_has_unfinished_owned_workflow');
  if (!pending) await atomicJson(markerPath, { journalPath, projectId: PROJECT, supervisorPid: process.pid, createdAt: new Date().toISOString() }, true);
}
export function executionBudget(maxSeconds, cleanupSeconds) {
  const total = maxSeconds * 1000, recovery = cleanupSeconds * 1000;
  check(Number.isSafeInteger(total) && Number.isSafeInteger(recovery) && total > 2 * recovery + 60000, 'execution_bound_must_reserve_work_and_cleanup');
  return { total, main: total - recovery, work: total - 2 * recovery, recovery };
}
export const unresolvedMutations = attempt => (attempt?.mutations ?? []).filter(item => item.state === 'in-flight' || item.state === 'unknown');
export const cleanupCanComplete = attempt => unresolvedMutations(attempt).length === 0 && Object.values(attempt?.scanJobs ?? {}).every(item => item.terminal === true);
function terminalMutationRejection(name, error) {
  const known = {
    'call:activateMyMembership': ['functions/permission-denied', 'functions/failed-precondition'],
    'call:publishContentDraft': ['functions/permission-denied', 'functions/failed-precondition'],
    'call:submitConsultation': ['functions/permission-denied'],
    'client-signup': ['auth/invalid-email', 'auth/weak-password', 'auth/email-already-in-use', 'auth/operation-not-allowed', 'auth/password-does-not-meet-requirements'],
    'admin-create-user': ['auth/email-already-exists', 'auth/uid-already-exists', 'auth/invalid-email', 'auth/invalid-password', 'auth/invalid-uid'],
    'client-upload': ['storage/unauthorized'],
  };
  return (known[name] ?? []).includes(error.code);
}
export async function trackedMutation(attempt, persist, planSha256, name, target, action, receipt = () => {}) {
  const item = { id: randomUUID(), attempt: attempt.number, planSha256, name, target, startedAt: new Date().toISOString(), state: 'in-flight' };
  item.intentSha256 = hash({ id: item.id, attempt: item.attempt, planSha256, name, target, startedAt: item.startedAt });
  attempt.mutations ??= []; attempt.mutations.push(item); await persist();
  try {
    const response = await action(); receipt(response); item.state = 'acknowledged'; item.completedAt = new Date().toISOString(); await persist(); return response;
  } catch (error) {
    item.state = terminalMutationRejection(name, error) ? 'rejected' : 'unknown'; item.code = safeCode(error); item.completedAt = new Date().toISOString(); await persist(); throw error;
  }
}
export function applyTerminalEvidence(attempt, planSha256, receipts = []) {
  check(Array.isArray(receipts), 'operation_receipts_must_be_an_array');
  const used = new Set((attempt.mutations ?? []).map(item => item.resolution?.terminalEvidenceSha256).filter(Boolean));
  for (const item of unresolvedMutations(attempt)) {
    const evidence = receipts.find(row => row.id === item.id && row.attempt === attempt.number && row.planSha256 === planSha256 && row.intentSha256 === item.intentSha256);
    if (!evidence) continue;
    check(evidence.terminalResponse === true && ['succeeded', 'failed'].includes(evidence.outcome) && /^[a-f0-9]{64}$/.test(evidence.terminalEvidenceSha256 ?? '') && !used.has(evidence.terminalEvidenceSha256) && typeof evidence.providerEvidenceId === 'string' && evidence.providerEvidenceId.length >= 3 && Date.parse(evidence.observedAt) >= Date.parse(item.startedAt), 'operation_specific_terminal_evidence_required');
    used.add(evidence.terminalEvidenceSha256); item.state = 'root-confirmed-terminal'; item.resolution = evidence;
  }
}
export function markInterruptedMutations(journal) {
  const attempt = journal.attempts.at(-1);
  if (attempt && unresolvedMutations(attempt).length) {
    for (const item of unresolvedMutations(attempt)) item.state = 'unknown';
    attempt.cleanupState = 'UNKNOWN'; attempt.cleanupComplete = false; journal.cleanupRequired = true;
  }
  for (const area of AREAS) if (journal.results[area].status === 'RUNNING') journal.results[area] = { ...journal.results[area], status: 'UNKNOWN' };
}
export const SCAN_JOB = `projects/${PROJECT}/locations/${REGION}/jobs/isp-attachment-scan`;
export const SCAN_WORKFLOW = `projects/${PROJECT}/locations/${REGION}/workflows/isp-attachment-dispatch`;
export function ownedScanResource(name, kind) {
  const patterns = {
    workflow: new RegExp(`^${SCAN_WORKFLOW}/executions/[A-Za-z0-9_-]{1,128}$`),
    operation: new RegExp(`^projects/${PROJECT}/locations/${REGION}/operations/[A-Za-z0-9_-]{1,256}$`),
    execution: new RegExp(`^${SCAN_JOB}/executions/isp-attachment-scan-[a-z0-9-]{1,80}$`),
  };
  check(typeof name === 'string' && patterns[kind]?.test(name), 'scan_resource_not_owned'); return name;
}
export function scanCancellationMarker(marker, fenceId) {
  return marker ? { ...marker, cancelled: true, cleanupFenceId: fenceId } : { id: `cleanup-${fenceId}`, cleanupOnly: true, cancelled: true, cleanupFenceId: fenceId, launchOutcome: 'not_launched' };
}
export async function reconcileOwnedScanDispatch({ binding, marker, api, persist, deadlineMs, readMarker = async () => marker, sleep = pause, clock = Date.now }) {
  check(marker.id === binding.dispatchId && marker.jobName === SCAN_JOB && marker.generation === binding.generation && marker.sha256 === binding.sha256 && marker.cancelled === true, 'scan_dispatch_cleanup_binding_changed');
  const workflowName = ownedScanResource(marker.workflowExecution, 'workflow');
  check(workflowName === `${SCAN_WORKFLOW}/executions/${binding.dispatchId}`, 'scan_workflow_dispatch_mismatch');
  const state = { dispatchId: binding.dispatchId, workflowExecution: workflowName, terminal: false };
  const request = async (method, kind, name) => { check(clock() + 10000 < deadlineMs, 'scan_terminal_observation_deadline'); return api(method, kind, ownedScanResource(name, kind)); };
  let workflow = await request('GET', 'workflow', workflowName);
  check(workflow.name === workflowName && workflow.workflowRevisionId === binding.workflowRevision, 'scan_workflow_revision_changed');
  if (['ACTIVE', 'QUEUED'].includes(workflow.state)) {
    await request('POST', 'workflow', workflowName);
    do { await sleep(2000); workflow = await request('GET', 'workflow', workflowName); } while (['ACTIVE', 'QUEUED'].includes(workflow.state));
  }
  check(['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(workflow.state), 'scan_workflow_terminal_unknown');
  state.workflowState = workflow.state; await persist(state);
  let result = {};
  if (workflow.result) { try { result = JSON.parse(workflow.result); } catch { check(false, 'scan_workflow_result_invalid'); } }
  let operationName = '', executionName = '';
  for (;;) {
    const fresh = await readMarker();
    check(fresh?.id === binding.dispatchId && fresh.jobName === SCAN_JOB && fresh.generation === binding.generation && fresh.sha256 === binding.sha256 && fresh.cancelled === true, 'scan_dispatch_refresh_binding_changed');
    if (fresh.operationName && result.operationName) check(ownedScanResource(fresh.operationName, 'operation') === ownedScanResource(result.operationName, 'operation'), 'scan_operation_receipts_differ');
    if (fresh.executionName && result.executionName) check(ownedScanResource(fresh.executionName, 'execution') === ownedScanResource(result.executionName, 'execution'), 'scan_execution_receipts_differ');
    operationName = fresh.operationName || result.operationName || operationName;
    executionName = fresh.executionName || result.executionName || executionName;
    if (operationName) {
      operationName = ownedScanResource(operationName, 'operation'); state.operationName = operationName; await persist(state);
      const operation = await request('GET', 'operation', operationName);
      check(operation.name === operationName, 'scan_operation_identity_changed');
      const candidate = operation.response?.name || operation.metadata?.name;
      if (candidate && candidate.startsWith(`${SCAN_JOB}/executions/`)) {
        const fromOperation = ownedScanResource(candidate, 'execution');
        if (executionName) check(ownedScanResource(executionName, 'execution') === fromOperation, 'scan_operation_execution_mismatch');
        executionName = fromOperation;
      }
    }
    if (executionName) break;
    if (workflow.state === 'SUCCEEDED' && result.launchStatus === 'not_launched' && !operationName) {
      state.terminal = true; state.noLaunch = true; await persist(state); return state;
    }
    // A queued Job can publish its identity after the initial read. Absence never proves no launch.
    check(clock() + 12000 < deadlineMs, 'scan_launch_outcome_unknown'); await sleep(2000);
  }
  executionName = ownedScanResource(executionName, 'execution'); state.executionName = executionName; await persist(state);
  const readExecution = async () => {
    const execution = await request('GET', 'execution', executionName);
    const container = execution.template?.containers?.find(item => item.name === 'scanner');
    const environment = Object.fromEntries((container?.env ?? []).map(item => [item.name, item.value]));
    check(execution.name === executionName && environment.ISP_ATTACHMENT_ID === binding.attachmentId && environment.ISP_ATTACHMENT_GENERATION === binding.generation && environment.ISP_ATTACHMENT_SHA256 === binding.sha256 && environment.ISP_SCAN_DISPATCH_ID === binding.dispatchId && container.image?.endsWith(`@${binding.imageDigest}`), 'scan_execution_binding_changed');
    return execution;
  };
  let execution = await readExecution();
  if (!execution.completionTime) {
    await request('POST', 'execution', executionName);
    do { await sleep(2000); execution = await readExecution(); } while (!execution.completionTime);
  }
  check(Number.isFinite(Date.parse(execution.completionTime)) && (execution.runningCount ?? 0) === 0, 'scan_execution_terminal_unknown');
  state.terminal = true; state.executionCompletedAt = execution.completionTime; await persist(state); return state;
}
function planFixture(prefix) {
  const row = role => ({ name: `TEST ${role} ${prefix}`, email: `${prefix}-${role}@example.invalid`, memberReference: `000-${prefix}-${role}` });
  return { prefix, label: LABEL, discoverId: '3', signup: row('signup'), legacy: row('legacy'), omitted: row('omitted'),
    eventId: `${prefix}-event`, publicationId: `${prefix}-publication`, unsafeId: `${prefix}-unsafe`,
    syntheticVerification: 'Admin marks only owned synthetic signup verified; no mail delivery is tested',
    csvIntents: { first: 'signup,legacy,omitted eligible; restoreSuspended absent', suspend: 'signup ineligible; preserve omissions', ordinary: 'signup eligible; restoreSuspended absent', restore: 'signup eligible; restoreSuspended true' }, maxFinalizedAttachments: 3 };
}
function planOutput() {
  console.log(JSON.stringify({ mode: 'PLAN_ONLY', providerCalls: 0, areas: AREAS, sourceFilesToSeal: SOURCE_FILES,
    prerequisites: ['review this script', 'D-only private owned-fixture journal from --prepare', 'exact reviewed source/release + scanner-ready manifest/self-test tuple', 'explicit cost allowance and time bound', 'no nonfixture member or active registry state', 'exact Discover-3 baseline approval', 'synthetic admin TOTP is setup only'],
    invocation: 'Use-IspEnvironment.ps1, then D-hosted Node; --prepare --journal=D:\\...\\audit\\private\\workflow-....json; root reviews private release; --execute --journal=... --release=...',
    boundaries: ['no owner credentials or email', 'no old Auth/profile/MFA proof replay', 'no automatic feature or scanner retry', 'six compact area receipts; cleanup is a separate mandatory overall gate', 'passed areas remain journaled and require explicit carry approval when source changes', 'no EICAR fixture on this computer'] }, null, 2));
}
async function prepare() {
  check(/^D:[\\/]/i.test(ROOT) && /^D:[\\/]/i.test(process.execPath), 'all_project_and_node_paths_must_be_on_D');
  await mkdir(PRIVATE, { recursive: true });
  const path = await privatePath(option('journal'), false);
  const prefix = `isp-wf-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const plan = planFixture(prefix), credentials = {};
  for (const role of ['admin', 'signup', 'legacy', 'conflict']) credentials[role] = { email: `${prefix}-${role}@example.invalid`, password: `Aa1!${randomBytes(30).toString('base64url')}`, plannedUid: role === 'signup' ? null : `${prefix}-${role}` };
  await atomicJson(path, { schemaVersion: 1, projectId: PROJECT, createdAt: new Date().toISOString(), plan, planSha256: hash(plan), credentials, results: Object.fromEntries(AREAS.map(area => [area, { status: 'PENDING' }])), attempts: [], cleanupRequired: false }, true);
  console.log('PREPARED private fixture journal; review its fixture plan and file permissions before release.');
}
async function sealedInputs() {
  check(/^D:[\\/]/i.test(ROOT) && /^D:[\\/]/i.test(process.execPath), 'all_project_and_node_paths_must_be_on_D');
  check(process.env.GOOGLE_CLOUD_PROJECT === PROJECT && process.env.GOOGLE_CLOUD_QUOTA_PROJECT === PROJECT, 'explicit_ISP_project_environment_required');
  for (const [name, value] of Object.entries(process.env)) if (/EMULATOR|FIREBASE_AUTH_EMULATOR/.test(name)) check(!value, 'emulator_not_allowed');
  for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'CLOUDSDK_CONFIG', 'TEMP', 'TMP']) check(/^D:[\\/]/i.test(process.env[name] ?? ''), 'ADC_config_and_temp_must_be_on_D');
  const journalPath = await privatePath(option('journal')), releasePath = await privatePath(option('release'));
  const journal = JSON.parse(await readFile(journalPath, 'utf8')), releaseBytes = await readFile(releasePath), release = JSON.parse(releaseBytes);
  check(journal.schemaVersion === 1 && journal.projectId === PROJECT && journal.planSha256 === hash(journal.plan), 'fixture_plan_integrity_required');
  check(/^isp-wf-\d{13}-[a-f0-9]{6}$/.test(journal.plan.prefix), 'owned_fixture_prefix_required');
  check(release.schemaVersion === 1 && release.sourceGo === true && release.privateAclVerified === true && release.projectId === PROJECT && release.region === REGION && release.bucket === BUCKET, 'explicit_private_source_release_required');
  check(release.reviewedFixturePlanSha256 === journal.planSha256, 'exact_fixture_plan_approval_required');
  check(release.approvedBy === 'root' && release.directorSourceGo === true, 'root_and_director_source_release_required');
  check(release.functionsReady === true && /^[a-f0-9]{64}$/.test(release.providerSealSha256 ?? ''), 'deployed_functions_evidence_tuple_required');
  check(/^[a-f0-9]{40}$/.test(release.commit ?? ''), 'reviewed_commit_required');
  const head = (await readFile(resolve(ROOT, '.git/HEAD'), 'utf8')).trim();
  let commit = head;
  if (head.startsWith('ref: ')) {
    const ref = head.slice(5); check(/^refs\/heads\/[a-zA-Z0-9_/-]+$/.test(ref), 'unexpected_git_reference');
    try { commit = (await readFile(resolve(ROOT, '.git', ref), 'utf8')).trim(); }
    catch { const packed = await readFile(resolve(ROOT, '.git/packed-refs'), 'utf8'); commit = packed.split(/\r?\n/).find(line => line.endsWith(` ${ref}`))?.split(' ')[0]; }
  }
  check(commit === release.commit, 'source_commit_changed');
  for (const path of SOURCE_FILES) check(release.sourceSha256?.[path]?.toLowerCase() === digest(await readFile(resolve(ROOT, path))), 'reviewed_source_hash_changed');
  const scanner = release.scanner;
  check(scanner?.ready === true && scanner.route === 'workflow-job' && scanner.jobName === SCAN_JOB && scanner.workflowName === SCAN_WORKFLOW && typeof scanner.workflowRevision === 'string' && scanner.workflowRevision.length > 0 && scanner.legacyHttpTriggerDisabled === true && /^[a-f0-9]{64}$/.test(scanner.jobConfigSha256 ?? '') && /^sha256:[a-f0-9]{64}$/.test(scanner.imageDigest ?? '') && /^[a-f0-9]{64}$/.test(scanner.manifestSha256 ?? ''), 'explicit_scanner_ready_tuple_required');
  check(release.maxSeconds === 2400 && release.cleanupSeconds === 180, 'job_route_requires_2400_total_180_cleanup');
  check(Number.isSafeInteger(scanner.dailyVersion) && scanner.dailyVersion > 0 && scanner.antivirusSelfTest?.state === 'passed' && scanner.antivirusSelfTest.dailyVersion === scanner.dailyVersion && scanner.antivirusSelfTest.engineVersion === '1.4.6', 'real_mirror_antivirus_self_test_required');
  check(Date.now() - Date.parse(scanner.observedAt) >= 0 && Date.now() - Date.parse(scanner.observedAt) < 24 * 60 * 60 * 1000, 'scanner_readiness_receipt_stale');
  check(release.cost?.approved === true && release.cost.maxAdditionalUsd > 0 && release.cost.maxAdditionalUsd <= 1.50 && /^[a-f0-9]{64}$/.test(release.cost.ledgerSha256 ?? ''), 'root_cost_ledger_allowance_required');
  check(Number.isSafeInteger(release.maxSeconds) && release.maxSeconds >= 300 && release.maxSeconds <= 2400 && release.cleanupSeconds >= 60 && release.cleanupSeconds <= 180, 'bounded_execution_deadline_required');
  check(Array.isArray(release.areas) && release.areas.length > 0 && new Set(release.areas).size === release.areas.length && release.areas.every(area => AREAS.includes(area)), 'explicit_six_area_subset_required');
  for (const area of AREAS) if (journal.results[area].status === 'PASS') check(release.acceptPassedAreas?.[area] === journal.results[area].releaseSha256, 'passed_area_carry_approval_required');
  if (!['--cleanup', '--cleanup-worker'].includes(mode)) check(Date.now() < Date.parse(release.expiresAt) && Date.parse(release.expiresAt) - Date.now() <= 24 * 60 * 60 * 1000, 'release_expired_or_unbounded');
  const adc = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  check(adc.type === 'authorized_user' && !adc.private_key, 'attached_user_ADC_only_no_service_keys');
  check(release.firebase?.projectId === PROJECT && release.firebase.authDomain === `${PROJECT}.firebaseapp.com` && typeof release.firebase.apiKey === 'string' && typeof release.firebase.appId === 'string', 'pinned_client_SDK_configuration_required');
  check(release.discoverBaselineSha256 === null || /^[a-f0-9]{64}$/.test(release.discoverBaselineSha256 ?? ''), 'exact_discover_baseline_approval_required');
  return { journalPath, journal, release, releaseSha256: digest(releaseBytes) };
}
function printResults(journal) {
  for (const area of AREAS) console.log(`${journal.results[area].status} ${area}`);
  console.log((journal.cleanupRequired || !cleanupCanComplete(journal.attempts.at(-1))) ? (journal.attempts.at(-1)?.cleanupState === 'UNKNOWN' || !cleanupCanComplete(journal.attempts.at(-1)) ? 'CLEANUP_UNKNOWN - remote completion needs operation-specific evidence.' : 'CLEANUP_REQUIRED - inspect the private journal before further work.') : 'CLEANUP_COMPLETE');
}
async function supervise(cleanupOnly) {
  const journalPath = await privatePath(option('journal'));
  const locks = await acquireWorkflowLocks(journalPath), marker = resolve(PRIVATE, `workflow-pending-${PROJECT}.json`);
  try {
    const inputs = await sealedInputs();
    check(!inputs.journal.cleanupRequired || cleanupOnly, 'finish_owned_cleanup_before_new_work');
    const budget = executionBudget(inputs.release.maxSeconds, inputs.release.cleanupSeconds), end = performance.now() + budget.total;
    await pendingAdmission(marker, journalPath, cleanupOnly);
    const childArgs = [fileURLToPath(import.meta.url), cleanupOnly ? '--cleanup-worker' : '--worker', `--journal=${inputs.journalPath}`, `--release=${await privatePath(option('release'))}`];
    const run = async (workerArgs, maximum) => {
      const milliseconds = Math.min(maximum, Math.max(0, end - performance.now()));
      if (milliseconds <= 0) return { result: 1, timeout: true };
      const child = spawn(process.execPath, workerArgs, { cwd: ROOT, env: { ...process.env, ISP_WORKFLOW_SUPERVISED: String(process.pid), ISP_WORKFLOW_LOCK_NONCE: locks.nonce, ISP_WORKFLOW_WORK_ENDS_AT: String(Date.now() + budget.work) }, stdio: 'ignore', windowsHide: true });
      let timeout = false;
      const timer = setTimeout(() => { timeout = true; child.kill('SIGKILL'); }, milliseconds);
      const result = await new Promise(done => { child.once('error', () => done(1)); child.once('exit', code => done(code ?? 1)); });
      clearTimeout(timer); return { result, timeout };
    };
    const first = await run(childArgs, cleanupOnly ? budget.recovery : budget.main);
    let latest = JSON.parse(await readFile(journalPath, 'utf8'));
    if (first.timeout || first.result !== 0) {
      markInterruptedMutations(latest); await atomicJson(journalPath, latest);
    }
    if (first.timeout && !cleanupOnly && performance.now() < end) {
      const recovered = await run(childArgs.map(value => value === '--worker' ? '--cleanup-worker' : value), budget.recovery);
      if (recovered.timeout || recovered.result !== 0) { latest = JSON.parse(await readFile(journalPath, 'utf8')); markInterruptedMutations(latest); await atomicJson(journalPath, latest); }
    }
    latest = JSON.parse(await readFile(journalPath, 'utf8')); printResults(latest);
    if (!latest.cleanupRequired && cleanupCanComplete(latest.attempts.at(-1)) && (latest.attempts.at(-1)?.cleanupComplete || latest.attempts.length === 0)) {
      const pending = JSON.parse(await readFile(marker, 'utf8')); check(pending.journalPath === journalPath && pending.projectId === PROJECT, 'pending_marker_ownership_changed'); await unlink(marker);
    }
    if (first.result !== 0 || latest.cleanupRequired || !cleanupCanComplete(latest.attempts.at(-1)) || AREAS.some(area => latest.results[area].status !== 'PASS')) process.exitCode = 1;
  } finally { await locks.release(); }
}
async function worker(cleanupOnly) {
  check(process.env.ISP_WORKFLOW_SUPERVISED === String(process.ppid), 'worker_requires_bounded_supervisor');
  const { journalPath, journal, release, releaseSha256 } = await sealedInputs();
  const save = () => atomicJson(journalPath, journal);
  const [clientApp, clientAuth, clientDb, clientFunctions, clientStorage, adminApp, adminAuth, adminDb, adminStorage, otp] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/firestore'), import('firebase/functions'), import('firebase/storage'),
    import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore'), import('firebase-admin/storage'), import('otpauth'),
  ]);
  const backend = adminApp.initializeApp({ projectId: PROJECT, storageBucket: BUCKET, credential: adminApp.applicationDefault() }, `owned-workflow-${Date.now()}`);
  const adb = adminDb.getFirestore(backend), identities = adminAuth.getAuth(backend), objects = adminStorage.getStorage(backend).bucket(BUCKET);
  const sessions = [];
  let attempt = journal.attempts.at(-1), currentArea = null, cleanupAttempted = false;
  const endsAt = Number(process.env.ISP_WORKFLOW_WORK_ENDS_AT);
  check(Number.isFinite(endsAt), 'supervised_work_deadline_required');
  const lockOwner = JSON.parse(await readFile(resolve(PRIVATE, `workflow-project-${PROJECT}.lock/owner.json`), 'utf8'));
  check(lockOwner.nonce === process.env.ISP_WORKFLOW_LOCK_NONCE && lockOwner.supervisorPid === process.ppid && lockOwner.journalPath === journalPath, 'exclusive_supervisor_lock_required');
  const mutate = (name, target, action, receipt) => trackedMutation(attempt, save, journal.planSha256, name, target, action, receipt);
  const time = () => check(Date.now() < endsAt, 'workflow_work_deadline_exceeded');
  function encode(value) {
    if (value instanceof adminDb.Timestamp) return { $timestamp: [value.seconds, value.nanoseconds] };
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === 'object') { check(value.constructor === Object, 'unsupported_baseline_field_type'); return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])); }
    return value;
  }
  function decode(value) {
    if (value?.$timestamp) return new adminDb.Timestamp(...value.$timestamp);
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
    return value;
  }
  const snapshotValue = snapshot => snapshot.exists ? encode(snapshot.data()) : null;
  const stamp = snapshot => hash(snapshotValue(snapshot));
  const recordDoc = async path => { if (!attempt.docs.includes(path)) { attempt.docs.push(path); await save(); } };
  function ownAddress(address) { return typeof address === 'string' && address.startsWith(`${journal.plan.prefix}-`) && address.endsWith('@example.invalid'); }
  function ownReference(reference) { return typeof reference === 'string' && reference.startsWith(`000-${journal.plan.prefix}-`); }
  const ownedUids = () => new Set(attempt.users.map(user => user.uid).filter(Boolean));
  async function bounded(query, maximum = 25) { const result = await query.limit(maximum + 1).get(); check(result.size <= maximum, 'unexpected_fixture_query_size'); return result.docs; }
  async function assertOnlyOwnedMembers() {
    const members = await bounded(adb.collection('members'), 10);
    for (const member of members) check(ownedUids().has(member.id) && ownAddress(member.get('email')) && ownReference(member.get('membershipReference')), 'foreign_member_blocks_global_registry_mutation');
  }
  async function assertRegistryOwned() {
    await assertOnlyOwnedMembers();
    const state = await adb.doc('registryState/current').get();
    const active = state.get('activeVersion');
    if (active) check(attempt.versions.includes(active) && state.get('updatedBy') === attempt.adminUid, 'foreign_registry_state_blocks_mutation');
    else check(stamp(state) === attempt.baseline.registryState.sha256, 'inactive_registry_baseline_changed');
  }
  async function session(role, user = null) {
    const app = clientApp.initializeApp({ ...release.firebase, storageBucket: BUCKET }, `${journal.plan.prefix}-${role}-${randomBytes(3).toString('hex')}`);
    const auth = clientAuth.initializeAuth(app, { persistence: clientAuth.inMemoryPersistence });
    const db = clientDb.initializeFirestore(app, { localCache: clientDb.memoryLocalCache() });
    const functions = clientFunctions.getFunctions(app, REGION), storage = clientStorage.getStorage(app);
    storage.maxUploadRetryTime = 0; storage.maxOperationRetryTime = 0;
    const value = { app, auth, db, functions, storage, role }; sessions.push(value);
    if (user) await clientAuth.signInWithEmailAndPassword(auth, user.email, user.password);
    return value;
  }
  async function call(who, name, data) {
    time(); const action = async () => (await clientFunctions.httpsCallable(who.functions, name, { timeout: 120000 })(data)).data;
    if (['listContentDrafts', 'getContentFile', 'listMyConsultations', 'listMyEventInterests', 'listAdminConsultations', 'getRegistryImportPreview', 'listRegistry'].includes(name)) return action();
    return mutate(`call:${name}`, { recordId: data.id ?? data.previewId ?? data.attachmentId ?? data.eventId ?? data.requestKey ?? null }, action);
  }
  async function denied(operation, codes) {
    try { await operation(); } catch (error) { check(codes.includes(error.code), 'unexpected_denial_or_provider_error'); return; }
    check(false, 'expected_new_feature_denial_missing');
  }
  async function fresh(who, path) { return clientDb.getDocFromServer(clientDb.doc(who.db, path)); }
  async function captureBaseline() {
    check(attempt.docs.length === 0 && attempt.users.length === 0, 'baseline_capture_must_precede_fixture_creation');
    const members = await bounded(adb.collection('members'), 10); check(members.length === 0, 'nonfixture_members_exist_global_registry_proof_refused');
    const [state, draft, published] = await adb.getAll(adb.doc('registryState/current'), adb.doc('discoverDrafts/3'), adb.doc('discover/3'));
    const data = state.data();
    check(!state.exists || (data.activeVersion === undefined || data.activeVersion === null || data.activeVersion === '') && (data.revision === undefined || data.revision === 0), 'nonfixture_registry_state_exists_proof_refused');
    const discover = { draft: snapshotValue(draft), published: snapshotValue(published) };
    check(release.discoverBaselineSha256 === (draft.exists || published.exists ? hash(discover) : null), 'Discover_3_baseline_requires_exact_root_approval');
    attempt.baseline = { registryState: { value: snapshotValue(state), sha256: stamp(state) }, discover };
    attempt.initialDiscoverRevision = draft.exists ? draft.get('revision') : 0;
    check(Number.isSafeInteger(attempt.initialDiscoverRevision), 'Discover_draft_revision_invalid');
    await save();
  }
  async function ownedIdentity(record) {
    let user;
    try { user = record.uid ? await identities.getUser(record.uid) : await identities.getUserByEmail(record.email); }
    catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
    check(ownAddress(user.email) && user.email === record.email && Date.parse(user.metadata.creationTime) >= attempt.startedMs - 1000, 'identity_ownership_or_creation_time_failed');
    check(record.kind === 'client-signup' ? record.uid === user.uid || record.uid === null : user.uid === record.uid && user.uid.startsWith(`${journal.plan.prefix}-`), 'identity_UID_ownership_failed');
    record.uid = user.uid; await save(); return user;
  }
  async function createIdentity(role, clientCreated = false) {
    const credentials = journal.credentials[role]; check(ownAddress(credentials.email), 'synthetic_identity_address_required');
    const record = { role, kind: clientCreated ? 'client-signup' : 'admin-fixture', email: credentials.email, uid: clientCreated ? null : credentials.plannedUid };
    attempt.users.push(record); await save(); // Ownership intent exists before an ambiguous create response.
    if (clientCreated) {
      const who = await session(role);
      const response = await mutate('client-signup', { email: credentials.email }, () => clientAuth.createUserWithEmailAndPassword(who.auth, credentials.email, credentials.password), response => { record.uid = response.user.uid; });
      record.uid = response.user.uid; await save(); await ownedIdentity(record);
      return { who, record };
    }
    check(record.uid.startsWith(`${journal.plan.prefix}-`), 'prefixed_admin_fixture_UID_required');
    await mutate('admin-create-user', { uid: record.uid, email: credentials.email }, () => identities.createUser({ uid: record.uid, email: credentials.email, password: credentials.password, emailVerified: true, displayName: `TEST ${role}` }));
    await ownedIdentity(record); return { record };
  }
  async function verifyOwnedSignup(who, record) {
    await ownedIdentity(record);
    await mutate('fixture-verify-user', { uid: record.uid }, () => identities.updateUser(record.uid, { emailVerified: true }));
    await who.auth.currentUser.reload();
    await clientAuth.signOut(who.auth);
    await clientAuth.signInWithEmailAndPassword(who.auth, journal.credentials.signup.email, journal.credentials.signup.password);
    await who.auth.currentUser.getIdToken(true);
  }
  async function administrator() {
    const { record } = await createIdentity('admin'); attempt.adminUid = record.uid; await save();
    await mutate('fixture-admin-claim', { uid: record.uid }, () => identities.setCustomUserClaims(record.uid, { admin: true }));
    await recordDoc(`staff/${record.uid}`); await mutate('fixture-staff-create', { uid: record.uid }, () => adb.doc(`staff/${record.uid}`).create({ active: true, fixtureRun: journal.plan.prefix }));
    const who = await session('admin', journal.credentials.admin);
    const enrollmentStep = Math.floor(Date.now() / 30000), mfaSession = await clientAuth.multiFactor(who.auth.currentUser).getSession();
    const secret = await clientAuth.TotpMultiFactorGenerator.generateSecret(mfaSession);
    check(secret.hashingAlgorithm === 'SHA1' && secret.codeLength === 6 && secret.codeIntervalSeconds === 30, 'unsupported_fixture_TOTP_settings');
    attempt.adminTotpSecret = secret.secretKey; await save();
    const code = () => new otp.TOTP({ secret: otp.Secret.fromBase32(secret.secretKey), algorithm: 'SHA1', digits: 6, period: 30 }).generate();
    await clientAuth.multiFactor(who.auth.currentUser).enroll(clientAuth.TotpMultiFactorGenerator.assertionForEnrollment(secret, code()), 'Owned workflow prerequisite');
    await clientAuth.signOut(who.auth);
    let resolver;
    try { await clientAuth.signInWithEmailAndPassword(who.auth, journal.credentials.admin.email, journal.credentials.admin.password); }
    catch (error) { check(error.code === 'auth/multi-factor-auth-required', 'admin_prerequisite_signin_failed'); resolver = clientAuth.getMultiFactorResolver(who.auth, error); }
    check(resolver, 'admin_prerequisite_requires_TOTP');
    while (Math.floor(Date.now() / 30000) <= enrollmentStep) { time(); await pause(500); }
    const factor = resolver.hints.find(hint => hint.factorId === clientAuth.TotpMultiFactorGenerator.FACTOR_ID); check(factor, 'admin_TOTP_hint_missing');
    await resolver.resolveSignIn(clientAuth.TotpMultiFactorGenerator.assertionForSignIn(factor.uid, code()));
    // This is setup for business operations, not a repeated Auth/MFA proof area.
    return who;
  }
  function csv(rows) { return 'name,email,member_reference,status\n' + rows.map(row => [row.name, row.email, row.memberReference, row.status ?? 'eligible'].join(',')).join('\n') + '\n'; }
  async function importReviewed(admin, rows, restoreSuspended) {
    await assertRegistryOwned();
    const expected = rows.map(row => ({ ...row, status: row.status ?? 'eligible' }));
    check(expected.every(row => ownAddress(row.email) && ownReference(row.memberReference)), 'only_owned_registry_rows_allowed');
    const source = restoreSuspended === undefined ? { csv: csv(rows) } : { csv: csv(rows), restoreSuspended };
    const preview = await call(admin, 'previewRegistryImport', source);
    attempt.previews.push(preview.previewId); await save();
    check(preview.state === 'ready' && preview.errors.length === 0 && preview.rows.length === rows.length && preview.nextCursor === null && preview.counts.duplicates === 0 && preview.counts.invalid === 0, 'registry_preview_not_ready');
    check(preview.restoreSuspended === (restoreSuspended === true) && Date.parse(preview.expiresAt) > Date.now(), 'registry_preview_intent_or_expiry_mismatch');
    for (let index = 0; index < rows.length; index++) for (const field of ['name', 'email', 'memberReference', 'status']) check(preview.rows[index][field] === expected[index][field], 'registry_preview_exact_rows_mismatch');
    const reviewed = await call(admin, 'getRegistryImportPreview', { previewId: preview.previewId });
    check(reviewed.digest === preview.digest && reviewed.registryVersion === preview.registryVersion && canonical(reviewed.rows) === canonical(preview.rows), 'reviewed_preview_changed');
    attempt.reviewedPreviews ??= []; attempt.reviewedPreviews.push({ id: preview.previewId, digest: preview.digest, registryVersion: preview.registryVersion, restoreSuspended: preview.restoreSuspended, csvSha256: digest(source.csv), counts: preview.counts, rows: preview.rows }); await save();
    // Each explicit confirmation advances at most one bounded server phase; no error retries.
    let result;
    for (let step = 0; step < 8; step++) {
      time(); await assertRegistryOwned();
      result = await call(admin, 'confirmRegistryImport', { previewId: preview.previewId, digest: preview.digest, registryVersion: preview.registryVersion });
      if (result.state === 'confirmed') { attempt.versions.push(result.activeVersion); attempt.expectedRegistryRevision = preview.registryVersion + 1; await save(); break; }
      check(result.state === 'processing' && ['copy', 'apply', 'activate'].includes(result.phase), 'unexpected_registry_confirmation_state');
    }
    check(result?.state === 'confirmed', 'registry_confirmation_did_not_finish_within_fixture_bound');
    const active = await adb.doc('registryState/current').get(); check(active.get('activeVersion') === result.activeVersion && active.get('revision') === preview.registryVersion + 1, 'atomic_registry_pointer_not_persisted');
    return { preview, result };
  }
  async function legacyProfile(record) {
    const row = journal.plan.legacy;
    await recordDoc(`members/${record.uid}`);
    const profile = { displayName: `TEST legacy preserved ${journal.plan.prefix}`, email: row.email, membershipReference: row.memberReference, status: 'approved', company: 'TEST preserved company', branch: 'TEST branch', phone: '', createdAt: adminDb.Timestamp.now(), updatedAt: adminDb.Timestamp.now() };
    await mutate('fixture-legacy-profile', { uid: record.uid }, () => adb.doc(`members/${record.uid}`).create(profile)); return profile;
  }
  async function seedFixtureRegistry(signup, legacy) {
    // Only a failed-area continuation uses Admin fixture construction; it never replays a passed import/activation area.
    await assertRegistryOwned();
    const version = `${journal.plan.prefix}-prerequisite-${attempt.number}`;
    const rows = [journal.plan.signup, journal.plan.legacy, journal.plan.omitted];
    attempt.versions.push(version); attempt.fixtureOnlyVersions ??= []; attempt.fixtureOnlyVersions.push(version); await save();
    await mutate('fixture-prerequisite-registry', { version }, () => adb.runTransaction(async transaction => {
      const stateRef = adb.doc('registryState/current'), state = await transaction.get(stateRef);
      check(stamp(state) === attempt.baseline.registryState.sha256, 'prerequisite_registry_baseline_changed');
      transaction.create(adb.doc(`memberRegistryVersions/${version}`), { state: 'active', actorUid: attempt.adminUid, fixtureRun: journal.plan.prefix, entryCount: rows.length });
      for (const row of rows) transaction.create(adb.doc(`memberRegistryVersions/${version}/entries/${digest(row.memberReference)}`), { ...row, status: 'eligible', accessSuspended: false });
      for (const [record, row] of [[signup, journal.plan.signup], [legacy, journal.plan.legacy]]) {
        const key = digest(row.memberReference);
        transaction.set(adb.doc(`members/${record.uid}`), { displayName: row.name, email: row.email, membershipReference: row.memberReference, status: 'approved', registryKey: key, company: '', branch: '', phone: '', createdAt: adminDb.Timestamp.now(), updatedAt: adminDb.Timestamp.now() });
        transaction.create(adb.doc(`registryBindings/${key}`), { uid: record.uid, email: row.email, memberReference: row.memberReference, createdAt: adminDb.Timestamp.now() });
      }
      transaction.set(stateRef, { activeVersion: version, revision: 1, updatedBy: attempt.adminUid, updatedAt: adminDb.Timestamp.now() });
    }, { maxAttempts: 1 }));
    attempt.expectedRegistryRevision = 1; await save();
  }
  let admin, member, legacy, guest, signupRecord, legacyRecord;
  const feature = {};
  feature.enrollment_registry = async () => {
    const beforeSignupProfile = await adb.doc(`members/${signupRecord.uid}`).get(); check(!beforeSignupProfile.exists, 'signup_must_precede_registry_without_profile');
    const beforeState = await adb.doc('registryState/current').get(); check(!beforeState.get('activeVersion'), 'signup_before_registry_required');
    const imported = await importReviewed(admin, [journal.plan.signup, journal.plan.legacy, journal.plan.omitted]);
    check(imported.preview.counts.add === 3 && imported.preview.counts.omitted === 0 && imported.preview.counts.restoredSuspensions === 0, 'first_preview_counts_wrong');
    check(!(await adb.doc(`members/${signupRecord.uid}`).get()).exists, 'CSV_must_not_activate_Auth_only_signup');
    const activation = await call(member, 'activateMyMembership', { memberReference: journal.plan.signup.memberReference });
    check(activation.uid === signupRecord.uid && activation.paired === true && activation.status === 'approved' && activation.registryKey === digest(journal.plan.signup.memberReference), 'verified_activation_receipt_wrong');
    const created = await fresh(member, `members/${signupRecord.uid}`);
    check(created.exists() && created.get('email') === journal.plan.signup.email && created.get('membershipReference') === journal.plan.signup.memberReference && created.get('status') === 'approved', 'verified_activation_not_persisted');
    check(['displayName', 'company', 'branch', 'phone'].every(field => typeof created.get(field) === 'string'), 'activation_profile_field_contract_wrong');
    const bindingPath = `registryBindings/${digest(journal.plan.legacy.memberReference)}`;
    await recordDoc(bindingPath);
    // A deliberately conflicting, owned fixture UID tests the permanent-binding denial.
    const conflictUid = attempt.users.find(user => user.role === 'conflict').uid;
    await mutate('fixture-conflicting-binding', { bindingPath, uid: conflictUid }, () => adb.doc(bindingPath).create({ uid: conflictUid, email: journal.plan.legacy.email, memberReference: journal.plan.legacy.memberReference, createdAt: adminDb.Timestamp.now() }));
    await denied(() => call(legacy, 'activateMyMembership', { memberReference: journal.plan.legacy.memberReference }), ['functions/permission-denied']);
    await mutate('fixture-conflict-binding-delete', { bindingPath }, () => adb.runTransaction(async transaction => {
      const existing = await transaction.get(adb.doc(bindingPath)); check(existing.get('uid') === conflictUid && existing.get('email') === journal.plan.legacy.email, 'owned_conflict_binding_changed'); transaction.delete(existing.ref);
    }, { maxAttempts: 1 }));
    const legacyBefore = (await adb.doc(`members/${legacyRecord.uid}`).get()).data();
    const paired = await call(legacy, 'activateMyMembership', { memberReference: journal.plan.legacy.memberReference });
    check(paired.paired === true && paired.uid === legacyRecord.uid, 'legacy_pairing_receipt_wrong');
    const legacyAfter = (await fresh(legacy, `members/${legacyRecord.uid}`)).data();
    for (const field of ['displayName', 'company', 'branch', 'phone', 'email', 'membershipReference', 'status']) check(legacyAfter[field] === legacyBefore[field], 'legacy_profile_overwritten_during_pairing');
    check(legacyAfter.registryKey === digest(journal.plan.legacy.memberReference), 'legacy_registry_pairing_missing');
    const same = await call(legacy, 'activateMyMembership', { memberReference: journal.plan.legacy.memberReference }); check(same.uid === paired.uid && same.registryKey === paired.registryKey, 'legacy_pairing_idempotence_failed');
    return { signupBeforeRegistry: true, reviewedRows: 3, activation: true, legacyPairing: true, UIDConflictDenied: true, noEmailSent: true };
  };
  const eventData = () => ({ title: `TEST - not a real ISP event (${journal.plan.prefix})`, format: 'Webinar', summary: LABEL, description: LABEL, audience: 'Synthetic proof identities only', programme: 'No real programme or registration', date: '2099-01-01', startsAt: '10:00', endsAt: '10:15', timezone: 'Asia/Kuala_Lumpur', venue: 'TEST only - no venue', venueDetails: '', admission: 'free', fee: '', paymentMethod: '', bankName: '', accountName: '', accountNumber: '', receiptEmail: '', paymentNotes: '', images: [], brochure: null });
  async function draftPreviewPublish(kind, id, data, expectedRevision = 0) {
    const collections = { event: ['eventDrafts', 'events'], discover: ['discoverDrafts', 'discover'], publication: ['publicationDrafts', 'publications'] }[kind];
    for (const name of collections) if (kind !== 'discover') await recordDoc(`${name}/${id}`);
    const saved = await call(admin, 'saveContentDraft', { kind, id, expectedRevision, data });
    const preview = await call(admin, 'previewContentDraft', { kind, id, expectedRevision: saved.revision });
    check(preview.attachmentStatus === 'clean' && preview.revision === saved.revision && typeof preview.previewToken === 'string', 'draft_preview_not_publishable');
    const published = await call(admin, 'publishContentDraft', { kind, id, expectedRevision: saved.revision, expectedPreviewToken: preview.previewToken });
    check(published.revision === saved.revision, 'published_revision_wrong');
    if (kind === 'discover') { attempt.discoverTouched = true; await save(); }
    return published;
  }
  feature.events_interest = async () => {
    const data = eventData(), id = journal.plan.eventId;
    const published = await draftPreviewPublish('event', id, data);
    const publicEvent = await fresh(guest, `events/${id}`); check(publicEvent.exists() && publicEvent.get('data.title') === data.title && publicEvent.get('revision') === published.revision, 'event_public_projection_not_persisted');
    await call(admin, 'saveContentDraft', { kind: 'event', id, expectedRevision: published.revision, data: { ...data, title: `TEST private draft ${journal.plan.prefix}` } });
    check((await fresh(guest, `events/${id}`)).get('data.title') === data.title, 'unpublished_event_edit_leaked');
    const interestId = `${id}__${signupRecord.uid}`; await recordDoc(`eventInterests/${interestId}`);
    const interest = await call(member, 'saveEventInterest', { eventId: id, name: journal.plan.signup.name, email: journal.plan.signup.email, company: 'TEST fixture' });
    const stored = await fresh(member, `eventInterests/${interestId}`);
    check(interest.id === interestId && stored.exists() && stored.get('ownerUid') === signupRecord.uid && stored.get('eventRevision') === published.revision && stored.get('eventSnapshot.title') === data.title, 'member_interest_published_snapshot_wrong');
    return { publicProjection: true, privateDraftStable: true, memberInterestPersisted: true, publishedRevision: published.revision };
  };
  feature.discover = async () => {
    const data = { tag: 'TEST - transient fixture', title: `TEST Discover ${journal.plan.prefix}`, description: LABEL, imageAlt: 'TEST only', websiteUrl: 'https://example.invalid/isp-workflow-test', defaultImage: 'plantation-small.jpg', image: null };
    // Persist intent before the first mutation so an ambiguous response still restores the exact baseline.
    attempt.discoverTouched = true; await save();
    const published = await draftPreviewPublish('discover', '3', data, attempt.initialDiscoverRevision);
    const record = await fresh(guest, 'discover/3'); check(record.exists() && record.get('data.title') === data.title && record.get('revision') === published.revision, 'Discover_public_projection_not_persisted');
    return { fixedPosition: 3, previewBoundPublish: true, publicProjection: true };
  };
  feature.consultation = async () => {
    const requestKey = randomUUID(), id = digest(`${signupRecord.uid}:${requestKey}`); await recordDoc(`consultations/${id}`);
    const request = { category: 'Other enquiry', subject: `TEST ${journal.plan.prefix}`, message: LABEL, requestKey };
    const receipt = await call(member, 'submitConsultation', request), stored = await fresh(member, `consultations/${id}`);
    check(receipt.id === id && stored.exists() && stored.get('ownerUid') === signupRecord.uid && stored.get('message') === request.message && stored.get('reference') === receipt.reference, 'consultation_persistence_failed');
    const adminRecord = (await fresh(admin, `consultations/${id}`)).data();
    check(adminRecord && adminRecord.ownerName === journal.plan.signup.name && adminRecord.ownerEmail === journal.plan.signup.email, 'admin_consultation_contact_snapshot_missing');
    return { persisted: true, storedReference: true, serverDerivedAdminContact: true };
  };
  feature.suspension_restoration = async () => {
    const profileRef = adb.doc(`members/${signupRecord.uid}`), profileBefore = encode((await profileRef.get()).data()), authBefore = await identities.getUser(signupRecord.uid);
    const suspended = await importReviewed(admin, [{ ...journal.plan.signup, status: 'ineligible' }]);
    check(suspended.preview.counts.omitted === 2 && suspended.preview.counts.restoredSuspensions === 0, 'suspension_omission_counts_wrong');
    const ordinary = await importReviewed(admin, [journal.plan.signup]);
    check(ordinary.preview.restoreSuspended === false && ordinary.preview.counts.restoredSuspensions === 0 && ordinary.preview.rows[0].restoreSuspension === false, 'ordinary_eligible_import_must_not_restore');
    const key = digest(journal.plan.signup.memberReference), activeRow = await adb.doc(`memberRegistryVersions/${ordinary.result.activeVersion}/entries/${key}`).get(); check(activeRow.get('accessSuspended') === true, 'sticky_suspension_was_cleared_by_default');
    const deniedKey = randomUUID(); await recordDoc(`consultations/${digest(`${signupRecord.uid}:${deniedKey}`)}`);
    await denied(() => call(member, 'submitConsultation', { category: 'Other enquiry', subject: 'TEST suspended denial', message: LABEL, requestKey: deniedKey }), ['functions/permission-denied']);
    const restored = await importReviewed(admin, [journal.plan.signup], true);
    check(restored.preview.restoreSuspended === true && restored.preview.counts.restoredSuspensions === 1 && restored.preview.rows[0].restoreSuspension === true && restored.preview.counts.omitted === 2, 'explicit_restoration_preview_missing');
    const row = await adb.doc(`memberRegistryVersions/${restored.result.activeVersion}/entries/${key}`).get(); check(row.get('status') === 'eligible' && row.get('accessSuspended') === false, 'explicit_restoration_not_activated');
    check(canonical(encode((await profileRef.get()).data())) === canonical(profileBefore), 'registry_import_must_not_change_member_profile_or_status');
    const authAfter = await identities.getUser(signupRecord.uid); check(authBefore.disabled === authAfter.disabled && canonical(authBefore.customClaims ?? {}) === canonical(authAfter.customClaims ?? {}), 'registry_import_must_not_enable_Auth_or_grant_claims');
    return { omittedPreserved: 2, ordinaryEligibleKeepsSuspension: true, explicitRestorationCount: 1, noAccountActivationOrClaims: true };
  };
  function pdfFixture() {
    const parts = ['%PDF-1.4\n%ISP synthetic proof\n'], offsets = [0];
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(parts.join(''))); parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`); });
    const xref = Buffer.byteLength(parts.join('')); parts.push(`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return Buffer.from(parts.join(''));
  }
  function pngFixture() {
    const crc32 = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
    const chunk = (name, bytes) => { const data = Buffer.concat([Buffer.from(name), bytes]), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(data)); return Buffer.concat([size, data, crc]); };
    const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,255,255,255]))), chunk('IEND', Buffer.alloc(0))]);
  }
  async function upload(parentId, role, bytes, mimeType) {
    check(attempt.attachments.length < 3, 'three_attachment_scan_limit');
    const reservation = await call(admin, 'prepareContentUpload', { kind: 'publication', id: parentId, role, name: `TEST-${role}.${mimeType === 'image/png' ? 'png' : 'pdf'}`, mimeType, size: bytes.length });
    check(reservation.bucket === BUCKET && reservation.storagePath === `contentUploads/publication/${parentId}/${reservation.attachmentId}`, 'upload_reservation_path_mismatch');
    const record = { ...reservation, parentId, role, sha256: digest(bytes), size: bytes.length, contentType: mimeType };
    attempt.attachments.push(record); await save();
    await mutate('client-upload', { storagePath: reservation.storagePath, attachmentId: reservation.attachmentId, sha256: record.sha256, size: bytes.length }, () => clientStorage.uploadBytes(clientStorage.ref(admin.storage, reservation.storagePath), bytes, { contentType: mimeType, cacheControl: 'private, no-store' }), uploaded => { record.uploadGeneration = uploaded.metadata.generation; });
    const finalized = await call(admin, 'finalizeContentUpload', { attachmentId: reservation.attachmentId });
    check(typeof finalized.generation === 'string', 'finalized_generation_missing'); record.generation = finalized.generation; await save();
    return record;
  }
  async function waitForScan(file, expected) {
    const expires = Math.min(endsAt, Date.now() + 540000);
    while (Date.now() < expires) {
      time(); const record = (await adb.doc(`contentAttachments/${file.attachmentId}`).get()).data();
      check(record?.generation === file.generation && record.sha256 === file.sha256, 'scanner_file_tuple_changed');
      if (record.scanStatus !== 'pending') {
        if (expected === 'clean') {
          check(record.scanStatus === 'clean' && record.scan?.scannerId === 'isp-clamav-1.4.6-v1' && record.scan.generation === file.generation && record.scan.sha256 === file.sha256 && record.scan.databaseVersion === release.scanner.dailyVersion && record.scan.databaseManifestSha256 === release.scanner.manifestSha256 && record.scan.engineVersion.startsWith('ClamAV 1.4.6/'), 'trusted_clean_scan_evidence_missing');
        } else check(record.scanStatus === 'rejected' && record.scanError?.code === 'format_validation_failed' && record.scan === null, 'unsafe_format_not_rejected_by_actual_scanner');
        file.scanStatus = record.scanStatus; file.scanEvidence = encode(record.scan ?? record.scanError); await save(); return;
      }
      await pause(5000); // Bounded read polling only: never retrigger, re-finalize or retry a scan.
    }
    check(false, 'trusted_scan_did_not_finish_within_allowance');
  }
  feature.private_files = async () => {
    const id = journal.plan.publicationId, pdfBytes = pdfFixture(), coverBytes = pngFixture();
    const cover = await upload(id, 'cover', coverBytes, 'image/png'); await waitForScan(cover, 'clean');
    const pdf = await upload(id, 'pdf', pdfBytes, 'application/pdf'); await waitForScan(pdf, 'clean');
    const data = { title: `TEST publication ${journal.plan.prefix}`, subtitle: LABEL, author: 'TEST synthetic fixture', issueDate: '2099-01-01', description: LABEL, cover: cover.attachmentId, pdf: pdf.attachmentId };
    const published = await draftPreviewPublish('publication', id, data);
    const projection = await fresh(member, `publications/${id}`); check(projection.exists() && projection.get('data.pdf') === pdf.attachmentId, 'member_publication_projection_missing');
    const metadata = await call(member, 'getContentFile', { kind: 'publication', id, attachmentId: pdf.attachmentId });
    check(metadata.delivery === 'authenticated' && metadata.generation === pdf.generation && metadata.sha256 === pdf.sha256 && metadata.storagePath === pdf.storagePath, 'private_file_metadata_tuple_wrong');
    const url = new URL(`https://${REGION}-${PROJECT}.cloudfunctions.net/downloadContentFile`);
    url.search = new URLSearchParams({ kind: 'publication', id, attachmentId: pdf.attachmentId }).toString();
    const token = await member.auth.currentUser.getIdToken(true);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(120000) });
    check(response.status === 200 && response.headers.get('x-isp-file-generation') === pdf.generation && response.headers.get('x-isp-file-sha256') === pdf.sha256 && /attachment/.test(response.headers.get('content-disposition') ?? '') && response.headers.get('x-content-type-options') === 'nosniff', 'authenticated_binary_download_headers_wrong');
    const bytes = Buffer.from(await response.arrayBuffer()); check(bytes.length === pdfBytes.length && digest(bytes) === pdf.sha256, 'private_binary_download_integrity_failed');
    await denied(() => call(guest, 'getContentFile', { kind: 'publication', id, attachmentId: pdf.attachmentId }), ['functions/unauthenticated', 'functions/permission-denied']);
    await denied(() => clientStorage.getBytes(clientStorage.ref(guest.storage, pdf.storagePath), 25 * 1024 * 1024), ['storage/unauthorized']);
    const anonymous = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) }); check(anonymous.status === 401, 'guest_HTTP_private_download_not_denied'); await anonymous.body?.cancel();
    // An inert text body presented as a PDF exercises actual post-antivirus strict format rejection.
    const unsafe = await upload(id, 'pdf', Buffer.from('ISP TEST: deliberately not a PDF; no executable or malware content.\n'), 'application/pdf');
    await waitForScan(unsafe, 'rejected');
    const unsafeDraft = { ...data, title: `TEST unsafe rejection ${journal.plan.prefix}`, pdf: unsafe.attachmentId };
    const saved = await call(admin, 'saveContentDraft', { kind: 'publication', id, expectedRevision: published.revision, data: unsafeDraft });
    const blockedPreview = await call(admin, 'previewContentDraft', { kind: 'publication', id, expectedRevision: saved.revision });
    check(blockedPreview.attachmentStatus === 'pending', 'rejected_attachment_cannot_be_preview_ready');
    await denied(() => call(admin, 'publishContentDraft', { kind: 'publication', id, expectedRevision: saved.revision, expectedPreviewToken: blockedPreview.previewToken }), ['functions/failed-precondition']);
    check((await fresh(member, `publications/${id}`)).get('data.pdf') === pdf.attachmentId, 'rejected_draft_must_not_replace_published_file');
    await denied(() => call(member, 'getContentFile', { kind: 'publication', id, attachmentId: unsafe.attachmentId }), ['functions/permission-denied']);
    await denied(() => clientStorage.getBytes(clientStorage.ref(guest.storage, unsafe.storagePath), 25 * 1024 * 1024), ['storage/unauthorized']);
    const unsafeUrl = new URL(url); unsafeUrl.searchParams.set('attachmentId', unsafe.attachmentId);
    const adminToken = await admin.auth.currentUser.getIdToken(true);
    const unsafeResponse = await fetch(unsafeUrl, { headers: { Authorization: `Bearer ${adminToken}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    check(unsafeResponse.status === 409, 'rejected_file_binary_download_must_remain_blocked_even_admin'); await unsafeResponse.body?.cancel();
    return { exactGenerationCleanAttachments: 2, privatePublication: true, authenticatedBinaryDownload: true, guestDenied: true, actualUnsafeFormatRejected: true, mirrorAntivirusSelfTest: 'root-sealed PASS receipt', finalizedAttachments: attempt.attachments.length };
  };
  async function inventoryOwned() {
    const uids = ownedUids(), adminUid = attempt.adminUid;
    if (!adminUid) return;
    for (const preview of await bounded(adb.collection('memberRegistryPreviews').where('actorUid', '==', adminUid), 8)) {
      check(preview.id.match(/^[a-f0-9]{32}$/) && preview.get('storagePath') === `registryPreviews/${preview.id}/preview.json`, 'preview_ownership_invalid');
      if (!attempt.previews.includes(preview.id)) attempt.previews.push(preview.id);
      const path = preview.get('storagePath'), generation = preview.get('storageGeneration');
      const [payloadBytes] = await objects.file(path, { generation }).download();
      check(payloadBytes.length <= 65536 && digest(payloadBytes) === preview.get('payloadDigest'), 'owned_preview_payload_integrity_failed');
      const payload = JSON.parse(payloadBytes); check(payload.rows.length <= 3 && payload.rows.every(row => ownAddress(row.email) && ownReference(row.memberReference)), 'foreign_rows_in_owned_preview_cleanup_refused');
      attempt.objects.push({ path, generation, privatePreview: true });
      await recordDoc(preview.ref.path);
    }
    for (const version of await bounded(adb.collection('memberRegistryVersions').where('actorUid', '==', adminUid), 8)) {
      check(attempt.previews.includes(version.get('previewId')) || version.get('fixtureRun') === journal.plan.prefix && (attempt.fixtureOnlyVersions ?? []).includes(version.id), 'registry_version_ownership_invalid');
      if (!attempt.versions.includes(version.id)) attempt.versions.push(version.id);
      for (const row of await bounded(version.ref.collection('entries'), 6)) { check(ownAddress(row.get('email')) && ownReference(row.get('memberReference')) && row.id === digest(row.get('memberReference')), 'foreign_registry_row_cleanup_refused'); await recordDoc(row.ref.path); }
      await recordDoc(version.ref.path);
    }
    for (const attachment of await bounded(adb.collection('contentAttachments').where('ownerUid', '==', adminUid), 3)) {
      const data = attachment.data();
      check(data.kind === 'publication' && [journal.plan.publicationId, journal.plan.unsafeId].includes(data.parentId) && data.storagePath === `contentUploads/publication/${data.parentId}/${attachment.id}` && data.bucket === BUCKET, 'attachment_cleanup_ownership_invalid');
      const file = objects.file(data.storagePath);
      try {
        const [metadata] = await file.getMetadata();
        check(!data.generation || data.generation === metadata.generation, 'attachment_generation_changed_cleanup_refused');
        check(Date.parse(metadata.timeCreated) >= attempt.startedMs - 1000, 'attachment_creation_time_not_owned');
        attempt.objects.push({ path: data.storagePath, generation: metadata.generation });
      } catch (error) { if (error.code !== 404) throw error; }
      await recordDoc(attachment.ref.path);
    }
    // A late upload can materialize after its reservation document was removed by an earlier cleanup.
    // Reconcile the journal's exact reserved path, never infer absence from the attachment query alone.
    for (const upload of attempt.attachments) {
      check(upload.bucket === BUCKET && upload.storagePath === `contentUploads/publication/${upload.parentId}/${upload.attachmentId}` && [journal.plan.publicationId, journal.plan.unsafeId].includes(upload.parentId), 'journal_upload_path_ownership_invalid');
      try {
        const [metadata] = await objects.file(upload.storagePath).getMetadata();
        const expectedGeneration = upload.generation ?? upload.uploadGeneration;
        check(!expectedGeneration || metadata.generation === expectedGeneration, 'late_upload_generation_changed');
        check(Number(metadata.size) === upload.size && metadata.contentType === upload.contentType && Date.parse(metadata.timeCreated) >= attempt.startedMs - 1000, 'late_upload_ownership_metadata_invalid');
        attempt.objects.push({ path: upload.storagePath, generation: metadata.generation });
      } catch (error) { if (error.code !== 404) throw error; }
    }
    for (const uid of uids) {
      for (const collection of ['consultations', 'eventInterests']) for (const record of await bounded(adb.collection(collection).where('ownerUid', '==', uid), 8)) {
        check(collection === 'consultations' ? String(record.get('subject')).startsWith('TEST') : record.get('eventId') === journal.plan.eventId, 'foreign_document_in_owned_UID_cleanup_refused'); await recordDoc(record.ref.path);
      }
      const memberSnapshot = await adb.doc(`members/${uid}`).get();
      if (memberSnapshot.exists) { check(ownAddress(memberSnapshot.get('email')) && ownReference(memberSnapshot.get('membershipReference')), 'foreign_member_document_cleanup_refused'); await recordDoc(memberSnapshot.ref.path); }
    }
    for (const role of ['signup', 'legacy', 'omitted']) {
      const row = journal.plan[role], binding = await adb.doc(`registryBindings/${digest(row.memberReference)}`).get();
      if (binding.exists) { check(uids.has(binding.get('uid')) && binding.get('email') === row.email && binding.get('memberReference') === row.memberReference, 'foreign_UID_binding_cleanup_refused'); await recordDoc(binding.ref.path); }
    }
    attempt.objects = [...new Map(attempt.objects.map(object => [`${object.path}:${object.generation}`, object])).values()]; await save();
  }
  let scanCleanupEndsAt = 0;
  async function scanControlApi(method, kind, name) {
    const credential = backend.options.credential, token = await credential.getAccessToken();
    const host = kind === 'workflow' ? 'https://workflowexecutions.googleapis.com/v1/' : 'https://run.googleapis.com/v2/';
    const suffix = method === 'POST' ? ':cancel' : '';
    const action = async () => {
      const response = await fetch(host + name + suffix, { method, headers: { Authorization: `Bearer ${token.access_token}`, 'X-Goog-User-Project': PROJECT, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}), redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (method === 'POST' && response.status === 409) { await response.body?.cancel(); return { terminalRejection: true }; }
      check(response.ok, 'scan_control_request_failed'); return response.json();
    };
    return method === 'POST' ? mutate(`cleanup-scan-${kind}-cancel`, { name }, action) : action();
  }
  async function quiesceOwnedScanJobs() {
    attempt.scanJobs ??= {};
    if (!attempt.adminUid) return;
    const attachments = await bounded(adb.collection('contentAttachments').where('ownerUid', '==', attempt.adminUid), 3);
    const ids = new Set([...attachments.map(item => item.id), ...attempt.attachments.map(item => item.attachmentId)]);
    for (const attachmentId of ids) {
      const ref = adb.doc(`contentAttachments/${attachmentId}`), fenceId = attempt.scanJobs[attachmentId]?.fenceId ?? randomUUID();
      let fenced;
      await mutate('cleanup-scan-fence', { attachmentId, fenceId }, () => adb.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref), data = snapshot.data();
        if (!data) { check(attempt.scanJobs[attachmentId]?.terminal === true, 'missing_scan_marker_terminal_unknown'); return; }
        check(data.ownerUid === attempt.adminUid && data.kind === 'publication' && [journal.plan.publicationId, journal.plan.unsafeId].includes(data.parentId), 'scan_fence_attachment_not_owned');
        const marker = scanCancellationMarker(data.scanDispatch, fenceId);

        transaction.update(ref, { scanDispatch: marker }); fenced = { data, marker };
      }, { maxAttempts: 1 }));
      if (!fenced) continue;
      const { data, marker } = fenced;
      attempt.scanJobs[attachmentId] = { ...(attempt.scanJobs[attachmentId] ?? {}), fenceId, dispatchId: marker.id, terminal: false }; await save();
      try {
        if (marker.cleanupOnly === true) { attempt.scanJobs[attachmentId].terminal = true; attempt.scanJobs[attachmentId].noLaunch = true; await save(); continue; }
        await reconcileOwnedScanDispatch({ binding: { attachmentId, dispatchId: marker.id, generation: data.generation, sha256: data.sha256, workflowRevision: release.scanner.workflowRevision, imageDigest: release.scanner.imageDigest }, marker, api: scanControlApi, deadlineMs: scanCleanupEndsAt, readMarker: async () => (await ref.get()).get('scanDispatch'), persist: async state => { attempt.scanJobs[attachmentId] = { ...attempt.scanJobs[attachmentId], ...state }; await save(); } });
      } catch (error) { attempt.cleanupState = 'UNKNOWN'; attempt.scanJobs[attachmentId].terminal = false; attempt.scanJobs[attachmentId].code = safeCode(error); await save(); throw error; }
    }
  }
  async function cleanup() {
    cleanupAttempted = true;
    if (!attempt || attempt.cleanupComplete && cleanupCanComplete(attempt)) { journal.cleanupRequired = false; await save(); return; }
    attempt.cleanupStartedAt = new Date().toISOString(); scanCleanupEndsAt = Date.now() + release.cleanupSeconds * 1000; await save();
    // Recover a client-created UID after an ambiguous response only by its pre-journaled unique synthetic email.
    for (const record of attempt.users) await ownedIdentity(record);
    await inventoryOwned();
    await quiesceOwnedScanJobs();
    if (attempt.baseline) {
      await assertOnlyOwnedMembers();
      check(attempt.docs.length + 3 <= 400, 'atomic_cleanup_document_limit_exceeded');
      await mutate('cleanup-atomic-baseline', { planSha256: journal.planSha256 }, () => adb.runTransaction(async transaction => {
        const memberRange = await transaction.get(adb.collection('members').limit(11));
        check(memberRange.size <= 10 && memberRange.docs.every(row => ownedUids().has(row.id) && ownAddress(row.get('email')) && ownReference(row.get('membershipReference'))), 'foreign_member_appeared_cleanup_refused');
        const specialRefs = ['registryState/current', 'discoverDrafts/3', 'discover/3'].map(path => adb.doc(path));
        const snapshots = await transaction.getAll(...specialRefs, ...attempt.docs.map(path => adb.doc(path)));
        const [state, discoverDraft, discoverPublished] = snapshots;
        const active = state.get('activeVersion');
        check(stamp(state) === attempt.baseline.registryState.sha256 || attempt.versions.includes(active) && state.get('updatedBy') === attempt.adminUid, 'foreign_registry_pointer_cleanup_refused');
        const discoverSnapshots = [discoverDraft, discoverPublished], baselineDiscover = [attempt.baseline.discover.draft, attempt.baseline.discover.published];
        for (let index = 0; index < 2; index++) {
          const current = discoverSnapshots[index];
          const unchanged = stamp(current) === hash(baselineDiscover[index]);
          const own = attempt.discoverTouched && current.exists && current.get('data.title') === `TEST Discover ${journal.plan.prefix}` && current.get('data.description') === LABEL && current.get('revision') === attempt.initialDiscoverRevision + 1 && (index === 1 || current.get('updatedBy') === attempt.adminUid);
          check(unchanged || own, 'foreign_Discover_change_cleanup_refused');
        }
        for (const snapshot of snapshots.slice(3)) {
          if (!snapshot.exists) continue;
          const path = snapshot.ref.path, data = snapshot.data();
          if (path.startsWith('staff/')) check(snapshot.id === attempt.adminUid && data.fixtureRun === journal.plan.prefix, 'foreign_staff_cleanup_refused');
          else if (path.startsWith('members/')) check(ownedUids().has(snapshot.id) && ownAddress(data.email) && ownReference(data.membershipReference), 'foreign_member_cleanup_refused');
          else if (path.startsWith('registryBindings/')) check(ownedUids().has(data.uid) && ownAddress(data.email) && ownReference(data.memberReference), 'foreign_binding_cleanup_refused');
          else if (path.startsWith('memberRegistryPreviews/')) check(data.actorUid === attempt.adminUid && attempt.previews.includes(snapshot.id), 'foreign_preview_cleanup_refused');
          else if (path.startsWith('memberRegistryVersions/')) check(path.split('/').length === 2 ? data.actorUid === attempt.adminUid && attempt.versions.includes(snapshot.id) : ownAddress(data.email) && ownReference(data.memberReference) && attempt.versions.includes(path.split('/')[1]), 'foreign_version_cleanup_refused');
          else if (path.startsWith('contentAttachments/')) {
            check(data.ownerUid === attempt.adminUid && [journal.plan.publicationId, journal.plan.unsafeId].includes(data.parentId), 'foreign_attachment_cleanup_refused');
            const receipt = attempt.scanJobs[snapshot.id];
            check(receipt?.terminal === true && data.scanDispatch?.cancelled === true && data.scanDispatch?.id === receipt.dispatchId && data.scanDispatch?.cleanupFenceId === receipt.fenceId, 'scan_terminal_barrier_required_before_delete');
          }
          else if (path.startsWith('consultations/')) check(ownedUids().has(data.ownerUid) && String(data.subject).startsWith('TEST'), 'foreign_consultation_cleanup_refused');
          else if (path.startsWith('eventInterests/')) check(ownedUids().has(data.ownerUid) && data.eventId === journal.plan.eventId, 'foreign_interest_cleanup_refused');
          else check([journal.plan.eventId, journal.plan.publicationId, journal.plan.unsafeId].includes(snapshot.id) && (data.createdBy === attempt.adminUid || String(data.data?.title).includes(journal.plan.prefix) && String(data.data?.title).startsWith('TEST')), 'foreign_content_cleanup_refused');
        }
        // The active pointer, fixed Discover documents and all owned Firestore fixtures change atomically.
        const restore = (ref, value) => value === null ? transaction.delete(ref) : transaction.set(ref, decode(value));
        restore(specialRefs[0], attempt.baseline.registryState.value);
        restore(specialRefs[1], attempt.baseline.discover.draft); restore(specialRefs[2], attempt.baseline.discover.published);
        for (const snapshot of snapshots.slice(3)) if (snapshot.exists) transaction.delete(snapshot.ref);
      }, { maxAttempts: 1 }));
      attempt.firestoreRestored = true; await save();
    }
    for (const object of attempt.objects) {
      check(object.privatePreview ? /^registryPreviews\/[a-f0-9]{32}\/preview\.json$/.test(object.path) && attempt.previews.includes(object.path.split('/')[1]) : object.path.startsWith(`contentUploads/publication/${journal.plan.publicationId}/`) || object.path.startsWith(`contentUploads/publication/${journal.plan.unsafeId}/`), 'object_cleanup_path_not_owned');
      check(/^\d+$/.test(String(object.generation)), 'object_cleanup_generation_required');
      await mutate('cleanup-object-delete', { path: object.path, generation: object.generation }, () => objects.file(object.path, { generation: object.generation }).delete({ ifGenerationMatch: object.generation, ignoreNotFound: true }));
      object.deleted = true; await save();
    }
    for (const record of attempt.users) { const user = await ownedIdentity(record); if (user) await mutate('cleanup-user-delete', { uid: user.uid }, () => identities.deleteUser(user.uid)); record.deleted = true; await save(); }
    attempt.cleanupComplete = cleanupCanComplete(attempt); attempt.cleanupState = attempt.cleanupComplete ? 'COMPLETE' : 'UNKNOWN';
    if (attempt.cleanupComplete) attempt.cleanupCompletedAt = new Date().toISOString(); else process.exitCode = 1;
    journal.cleanupRequired = !attempt.cleanupComplete; await save();
  }
  try {
    if (cleanupOnly) { check(journal.cleanupRequired === true, 'no_owned_cleanup_pending'); applyTerminalEvidence(attempt, journal.planSha256, release.resolvedMutations ?? []); await save(); await cleanup(); return; }
    check(!journal.cleanupRequired, 'previous_owned_cleanup_required');
    check(!journal.attempts.some(previous => previous.releaseSha256 === releaseSha256), 'release_allows_one_execution_only_new_review_required');
    const selected = AREAS.filter(area => release.areas.includes(area) && journal.results[area].status !== 'PASS'); check(selected.length > 0, 'no_unpassed_area_selected');
    attempt = { number: journal.attempts.length + 1, startedMs: Date.now(), startedAt: new Date().toISOString(), releaseSha256, sourceCommit: release.commit, areas: selected, docs: [], users: [], objects: [], previews: [], versions: [], attachments: [], cleanupComplete: false };
    journal.attempts.push(attempt); journal.cleanupRequired = true; await save();
    await captureBaseline();
    admin = await administrator(); guest = await session('guest');
    ({ who: member, record: signupRecord } = await createIdentity('signup', true));
    await verifyOwnedSignup(member, signupRecord);
    ({ record: legacyRecord } = await createIdentity('legacy')); await legacyProfile(legacyRecord);
    legacy = await session('legacy', journal.credentials.legacy); await createIdentity('conflict');
    if (!selected.includes('enrollment_registry')) {
      check(journal.results.enrollment_registry.status === 'PASS' && release.acceptPassedAreas?.enrollment_registry === journal.results.enrollment_registry.releaseSha256, 'continuation_requires_approved_enrollment_proof');
      await seedFixtureRegistry(signupRecord, legacyRecord);
    }
    for (const area of selected) {
      currentArea = area; time(); journal.results[area] = { status: 'RUNNING', releaseSha256, startedAt: new Date().toISOString() }; await save();
      const evidence = await feature[area]();
      journal.results[area] = { status: 'PASS', releaseSha256, sourceCommit: release.commit, completedAt: new Date().toISOString(), evidence }; await save();
    }
  } catch (error) {
    if (currentArea) journal.results[currentArea] = { status: 'FAIL', releaseSha256, failedAt: new Date().toISOString(), code: safeCode(error) };
    if (attempt) attempt.failure = { phase: currentArea ?? (cleanupOnly ? 'cleanup' : 'prerequisite_setup'), code: safeCode(error), at: new Date().toISOString() };
    await save(); process.exitCode = 1;
  } finally {
    if (journal.cleanupRequired && attempt && !cleanupAttempted) {
      try { await cleanup(); } catch (error) { attempt.cleanupFailure = { code: safeCode(error), at: new Date().toISOString() }; journal.cleanupRequired = true; await save(); process.exitCode = 1; }
    }
    for (const who of sessions) { try { await clientAuth.signOut(who.auth); await clientApp.deleteApp(who.app); } catch { /* No raw provider errors or credentials are printed. */ } }
    try { await adminApp.deleteApp(backend); } catch { /* Supervisor enforces a hard outer deadline. */ }
  }
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) try {
  if (mode === '--plan') planOutput();
  else if (mode === '--prepare') await prepare();
  else if (mode === '--execute' || mode === '--cleanup') await supervise(mode === '--cleanup');
  else await worker(mode === '--cleanup-worker');
} catch (error) {
  // Deliberately omit provider messages, emails, tokens, filenames and local credential paths.
  console.error(`HOLD ${safeCode(error)}`); process.exitCode = 1;
}
