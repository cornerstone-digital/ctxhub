import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { registerWorkspace } from '../workspaces/registry.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { runGit } from '../git/git.js';
import { createServiceServer } from './server.js';

async function withRunningServer(run: (baseUrl: string) => Promise<void>) {
  const server = createServiceServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function withIsolatedCtxhubHome(run: () => Promise<void>) {
  const ctxhubHome = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-service-server-home-'));
  const original = process.env.CTXHUB_HOME;
  process.env.CTXHUB_HOME = ctxhubHome;

  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.CTXHUB_HOME;
    else process.env.CTXHUB_HOME = original;
    await rm(ctxhubHome, { recursive: true, force: true });
  }
}

test('GET / serves Fleet view HTML', () => {
  return withRunningServer(async baseUrl => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  });
});

test('GET /health reports ok with a version string', () => {
  return withRunningServer(async baseUrl => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.ok(typeof body.version === 'string' && body.version.length > 0);
  });
});

test('GET /workspaces returns an empty list when nothing is registered', () => {
  return withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/workspaces`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.workspaces, []);
    })
  );
});

test('GET /workspaces lists a registered workspace, and /workspaces/:name/status reuses ctxhub doctor checks', () => {
  return withIsolatedCtxhubHome(async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-service-server-ws-'));
    try {
      await initConfig('server-ws', workspaceDir);
      await registerWorkspace(workspaceDir);

      await withRunningServer(async baseUrl => {
        const listRes = await fetch(`${baseUrl}/workspaces`);
        const listBody = await listRes.json();
        assert.equal(listBody.workspaces.length, 1);
        assert.equal(listBody.workspaces[0].name, 'server-ws');
        assert.equal(listBody.workspaces[0].exists, true);

        const statusRes = await fetch(`${baseUrl}/workspaces/server-ws/status`);
        assert.equal(statusRes.status, 200);
        const statusBody = await statusRes.json();
        assert.equal(statusBody.name, 'server-ws');
        assert.ok(Array.isArray(statusBody.checks) && statusBody.checks.length > 0);
        assert.ok(statusBody.checks.some((line: { message: string }) => line.message.includes('Config schema')));
      });
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

test('GET /workspaces/:name/status 404s for an unregistered name', () => {
  return withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/workspaces/nonexistent/status`);
      assert.equal(res.status, 404);
    })
  );
});

async function withRegisteredWorkspace(name: string, run: (baseUrl: string, workspaceDir: string) => Promise<void>) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `ctxhub-service-server-ws-${name}-`));
  try {
    await initConfig(name, workspaceDir);
    await registerWorkspace(workspaceDir, name);
    await withRunningServer(baseUrl => run(baseUrl, workspaceDir));
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

test('GET /workspaces/:name/config returns the full workspace config', () => {
  return withIsolatedCtxhubHome(() =>
    withRegisteredWorkspace('config-ws', async baseUrl => {
      const res = await fetch(`${baseUrl}/workspaces/config-ws/config`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.workspace.name, 'config-ws');
      assert.ok(Array.isArray(body.knowledge.include));
      assert.ok(Array.isArray(body.privacy.redactPatterns));
    })
  );
});

test('PATCH /workspaces/:name/config merges knowledge/privacy/llm without touching other sections', () => {
  return withIsolatedCtxhubHome(() =>
    withRegisteredWorkspace('patch-ws', async baseUrl => {
      const before = await (await fetch(`${baseUrl}/workspaces/patch-ws/config`)).json();

      const res = await fetch(`${baseUrl}/workspaces/patch-ws/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privacy: { redactPatterns: ['api[_-]?key'] }, llm: { enabled: true } })
      });
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.deepEqual(body.privacy.redactPatterns, ['api[_-]?key']);
      assert.equal(body.llm.enabled, true);
      // Untouched sections survive the patch unchanged.
      assert.deepEqual(body.knowledge, before.knowledge);
      assert.equal(body.index.provider, before.index.provider);
    })
  );
});

test('POST /workspaces/:name/repos adds a repo, rejects a duplicate name and a nonexistent path', () => {
  return withIsolatedCtxhubHome(() =>
    withRegisteredWorkspace('repo-ws', async (baseUrl, workspaceDir) => {
      await mkdir(path.join(workspaceDir, 'app'));

      const addRes = await fetch(`${baseUrl}/workspaces/repo-ws/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'app', path: 'app' })
      });
      assert.equal(addRes.status, 201);
      const added = await addRes.json();
      assert.equal(added.name, 'app');
      assert.equal(added.git, false);

      const dupRes = await fetch(`${baseUrl}/workspaces/repo-ws/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'app', path: 'app' })
      });
      assert.equal(dupRes.status, 400);

      const missingRes = await fetch(`${baseUrl}/workspaces/repo-ws/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ghost', path: 'does-not-exist' })
      });
      assert.equal(missingRes.status, 400);

      const listRes = await fetch(`${baseUrl}/workspaces/repo-ws/repos`);
      const listBody = await listRes.json();
      assert.deepEqual(listBody.repos, ['app']);
    })
  );
});

