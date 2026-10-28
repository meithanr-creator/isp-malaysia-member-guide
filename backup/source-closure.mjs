import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { requireThat, sha256 } from './manifest.mjs';
// Explicit nonsecret rebuild closure; no environment, credential, audit or generated runtime files.
export const SOURCE_PATHS = Object.freeze([
  "infra/scanner-job-launcher-role.yaml",
  "infra/scanner-workflow-role.yaml",
  "infra/scanner-dispatch-workflow.yaml",
  "scanner/test_job_entry.py",
  "scanner/job_entry.py",
  "backup/sdk-contract.mjs",
  "backup/restore-probe.mjs",
  "docs/CONTROLLED-RESTORE-PROOF.md",
  "public/assets/isp-512.png",
  "public/service-worker.js",
  "public/manifest.webmanifest",
  ".firebaserc",
  "backup/Dockerfile",
  "backup/Dockerfile.dockerignore",
  "backup/README.md",
  "backup/job.mjs",
  "backup/manifest.mjs",
  "backup/manifest.test.mjs",
  "backup/package-lock.json",
  "backup/package.json",
  "backup/review-fixes.test.mjs",
  "backup/source-closure.mjs",
  "backup/watchdog.mjs",
  "firebase.json",
  "firestore.indexes.json",
  "firestore.rules",
  "functions/package-lock.json",
  "functions/package.json",
  "functions/src/content.ts",
  "functions/src/download.ts",
  "functions/src/enrollment.ts",
  "functions/src/index.ts",
  "functions/src/registry.ts",
  "functions/src/runtime.ts",
  "functions/src/validation.ts",
  "functions/tsconfig.json",
  "index.html",
  "infra/backup-reader-role.yaml",
  "infra/backup-staging-lifecycle.json",
  "package-lock.json",
  "package.json",
  "public/assets/arrow-left.svg",
  "public/assets/bar-chart-line.svg",
  "public/assets/book.svg",
  "public/assets/box-arrow-right.svg",
  "public/assets/calendar3.svg",
  "public/assets/chevron-right.svg",
  "public/assets/event-palms.jpg",
  "public/assets/file-earmark-text.svg",
  "public/assets/geo-alt.svg",
  "public/assets/house-door-fill.svg",
  "public/assets/isp-180.png",
  "public/assets/isp-192.png",
  "public/assets/isp-crest.png",
  "public/assets/journal-bookmark.svg",
  "public/assets/list.svg",
  "public/assets/member-collection.jpg",
  "public/assets/member-consultation.jpg",
  "public/assets/member-events.jpg",
  "public/assets/newsreader-license.txt",
  "public/assets/newsreader.ttf",
  "public/assets/people-fill.svg",
  "public/assets/plantation-small.jpg",
  "public/assets/planter-cover.jpg",
  "public/assets/plus-lg.svg",
  "public/assets/source-sans-3-license.txt",
  "public/assets/source-sans-3.ttf",
  "public/assets/welcome-palms.jpg",
  "public/backup-connect.html",
  "public/backup-info.css",
  "public/backup-privacy.html",
  "public/backup-use.html",
  "scanner/.dockerignore",
  "scanner/Dockerfile",
  "scanner/README.md",
  "scanner/mirror.py",
  "scanner/policy.py",
  "scanner/requirements.txt",
  "scanner/scanner.py",
  "scanner/test_policy.py",
  "scanner/test_review_fixes.py",
  "scanner/test_receiver_http.py",
  "scanner/validate_file.py",
  "src/ActivateAccount.tsx",
  "src/App.tsx",
  "src/ContentPages.tsx",
  "src/content.ts",
  "src/enrollment.ts",
  "src/firebase.ts",
  "src/main.tsx",
  "src/styles.css",
  "src/vite-env.d.ts",
  "storage-cors.json",
  "storage.rules",
  "tsconfig.json"
]);
const allowed = new Set(SOURCE_PATHS);
export function assertSourcePath(value) { requireThat(typeof value === 'string' && allowed.has(value), 'UNREVIEWED_SOURCE_FILE_REFUSED'); }
export function assertSourceClosure(paths) {
  requireThat(Array.isArray(paths) && paths.length === allowed.size && new Set(paths).size === allowed.size, 'SOURCE_REBUILD_CLOSURE_INCOMPLETE');
  for (const value of paths) assertSourcePath(value);
}


