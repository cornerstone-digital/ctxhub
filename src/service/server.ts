import http from 'node:http';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve, relative } from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { listWorkspaces } from '../workspaces/registry.js';
import { authenticate } from '../auth/middleware.js';
import { loadWorkspaceConfig, saveConfig } from '../config/config.js';
import { buildDoctorChecks, runDoctorChecks, type CheckLine } from '../commands/doctorChecks.js';
import { getPackageVersion } from '../utils/version.js';
import { renderFleetViewHtml } from './fleetView.js';
import { createExplainResult } from '../commands/explain.js';
import { indexWorkspace, type IndexProgressEvent, type IndexResult } from '../indexing/indexer.js';
import { notify } from '../utils/notify.js';
import { eventBus, type CtxhubEventEnvelope } from '../events/eventBus.js';
import { readEventLog } from '../events/eventLog.js';
import { addCaptainTask, getCaptainTask, loadCaptainTasks, removeCaptainTask, type CaptainTask } from '../captains/tasks.js';
import { listCaptainRuns, promoteCaptainRun, runCaptainTask } from '../captains/runner.js';
import { getCaptainStats } from '../captains/captainStats.js';
import { buildKnowledgeGraph, findKnowledgeGraphNodeContent, expandKnowledgeGraphNode } from '../indexing/knowledgeGraph.js';
import { isGitRepo } from '../git/git.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { CtxhubConfig, ExecutionProfile, RepoConfig } from '../config/types.js';
import { getSkillsStatus, installSkills } from '../commands/skills.js';
import { getPersonasStatus, initPersonas, syncPersonas } from '../commands/personas.js';
import { createReviewResult, loadReviewerProfiles, DEFAULT_REVIEW_PROFILES_PATH } from '../commands/review.js';
import { addJobDefinition, getJobDefinition, listJobRuns, loadJobDefinitions, loadJobRun, removeJobDefinition } from '../jobs/jobStore.js';
import { createGroup, addOrg, removeOrg, updateSharing, resolveOrgForUser, canSearchCrossOrg } from '../groups/groups.js';
import { loadGroupStore, findGroup, findOrgsByGroup } from '../groups/store.js';
import type { SharingMode, TrustTier } from '../groups/types.js';
import type { Principal } from '../auth/types.js';
import { hasRole } from '../auth/jwt.js';
import { startJobBackground } from '../jobs/runner.js';
import type { JobDefinition } from '../jobs/types.js';
import type { EvalCase, EvalSuite } from '../commands/eval.js';
import { CACHE_DIR } from '../config/config.js';
import { RateLimiter, extractClientIp } from './rateLimiter.js';
import { verifyShareToken, getShareSecret, getSharesDir } from '../commands/share.js';

// docs/control-plane.md Phase 2, extended: the registry-over-HTTP API plus an in-process event
// bus (src/events/eventBus.ts) fed by real producers -- index jobs and Captain runs -- and
// exposed to subscribers over SSE (GET /events) below. Desktop notifications are just one more
// subscriber (see the eventBus.subscribe call below), not something index jobs call directly.
export const DEFAULT_SERVICE_PORT = 7342;

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Auth routes are tighter (10 req/min) to limit brute-force attempts. All other
// routes get 100 req/min per IP. Windows reset whole (not rolling) every 60 s.
const authRateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 10 });
const defaultRateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 100 });

// Desktop notifications are a bus subscriber like any other -- the indexer/captains publish
// facts, they don't know or care that this listener happens to shell out to osascript/notify-send.
eventBus.subscribe(event => {
  if (event.type === 'index.completed') {
    notify('ctxhub', `Finished indexing "${event.workspace}" — ${event.result.indexed} indexed, ${event.result.deleted} deleted`);
  } else if (event.type === 'index.failed') {
    notify('ctxhub', `Indexing "${event.workspace}" failed: ${event.error}`);
  } else if (event.type === 'captain.run.completed') {
    notify('ctxhub', `Captain "${event.task}" finished on "${event.workspace}"`);
  } else if (event.type === 'captain.run.failed') {
    notify('ctxhub', `Captain "${event.task}" failed on "${event.workspace}": ${event.error}`);
  }
});

export type IndexJobStatus = 'idle' | 'running' | 'done' | 'error';

export type IndexJobState = {
  status: IndexJobStatus;
  repo?: string;
  scanned: number;
  total: number;
  startedAt?: string;
  finishedAt?: string;
  result?: IndexResult;
  error?: string;
};

// In-memory only -- one process per `ctxhub service`, and job state resets on restart same as
// nothing having run yet. Keyed by registry workspace name (not path) so it lines up with the
// same name the UI already polls /workspaces/:name/status under.
const indexJobs = new Map<string, IndexJobState>();

function getIndexJobState(name: string): IndexJobState {
  return indexJobs.get(name) ?? { status: 'idle', scanned: 0, total: 0 };
}

