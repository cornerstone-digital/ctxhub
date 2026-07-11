import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve, relative } from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { listWorkspaces } from '../workspaces/registry.js';
import { loadWorkspaceConfig, saveConfig } from '../config/config.js';
import { buildDoctorChecks, runDoctorChecks, type CheckLine } from '../commands/doctorChecks.js';
import { getPackageVersion } from '../utils/version.js';
import { renderFleetViewHtml } from './fleetView.js';
import { createExplainResult } from '../commands/explain.js';
import { indexWorkspace, type IndexProgressEvent, type IndexResult } from '../indexing/indexer.js';
import { notify } from '../utils/notify.js';
import { eventBus, type CtxhubEventEnvelope } from '../events/eventBus.js';
import { addCaptainTask, getCaptainTask, loadCaptainTasks, removeCaptainTask, type CaptainTask } from '../captains/tasks.js';
import { listCaptainRuns, promoteCaptainRun, runCaptainTask } from '../captains/runner.js';
import { buildKnowledgeGraph, findKnowledgeGraphNodeContent, expandKnowledgeGraphNode } from '../indexing/knowledgeGraph.js';
import { isGitRepo } from '../git/git.js';
import { pathExists } from '../utils/fs.js';
import type { CtxhubConfig, ExecutionProfile, RepoConfig } from '../config/types.js';
import { getSkillsStatus, installSkills } from '../commands/skills.js';
import { getPersonasStatus, initPersonas, syncPersonas } from '../commands/personas.js';

// docs/control-plane.md Phase 2, extended: the registry-over-HTTP API plus an in-process event
// bus (src/events/eventBus.ts) fed by real producers -- index jobs and Captain runs -- and
// exposed to subscribers over SSE (GET /events) below. Desktop notifications are just one more
// subscriber (see the eventBus.subscribe call below), not something index jobs call directly.
export const DEFAULT_SERVICE_PORT = 7342;

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

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += String(chunk);
      if (data.length > 1_048_576) { // 1 MB
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

export function createServiceServer(): http.Server {
  return http.createServer((req, res) => {
    void handleRequest(req, res).catch(error => sendJson(res, 500, { error: (error as Error).message }));
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // CORS headers for dev (Vite dev server proxies in prod)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve React UI from ui/dist if built, else fallback to fleet HTML
  if (req.method === 'GET' && url.pathname === '/') {
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

  if (req.method === 'GET' && url.pathname === '/events') {
    handleEventStream(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/workspaces') {
    const workspaces = await listWorkspaces();
    sendJson(res, 200, { workspaces });
    return;
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
    await handleWorkspaceChat(req, res, decodeURIComponent(chatMatch[1]));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/captains') {
    const { tasks } = await loadCaptainTasks();
    sendJson(res, 200, { tasks });
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
    const runs = await listCaptainRuns(decodeURIComponent(captainRunsMatch[1]));
    sendJson(res, 200, { runs });
    return;
  }

  const promoteMatch = /^\/captains\/([^/]+)\/runs\/([^/]+)\/promote$/.exec(url.pathname);
  if (req.method === 'POST' && promoteMatch) {
    await handleCaptainPromote(req, res, decodeURIComponent(promoteMatch[1]), decodeURIComponent(promoteMatch[2]));
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

async function handleWorkspaceChat(req: http.IncomingMessage, res: http.ServerResponse, name: string): Promise<void> {
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
  sendJson(res, 200, result);
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