test('DELETE /workspaces/:name/repos/:repoName removes a repo and 404s for an unknown one', () => {
  return withIsolatedCtxhubHome(() =>
    withRegisteredWorkspace('repo-del-ws', async (baseUrl, workspaceDir) => {
      await mkdir(path.join(workspaceDir, 'app'));
      await fetch(`${baseUrl}/workspaces/repo-del-ws/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'app', path: 'app' })
      });

      const missingRes = await fetch(`${baseUrl}/workspaces/repo-del-ws/repos/ghost`, { method: 'DELETE' });
      assert.equal(missingRes.status, 404);

      const delRes = await fetch(`${baseUrl}/workspaces/repo-del-ws/repos/app`, { method: 'DELETE' });
      assert.equal(delRes.status, 200);
      assert.deepEqual((await delRes.json()).removed, true);

      const listBody = await (await fetch(`${baseUrl}/workspaces/repo-del-ws/repos`)).json();
      assert.deepEqual(listBody.repos, []);
    })
  );
});

test('execution profiles: upsert, read back via config, and remove', () => {
  return withIsolatedCtxhubHome(() =>
    withRegisteredWorkspace('profile-ws', async baseUrl => {
      const upsertRes = await fetch(`${baseUrl}/workspaces/profile-ws/execution-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'fast', profile: { runtime: 'claude', model: 'haiku' } })
      });
      assert.equal(upsertRes.status, 200);

      const config = await (await fetch(`${baseUrl}/workspaces/profile-ws/config`)).json();
      assert.deepEqual(config.executionProfiles.fast, { runtime: 'claude', model: 'haiku' });

      const missingRes = await fetch(`${baseUrl}/workspaces/profile-ws/execution-profiles/ghost`, { method: 'DELETE' });
      assert.equal(missingRes.status, 404);

      const delRes = await fetch(`${baseUrl}/workspaces/profile-ws/execution-profiles/fast`, { method: 'DELETE' });
      assert.equal(delRes.status, 200);

      const configAfter = await (await fetch(`${baseUrl}/workspaces/profile-ws/config`)).json();
      assert.deepEqual(configAfter.executionProfiles, {});
    })
  );
});

test('workspace members: grant, list, and revoke a role, including a custom role name', () => {
  return withIsolatedCtxhubHome(() =>
    withRegisteredWorkspace('members-ws', async baseUrl => {
      const emptyList = await (await fetch(`${baseUrl}/workspaces/members-ws/members`)).json();
      assert.deepEqual(emptyList.members, []);

      const grantRes = await fetch(`${baseUrl}/workspaces/members-ws/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub: 'user-1', role: 'admin' })
      });
      assert.equal(grantRes.status, 200);

      // A custom role name is accepted here too -- resolveToBuiltInRole (customRoleStore.ts)
      // is what makes this actually affect access, not this route.
      await fetch(`${baseUrl}/workspaces/members-ws/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub: 'user-2', role: 'reviewer' })
      });

      const listRes = await fetch(`${baseUrl}/workspaces/members-ws/members`);
      const list = await listRes.json();
      assert.deepEqual(
        list.members.sort((a: { sub: string }, b: { sub: string }) => a.sub.localeCompare(b.sub)),
        [{ sub: 'user-1', role: 'admin' }, { sub: 'user-2', role: 'reviewer' }]
      );

      const revokeRes = await fetch(`${baseUrl}/workspaces/members-ws/members/user-1`, { method: 'DELETE' });
      assert.equal(revokeRes.status, 200);
      assert.deepEqual(await revokeRes.json(), { revoked: true });

      const revokeMissingRes = await fetch(`${baseUrl}/workspaces/members-ws/members/ghost`, { method: 'DELETE' });
      assert.deepEqual(await revokeMissingRes.json(), { revoked: false });

      const finalList = await (await fetch(`${baseUrl}/workspaces/members-ws/members`)).json();
      assert.deepEqual(finalList.members, [{ sub: 'user-2', role: 'reviewer' }]);
    })
  );
});

test('GET /roles returns built-in roles and any custom roles', () => {
  return withIsolatedCtxhubHome(() =>
    withRegisteredWorkspace('roles-ws', async baseUrl => {
      const res = await fetch(`${baseUrl}/roles`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.builtIn, ['owner', 'admin', 'member', 'reader', 'machine']);
      assert.deepEqual(body.custom, []);
    })
  );
});