export const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_SOURCE_TOTAL_BYTES = 32 * 1024 * 1024;
async function requiredStat(target) {
  try { return await fs.lstat(target); }
  catch (error) { if (error.code === 'ENOENT') requireThat(false, 'SOURCE_REQUIRED_PATH_MISSING'); throw error; }
}
async function plainDirectory(target) {
  const stat = await requiredStat(target);
  requireThat(!stat.isSymbolicLink() && stat.isDirectory(), 'SOURCE_PARENT_LINK_OR_TYPE_REFUSED');
}
async function plainRoot(root) {
  const parsed = path.parse(root); let current = parsed.root;
  await plainDirectory(current);
  for (const part of root.slice(parsed.root.length).split(path.sep).filter(Boolean)) { current = path.join(current, part); await plainDirectory(current); }
}
export async function readSourceArchive(sourceRoot, sourceVersion) {
  requireThat(typeof sourceRoot === 'string' && path.isAbsolute(sourceRoot) && /^[a-f0-9]{40}$/.test(sourceVersion || ''), 'SOURCE_ROOT_OR_VERSION_INVALID');
  const root = path.resolve(sourceRoot), files = []; let total = 0;
  await plainRoot(root); assertSourceClosure([...SOURCE_PATHS]);
  for (const relative of SOURCE_PATHS) {
    assertSourcePath(relative);
    const parts = relative.split('/');
    requireThat(!path.isAbsolute(relative) && !/[\\\u0000]/.test(relative) && parts.every(part => part && part !== '.' && part !== '..'), 'SOURCE_PATH_ESCAPE_REFUSED');
    const target = path.resolve(root, ...parts), within = path.relative(root, target);
    requireThat(within && !path.isAbsolute(within) && within !== '..' && !within.startsWith('..' + path.sep), 'SOURCE_PATH_ESCAPE_REFUSED');
    let parent = root;
    for (const part of parts.slice(0, -1)) { parent = path.join(parent, part); await plainDirectory(parent); }
    const before = await requiredStat(target);
    requireThat(!before.isSymbolicLink() && before.isFile(), 'SOURCE_FILE_LINK_OR_TYPE_REFUSED');
    requireThat(Number.isSafeInteger(before.size) && before.size >= 0 && before.size <= MAX_SOURCE_FILE_BYTES, 'SOURCE_FILE_SIZE_EXCEEDED');
    total += before.size; requireThat(total <= MAX_SOURCE_TOTAL_BYTES, 'SOURCE_TOTAL_SIZE_EXCEEDED');
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW || 0));
    const handle = await fs.open(target, flags);
    try {
      const opened = await handle.stat();
      requireThat(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size, 'SOURCE_FILE_CHANGED_DURING_OPEN');
      const bytes = Buffer.alloc(opened.size); let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
        requireThat(result.bytesRead > 0, 'SOURCE_FILE_READ_INCOMPLETE'); offset += result.bytesRead;
      }
      const extra = await handle.read(Buffer.alloc(1), 0, 1, opened.size), after = await handle.stat(), finalPath = await requiredStat(target);
      requireThat(extra.bytesRead === 0 && after.size === opened.size && after.mtimeMs === opened.mtimeMs && !finalPath.isSymbolicLink() && finalPath.isFile() && finalPath.dev === opened.dev && finalPath.ino === opened.ino && finalPath.size === opened.size && finalPath.mtimeMs === opened.mtimeMs, 'SOURCE_FILE_CHANGED_DURING_READ');
      files.push({ path: relative, sha256: sha256(bytes), bytesBase64: bytes.toString('base64') });
    } finally { await handle.close(); }
  }
  assertSourceClosure(files.map(file => file.path));
  return { sourceVersion, coverage: 'Exact nonsecret frontend, Functions, scanner and backup rebuild inputs; operator-supplied environment and live console configuration excluded.', files };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  requireThat(process.argv[2] === '--contract' && process.argv.length === 4, 'SOURCE_CONTRACT_ARGUMENTS_REQUIRED');
  const archive = await readSourceArchive(process.argv[3], process.env.ISP_SOURCE_VERSION);
  console.log(JSON.stringify({ contract: 'actual explicit source archive reader', files: archive.files.length, rawBytes: archive.files.reduce((sum, file) => sum + Buffer.from(file.bytesBase64, 'base64').length, 0), maxFileBytes: MAX_SOURCE_FILE_BYTES, maxTotalBytes: MAX_SOURCE_TOTAL_BYTES, unlistedFilesArchived: 0, providerCalls: 0 }));
}