// Fires the index run and returns immediately -- callers get the just-started state back and
// poll GET .../index-status for progress, same polling model as the rest of this API.
function startIndexJob(name: string, workspacePath: string): IndexJobState {
  const existing = indexJobs.get(name);
  if (existing?.status === 'running') return existing;

  const state: IndexJobState = { status: 'running', scanned: 0, total: 0, startedAt: new Date().toISOString() };
  indexJobs.set(name, state);
  eventBus.publish({ type: 'index.started', workspace: name });

  void indexWorkspace(workspacePath, false, (event: IndexProgressEvent) => {
    if (event.type === 'repo-progress') {
      state.repo = event.repo;
      state.scanned = event.scanned;
      state.total = event.total;
      eventBus.publish({ type: 'index.progress', workspace: name, repo: event.repo, scanned: event.scanned, total: event.total });
    }
  })
    .then(result => {
      state.status = 'done';
      state.result = result;
      state.finishedAt = new Date().toISOString();
      eventBus.publish({ type: 'index.completed', workspace: name, result });
    })
    .catch((error: unknown) => {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : String(error);
      state.finishedAt = new Date().toISOString();
      eventBus.publish({ type: 'index.failed', workspace: name, error: state.error });
    });

  return state;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIST = join(__dirname, '..', '..', 'ui', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};

export type WorkspaceStatusResponse = {
  name: string;
  path: string;
  checks: CheckLine[];
};

class PayloadTooLargeError extends Error {
  constructor() { super('Request body exceeds 1MB limit.'); this.name = 'PayloadTooLargeError'; }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  // Fast path: reject before reading the stream when Content-Length is declared too large.
  const declaredLength = req.headers['content-length'];
  if (declaredLength && parseInt(declaredLength, 10) > 1_048_576) {
    throw new PayloadTooLargeError();
  }

  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += String(chunk);
      if (data.length > 1_048_576) { // 1 MB
        req.destroy();
        reject(new PayloadTooLargeError());
      }
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ── Security headers ──────────────────────────────────────────────────────────
// Applied to every response before any routing logic runs. The dashboard HTML
// route overrides CSP with a looser policy since it embeds inline scripts/styles.
function addSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
}

export function createServiceServer(): http.Server {
  return http.createServer((req, res) => {
    void handleRequest(req, res).catch(error => {
      if (error instanceof PayloadTooLargeError) {
        sendJson(res, 413, { error: 'payload_too_large', hint: 'Request body exceeds 1MB limit.' });
      } else {
        sendJson(res, 500, { error: (error as Error).message });
      }
    });
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // Security headers — applied first, before any routing or auth checks.
  addSecurityHeaders(res);

  // CORS headers for dev (Vite dev server proxies in prod)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Rate limiting — applied before auth so that even unauthenticated callers are guarded.
  {
    const clientIp = extractClientIp(req.headers as Record<string, string | string[] | undefined>, req.socket.remoteAddress);
    const isAuthRoute = url.pathname.startsWith('/auth/');
    const limiter = isAuthRoute ? authRateLimiter : defaultRateLimiter;
    const key = `${isAuthRoute ? 'auth' : 'default'}:${clientIp}`;
    if (!limiter.check(key)) {
      sendJson(res, 429, { error: 'rate_limit_exceeded', hint: 'Too many requests. Try again shortly.' });
      return;
    }
  }

  // Auth — when Entra ID is configured, every non-public route requires a valid Bearer JWT.
  // In local mode (no auth configured) this is a no-op and every caller gets owner access.
  const authOutcome = await authenticate(req, url);
  if (!authOutcome.ok) {
    sendJson(res, authOutcome.status, {
      error: authOutcome.code,
      hint: authOutcome.hint,
    });
    return;
  }

  // Serve React UI from ui/dist if built, else fallback to fleet HTML
  if (req.method === 'GET' && url.pathname === '/') {
    // Dashboard HTML embeds inline <script> and <style> — loosen CSP to allow it.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    const indexPath = join(UI_DIST, 'index.html');
    const indexExists = await fsPromises.access(indexPath).then(() => true).catch(() => false);
    if (indexExists) {
      const html = await fsPromises.readFile(indexPath, 'utf-8');
      sendHtml(res, 200, html);
    } else {
      sendHtml(res, 200, renderFleetViewHtml());
    }
    return;
  }

  // Serve Vite build assets
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    const filePath = join(UI_DIST, url.pathname);
    const fileExists = await fsPromises.access(filePath).then(() => true).catch(() => false);
    if (fileExists) {
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      const content = await fsPromises.readFile(filePath);
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length });
      res.end(content);
    } else {
      sendJson(res, 404, { error: 'Asset not found' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', version: getPackageVersion() });
    return;
  }

  // ── Global multi-workspace search ─────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/search') {
    await handleGlobalSearch(res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    handleEventStream(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events/history') {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
    const before = url.searchParams.get('before') ?? undefined;
    const types = url.searchParams.get('types')?.split(',').filter(Boolean);
    const events = await readEventLog({ limit, before, types });
    sendJson(res, 200, { events, count: events.length });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/workspaces') {
    const workspaces = await listWorkspaces();
    sendJson(res, 200, { workspaces });
    return;
  }

  // ── Workspace-level role check ────────────────────────────────────────────
  // For any /workspaces/:name/* route: if the workspace config declares allowedRoles,
  // verify the principal has at least one matching role. Local mode (roles: ['owner'])
  // always passes since owners are never restricted.
  const workspaceRouteMatch = /^\/workspaces\/([^/]+)(?:\/|$)/.exec(url.pathname);
  if (workspaceRouteMatch && url.pathname !== '/workspaces') {
    const wsName = decodeURIComponent(workspaceRouteMatch[1]);
    const workspaces = await listWorkspaces();
    const wsEntry = workspaces.find(w => w.name === wsName);
    if (wsEntry?.exists) {
      try {
        const { config: wsConfig } = await loadWorkspaceConfig(wsEntry.path);
        const allowedRoles = wsConfig.workspace.allowedRoles;
        if (allowedRoles && allowedRoles.length > 0) {
          const principal = authOutcome.principal;
          const hasAccess = principal.roles.some(r => allowedRoles.includes(r));
          if (!hasAccess) {
            sendJson(res, 403, { error: 'forbidden', hint: 'Your role does not permit access to this workspace' });
            return;
          }
        }
      } catch {
        // Config unreadable — let the downstream handler return the appropriate error
      }
    }
  }

  const statusMatch = /^\/workspaces\/([^/]+)\/status$/.exec(url.pathname);
  if (req.method === 'GET' && statusMatch) {
    await handleWorkspaceStatus(res, decodeURIComponent(statusMatch[1]));
    return;
  }

  const indexMatch = /^\/workspaces\/([^/]+)\/index$/.exec(url.pathname);
  if (req.method === 'POST' && indexMatch) {
    await handleWorkspaceIndexStart(res, decodeURIComponent(indexMatch[1]));
    return;
  }

  const indexStatusMatch = /^\/workspaces\/([^/]+)\/index-status$/.exec(url.pathname);
  if (req.method === 'GET' && indexStatusMatch) {
    sendJson(res, 200, getIndexJobState(decodeURIComponent(indexStatusMatch[1])));
    return;
  }

  const reposMatch = /^\/workspaces\/([^/]+)\/repos$/.exec(url.pathname);
  if (req.method === 'GET' && reposMatch) {
    await handleWorkspaceRepos(res, decodeURIComponent(reposMatch[1]));
    return;
  }
  if (req.method === 'POST' && reposMatch) {
    await handleAddRepo(req, res, decodeURIComponent(reposMatch[1]));
    return;
  }

  const repoDeleteMatch = /^\/workspaces\/([^/]+)\/repos\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && repoDeleteMatch) {
    await handleRemoveRepo(res, decodeURIComponent(repoDeleteMatch[1]), decodeURIComponent(repoDeleteMatch[2]));
    return;
  }

  const configMatch = /^\/workspaces\/([^/]+)\/config$/.exec(url.pathname);
  if (req.method === 'GET' && configMatch) {
    await handleGetConfig(res, decodeURIComponent(configMatch[1]));
    return;
  }
  if (req.method === 'PATCH' && configMatch) {
    await handlePatchConfig(req, res, decodeURIComponent(configMatch[1]));
    return;
  }

  const profilesMatch = /^\/workspaces\/([^/]+)\/execution-profiles$/.exec(url.pathname);
  if (req.method === 'POST' && profilesMatch) {
    await handleUpsertExecutionProfile(req, res, decodeURIComponent(profilesMatch[1]));
    return;
  }

  const profileDeleteMatch = /^\/workspaces\/([^/]+)\/execution-profiles\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && profileDeleteMatch) {
    await handleRemoveExecutionProfile(res, decodeURIComponent(profileDeleteMatch[1]), decodeURIComponent(profileDeleteMatch[2]));
    return;
  }

  const skillsMatch = /^\/workspaces\/([^/]+)\/skills$/.exec(url.pathname);
  if (req.method === 'GET' && skillsMatch) {
    await handleGetSkillsStatus(res, decodeURIComponent(skillsMatch[1]));
    return;
  }

  const skillsInstallMatch = /^\/workspaces\/([^/]+)\/skills\/install$/.exec(url.pathname);
  if (req.method === 'POST' && skillsInstallMatch) {
    await handleInstallSkills(req, res, decodeURIComponent(skillsInstallMatch[1]));
    return;
  }

  const personasMatch = /^\/workspaces\/([^/]+)\/personas$/.exec(url.pathname);
  if (req.method === 'GET' && personasMatch) {
    await handleGetPersonasStatus(res, decodeURIComponent(personasMatch[1]));
    return;
  }

  const personasInitMatch = /^\/workspaces\/([^/]+)\/personas\/init$/.exec(url.pathname);
  if (req.method === 'POST' && personasInitMatch) {
    await handleInitPersonas(res, decodeURIComponent(personasInitMatch[1]));
    return;
  }

  const personasSyncMatch = /^\/workspaces\/([^/]+)\/personas\/sync$/.exec(url.pathname);
  if (req.method === 'POST' && personasSyncMatch) {
    await handleSyncPersonas(req, res, decodeURIComponent(personasSyncMatch[1]));
    return;
  }

  const knowledgeGraphMatch = /^\/workspaces\/([^/]+)\/knowledge-graph$/.exec(url.pathname);
  if (req.method === 'GET' && knowledgeGraphMatch) {
    await handleKnowledgeGraph(res, decodeURIComponent(knowledgeGraphMatch[1]));
    return;
  }

  const knowledgeGraphNodeMatch = /^\/workspaces\/([^/]+)\/knowledge-graph\/node$/.exec(url.pathname);
  if (req.method === 'GET' && knowledgeGraphNodeMatch) {
    const nodeId = url.searchParams.get('id');
    if (!nodeId) {
      sendJson(res, 400, { error: 'Missing "id" query parameter' });
      return;
    }
    await handleKnowledgeGraphNode(res, decodeURIComponent(knowledgeGraphNodeMatch[1]), nodeId);
    return;
  }

  const knowledgeGraphExpandMatch = /^\/workspaces\/([^/]+)\/knowledge-graph\/expand$/.exec(url.pathname);
  if (req.method === 'GET' && knowledgeGraphExpandMatch) {
    const nodeId = url.searchParams.get('id');
    if (!nodeId) {
      sendJson(res, 400, { error: 'Missing "id" query parameter' });
      return;
    }
    await handleKnowledgeGraphExpand(res, decodeURIComponent(knowledgeGraphExpandMatch[1]), nodeId);
    return;
  }

  const chatMatch = /^\/workspaces\/([^/]+)\/chat$/.exec(url.pathname);
  if (req.method === 'POST' && chatMatch) {
    await handleWorkspaceChat(req, res, decodeURIComponent(chatMatch[1]), url, authOutcome.principal);
    return;
  }

  const searchMatch = /^\/workspaces\/([^/]+)\/search$/.exec(url.pathname);
  if (req.method === 'GET' && searchMatch) {
    await handleWorkspaceSearch(res, decodeURIComponent(searchMatch[1]), url, req);
    return;
  }

  const reviewProfilesMatch = /^\/workspaces\/([^/]+)\/review-profiles$/.exec(url.pathname);
  if (req.method === 'GET' && reviewProfilesMatch) {
    await handleReviewProfiles(res, decodeURIComponent(reviewProfilesMatch[1]));
    return;
  }

  const reviewMatch = /^\/workspaces\/([^/]+)\/review$/.exec(url.pathname);
  if (req.method === 'POST' && reviewMatch) {
    await handleWorkspaceReview(req, res, decodeURIComponent(reviewMatch[1]));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/captains') {
    const { tasks } = await loadCaptainTasks();
    sendJson(res, 200, { tasks });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/captains/stats') {
    const stats = await getCaptainStats();
    sendJson(res, 200, { stats });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/captains') {
    await handleCaptainCreate(req, res);
    return;
  }

  const captainDeleteMatch = /^\/captains\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && captainDeleteMatch) {
    const removed = await removeCaptainTask(decodeURIComponent(captainDeleteMatch[1]));
    sendJson(res, 200, { removed });
    return;
  }

  const captainRunMatch = /^\/captains\/([^/]+)\/run$/.exec(url.pathname);
  if (req.method === 'POST' && captainRunMatch) {
    await handleCaptainRun(res, decodeURIComponent(captainRunMatch[1]));
    return;
  }

  const captainRunsMatch = /^\/captains\/([^/]+)\/runs$/.exec(url.pathname);
  if (req.method === 'GET' && captainRunsMatch) {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);
    const { records, total } = await listCaptainRuns(decodeURIComponent(captainRunsMatch[1]), { limit, offset });
    sendJson(res, 200, { runs: records, total, limit, offset });
    return;
  }

  const promoteMatch = /^\/captains\/([^/]+)\/runs\/([^/]+)\/promote$/.exec(url.pathname);
  if (req.method === 'POST' && promoteMatch) {
    await handleCaptainPromote(req, res, decodeURIComponent(promoteMatch[1]), decodeURIComponent(promoteMatch[2]));
    return;
  }

  // ── Jobs ─────────────────────────────────────────────────────────────────

  if (req.method === 'GET' && url.pathname === '/jobs') {
    const { jobs } = await loadJobDefinitions();
    sendJson(res, 200, { jobs });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/jobs') {
    const body = (await readJsonBody(req)) as Partial<JobDefinition>;
    if (!body.name || !body.steps?.length) {
      sendJson(res, 400, { error: 'name and at least one step are required' });
      return;
    }
    try {
      await addJobDefinition(body as JobDefinition);
      sendJson(res, 201, body);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const jobDeleteMatch = /^\/jobs\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && jobDeleteMatch) {
    const removed = await removeJobDefinition(decodeURIComponent(jobDeleteMatch[1]));
    sendJson(res, 200, { removed });
    return;
  }

  const jobRunMatch = /^\/jobs\/([^/]+)\/run$/.exec(url.pathname);
  if (req.method === 'POST' && jobRunMatch) {
    const jobName = decodeURIComponent(jobRunMatch[1]);
    const job = await getJobDefinition(jobName);
    if (!job) {
      sendJson(res, 404, { error: `No job named "${jobName}"` });
      return;
    }
    // Fire-and-forget: returns the jobId immediately; progress arrives via SSE + GET /job-runs/:jobId
    const jobId = startJobBackground(job);
    sendJson(res, 202, { jobId });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/job-runs') {
    const runs = await listJobRuns(50);
    sendJson(res, 200, { runs });
    return;
  }

  const jobRunGetMatch = /^\/job-runs\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && jobRunGetMatch) {
    const run = await loadJobRun(decodeURIComponent(jobRunGetMatch[1]));
    if (!run) {
      sendJson(res, 404, { error: 'Job run not found' });
      return;
    }
    sendJson(res, 200, run);
    return;
  }

  // ── Webhook trigger — POST /webhooks/:token/trigger/:name ────────────────
  // External systems (CI, GitHub Actions, scripts) can fire a Captain or Job run
  // without accessing the dashboard. The token must match config.webhooks.token.

  const webhookMatch = /^\/webhooks\/([^/]+)\/trigger\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'POST' && webhookMatch) {
    await handleWebhookTrigger(req, res, decodeURIComponent(webhookMatch[1]), decodeURIComponent(webhookMatch[2]));
    return;
  }

  // ── Eval routes ───────────────────────────────────────────────────────────

  const evalsMatch = /^\/workspaces\/([^/]+)\/evals$/.exec(url.pathname);
  if (req.method === 'GET' && evalsMatch) {
    await handleListEvals(res, decodeURIComponent(evalsMatch[1]));
    return;
  }

  const evalGetMatch = /^\/workspaces\/([^/]+)\/evals\/latest$/.exec(url.pathname);
  if (req.method === 'GET' && evalGetMatch) {
    await handleGetLatestEval(res, decodeURIComponent(evalGetMatch[1]));
    return;
  }

  const evalCasesMatch = /^\/workspaces\/([^/]+)\/evals\/cases$/.exec(url.pathname);
  if (req.method === 'POST' && evalCasesMatch) {
    await handleAddEvalCase(req, res, decodeURIComponent(evalCasesMatch[1]));
    return;
  }

  // ── Execution profile active selection ────────────────────────────────────

  const activeProfileMatch = /^\/workspaces\/([^/]+)\/active-profile$/.exec(url.pathname);
  if (req.method === 'GET' && activeProfileMatch) {
    await handleGetActiveProfile(res, decodeURIComponent(activeProfileMatch[1]));
    return;
  }
  if (req.method === 'PUT' && activeProfileMatch) {
    await handleSetActiveProfile(req, res, decodeURIComponent(activeProfileMatch[1]));
    return;
  }

  // ── List execution profiles ────────────────────────────────────────────────

  const listProfilesMatch = /^\/workspaces\/([^/]+)\/execution-profiles$/.exec(url.pathname);
  if (req.method === 'GET' && listProfilesMatch) {
    await handleListExecutionProfiles(res, decodeURIComponent(listProfilesMatch[1]));
    return;
  }

  // ── Auth routes ───────────────────────────────────────────────────────────
  // These are public (no JWT required) — they are part of the login flow itself.

  if (req.method === 'GET' && url.pathname === '/auth/status') {
    const { isAuthConfigured } = await import('../auth/index.js');
    const configured = await isAuthConfigured();
    const { loadTokens } = await import('../auth/index.js');
    const tokens = await loadTokens();
    sendJson(res, 200, {
      configured,
      loggedIn: tokens !== null,
      user: tokens?.user ?? null,
      expiresAt: tokens?.ctxhubToken.expiresAt ?? null,
    });
    return;
  }

  // ── Corporate Groups ──────────────────────────────────────────────────────

  if (req.method === 'POST' && url.pathname === '/groups') {
    await handleGroupCreate(req, res, authOutcome.principal);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/groups') {
    await handleGroupList(res);
    return;
  }

  const groupGetMatch = /^\/groups\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && groupGetMatch) {
    await handleGroupGet(res, decodeURIComponent(groupGetMatch[1]));
    return;
  }

  const groupOrgsMatch = /^\/groups\/([^/]+)\/orgs$/.exec(url.pathname);
  if (req.method === 'POST' && groupOrgsMatch) {
    await handleGroupAddOrg(req, res, decodeURIComponent(groupOrgsMatch[1]), authOutcome.principal);
    return;
  }

  const groupOrgDeleteMatch = /^\/groups\/([^/]+)\/orgs\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && groupOrgDeleteMatch) {
    await handleGroupRemoveOrg(res, decodeURIComponent(groupOrgDeleteMatch[1]), decodeURIComponent(groupOrgDeleteMatch[2]), authOutcome.principal);
    return;
  }

  const groupSharingMatch = /^\/groups\/([^/]+)\/sharing$/.exec(url.pathname);
  if (req.method === 'PATCH' && groupSharingMatch) {
    await handleGroupSharing(req, res, authOutcome.principal);
    return;
  }

  // ── Share routes ──────────────────────────────────────────────────────────

  const shareTokenMatch = /^\/share\/(.+)$/.exec(url.pathname);
  if (req.method === 'GET' && shareTokenMatch) {
    await handleShareGet(res, decodeURIComponent(shareTokenMatch[1]));
    return;
  }

  // ── Peer discovery routes ─────────────────────────────────────────────────

  if (req.method === 'POST' && url.pathname === '/peers/heartbeat') {
    await handlePeerHeartbeat(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/peers') {
    await handlePeerList(res);
    return;
  }

  // ── Cloud sync route ──────────────────────────────────────────────────────

  if (req.method === 'POST' && url.pathname === '/cloud/sync') {
    if (!hasRole(authOutcome.principal, 'admin')) {
      sendJson(res, 403, { error: 'Admin role required' });
      return;
    }
    await handleCloudSync(res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/cloud/status') {
    await handleCloudStatus(res);
    return;
  }

  sendJson(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
}

// Runs the task inside *this* process rather than the caller's -- the whole point is that
// `ctxhub captain run <name>` from a terminal publishes to the same eventBus this service (and
// therefore its SSE subscribers/dashboard) is already listening to, instead of a disposable CLI
// process's own disconnected in-memory bus. Awaited, not fire-and-forget like index jobs: a
// single Captain query is fast enough that the CLI can just wait for the real answer to show.
async function handleCaptainRun(res: http.ServerResponse, name: string): Promise<void> {
  const task = await getCaptainTask(name);
  if (!task) {
    sendJson(res, 404, { error: `No captain task named "${name}"` });
    return;
  }

  try {
    const record = await runCaptainTask(task);
    sendJson(res, 200, record);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleCaptainCreate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = (await readJsonBody(req)) as Partial<CaptainTask>;
  if (!body.name || !body.workspace || !body.query) {
    sendJson(res, 400, { error: 'name, workspace, and query are required' });
    return;
  }

  const task: CaptainTask = {
    name: body.name,
    workspace: body.workspace,
    query: body.query,
    persona: body.persona || undefined,
    profile: body.profile || undefined,
    schedule: body.schedule?.everyMinutes ? { everyMinutes: body.schedule.everyMinutes } : undefined,
    handoffTo: body.handoffTo || undefined
  };

  try {
    await addCaptainTask(task);
    sendJson(res, 201, task);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleCaptainPromote(req: http.IncomingMessage, res: http.ServerResponse, name: string, runId: string): Promise<void> {
  const body = (await readJsonBody(req)) as { repo?: string; title?: string; agent?: string };
  if (!body.repo) {
    sendJson(res, 400, { error: 'repo is required' });
    return;
  }

  try {
    const notePath = await promoteCaptainRun(name, runId, body.repo, { title: body.title, agent: body.agent });
    sendJson(res, 200, { notePath });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleWorkspaceRepos(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace || !workspace.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const { config } = await loadWorkspaceConfig(workspace.path);
  sendJson(res, 200, { repos: config.repositories.map(repo => repo.name) });
}

// Shared by every workspace-scoped config handler below -- looks up the registered workspace by
// name, 404s and returns undefined if it's missing or its path no longer exists. Handlers just
// bail out on an undefined return; the 404 response is already sent.
async function findExistingWorkspace(res: http.ServerResponse, name: string): Promise<{ path: string } | undefined> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace || !workspace.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return undefined;
  }
  return workspace;
}

async function handleGetConfig(res: http.ServerResponse, name: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;
  const { config } = await loadWorkspaceConfig(workspace.path);
  sendJson(res, 200, config);
}

// Deliberately narrow: only knowledge/privacy/llm are mergeable here (plain settings objects,
// safe to patch field-by-field). repositories and executionProfiles have their own
// dedicated add/remove endpoints below instead of being merge-patchable, since both are
// name-keyed collections where "merge this partial object in" is ambiguous (upsert one entry?
// replace the whole list?) in a way a settings object isn't.
async function handlePatchConfig(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  const patch = (await readJsonBody(req)) as Partial<Pick<CtxhubConfig, 'knowledge' | 'privacy' | 'llm'>>;

  const updated: CtxhubConfig = {
    ...config,
    knowledge: { ...config.knowledge, ...patch.knowledge },
    privacy: { ...config.privacy, ...patch.privacy },
    llm: { ...config.llm, ...patch.llm }
  };

  await saveConfig(updated, workspaceRoot);
  sendJson(res, 200, updated);
}

async function handleAddRepo(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;

  const body = (await readJsonBody(req)) as { name?: string; path?: string };
  if (!body.name || !body.path) {
    sendJson(res, 400, { error: 'name and path are required' });
    return;
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  if (config.repositories.some(repo => repo.name === body.name)) {
    sendJson(res, 400, { error: `Repository already exists: ${body.name}` });
    return;
  }

  const absolutePath = resolve(workspaceRoot, body.path);
  if (!(await pathExists(absolutePath))) {
    sendJson(res, 400, { error: `Repository path does not exist: ${body.path}` });
    return;
  }

  const repo: RepoConfig = {
    name: body.name,
    path: relative(workspaceRoot, absolutePath) || '.',
    git: await isGitRepo(absolutePath)
  };
  config.repositories.push(repo);
  await saveConfig(config, workspaceRoot);
  sendJson(res, 201, repo);
}

async function handleRemoveRepo(res: http.ServerResponse, name: string, repoName: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  const index = config.repositories.findIndex(repo => repo.name === repoName);
  if (index === -1) {
    sendJson(res, 404, { error: `No repository named "${repoName}"` });
    return;
  }

  config.repositories.splice(index, 1);
  await saveConfig(config, workspaceRoot);
  sendJson(res, 200, { removed: true });
}

async function handleUpsertExecutionProfile(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;

  const body = (await readJsonBody(req)) as { name?: string; profile?: ExecutionProfile };
  if (!body.name || !body.profile || !body.profile.runtime) {
    sendJson(res, 400, { error: 'name and profile.runtime are required' });
    return;
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  config.executionProfiles = { ...config.executionProfiles, [body.name]: body.profile };
  await saveConfig(config, workspaceRoot);
  sendJson(res, 200, { name: body.name, profile: body.profile });
}

async function handleRemoveExecutionProfile(res: http.ServerResponse, name: string, profileName: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  if (!(profileName in config.executionProfiles)) {
    sendJson(res, 404, { error: `No execution profile named "${profileName}"` });
    return;
  }

  const rest = { ...config.executionProfiles };
  delete rest[profileName];
  config.executionProfiles = rest;
  await saveConfig(config, workspaceRoot);
  sendJson(res, 200, { removed: true });
}

async function handleGetSkillsStatus(res: http.ServerResponse, name: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;
  sendJson(res, 200, { skills: await getSkillsStatus(workspace.path) });
}

async function handleInstallSkills(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;

  const body = (await readJsonBody(req)) as { agents?: string[] };
  const agents = body.agents ?? [];

  try {
    await installSkills(agents, workspace.path);
    eventBus.publish({ type: 'skills.installed', workspace: name, agents });
    sendJson(res, 200, { skills: await getSkillsStatus(workspace.path) });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleGetPersonasStatus(res: http.ServerResponse, name: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;
  sendJson(res, 200, await getPersonasStatus(workspace.path));
}

async function handleInitPersonas(res: http.ServerResponse, name: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;
  const { created } = await initPersonas(workspace.path);
  sendJson(res, 200, { created, status: await getPersonasStatus(workspace.path) });
}

async function handleSyncPersonas(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const workspace = await findExistingWorkspace(res, name);
  if (!workspace) return;

  const body = (await readJsonBody(req)) as { agents?: string[] };
  const agents = body.agents ?? [];

  try {
    await syncPersonas(agents, workspace.path);
    eventBus.publish({ type: 'personas.synced', workspace: name, agents });
    sendJson(res, 200, await getPersonasStatus(workspace.path));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleKnowledgeGraph(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace || !workspace.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  try {
    const graph = await buildKnowledgeGraph(config, workspaceRoot);
    sendJson(res, 200, graph);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleKnowledgeGraphNode(res: http.ServerResponse, name: string, nodeId: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace || !workspace.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  try {
    const content = await findKnowledgeGraphNodeContent(config, workspaceRoot, nodeId);
    if (!content) {
      sendJson(res, 404, { error: `No indexed content found for node "${nodeId}"` });
      return;
    }
    sendJson(res, 200, content);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

// Backs the Knowledge view's "expand on click" behavior: a node past the bulk build's
// similarity-edge budget renders with no similarity edges yet -- clicking it fires this, one real
// index search, and the UI splices whatever comes back into the already-running simulation. Lets
// a user freely navigate outward from any node instead of being stuck with one fixed snapshot.
async function handleKnowledgeGraphExpand(res: http.ServerResponse, name: string, nodeId: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace || !workspace.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  try {
    const edges = await expandKnowledgeGraphNode(config, workspaceRoot, nodeId);
    if (!edges) {
      sendJson(res, 404, { error: `No indexed file found for node "${nodeId}"` });
      return;
    }
    sendJson(res, 200, { edges });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

// Server-Sent Events, not WebSocket: this stream is one-way (server -> client), which is all the
// dashboard and a future MCP-side "watch this workspace" consumer need, and SSE needs nothing
// beyond plain HTTP -- no upgrade handshake, reconnects automatically via EventSource on the
// client. Every connected client gets every event; per-workspace filtering happens client-side.
function handleEventStream(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(':ok\n\n');

  const unsubscribe = eventBus.subscribe((event: CtxhubEventEnvelope) => {
    res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', unsubscribe);
}

async function handleWorkspaceIndexStart(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace) {
    sendJson(res, 404, { error: `No registered workspace named "${name}"` });
    return;
  }
  if (!workspace.exists) {
    sendJson(res, 404, { error: `Workspace "${name}" is registered but its path no longer exists: ${workspace.path}` });
    return;
  }

  const state = startIndexJob(name, workspace.path);
  sendJson(res, 202, state);
}

async function handleWorkspaceStatus(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace) {
    sendJson(res, 404, { error: `No registered workspace named "${name}"` });
    return;
  }
  if (!workspace.exists) {
    sendJson(res, 404, { error: `Workspace "${name}" is registered but its path no longer exists: ${workspace.path}` });
    return;
  }

  // Reuses ctxhub doctor's own check functions rather than inventing separate health logic --
  // the control plane's idea of a workspace's health should never drift from `ctxhub doctor`'s.
  const { config, configPath } = await loadWorkspaceConfig(workspace.path);
  const checks = buildDoctorChecks(config, configPath, workspace.path);
  const lines = await runDoctorChecks(checks);

  const body: WorkspaceStatusResponse = { name: workspace.name, path: workspace.path, checks: lines };
  sendJson(res, 200, body);
}

async function handleWorkspaceSearch(res: http.ServerResponse, name: string, url: URL, req: http.IncomingMessage): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace || !workspace.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const q = url.searchParams.get('q') ?? '';
  if (!q.trim()) {
    sendJson(res, 400, { error: 'Missing or empty "q" query parameter' });
    return;
  }
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 10), 50);
  // When cross-org=true is passed, treat it as min-trust-tier=institutional so local results
  // exposed to a requesting peer are always filtered to institutional+ chunks.
  const crossOrgParam = url.searchParams.get('cross-org') === 'true';
  const rawMinTrustTier = url.searchParams.get('min-trust-tier') ?? undefined;
  const minTrustTier = (crossOrgParam ? 'institutional' : rawMinTrustTier) as import('../indexing/chunk.js').ChunkTrustTier | undefined;

  const { config } = await loadWorkspaceConfig(workspace.path);
  const { createIndexProvider } = await import('../indexing/providers.js');
  const { meetsMinTrustTier } = await import('../indexing/chunk.js');
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspace.path);
  let results = await index.search(q.trim(), limit);

  if (minTrustTier) {
    results = results.filter(r => meetsMinTrustTier(r as { trustTier?: import('../indexing/chunk.js').ChunkTrustTier }, minTrustTier));
  }

  sendJson(res, 200, results);
}

async function handleWorkspaceChat(req: http.IncomingMessage, res: http.ServerResponse, name: string, url: URL, principal: Principal): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace) {
    sendJson(res, 404, { error: `No registered workspace named "${name}"` });
    return;
  }
  if (!workspace.exists) {
    sendJson(res, 404, { error: `Workspace "${name}" path no longer exists: ${workspace.path}` });
    return;
  }

  const body = await readJsonBody(req);
  const query = (body as { query?: unknown }).query;
  if (typeof query !== 'string' || !query.trim()) {
    sendJson(res, 400, { error: 'Missing or empty "query" field in request body' });
    return;
  }

  const result = await createExplainResult(query.trim(), 8, workspace.path);

  // ── Cross-org search fan-out ─────────────────────────────────────────────
  const crossOrg = url.searchParams.get('cross-org') === 'true';
  const store = await loadGroupStore();
  const userOrg = principal.tenantId ? resolveOrgForUser(principal.tenantId, store) : undefined;

  if (crossOrg && userOrg) {
    const groupOrgs = findOrgsByGroup(store, userOrg.groupId);
    const permitted = groupOrgs.filter(o => o.id !== userOrg.id && canSearchCrossOrg(store, userOrg.id, o.id));

    // Forward the Authorization header to peer instances
    const authHeader = req.headers['authorization'];
    const peerResults: unknown[] = [];
    let crossOrgEnabled = false;

    for (const targetOrg of permitted) {
      if (!targetOrg.peerUrl) {
        console.log(`[cross-org] Org "${targetOrg.name}" (${targetOrg.id}) has no peerUrl — skipping`);
        continue;
      }
      try {
        const peerUrl = `${targetOrg.peerUrl}/workspaces/${encodeURIComponent(name)}/search?q=${encodeURIComponent(query.trim())}&limit=10&min-trust-tier=institutional`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authHeader) headers['Authorization'] = authHeader;
        const peerRes = await fetch(peerUrl, { headers });
        if (!peerRes.ok) {
          console.warn(`[cross-org] Peer "${targetOrg.name}" returned ${peerRes.status} — skipping`);
          continue;
        }
        const peerData = (await peerRes.json()) as unknown[];
        if (Array.isArray(peerData)) {
          const annotated = peerData.map(r => ({ ...(r as object), sourceOrg: { id: targetOrg.id, name: targetOrg.name } }));
          peerResults.push(...annotated);
          crossOrgEnabled = true;
        }
      } catch (err) {
        console.warn(`[cross-org] Failed to fetch from peer "${targetOrg.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    sendJson(res, 200, {
      ...result,
      sourceOrg: { id: userOrg.id, name: userOrg.name },
      crossOrgEnabled,
      crossOrgResults: peerResults,
      crossOrgOrgs: permitted.map(o => ({ id: o.id, name: o.name, hasPeer: Boolean(o.peerUrl) })),
    });
  } else {
    sendJson(res, 200, { ...result, sourceOrg: null, crossOrgEnabled: false });
  }
}

async function handleReviewProfiles(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace || !workspace.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const { workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  const profilesPath = resolve(workspaceRoot, DEFAULT_REVIEW_PROFILES_PATH);
  const suite = await loadReviewerProfiles(profilesPath);
  sendJson(res, 200, suite);
}

async function handleWorkspaceReview(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(entry => entry.name === name);
  if (!workspace || !workspace.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const body = (await readJsonBody(req)) as { topic?: unknown; as?: unknown; base?: unknown };
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const as = typeof body.as === 'string' ? body.as.trim() : '';
  if (!topic || !as) {
    sendJson(res, 400, { error: 'Missing or empty "topic"/"as" field in request body' });
    return;
  }
  const base = typeof body.base === 'string' && body.base.trim() ? body.base.trim() : undefined;

  try {
    const result = await createReviewResult(topic, { as, base }, workspace.path);
    sendJson(res, 200, { ...result, changed: Object.fromEntries(result.changed) });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

// ── Webhook trigger ────────────────────────────────────────────────────────

/** Read the raw request body as a Buffer (for HMAC signature verification). */
async function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_048_576) { req.destroy(); reject(new PayloadTooLargeError()); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleWebhookTrigger(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  name: string,
): Promise<void> {
  // Find a workspace to load config from (use the first registered one).
  const workspaces = await listWorkspaces();
  const anyWs = workspaces.find(ws => ws.exists);
  if (!anyWs) {
    sendJson(res, 503, { error: 'No registered workspaces' });
    return;
  }

  const { config } = await loadWorkspaceConfig(anyWs.path);
  if (!config.webhooks?.token || config.webhooks.token !== token) {
    sendJson(res, 401, { error: 'Invalid or missing webhook token' });
    return;
  }

  // HMAC-SHA256 signature verification (GitHub-style inbound pattern).
  // If a webhookSecret is configured, the caller must include a valid
  // X-Hub-Signature-256: sha256=<hex> header computed over the raw body.
  if (config.webhooks.webhookSecret) {
    const rawBody = await readRawBody(req);
    const expected = `sha256=${createHmac('sha256', config.webhooks.webhookSecret).update(rawBody).digest('hex')}`;
    const provided = req.headers['x-hub-signature-256'];
    if (!provided || provided !== expected) {
      sendJson(res, 401, { error: 'Invalid or missing X-Hub-Signature-256 header' });
      return;
    }
  }

  // Try job first, then captain.
  const job = await getJobDefinition(name);
  if (job) {
    const jobId = startJobBackground(job);
    sendJson(res, 202, { triggered: 'job', name, jobId });
    return;
  }

  const captain = await getCaptainTask(name);
  if (captain) {
    // Captain runs are non-blocking for webhooks — fire and forget like jobs.
    void runCaptainTask(captain).catch(err => {
      console.error(`[webhook] Captain run failed for "${name}":`, err);
    });
    sendJson(res, 202, { triggered: 'captain', name });
    return;
  }

  sendJson(res, 404, { error: `No job or captain task named "${name}"` });
}

// ── Eval list / latest ─────────────────────────────────────────────────────

async function handleListEvals(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(ws => ws.name === name);
  if (!workspace?.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const { workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  const evalsDir = resolve(workspaceRoot, CACHE_DIR, 'evals');

  try {
    const files = await fsPromises.readdir(evalsDir);
    const runs = files
      .filter(f => f.endsWith('.json') && f !== 'latest.json')
      .sort()
      .reverse()
      .slice(0, 20)
      .map(f => ({ id: f.replace('.json', ''), file: f }));
    sendJson(res, 200, { runs });
  } catch {
    sendJson(res, 200, { runs: [] });
  }
}

async function handleGetLatestEval(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(ws => ws.name === name);
  if (!workspace?.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const { workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  const latestPath = resolve(workspaceRoot, CACHE_DIR, 'evals', 'latest.json');

  if (!(await pathExists(latestPath))) {
    sendJson(res, 404, { error: 'No eval runs found. Run: ctxhub eval' });
    return;
  }

  try {
    const content = await readText(latestPath);
    sendJson(res, 200, JSON.parse(content));
  } catch {
    sendJson(res, 500, { error: 'Failed to parse latest eval run' });
  }
}

// ── Eval case append ───────────────────────────────────────────────────────

async function handleAddEvalCase(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(ws => ws.name === name);
  if (!workspace?.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const body = (await readJsonBody(req)) as { query?: unknown; expected?: unknown };
  if (typeof body.query !== 'string' || !body.query.trim()) {
    sendJson(res, 400, { error: 'Missing or empty "query" field' });
    return;
  }

  const { workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  const evalPath = resolve(workspaceRoot, CACHE_DIR, 'eval.json');

  let suite: EvalSuite = { cases: [] };
  if (await pathExists(evalPath)) {
    try {
      suite = JSON.parse(await readText(evalPath)) as EvalSuite;
    } catch {
      // corrupted — start fresh
    }
  }

  const newCase: EvalCase = {
    query: body.query.trim(),
    expected: Array.isArray(body.expected) ? (body.expected as EvalCase['expected']) : [],
    rationale: 'Flagged as incorrect from Mission Control',
  };

  suite.cases.push(newCase);
  await writeText(evalPath, `${JSON.stringify(suite, null, 2)}\n`);
  sendJson(res, 201, { added: newCase, total: suite.cases.length });
}

// ── Active execution profile ───────────────────────────────────────────────

async function handleGetActiveProfile(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(ws => ws.name === name);
  if (!workspace?.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const { config } = await loadWorkspaceConfig(workspace.path);
  sendJson(res, 200, {
    activeProfile: config.activeProfile ?? null,
    profiles: Object.keys(config.executionProfiles),
  });
}

async function handleSetActiveProfile(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(ws => ws.name === name);
  if (!workspace?.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const body = (await readJsonBody(req)) as { profile?: unknown };
  // null or empty string means "clear" (revert to llm defaults)
  const profile = typeof body.profile === 'string' && body.profile.trim() ? body.profile.trim() : null;

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
  if (profile && !config.executionProfiles[profile]) {
    sendJson(res, 400, { error: `No execution profile named "${profile}"` });
    return;
  }

  const updated = { ...config, activeProfile: profile ?? undefined };
  await saveConfig(updated, workspaceRoot);
  sendJson(res, 200, { activeProfile: profile });
}

// ── List execution profiles ────────────────────────────────────────────────

async function handleListExecutionProfiles(res: http.ServerResponse, name: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find(ws => ws.name === name);
  if (!workspace?.exists) {
    sendJson(res, 404, { error: `No registered, existing workspace named "${name}"` });
    return;
  }

  const { config } = await loadWorkspaceConfig(workspace.path);
  sendJson(res, 200, { profiles: config.executionProfiles, activeProfile: config.activeProfile ?? null });
}

// ── Corporate Group handlers ──────────────────────────────────────────────────

async function handleGroupCreate(req: http.IncomingMessage, res: http.ServerResponse, principal: Principal): Promise<void> {
  if (!hasRole(principal, 'admin')) {
    sendJson(res, 403, { error: 'Admin or owner role required' });
    return;
  }

  const body = (await readJsonBody(req)) as { name?: unknown };
  if (typeof body.name !== 'string' || !body.name.trim()) {
    sendJson(res, 400, { error: 'name is required' });
    return;
  }

  try {
    const group = await createGroup(body.name.trim(), principal.sub);
    sendJson(res, 201, { group });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleGroupList(res: http.ServerResponse): Promise<void> {
  const store = await loadGroupStore();
  sendJson(res, 200, { groups: store.groups, orgs: store.orgs, sharingPolicies: store.sharingPolicies });
}

async function handleGroupGet(res: http.ServerResponse, id: string): Promise<void> {
  const store = await loadGroupStore();
  const group = findGroup(store, id);
  if (!group) {
    sendJson(res, 404, { error: `No corporate group with id "${id}"` });
    return;
  }

  const orgs = findOrgsByGroup(store, id);
  const sharingPolicies = store.sharingPolicies.filter(
    p => orgs.some(o => o.id === p.fromOrgId) || orgs.some(o => o.id === p.toOrgId)
  );
  sendJson(res, 200, { group, orgs, sharingPolicies });
}

async function handleGroupAddOrg(req: http.IncomingMessage, res: http.ServerResponse, groupId: string, principal: Principal): Promise<void> {
  if (!hasRole(principal, 'admin')) {
    sendJson(res, 403, { error: 'Admin or owner role required' });
    return;
  }

  const body = (await readJsonBody(req)) as {
    name?: unknown;
    tenantId?: unknown;
    groupFilter?: unknown;
    trustTier?: unknown;
    peerUrl?: unknown;
  };

  if (typeof body.name !== 'string' || !body.name.trim()) {
    sendJson(res, 400, { error: 'name is required' });
    return;
  }
  if (typeof body.tenantId !== 'string' || !body.tenantId.trim()) {
    sendJson(res, 400, { error: 'tenantId is required' });
    return;
  }

  const validTiers: TrustTier[] = ['observer', 'participant', 'trusted'];
  const tier = typeof body.trustTier === 'string' ? body.trustTier as TrustTier : 'participant';
  if (!validTiers.includes(tier)) {
    sendJson(res, 400, { error: `trustTier must be one of: ${validTiers.join(', ')}` });
    return;
  }

  try {
    const org = await addOrg(
      groupId,
      {
        name: body.name.trim(),
        tenantId: body.tenantId.trim(),
        groupFilter: typeof body.groupFilter === 'string' && body.groupFilter.trim() ? body.groupFilter.trim() : undefined,
        trustTier: tier,
        peerUrl: typeof body.peerUrl === 'string' && body.peerUrl.trim() ? body.peerUrl.trim() : undefined,
      },
      principal.sub,
    );
    sendJson(res, 201, { org });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleGroupRemoveOrg(res: http.ServerResponse, groupId: string, orgId: string, principal: Principal): Promise<void> {
  if (!hasRole(principal, 'admin')) {
    sendJson(res, 403, { error: 'Admin or owner role required' });
    return;
  }

  try {
    await removeOrg(groupId, orgId, principal.sub);
    sendJson(res, 200, { removed: true });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleGroupSharing(req: http.IncomingMessage, res: http.ServerResponse, principal: Principal): Promise<void> {
  if (!hasRole(principal, 'admin')) {
    sendJson(res, 403, { error: 'Admin or owner role required' });
    return;
  }

  const body = (await readJsonBody(req)) as { fromOrgId?: unknown; toOrgId?: unknown; mode?: unknown };

  if (typeof body.fromOrgId !== 'string' || !body.fromOrgId.trim()) {
    sendJson(res, 400, { error: 'fromOrgId is required' });
    return;
  }
  if (typeof body.toOrgId !== 'string' || !body.toOrgId.trim()) {
    sendJson(res, 400, { error: 'toOrgId is required' });
    return;
  }

  const validModes: SharingMode[] = ['none', 'read', 'bidirectional'];
  if (typeof body.mode !== 'string' || !validModes.includes(body.mode as SharingMode)) {
    sendJson(res, 400, { error: `mode must be one of: ${validModes.join(', ')}` });
    return;
  }

  try {
    const policy = await updateSharing(
      body.fromOrgId.trim(),
      body.toOrgId.trim(),
      body.mode as SharingMode,
      principal.sub,
    );
    sendJson(res, 200, { policy });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

// ── Global multi-workspace search ─────────────────────────────────────────────
// GET /search?q=<query>[&all-workspaces=true][&limit=10]
// When all-workspaces=true, fans out to every registered workspace, annotates each
// result with {workspace:<name>}, deduplicates by chunk id, and returns sorted by score.
async function handleGlobalSearch(res: http.ServerResponse, url: URL): Promise<void> {
  const q = url.searchParams.get('q') ?? '';
  if (!q.trim()) {
    sendJson(res, 400, { error: 'Missing or empty "q" query parameter' });
    return;
  }

  const allWs = url.searchParams.get('all-workspaces') === 'true';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 10), 50);

  if (!allWs) {
    // Single-workspace mode: require a workspace name (compatibility with existing pattern)
    sendJson(res, 400, { error: 'Pass all-workspaces=true or use /workspaces/:name/search' });
    return;
  }

  const workspaces = await listWorkspaces();
  const active = workspaces.filter(ws => ws.exists);
  if (!active.length) {
    sendJson(res, 200, { results: [], count: 0, workspacesSearched: 0 });
    return;
  }

  const { createIndexProvider } = await import('../indexing/providers.js');
  const { meetsMinTrustTier } = await import('../indexing/chunk.js');
  void meetsMinTrustTier; // used elsewhere

  const allResults: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const ws of active) {
    try {
      const { config } = await loadWorkspaceConfig(ws.path);
      const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, ws.path);
      const results = await index.search(q.trim(), limit);
      for (const r of results) {
        const id = (r as { id?: string }).id;
        if (id && !seen.has(id)) {
          seen.add(id);
          allResults.push({ ...(r as Record<string, unknown>), workspace: ws.name });
        }
      }
    } catch {
      // Workspace unreachable — skip silently
    }
  }

  allResults.sort((a, b) => ((b.score as number) ?? 0) - ((a.score as number) ?? 0));
  const topResults = allResults.slice(0, limit * active.length);

  sendJson(res, 200, { results: topResults, count: topResults.length, workspacesSearched: active.length });
}

// ── Share handler ─────────────────────────────────────────────────────────────

async function handleShareGet(res: http.ServerResponse, token: string): Promise<void> {
  try {
    const secret = await getShareSecret();
    const payload = verifyShareToken(token, secret);

    const packPath = `${getSharesDir()}/${payload.jti}.json`;
    if (!(await pathExists(packPath))) {
      sendJson(res, 404, { error: 'Share not found or already consumed' });
      return;
    }

    const packJson = await readText(packPath);
    const pack = JSON.parse(packJson) as unknown;

    // One-time use: delete after serving
    if (payload.oneTime) {
      const { rm } = await import('node:fs/promises');
      await rm(packPath, { force: true });
      const metaPath = `${getSharesDir()}/${payload.jti}.meta.json`;
      await rm(metaPath, { force: true }).catch(() => {/* best-effort */});
    }

    sendJson(res, 200, pack);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('expired') || msg.includes('Invalid') || msg.includes('Malformed')) {
      sendJson(res, 401, { error: msg });
    } else {
      sendJson(res, 500, { error: msg });
    }
  }
}

// ── Peer heartbeat handlers ───────────────────────────────────────────────────

async function handlePeerHeartbeat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = (await readJsonBody(req)) as { orgId?: string; peerUrl?: string; groupId?: string };
  if (!body.orgId || !body.peerUrl || !body.groupId) {
    sendJson(res, 400, { error: 'orgId, peerUrl, and groupId are required' });
    return;
  }

  const store = await loadGroupStore();
  const org = store.orgs.find(o => o.id === body.orgId);
  if (!org) {
    sendJson(res, 404, { error: `No org with id "${body.orgId}"` });
    return;
  }

  const now = new Date().toISOString();
  if (org.peerUrl !== body.peerUrl) {
    if (!org.registeredAt) {
      org.registeredAt = now;
    }
    org.peerUrl = body.peerUrl;
  }
  org.lastSeen = now;

  const { saveGroupStore } = await import('../groups/store.js');
  await saveGroupStore(store);

  sendJson(res, 200, { ok: true, groupId: body.groupId, orgId: body.orgId });
}

async function handlePeerList(res: http.ServerResponse): Promise<void> {
  const store = await loadGroupStore();
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const activePeers = store.orgs.filter(o => {
    if (!o.peerUrl) return false;
    if (!o.lastSeen) return false;
    return o.lastSeen >= fiveMinutesAgo;
  }).map(o => ({
    orgId: o.id,
    groupId: o.groupId,
    name: o.name,
    peerUrl: o.peerUrl,
    trustTier: o.trustTier,
    lastSeen: o.lastSeen,
    registeredAt: o.registeredAt,
  }));

  sendJson(res, 200, { peers: activePeers, count: activePeers.length });
}

// ── Cloud sync handlers ───────────────────────────────────────────────────────

async function handleCloudSync(res: http.ServerResponse): Promise<void> {
  try {
    const { loadCloudConfig } = await import('../commands/cloud.js');
    const { getSyncConfig, syncToCloud } = await import('../cloud/sync.js');

    const cloudConfig = await loadCloudConfig();
    if (!cloudConfig) {
      sendJson(res, 400, { error: 'Cloud sync not configured. Run: ctxhub cloud configure' });
      return;
    }

    const syncConfig = await getSyncConfig();
    if (!syncConfig) {
      sendJson(res, 400, { error: 'Cloud sync not configured. Run: ctxhub cloud configure' });
      return;
    }

    // Collect promoted chunks across all registered workspaces
    const { listWorkspaces: listWs } = await import('../workspaces/registry.js');
    const { createIndexProvider } = await import('../indexing/providers.js');
    const workspaces = await listWs();
    const allChunks: import('../config/types.js').IndexedDocument[] = [];

    for (const ws of workspaces.filter(w => w.exists)) {
      try {
        const { config } = await loadWorkspaceConfig(ws.path);
        const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, ws.path);
        const results = await index.search('', 500);
        for (const r of results) {
          const tier = (r as { trustTier?: string }).trustTier;
          if (tier === 'institutional' || tier === 'canonical') {
            allChunks.push(r as import('../config/types.js').IndexedDocument);
          }
        }
      } catch {
        // Workspace unreachable — skip
      }
    }

    const result = await syncToCloud(syncConfig, allChunks);

    // Update lastSyncAt in the cloud config file
    if (!result.skipped && (result.synced ?? 0) > 0) {
      const { saveCloudConfig } = await import('../commands/cloud.js');
      await saveCloudConfig({
        ...cloudConfig,
        lastSyncAt: new Date().toISOString(),
        chunksSynced: (cloudConfig.chunksSynced ?? 0) + (result.synced ?? 0),
      });
    }

    sendJson(res, 200, {
      synced: result.synced ?? 0,
      errors: result.errors ?? [],
      skipped: result.skipped ?? false,
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleCloudStatus(res: http.ServerResponse): Promise<void> {
  try {
    const { loadCloudConfig } = await import('../commands/cloud.js');
    const config = await loadCloudConfig();
    if (!config) {
      sendJson(res, 200, { configured: false });
      return;
    }

    // Count available institutional/canonical chunks
    const { listWorkspaces: listWs } = await import('../workspaces/registry.js');
    const { createIndexProvider } = await import('../indexing/providers.js');
    const workspaces = await listWs();
    let chunksAvailable = 0;

    for (const ws of workspaces.filter(w => w.exists)) {
      try {
        const { config: wsConfig } = await loadWorkspaceConfig(ws.path);
        const index = createIndexProvider(wsConfig.index.provider, wsConfig.index.path, wsConfig.index.table, ws.path);
        const results = await index.search('', 500);
        for (const r of results) {
          const tier = (r as { trustTier?: string }).trustTier;
          if (tier === 'institutional' || tier === 'canonical') chunksAvailable++;
        }
      } catch {
        // skip
      }
    }

    const endpoint = config.endpoint;
    const maskedEndpoint = endpoint.length > 20 ? `${endpoint.slice(0, 20)}…` : endpoint;

    sendJson(res, 200, {
      configured: true,
      endpoint: maskedEndpoint,
      lastSyncAt: config.lastSyncAt ?? null,
      chunksSynced: config.chunksSynced ?? 0,
      chunksAvailable,
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}