test('skills: status reports nothing installed, install writes real files, status reflects it', () => {
  return withIsolatedCtxhubHome(() =>
    withRegisteredWorkspace('skills-ws', async baseUrl => {
      const before = await (await fetch(`${baseUrl}/workspaces/skills-ws/skills`)).json();
      assert.ok(before.skills.length > 0);
      assert.ok(before.skills.every((s: { installed: boolean }) => s.installed === false));

      const installRes = await fetch(`${baseUrl}/workspaces/skills-ws/skills/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: ['claude'] })
      });
      assert.equal(installRes.status, 200);
      const installed = (await installRes.json()).skills;
      assert.ok(installed.filter((s: { agent: string; installed: boolean }) => s.agent === 'claude').every((s: { installed: boolean }) => s.installed));
      assert.ok(installed.filter((s: { agent: string; installed: boolean }) => s.agent !== 'claude').every((s: { installed: boolean }) => !s.installed));
    })
  );
});

test('personas: init scaffolds a starter persona, sync compiles it, status reflects both', () => {
  return withIsolatedCtxhubHome(() =>
    withRegisteredWorkspace('personas-ws', async baseUrl => {
      const empty = await (await fetch(`${baseUrl}/workspaces/personas-ws/personas`)).json();
      assert.deepEqual(empty.personas, []);

      const initRes = await fetch(`${baseUrl}/workspaces/personas-ws/personas/init`, { method: 'POST' });
      assert.equal(initRes.status, 200);
      const initBody = await initRes.json();
      assert.ok(initBody.created.length > 0);
      assert.ok(initBody.status.personas.some((p: { name: string }) => p.name === 'architect'));

      const syncRes = await fetch(`${baseUrl}/workspaces/personas-ws/personas/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: ['claude'] })
      });
      assert.equal(syncRes.status, 200);
      const syncBody = await syncRes.json();
      assert.ok(syncBody.compiledFor.includes('claude'));
    })
  );
});

async function withReviewableWorkspace(name: string, run: (baseUrl: string) => Promise<void>) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `ctxhub-service-server-review-${name}-`));
  try {
    await initConfig(name, workspaceDir);

    const repoPath = path.join(workspaceDir, 'app');
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, 'README.md'), '# App\n\nHow to set this up.\n');
    await runGit(['init'], repoPath);
    await runGit(['config', 'user.email', 'test@example.com'], repoPath);
    await runGit(['config', 'user.name', 'Test'], repoPath);
    await runGit(['add', '.'], repoPath);
    await runGit(['commit', '-m', 'init'], repoPath);
    await runGit(['branch', 'base'], repoPath);
    await writeFile(path.join(repoPath, 'README.md'), '# App\n\nHow to set this up.\n\nUpdated.\n');
    await runGit(['add', '.'], repoPath);
    await runGit(['commit', '-m', 'update readme'], repoPath);

    const config = await loadConfig(workspaceDir);
    config.repositories.push({ name: 'app', path: './app', git: true });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, workspaceDir);
    await indexWorkspace(workspaceDir, false);

    await registerWorkspace(workspaceDir, name);
    await withRunningServer(run);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

test('GET /workspaces/:name/review-profiles seeds and returns the 5 built-in personas', () => {
  return withIsolatedCtxhubHome(() =>
    withReviewableWorkspace('review-ws', async baseUrl => {
      const res = await fetch(`${baseUrl}/workspaces/review-ws/review-profiles`);
      assert.equal(res.status, 200);
      const body = await res.json();
      const names = body.profiles.map((p: { name: string }) => p.name);
      assert.deepEqual(names.sort(), ['bug-hunter', 'contract', 'docs', 'performance', 'security']);
    })
  );
});

test('POST /workspaces/:name/review runs a real persona-grounded review against the real git diff', () => {
  return withIsolatedCtxhubHome(() =>
    withReviewableWorkspace('review-ws', async baseUrl => {
      const res = await fetch(`${baseUrl}/workspaces/review-ws/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'README setup instructions', as: 'bug-hunter', base: 'base' })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.persona, 'bug-hunter');
      assert.ok(body.changed.app.includes('README.md'));
      // llm.enabled defaults to false for a freshly initialized workspace -- synthesizeReviewFindings
      // degrades gracefully to an empty findings list plus a notice, rather than erroring.
      assert.deepEqual(body.findings, []);
      assert.match(body.llmNotice, /disabled/);
    })
  );
});

test('POST /workspaces/:name/review 400s for an unknown persona name', () => {
  return withIsolatedCtxhubHome(() =>
    withReviewableWorkspace('review-ws', async baseUrl => {
      const res = await fetch(`${baseUrl}/workspaces/review-ws/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'anything', as: 'not-a-real-persona' })
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /Unknown review persona/);
    })
  );
});

test('unknown routes 404', () => {
  return withIsolatedCtxhubHome(() =>
    withRunningServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/nope`);
      assert.equal(res.status, 404);
    })
  );
});
