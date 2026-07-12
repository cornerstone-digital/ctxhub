import { Argument, Command, Option } from 'commander';
import { initCommand } from '../commands/init.js';
import { repoAddCommand, repoDiscoverCommand, repoHookCommand, repoListCommand } from '../commands/repo.js';
import { indexCommand } from '../commands/index.js';
import { searchCommand } from '../commands/search.js';
import { syncCommand } from '../commands/sync.js';
import { memoryAddCommand, memoryCheckpointCommand, memoryClearCommand, memoryDiaryCommand, memorySearchCommand, memoryStatusCommand, memoryTimelineCommand } from '../commands/memory.js';
import { statsCommand } from '../commands/stats.js';
import { doctorCommand } from '../commands/doctor.js';
import { mcpCommand } from '../commands/mcp.js';
import { agentLaunchCommand, SUPPORTED_AGENTS } from '../commands/agent.js';
import { skillsInstallCommand, SUPPORTED_SKILL_AGENTS } from '../commands/skills.js';
import { onboardCommand } from '../commands/onboard.js';
import { noteAddCommand, notePromoteCommand } from '../commands/note.js';
import { diagramAddCommand } from '../commands/diagram.js';
import { packCommand } from '../commands/pack.js';
import { explainCommand } from '../commands/explain.js';
import { askCommand } from '../commands/ask.js';
import { replayCommand } from '../commands/replay.js';
import { handoffCommand } from '../commands/handoff.js';
import { reviewCommand } from '../commands/review.js';
import { personasInitCommand, personasSyncCommand, SUPPORTED_PERSONA_SYNC_AGENTS } from '../commands/personas.js';
import { workspaceExportCommand, workspaceGrantCommand, workspaceImportCommand, workspaceListCommand, workspaceMembersCommand, workspaceRegisterCommand, workspaceRemoveCommand, workspaceRevokeCommand, workspaceSetRolesCommand } from '../commands/workspace.js';
import {
  knowledgeArchiveCommand,
  knowledgeCreateCommand,
  knowledgeFlagCommand,
  knowledgeListCommand,
  knowledgePromoteCommand,
  knowledgeShowCommand,
  knowledgeSupersededCommand,
  knowledgeSearchCommand,
  knowledgeVelocityCommand,
  knowledgeEdgeAddCommand,
  knowledgeEdgeListCommand,
  knowledgeConceptAddCommand,
  knowledgeConceptLinkCommand,
  knowledgeConceptListCommand,
} from '../commands/knowledge.js';
import { serviceStartCommand, serviceStopCommand, serviceStatusCommand, dashboardCommand } from '../commands/service.js';
import {
  captainAddCommand,
  captainApprovalsCommand,
  captainExportCommand,
  captainImportCommand,
  captainListCommand,
  captainPromoteCommand,
  captainRemoveCommand,
  captainRunCommand
} from '../commands/captain.js';
import { DEFAULT_SERVICE_PORT } from '../service/server.js';
import { evalCommand } from '../commands/eval.js';
import { validateDocsCommand } from '../commands/validate.js';
import { graphCommand } from '../commands/graph.js';
import { openCommand } from '../commands/open.js';
import { prContextCommand } from '../commands/prContext.js';
import { watchCommand } from '../commands/watch.js';
import { reportCommand } from '../commands/report.js';
import { ciInitCommand } from '../commands/ci.js';
import { resetCommand } from '../commands/reset.js';
import {
  authConfigureCommand,
  authStatusCommand,
  loginCommand,
  logoutCommand,
  roleMapListCommand,
  roleMapAddOwnerCommand,
  roleMapAddGroupCommand,
  roleMapRemoveGroupCommand,
  roleMapSetDefaultCommand,
  type AuthConfigureOptions,
} from '../commands/auth.js';
import { VALID_ROLES } from '../auth/roles.js';
import { jobAddCommand, jobListCommand, jobRemoveCommand, jobRunCommand, jobRunsCommand } from '../commands/job.js';
import { webhookGenerateTokenCommand, webhookSetSecretCommand, webhookSetTokenCommand, webhookShowCommand } from '../commands/webhook.js';
import { groupCreateCommand, groupListCommand, groupAddOrgCommand, groupRemoveOrgCommand, groupSharingCommand, groupStatusCommand, groupInviteCommand, groupJoinCommand, groupHeartbeatCommand, groupIdentitySetDefaultCommand, groupIdentityAddGroupRoleCommand, groupIdentityAddOverrideCommand, groupIdentityShowCommand, groupQueryCommand } from '../commands/group.js';
import { chunkPromoteCommand, chunkListCommand } from '../commands/chunk.js';
import { runGuidedMode } from '../commands/guided.js';
import { checkForDriftOnce } from '../utils/driftCheck.js';
import { getPackageVersion, versionCheckCommand } from '../utils/version.js';
import { shareCommand, shareListCommand, shareRevokeCommand } from '../commands/share.js';
import { serviceSetPeerUrlCommand } from '../commands/service.js';
import { cloudConfigureCommand, cloudStatusCommand, cloudSyncCommand } from '../commands/cloud.js';
import { demoCommand } from '../commands/demo.js';
import { blueprintPackCommand, blueprintInstallCommand, blueprintListCommand, blueprintRemoveCommand, blueprintPublishCommand } from '../commands/blueprint.js';
import { machineTokenCreateCommand, machineTokenListCommand, machineTokenRevokeCommand } from '../commands/machineToken.js';
import { auditCommand } from '../commands/audit.js';
import { statusCommand } from '../commands/status.js';
import {
  topologyRepoAddCommand,
  topologyRepoListCommand,
  topologyServiceAddCommand,
  topologyServiceListCommand,
  topologyEdgeAddCommand,
  topologyEdgeListCommand,
  topologyDepsCommand,
  topologyShowCommand,
} from '../commands/topology.js';
import {
  cascadeListCommand,
  cascadeAddCommand,
  cascadeRemoveCommand,
  cascadeDeriveCommand,
} from '../commands/cascade.js';
import {
  roleCreateCommand,
  roleListCommand,
  roleShowCommand,
  roleDeleteCommand,
} from '../commands/role.js';
import {
  licenceStatusCommand,
  licenceInstallCommand,
} from '../commands/licence.js';
import { billingUsageCommand, type BillingUsageOptions } from '../commands/billing.js';

// Pure construction only -- no parsing, no process.exit. Split out from index.ts so
// guided mode (src/tui/guided/commandTree.ts) can introspect the full command tree
// (arguments/options/descriptions) without triggering a parse of process.argv.
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('ctxhub')
    .description('ctxhub developer workspace CLI')
    .version(getPackageVersion())
    .option('--plain', 'Prefer script-friendly output over interactive terminal views')
    .option('--no-interactive', 'Disable interactive terminal views');

  program.hook('preAction', async (_thisCommand, actionCommand) => {
    await checkForDriftOnce(actionCommand.name());
  });

  program
    .command('demo')
    .description('Scaffold a complete demo workspace with sample docs, indexed chunks, and institutional-tier promotions')
    .option('--workspace <name>', 'Demo workspace name', 'ctxhub-demo')
    .option('-f, --force', 'Overwrite an existing demo workspace')
    .action((opts: { workspace?: string; force?: boolean }) => demoCommand(opts));

  program
    .command('init')
    .description('Initialise a ctxhub workspace')
    .option('-n, --name <name>', 'Workspace name')
    .option('-f, --force', 'Overwrite existing config')
    .action(initCommand);

  program
    .command('onboard')
    .description('Interactively set up this workspace: init, repos, hooks, memory, agents, and skills')
    .action(onboardCommand);

  program
    .command('menu')
    .description('Launch the interactive guided menu')
    .action(runGuidedMode);

  const repo = program.command('repo').description('Manage workspace repositories');

  repo
    .command('add')
    .argument('<name>', 'Repository name')
    .argument('<path>', 'Repository path')
    .option('--suggest-globs', 'Ask the configured agent CLI for repo-specific include/exclude glob suggestions after adding the repo')
    .description('Add a repository to the workspace')
    .action(repoAddCommand);

  repo
    .command('list')
    .description('List configured repositories')
    .action(repoListCommand);

  repo
    .command('discover')
    .argument('[root]', 'Root folder to scan', '.')
    .option('--plain', 'Add discovered repos without the interactive review screen')
    .option('--no-interactive', 'Disable the interactive review screen')
    .option('--suggest-globs', 'Ask the configured agent CLI for repo-specific include/exclude glob suggestions for each newly added repo')
    .description('Discover Git repositories under a folder, with optional repo-specific glob suggestions when llm.enabled')
    .action(repoDiscoverCommand);

  repo
    .command('hook')
    .argument('<name>', 'Repository name')
    .description('Install a post-commit hook that re-indexes the workspace after each commit')
    .option('-f, --force', 'Overwrite an existing post-commit hook')
    .action(repoHookCommand);

  const ci = program.command('ci').description('Scaffold CI integrations for ctxhub workspace checks');

  ci
    .command('init')
    .description('Create a GitHub Actions workflow for ctxhub docs, diagram, and optional eval checks')
    .option('-f, --force', 'Overwrite an existing ctxhub workflow')
    .option('--with-eval', 'Include ctxhub eval in the workflow')
    .option('--package-manager <name>', 'Package manager to use (npm, pnpm, yarn)', 'npm')
    .action(ciInitCommand);

  program
    .command('index')
    .description('Index changed workspace knowledge')
    .option('-f, --force', 'Force re-index all files')
    .option('--plain', 'Use plain progress output')
    .option('--no-interactive', 'Disable the live progress view')
    .option('--notify', 'Send a desktop notification when indexing completes')
    .action(indexCommand);

  program
    .command('sync')
    .description('Pull repos and re-index changed knowledge')
    .option('--no-pull', 'Skip git pull')
    .option('--plain', 'Use plain progress output')
    .option('--no-interactive', 'Disable the live progress view')
    .option('--notify', 'Send a desktop notification when sync completes')
    .option('--to-cloud', 'After local sync, push institutional/canonical chunks to ctxhub Cloud (requires cloud configuration or CTXHUB_CLOUD_ENDPOINT)')
    .action(syncCommand);

  program
    .command('search')
    .argument('[query]', 'Initial search query')
    .option('-l, --limit <limit>', 'Max results', '5')
    .addOption(new Option('--type <type>', 'Filter results by content type').choices(['all', 'docs', 'code', 'architecture', 'notes']).default('all'))
    .option('--code', 'Shortcut for --type code')
    .option('--docs', 'Shortcut for --type docs')
    .option('--architecture', 'Shortcut for --type architecture')
    .option('--notes', 'Shortcut for --type notes')
    .option('--rewrite-query', 'Ask the configured agent CLI to rewrite the query/type before searching, surfacing both original and rewritten values')
    .option('-i, --interactive', 'Launch a live, filterable terminal search UI')
    .option('--plain', 'Require a query and print one-shot search results')
    .option('--no-interactive', 'Disable live search when query is omitted')
    .option('--all-workspaces', 'Search across all registered workspaces, annotating each result with its workspace name')
    .description('Search indexed workspace knowledge')
    .action(searchCommand);

  program
    .command('pack')
    .argument('<query>', 'Question or topic to assemble context for')
    .option('-l, --limit <limit>', 'Max results', '8')
    .option('--json', 'Print JSON')
    .option('--out <path>', 'Write a portable context pack artifact')
    .option('--include-absolute-paths', 'Include absolute local paths in exported artifacts')
    .description('Assemble an agent-ready context pack from search, architecture, freshness, and workspace status')
    .action(packCommand);

  program
    .command('explain')
    .argument('<query>', 'Question or topic to explain from indexed evidence')
    .option('-l, --limit <limit>', 'Max context results', '8')
    .option('--json', 'Print JSON')
    .option('--llm', 'Force LLM-backed answer synthesis for this call, even if disabled in config')
    .option('--no-llm', 'Force the non-LLM evidence scaffold for this call, even if enabled in config')
    .option('--notify', 'Send a desktop notification when the answer is ready')
    .option('--as <persona>', 'Frame the answer through a persona defined in agents/personas/ (see: ctxhub personas init)')
    .option('--profile <name>', 'Use a named executionProfiles entry to pick which harness/model runs this call (docs/control-plane.md Phase 4)')
    .description('Create a citation-first explanation from indexed context, LLM-synthesized when llm.enabled')
    .action(explainCommand);

  program
    .command('ask')
    .argument('<question>', 'Question to answer from indexed evidence')
    .option('-l, --limit <limit>', 'Max context results', '8')
    .option('--json', 'Print JSON')
    .option('--llm', 'Force LLM-backed ask synthesis for this call, even if disabled in config')
    .option('--no-llm', 'Disable ask synthesis for this call and print the fallback guidance')
    .option('--notify', 'Send a desktop notification when the answer is ready')
    .option('--as <persona>', 'Frame the answer through a persona defined in agents/personas/ (see: ctxhub personas init)')
    .description('Answer a question from indexed evidence using the configured agent CLI; unlike explain, this command has no non-LLM answer mode')
    .action(askCommand);

  program
    .command('replay')
    .argument('<file>', 'Context pack artifact JSON file')
    .option('--json', 'Print JSON')
    .description('Replay a previously exported context pack artifact')
    .action(replayCommand);

  program
    .command('open')
    .argument('<id>', 'Indexed chunk id')
    .option('--json', 'Print JSON')
    .description('Open a full indexed chunk by id')
    .action(openCommand);

  program
    .command('pr-context')
    .option('--base <ref>', 'Base git ref', 'origin/main')
    .option('-l, --limit <limit>', 'Max context results', '8')
    .option('--json', 'Print JSON')
    .option('--llm', 'Force cross-repo contract-risk review for this call, even if disabled in config')
    .option('--no-llm', 'Force skipping contract-risk review for this call, even if enabled in config')
    .option('--notify', 'Send a desktop notification when PR context is ready')
    .description('Build a context pack for files changed on the current branch, with LLM-backed contract-risk review when llm.enabled')
    .action(prContextCommand);

  program
    .command('handoff')
    .argument('<topic>', 'Topic or task to hand off')
    .option('--repo <name>', 'Limit handoff sections to a configured repo')
    .option('--out <path>', 'Output markdown path')
    .option('--from-pr', 'Include changed files from the current branch')
    .option('--base <ref>', 'Base git ref for --from-pr', 'origin/main')
    .option('-l, --limit <limit>', 'Max context results', '8')
    .option('--llm', 'Force a synthesized summary for this call, even if disabled in config')
    .option('--no-llm', 'Force skipping the synthesized summary for this call, even if enabled in config')
    .option('--notify', 'Send a desktop notification when the handoff bundle is ready')
    .option('--as <persona>', 'Frame the summary through a persona defined in agents/personas/ (see: ctxhub personas init)')
    .description('Create a markdown handoff bundle for another agent or teammate, with an LLM-synthesized summary when llm.enabled')
    .action(handoffCommand);

  program
    .command('review')
    .argument('<topic>', 'Topic or change to review')
    .requiredOption('--as <persona>', 'Reviewer persona to use (see .ctxhub/cache/review-profiles.json for available/custom personas)')
    .option('--profiles <path>', 'Path to a reviewer-profiles JSON file (default: .ctxhub/cache/review-profiles.json, seeded with built-ins on first run)')
    .option('--base <ref>', 'Base git ref for diff-based personas', 'origin/main')
    .option('-l, --limit <limit>', 'Max context results', '8')
    .option('--json', 'Print JSON')
    .option('--llm', 'Force LLM-backed findings for this call, even if disabled in config')
    .option('--no-llm', 'Force skipping LLM-backed findings for this call, even if enabled in config')
    .option('--notify', 'Send a desktop notification when the review is ready')
    .description('Review a topic/change with a named reviewer persona, grounded in existing context-pack/diff/architecture evidence')
    .action(reviewCommand);

  const memory = program.command('memory').description('Manage memory/index store');

  memory
    .command('status')
    .option('--plain', 'Print plain memory/index status')
    .option('--no-interactive', 'Disable the status panel')
    .description('Show memory stats')
    .action(memoryStatusCommand);

  memory
    .command('clear')
    .description('Clear local memory chunks')
    .option('-f, --force', 'Clear without confirmation')
    .action(memoryClearCommand);

  memory
    .command('search')
    .argument('<query>', 'Search MemPalace durable memory')
    .option('--wing <name>', 'Limit search to one MemPalace wing/project')
    .option('--room <name>', 'Limit search to one MemPalace room')
    .option('--source-file <path>', 'Limit search to one stored source file')
    .option('-l, --limit <limit>', 'Max results', '5')
    .option('--json', 'Print JSON')
    .description('Search MemPalace durable memory with optional wing/room filters')
    .action(memorySearchCommand);

  memory
    .command('add')
    .argument('<content>', 'Content to store in MemPalace durable memory')
    .option('--wing <name>', 'MemPalace wing/project to file this memory under (auto-suggested from existing rooms/repo if omitted)')
    .option('--room <name>', 'MemPalace room/topic to file this memory under (auto-suggested from existing rooms if omitted)')
    .option('--source-file <path>', 'Optional source file path to associate with this memory')
    .option('--added-by <name>', 'Optional actor label stored with the memory', 'ctxhub')
    .option('--json', 'Print JSON')
    .description('Store durable memory in MemPalace, auto-suggesting a wing/room when not given explicitly')
    .action(memoryAddCommand);

  memory
    .command('diary')
    .argument('<entry>', 'Diary entry text to store in MemPalace')
    .requiredOption('--agent <name>', 'Agent or user name for the diary entry')
    .option('--topic <name>', 'Diary topic', 'general')
    .option('--wing <name>', 'Optional MemPalace wing/project; defaults to the agent-specific diary wing')
    .option('--json', 'Print JSON')
    .description('Write a durable diary entry to MemPalace, optionally under a chosen wing')
    .action(memoryDiaryCommand);

  memory
    .command('checkpoint')
    .argument('[note]', 'Optional free-text note to include in the checkpoint')
    .requiredOption('--agent <name>', 'Agent or user name for the checkpoint')
    .option('--topic <name>', 'Diary topic', 'checkpoint')
    .option('--wing <name>', 'Optional MemPalace wing/project; defaults to the agent-specific diary wing')
    .option('--json', 'Print JSON')
    .description('Save a session checkpoint diary entry auto-assembled from current git branch/commits plus an optional note')
    .action(memoryCheckpointCommand);

  memory
    .command('timeline')
    .argument('[entity]', 'Optional entity to show a focused MemPalace timeline for')
    .option('--json', 'Print JSON')
    .description('Show MemPalace knowledge-graph timeline events')
    .action(memoryTimelineCommand);

  program
    .command('stats')
    .description("Show ctxhub's estimated token savings vs. reading matched files in full")
    .option('--json', 'Print machine-readable JSON')
    .action(statsCommand);

  program
    .command('doctor')
    .description('Check workspace health')
    .option('--fix', 'Apply safe, low-risk automatic fixes (missing dirs, default privacy config)')
    .option('--dry-run', 'With --fix, explain intended changes without applying them')
    .option('--fix-skills', 'With --fix, reinstall stale skill files (overwrites installed skill files)')
    .option('--fix-personas', 'With --fix, recompile stale persona files (overwrites installed persona files)')
    .option('--plain', 'Print plain health-check output')
    .option('--no-interactive', 'Disable the live checklist')
    .option('--enterprise', 'Include enterprise checks (auth, session, role map, groups, index)')
    .addOption(
      new Option('--fix-agent <name>', "With --fix, refresh one agent's MCP config").choices(SUPPORTED_AGENTS)
    )
    .action(doctorCommand);

  program
    .command('reset')
    .description('Clear ctxhub state: registered workspaces, global data, or the local workspace index')
    .option('--registry', 'Clear only ~/.ctxhub/registry.json (unregister all workspaces)')
    .option('--global', 'Clear all of ~/.ctxhub/ (registry, service logs, captain history)')
    .option('--local', 'Clear .ctxhub/ in the current workspace (index, cache, memory, config)')
    .option('--all', 'Clear both global (~/.ctxhub/) and local (.ctxhub/) data')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(resetCommand);

  program
    .command('mcp')
    .description('Start the ctxhub MCP server (stdio) for AI agent tool use')
    .option('--allow-index', 'Expose opt-in mutating index/sync tools over MCP')
    .option('--allow-memory-write', 'Expose opt-in mutating MemPalace write tools (memory_add, diary_write) over MCP')
    .option('--restart-on-stale', 'Exit when a newer build is detected on disk (only an effective restart if your MCP host auto-respawns a stopped server)')
    .option('--central', 'Run as a Central MCP Gateway (docs/control-plane.md Phase 5): route tool calls into registered workspaces instead of binding to cwd')
    .action(mcpCommand);

  program
    .command('agent')
    .addArgument(new Argument('<name>', 'Agent to launch').choices(SUPPORTED_AGENTS))
    .description("Write the agent's MCP config for this workspace and launch it, pre-wired with the ctxhub MCP server")
    .option('--no-launch', 'Only write the MCP config, do not launch the agent')
    .action(agentLaunchCommand);

  const personas = program.command('personas').description('Manage portable agent personas (agents/ directory)');

  personas
    .command('init')
    .description('Scaffold agents/ with a starter persona and evidence policy (safe to re-run; never overwrites edited files)')
    .action(personasInitCommand);

  personas
    .command('sync')
    .addArgument(
      new Argument('[agents...]', 'Agents to compile personas for (default: all)').choices(SUPPORTED_PERSONA_SYNC_AGENTS)
    )
    .description('Compile agents/personas/*.md into a real native subagent file for each harness (Claude Code, Codex, Copilot, Cursor)')
    .action(personasSyncCommand);

  const workspace = program.command('workspace').description('Manage the user-level registry of ctxhub workspaces (docs/control-plane.md)');

  workspace
    .command('register')
    .argument('[path]', 'Workspace path to register', '.')
    .option('--name <name>', 'Name to register the workspace under (default: the workspace config\'s own name)')
    .description('Register a workspace in the user-level registry (~/.ctxhub/registry.json)')
    .action(workspaceRegisterCommand);

  workspace
    .command('list')
    .description('List registered workspaces')
    .action(workspaceListCommand);

  workspace
    .command('remove')
    .argument('<name>', 'Registered workspace name')
    .description('Remove a workspace from the registry (does not touch the workspace itself)')
    .action(workspaceRemoveCommand);

  workspace
    .command('set-roles')
    .description('Set the allowedRoles list for a workspace (restricts HTTP API access by role; use empty string to clear)')
    .requiredOption('--name <workspace>', 'Registered workspace name')
    .requiredOption('--roles <roles>', 'Comma-separated ctxhub roles that may access this workspace (e.g. "owner,admin,member"); pass empty string to clear')
    .action((opts: { name: string; roles: string }) => workspaceSetRolesCommand(opts));

  workspace
    .command('grant')
    .description('Grant a workspace-scoped role override to a specific user (overrides their org role for this workspace)')
    .requiredOption('--workspace <name>', 'Registered workspace name')
    .requiredOption('--sub <sub>', 'User subject identifier (sub)')
    .requiredOption('--role <role>', 'Role to grant for this workspace')
    .action((opts: { workspace: string; sub: string; role: string }) => workspaceGrantCommand(opts));

  workspace
    .command('revoke')
    .description('Remove a workspace-scoped role override for a specific user')
    .requiredOption('--workspace <name>', 'Registered workspace name')
    .requiredOption('--sub <sub>', 'User subject identifier (sub)')
    .action((opts: { workspace: string; sub: string }) => workspaceRevokeCommand(opts));

  workspace
    .command('members')
    .description('List allowed roles and per-member role overrides for a workspace')
    .requiredOption('--workspace <name>', 'Registered workspace name')
    .action((opts: { workspace: string }) => workspaceMembersCommand(opts));

  workspace
    .command('export')
    .description('Export workspace config, notes, and diagrams to a JSON file (index not included)')
    .requiredOption('--name <workspace>', 'Registered workspace name to export')
    .requiredOption('--out <path>', 'Output file path (e.g. my-workspace.json)')
    .action((opts: { name: string; out: string }) => workspaceExportCommand(opts));

  workspace
    .command('import')
    .description('Import a workspace from a previously exported JSON file (run ctxhub index afterwards)')
    .requiredOption('--from <path>', 'Path to the export JSON file')
    .option('--name <name>', 'Override the workspace name from the export')
    .action((opts: { from: string; name?: string }) => workspaceImportCommand(opts));

  // ── Knowledge Objects ─────────────────────────────────────────────────────

  const knowledge = program.command('knowledge').description('Manage structured, versioned knowledge objects');

  knowledge
    .command('create')
    .description('Create a new knowledge object in draft state')
    .requiredOption('--title <title>', 'Knowledge object title')
    .requiredOption('--content <content>', 'Knowledge statement / content')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .option('--tags <tags>', 'Comma-separated tags (e.g. "security,auth")')
    .action((opts: { title: string; content: string; workspace?: string; tags?: string }) => knowledgeCreateCommand(opts));

  knowledge
    .command('list')
    .description('List knowledge objects')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .option('--state <state>', 'Filter by state: draft, active, superseded, archived')
    .option('--tag <tag>', 'Filter by tag')
    .action((opts: { workspace?: string; state?: string; tag?: string }) => knowledgeListCommand(opts));

  knowledge
    .command('promote')
    .argument('<id>', 'Knowledge object id (full or 8-char prefix)')
    .description('Promote a draft knowledge object to active')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action((id: string, opts: { workspace?: string }) => knowledgePromoteCommand(id, opts));

  knowledge
    .command('supersede')
    .argument('<id>', 'Knowledge object id to supersede (full or 8-char prefix)')
    .description('Mark a knowledge object as superseded by a newer one')
    .requiredOption('--by <new-id>', 'Id of the knowledge object that replaces this one')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action((id: string, opts: { by: string; workspace?: string }) => knowledgeSupersededCommand(id, opts));

  knowledge
    .command('archive')
    .argument('<id>', 'Knowledge object id (full or 8-char prefix)')
    .description('Archive a knowledge object')
    .option('--reason <reason>', 'Reason for archiving')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action((id: string, opts: { reason?: string; workspace?: string }) => knowledgeArchiveCommand(id, opts));

  knowledge
    .command('flag')
    .argument('<id>', 'Knowledge object id (full or 8-char prefix)')
    .description('Toggle the human-review flag on a knowledge object')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action((id: string, opts: { workspace?: string }) => knowledgeFlagCommand(id, opts));

  knowledge
    .command('show')
    .argument('<id>', 'Knowledge object id (full or 8-char prefix)')
    .description('Show all fields of a single knowledge object')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action((id: string, opts: { workspace?: string }) => knowledgeShowCommand(id, opts));

  knowledge
    .command('search')
    .argument('<query>', 'Natural language query over promoted notes and ADRs')
    .description('Decision archaeology: search knowledge objects by title/content relevance')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .option('--min-confidence <n>', 'Minimum confidence score to include', parseFloat)
    .option('--include-archived', 'Include archived knowledge objects')
    .action((query: string, opts: { workspace?: string; minConfidence?: number; includeArchived?: boolean }) =>
      knowledgeSearchCommand(query, opts)
    );

  knowledge
    .command('velocity')
    .description('Time-series view of knowledge object creation, promotion, and archival rates')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .option('--from <date>', 'Start date (ISO), default 30 days before --to')
    .option('--to <date>', 'End date (ISO), default now')
    .option('--bucket <size>', 'Bucket size: day or week (default: day)')
    .action((opts: { workspace?: string; from?: string; to?: string; bucket?: string }) => knowledgeVelocityCommand(opts));

  const knowledgeEdge = knowledge.command('edge').description('Manage relationships between knowledge objects');

  knowledgeEdge
    .command('add')
    .description('Add a directed edge between two knowledge objects')
    .requiredOption('--from <id>', 'Source knowledge object id (full or 8-char prefix)')
    .requiredOption('--to <id>', 'Target knowledge object id (full or 8-char prefix)')
    .requiredOption('--type <type>', 'Edge type: supports, contradicts, supersedes, related_to, derived_from')
    .option('--description <text>', 'Optional description of the relationship')
    .option('--confidence <n>', 'Confidence score (default: 1.0)', parseFloat)
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action(
      (opts: { from: string; to: string; type: string; description?: string; confidence?: number; workspace?: string }) =>
        knowledgeEdgeAddCommand(opts)
    );

  knowledgeEdge
    .command('list')
    .description('List edges, optionally filtered to those touching one object')
    .option('--object <id>', 'Only show edges touching this knowledge object id')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action((opts: { object?: string; workspace?: string }) => knowledgeEdgeListCommand(opts));

  const knowledgeConcept = knowledge.command('concept').description('Manage recurring themes linked to knowledge objects');

  knowledgeConcept
    .command('add')
    .description('Create a new concept')
    .requiredOption('--name <name>', 'Concept name (must be unique)')
    .option('--description <text>', 'Optional description of the concept')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action((opts: { name: string; description?: string; workspace?: string }) => knowledgeConceptAddCommand(opts));

  knowledgeConcept
    .command('link')
    .description('Link a knowledge object to a concept')
    .requiredOption('--concept <id>', 'Concept id (full or 8-char prefix)')
    .requiredOption('--object <id>', 'Knowledge object id (full or 8-char prefix)')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action((opts: { concept: string; object: string; workspace?: string }) => knowledgeConceptLinkCommand(opts));

  knowledgeConcept
    .command('list')
    .description('List all concepts and how many objects each is linked to')
    .option('--workspace <name>', 'Registered workspace name (default: current workspace)')
    .action((opts: { workspace?: string }) => knowledgeConceptListCommand(opts));

  const service = program.command('service').description('Run the local control-plane service (docs/control-plane.md, Phase 2)');

  service
    .command('start')
    .option('--foreground', 'Run in the foreground instead of detaching a background process')
    .option('--port <port>', 'Port to listen on', String(DEFAULT_SERVICE_PORT))
    .description('Start the control-plane HTTP service (detached background process by default)')
    .action(serviceStartCommand);

  service
    .command('stop')
    .description('Stop the background control-plane service')
    .action(serviceStopCommand);

  service
    .command('status')
    .description('Report whether the control-plane service is running')
    .action(serviceStatusCommand);

  program
    .command('dashboard')
    .option('--port <port>', 'Port to listen on', String(DEFAULT_SERVICE_PORT))
    .description('Start the control-plane service if it isn\'t already running, then open Mission Control in your browser')
    .action(dashboardCommand);

  const captain = program.command('captain').description('Define and run Captain tasks against registered workspaces (docs/control-plane.md, Phase 6)');

  captain
    .command('add')
    .argument('<name>', 'Captain task name')
    .requiredOption('--workspace <name>', 'Registered workspace name to target (see: ctxhub workspace list)')
    .requiredOption('--query <query>', 'Question to ask the workspace, evidence-grounded via the same machinery as ctxhub explain')
    .option('--persona <persona>', 'Frame the answer through a persona defined in the target workspace\'s agents/personas/')
    .option('--profile <name>', 'Use a named executionProfiles entry from the target workspace to pick which harness/model runs this task')
    .option('--schedule-every-minutes <minutes>', 'Run this task automatically on this interval while `ctxhub service` is running (default: manual-only via `ctxhub captain run`)')
    .option('--handoff-to <name>', 'Name of another captain task to run immediately after this one finishes, with this task\'s answer folded in as context')
    .description('Define a captain task: plain, editable config, not hardcoded dispatch logic')
    .action(captainAddCommand);

  captain
    .command('list')
    .description('List defined captain tasks')
    .action(captainListCommand);

  captain
    .command('remove')
    .argument('<name>', 'Captain task name')
    .description('Remove a captain task definition')
    .option('--purge-runs', 'Also delete all saved run history for this task')
    .action(captainRemoveCommand);

  captain
    .command('run')
    .argument('<name>', 'Captain task name')
    .description('Run a captain task now, writing its result to the pending-approval queue (never directly to a repo)')
    .action(captainRunCommand);

  captain
    .command('approvals')
    .argument('<name>', 'Captain task name')
    .description('List a captain task\'s pending (not-yet-promoted) runs')
    .action(captainApprovalsCommand);

  captain
    .command('promote')
    .argument('<name>', 'Captain task name')
    .argument('<runId>', 'Run id (see: ctxhub captain approvals)')
    .argument('<repo>', 'Repository to write the promoted note into')
    .option('--title <title>', 'Note title (default: the task\'s query)')
    .option('--agent <agent>', 'Attribution recorded in the note frontmatter')
    .description('The one human-invoked action that turns a pending run into a real, git-tracked AI-draft note')
    .action(captainPromoteCommand);

  captain
    .command('export')
    .argument('<output>', 'Output path for the exported JSON file (e.g. captains.json)')
    .description('Export captain task definitions to a portable JSON file (run history not included)')
    .action(captainExportCommand);

  captain
    .command('import')
    .argument('<input>', 'Path to a JSON file produced by `ctxhub captain export`')
    .option('--overwrite', 'Replace existing tasks with the same name')
    .description('Import captain task definitions from a previously exported file')
    .action(captainImportCommand);

  // ── Jobs ─────────────────────────────────────────────────────────────────

  const job = program.command('job').description('Multi-step, multi-agent job pipelines with live dashboard visibility');

  job
    .command('list')
    .description('List defined jobs')
    .action(jobListCommand);

  job
    .command('add')
    .argument('<name>', 'Job name')
    .description('Define a new multi-step job')
    .option('--description <text>', 'Short description shown in Mission Control')
    .option('--step <spec>', 'Add a step in "name:workspace:query" format (repeatable, order matters)', (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option('--schedule-every-minutes <n>', 'Run automatically on this interval while the service is running')
    .action(jobAddCommand);

  job
    .command('remove')
    .argument('<name>', 'Job name')
    .description('Remove a job definition')
    .action(jobRemoveCommand);

  job
    .command('run')
    .argument('<name>', 'Job name')
    .description('Run a job now (sequentially, blocking until all steps finish)')
    .action(jobRunCommand);

  job
    .command('runs')
    .argument('[name]', 'Filter by job name (default: all jobs)')
    .description('Show recent job run history')
    .action(jobRunsCommand);

  const webhook = program.command('webhook').description('Manage webhook tokens for triggering Jobs and Captains from CI/external systems');

  webhook
    .command('show')
    .description('Show the webhook token and example trigger URLs')
    .action(webhookShowCommand);

  webhook
    .command('generate-token')
    .description('Generate and save a new random webhook token')
    .action(webhookGenerateTokenCommand);

  webhook
    .command('set-token')
    .argument('<token>', 'Token string to use (min 8 characters)')
    .description('Set a specific webhook token')
    .action(webhookSetTokenCommand);

  webhook
    .command('set-secret')
    .argument('<secret>', 'HMAC signing secret (min 8 characters)')
    .description('Set the HMAC-SHA256 signing secret for inbound webhook signature verification (X-Hub-Signature-256)')
    .action(webhookSetSecretCommand);

  const skills = program.command('skills').description('Install chat-native ctxhub usage guidance for coding agents');

  skills
    .command('install')
    .addArgument(
      new Argument('[agents...]', 'Agents to install for (default: all)').choices(SUPPORTED_SKILL_AGENTS)
    )
    .description('Install ctxhub skill files for workspace search, context, notes, and diagrams')
    .action(skillsInstallCommand);

  const note = program.command('note').description('Scaffold git-tracked, team-shared notes for a repo');

  note
    .command('add')
    .argument('<repo>', 'Repository name (see: ctxhub repo list)')
    .argument('<title>', 'Note title')
    .option('--agent <name>', 'Name of the agent creating this note')
    .option('--draft', 'Ask the configured agent CLI to draft the note body from recent commits and indexed context')
    .description('Create a dated, consistently-formatted note file under <repo>/agent-notes/, optionally with an AI draft when llm.enabled')
    .action(noteAddCommand);

  note
    .command('promote')
    .argument('<repo>', 'Repository name (see: ctxhub repo list)')
    .argument('<query>', 'MemPalace search query identifying the memory hit to promote')
    .option('--wing <name>', 'Limit the search to one MemPalace wing/project')
    .option('--room <name>', 'Limit the search to one MemPalace room')
    .option('--hit <index>', 'Which matching result to promote (0 = top match)', '0')
    .option('--title <title>', 'Note title (defaults to a snippet of the promoted memory text)')
    .option('--agent <name>', 'Name of the agent promoting this note')
    .description('Promote a MemPalace durable-memory hit into a git-tracked note under <repo>/agent-notes/')
    .action(notePromoteCommand);

  const diagram = program.command('diagram').description('Scaffold git-tracked Mermaid architecture diagrams for a repo');

  diagram
    .command('add')
    .argument('<repo>', 'Repository name (see: ctxhub repo list)')
    .argument('<title>', 'Diagram title')
    .option('--agent <name>', 'Name of the agent creating this diagram')
    .option('--dir <path>', 'Directory under the repo', 'docs/architecture')
    .option('--type <type>', 'Mermaid diagram type', 'flowchart')
    .option('--draft', 'Ask the configured agent CLI to draft the Mermaid content from recent commits and indexed context')
    .description('Create a dated .mmd architecture diagram under <repo>/docs/architecture/, optionally with an AI draft when llm.enabled')
    .action(diagramAddCommand);

  program
    .command('eval')
    .option('--file <path>', 'Eval suite JSON path')
    .option('--init', 'Create a starter eval suite')
    .option('--health', 'Run built-in workspace-agnostic health checks (5 broad queries; confirms the index is working)')
    .option('--suggest-queries', 'Ask the configured agent CLI for additional golden queries and append them to the eval suite for review')
    .option('--json', 'Print JSON')
    .option('--report', 'Write a Markdown eval report under .ctxhub/cache/evals/')
    .option('--plain', 'Print plain eval output')
    .option('--no-interactive', 'Disable interactive terminal summaries')
    .option('--agent-report', 'Check whether an agent reaches for the tool ctxhub\'s skill docs recommend (requires llm.enabled)')
    .option('--notify', 'Send a desktop notification when an LLM-backed eval mode (--agent-report/--suggest-queries) finishes')
    .description('Run golden query checks against the workspace index. Use --health for a quick index smoke test.')
    .action(evalCommand);

  const validate = program.command('validate').description('Validate indexed docs and architecture artifacts');

  validate
    .command('docs')
    .option('--json', 'Print JSON')
    .option('--strict-diagrams', 'Run stricter local Mermaid syntax checks')
    .option('--plain', 'Print plain validation output')
    .option('--no-interactive', 'Disable interactive terminal summaries')
    .description('Check docs for broken local links and malformed Mermaid files')
    .action(validateDocsCommand);

  program
    .command('graph')
    .option('--json', 'Print JSON')
    .option('--drift', 'Detect missing or unknown architecture graph references')
    .option('--fail-on-drift', 'Exit non-zero when drift findings are present')
    .option('--plain', 'Print plain graph output')
    .option('--no-interactive', 'Disable interactive terminal summaries')
    .option('--llm', 'Force drift-repair suggestions for this call, even if disabled in config')
    .option('--no-llm', 'Force skipping drift-repair suggestions for this call, even if enabled in config')
    .description('Summarize workspace components and relationships from architecture diagrams and package metadata')
    .action(graphCommand);

  program
    .command('watch')
    .option('--interval <seconds>', 'Fallback full-reindex interval in seconds, alongside instant file-change detection', '30')
    .option('--detach', 'Run in the background (detached process, PID file, logs to .ctxhub/cache/watch.log)')
    .option('--stop', 'Stop a background watch process started with --detach')
    .option('--status', 'Show whether a background watch process is running')
    .option('--notify', 'Send a desktop notification whenever a watch cycle actually indexes or deletes something')
    .description('Watch workspace files and re-index on change (instantly via filesystem events, with a periodic fallback pass)')
    .action(watchCommand);

  program
    .command('report')
    .option('-o, --output <path>', 'Output HTML path')
    .option('--open', 'Open the generated report in your browser')
    .option('--memory-query <query>', 'Include MemPalace memory hits for this query in the report and graph views')
    .option('--memory-wing <name>', 'Limit MemPalace report hits to one wing/project')
    .option('--memory-room <name>', 'Limit MemPalace report hits to one room')
    .option('--memory-limit <count>', 'Max MemPalace memory hits to include', '8')
    .option('--timeline-entity <name>', 'Focus the MemPalace timeline on one entity')
    .option('--timeline-limit <count>', 'Max timeline events to render', '40')
    .option('--plain', 'Do not open the report automatically')
    .option('--no-interactive', 'Disable interactive terminal behavior')
    .description('Generate a browsable HTML workspace report')
    .action(reportCommand);

  // ── Auth & login ──────────────────────────────────────────────────────────

  program
    .command('login')
    .description('Sign in to ctxhub via Microsoft Entra ID (OIDC)')
    .action(loginCommand);

  program
    .command('logout')
    .description('Sign out and clear stored credentials')
    .action(logoutCommand);

  const auth = program.command('auth').description('Manage enterprise SSO authentication (Microsoft Entra ID)');

  auth
    .command('configure')
    .description('Configure SSO for this ctxhub installation (Entra ID, Okta, Google, any OIDC provider, or SAML 2.0)')
    .option('--tenant-id <id>', 'Azure AD / Entra ID tenant ID (required for Entra provider)')
    .option('--client-id <id>', 'App registration client (application) ID (OIDC providers)')
    .option('--client-secret <secret>', 'App registration client secret (OIDC providers)')
    .addOption(new Option('--provider <provider>', 'Auth provider').choices(['entra', 'okta', 'google', 'generic', 'saml']).default('entra'))
    .option('--issuer-url <url>', 'OIDC issuer URL (required for non-Entra OIDC providers, e.g. https://accounts.google.com)')
    .option('--idp-entry-point <url>', 'SAML: IdP SSO URL (required for --provider saml)')
    .option('--idp-issuer <issuer>', 'SAML: IdP entity ID (required for --provider saml)')
    .option('--idp-cert <cert>', 'SAML: IdP X.509 signing certificate, PEM or base64 body only (required for --provider saml)')
    .option('--sp-entity-id <id>', 'SAML: this SP\'s own entity ID, registered with the IdP (required for --provider saml)')
    .option('--callback-url <url>', 'SAML: ACS URL (default: local CLI callback, matching how OIDC login works; set to a deployed instance\'s /auth/saml/acs for IdP-initiated SSO)')
    .action((opts: AuthConfigureOptions) => authConfigureCommand(opts));

  auth
    .command('status')
    .description('Show auth configuration and current session status')
    .action(authStatusCommand);

  const roleMap = auth.command('role-map').description('Manage Entra ID → ctxhub role mappings');

  roleMap
    .command('list')
    .description('Show the current role map configuration')
    .action(roleMapListCommand);

  roleMap
    .command('add-owner')
    .description('Grant owner role to a user by their Entra object ID (sub)')
    .requiredOption('--sub <id>', 'Entra object ID to grant owner role (shown in: ctxhub auth status)')
    .action((opts: { sub: string }) => roleMapAddOwnerCommand(opts));

  roleMap
    .command('add-group')
    .description('Map an Entra security group to a ctxhub role')
    .requiredOption('--group <id>', 'Entra security group object ID')
    .addOption(new Option('--role <role>', 'ctxhub role to assign').choices([...VALID_ROLES]).makeOptionMandatory())
    .action((opts: { group: string; role: string }) => roleMapAddGroupCommand(opts));

  roleMap
    .command('remove-group')
    .description('Remove a group → role mapping')
    .requiredOption('--group <id>', 'Entra security group object ID to remove')
    .action((opts: { group: string }) => roleMapRemoveGroupCommand(opts));

  roleMap
    .command('set-default')
    .description('Set the default role for authenticated users with no matching group')
    .addOption(new Option('--role <role>', 'Default ctxhub role').choices([...VALID_ROLES]).makeOptionMandatory())
    .action((opts: { role: string }) => roleMapSetDefaultCommand(opts));

  // ── Corporate Groups ──────────────────────────────────────────────────────

  const group = program.command('group').description('Manage corporate groups for cross-org knowledge sharing (docs/architecture/corporate_groups.md)');

  group
    .command('create')
    .description('Create a new corporate group')
    .requiredOption('--name <name>', 'Group display name (e.g. "VodafoneThree UK")')
    .action((opts: { name: string }) => groupCreateCommand(opts));

  group
    .command('list')
    .description('List all corporate groups and their member orgs')
    .action(() => groupListCommand());

  group
    .command('status')
    .description('Show a group\'s full topology: orgs and sharing matrix')
    .requiredOption('--group-id <id>', 'Corporate group id')
    .action((opts: { groupId: string }) => groupStatusCommand(opts));

  group
    .command('add-org')
    .description('Add an org (legal entity) to a corporate group')
    .requiredOption('--group-id <id>', 'Corporate group id')
    .requiredOption('--name <name>', 'Org display name')
    .requiredOption('--tenant-id <id>', 'Entra tenant ID for this org')
    .option('--group-filter <id>', 'Optional Entra group object ID to restrict membership')
    .addOption(new Option('--trust-tier <tier>', 'Trust tier for this org').choices(['observer', 'participant', 'trusted']).default('participant'))
    .option('--peer-url <url>', 'Base URL of this org\'s ctxhub service for cross-org search fan-out (e.g. https://ctxhub.example.com)')
    .action((opts: { groupId: string; name: string; tenantId: string; groupFilter?: string; trustTier?: string; peerUrl?: string }) =>
      groupAddOrgCommand(opts)
    );

  group
    .command('remove-org')
    .description('Remove an org from a corporate group (also removes all its sharing policies)')
    .requiredOption('--group-id <id>', 'Corporate group id')
    .requiredOption('--org-id <id>', 'Org id to remove')
    .action((opts: { groupId: string; orgId: string }) => groupRemoveOrgCommand(opts));

  group
    .command('sharing')
    .description('Set the sharing mode between two orgs')
    .requiredOption('--from-org <id>', 'Source org id')
    .requiredOption('--to-org <id>', 'Target org id')
    .addOption(new Option('--mode <mode>', 'Sharing mode').choices(['none', 'read', 'bidirectional']).makeOptionMandatory())
    .action((opts: { fromOrg: string; toOrg: string; mode: string }) => groupSharingCommand(opts));

  group
    .command('invite')
    .description('Generate a short-lived invitation token (24h) for an org to join a corporate group')
    .requiredOption('--group-id <id>', 'Corporate group id')
    .requiredOption('--org-name <name>', 'Display name for the org being invited (e.g. "Vodafone UK Engineering")')
    .action((opts: { groupId: string; orgName: string }) => groupInviteCommand(opts));

  group
    .command('join')
    .argument('<token>', 'Invitation token (from: ctxhub group invite)')
    .description('Join a corporate group using an invitation token; uses tenantId from the current auth session')
    .action((token: string) => groupJoinCommand(token));

  // ── Chunk trust tier management ────────────────────────────────────────────

  const chunk = program.command('chunk').description('Inspect and manage indexed chunk trust tiers');

  chunk
    .command('promote')
    .argument('<chunkId>', 'Indexed chunk id (full or prefix of at least 8 characters)')
    .addOption(new Option('--tier <tier>', 'New trust tier to assign').choices(['institutional', 'canonical']).makeOptionMandatory())
    .option('--reason <text>', 'Optional reason recorded with the promotion')
    .option('--by <name>', 'Operator name recorded with the promotion (default: cli)')
    .description('Manually elevate a chunk\'s trust tier to institutional or canonical')
    .action((chunkId: string, opts: { tier: string; reason?: string; by?: string }) => chunkPromoteCommand(chunkId, opts));

  chunk
    .command('list')
    .addOption(new Option('--min-tier <tier>', 'Minimum trust tier to show').choices(['unverified', 'reviewed', 'promoted', 'institutional', 'canonical']).default('unverified'))
    .description('List indexed chunks at or above the specified trust tier, showing id, path/title, and current tier')
    .action((opts: { minTier?: string }) => chunkListCommand(opts));

  // ── Share ─────────────────────────────────────────────────────────────────

  const share = program.command('share').description('Share a context pack via a signed, time-limited URL');

  share
    .command('create')
    .argument('<query>', 'Question or topic to assemble context for')
    .option('--ttl <seconds>', 'Token lifetime in seconds (default: 86400 = 24h)')
    .option('-l, --limit <limit>', 'Max context results', '8')
    .option('--port <port>', 'Service port for the share URL', String(DEFAULT_SERVICE_PORT))
    .option('--one-time', 'Delete the pack after first access')
    .description('Assemble a context pack and create a signed share URL (served by the local ctxhub service)')
    .action((query: string, opts: { ttl?: string; limit?: string; port?: string; oneTime?: boolean }) =>
      shareCommand(query, opts)
    );

  share
    .command('list')
    .description('List active (non-expired) shares with their queries and expiry times')
    .action(() => shareListCommand());

  share
    .command('revoke')
    .argument('<token-id>', 'Share token id to delete (the jti/UUID part)')
    .description('Delete a share pack file, revoking access')
    .action((tokenId: string) => shareRevokeCommand(tokenId));

  // ── service set-peer-url ──────────────────────────────────────────────────

  service
    .command('set-peer-url')
    .argument('<url>', 'The public base URL of this ctxhub instance (e.g. https://ctxhub.example.com)')
    .description('Set the public URL of this ctxhub instance for peer discovery via heartbeat')
    .action((url: string) => serviceSetPeerUrlCommand(url));

  // ── group heartbeat ───────────────────────────────────────────────────────

  group
    .command('heartbeat')
    .description('Send a heartbeat to the local service announcing this instance\'s peerUrl (requires CTXHUB_ORG_ID, CTXHUB_GROUP_ID env vars)')
    .action(() => groupHeartbeatCommand());

  // ── group query ───────────────────────────────────────────────────────────

  group
    .command('query')
    .description('Query knowledge from peer orgs within the same corporate group')
    .requiredOption('--q <query>', 'Knowledge query')
    .option('--min-confidence <n>', 'Minimum confidence score (0.0–1.0) to include in results')
    .action((opts: { q: string; minConfidence?: string }) => groupQueryCommand(opts));

  // ── group identity ────────────────────────────────────────────────────────

  const groupIdentity = group.command('identity').description('Manage per-org identity configuration (per-org role overrides for a shared Entra ID tenant)');

  groupIdentity
    .command('set-default')
    .description('Set the default role for authenticated members of this org (overrides the global default)')
    .requiredOption('--group-id <id>', 'Corporate group id')
    .requiredOption('--org-id <id>', 'Org id')
    .requiredOption('--role <role>', 'Default ctxhub role for this org')
    .action((opts: { groupId: string; orgId: string; role: string }) => groupIdentitySetDefaultCommand(opts));

  groupIdentity
    .command('add-group-role')
    .description('Map an Entra security group to a ctxhub role within this org (overrides the global group role mapping)')
    .requiredOption('--group-id <gid>', 'Corporate group id')
    .requiredOption('--org-id <oid>', 'Org id')
    .requiredOption('--entra-group <eg>', 'Entra security group object ID')
    .requiredOption('--role <role>', 'ctxhub role to assign to members of this Entra group in this org')
    .action((opts: { groupId: string; orgId: string; entraGroup: string; role: string }) => groupIdentityAddGroupRoleCommand(opts));

  groupIdentity
    .command('add-override')
    .description('Set a per-user role override within this org (overrides all other role resolution for this user)')
    .requiredOption('--group-id <gid>', 'Corporate group id')
    .requiredOption('--org-id <oid>', 'Org id')
    .requiredOption('--sub <sub>', 'Entra object ID (sub) of the user')
    .requiredOption('--role <role>', 'ctxhub role to assign to this user in this org')
    .action((opts: { groupId: string; orgId: string; sub: string; role: string }) => groupIdentityAddOverrideCommand(opts));

  groupIdentity
    .command('show')
    .description('Show the current identity configuration for an org')
    .requiredOption('--group-id <gid>', 'Corporate group id')
    .requiredOption('--org-id <oid>', 'Org id')
    .action((opts: { groupId: string; orgId: string }) => groupIdentityShowCommand(opts));

  // ── Cloud ─────────────────────────────────────────────────────────────────

  const cloud = program.command('cloud').description('Manage ctxhub Cloud sync configuration');

  cloud
    .command('configure')
    .description('Save ctxhub Cloud endpoint and API key to ~/.ctxhub/cloud.json')
    .requiredOption('--endpoint <url>', 'ctxhub Cloud API base URL (e.g. https://cloud.ctxhub.io)')
    .requiredOption('--api-key <key>', 'API key for authenticating Cloud sync requests')
    .action((opts: { endpoint: string; apiKey: string }) => cloudConfigureCommand(opts));

  cloud
    .command('status')
    .description('Show Cloud sync configuration and last sync statistics')
    .action(() => cloudStatusCommand());

  cloud
    .command('sync')
    .description('Push institutional/canonical chunks to ctxhub Cloud')
    .option('--workspace <name>', 'Limit sync to a specific workspace (default: all registered workspaces)')
    .option('--dry-run', 'Show how many chunks would be synced without actually syncing')
    .action((opts: { workspace?: string; dryRun?: boolean }) => cloudSyncCommand(opts));

  // ── Blueprint ─────────────────────────────────────────────────────────────

  const blueprint = program.command('blueprint').description('Manage installable packages of captain tasks, personas, and mission templates');

  blueprint
    .command('pack')
    .description('Pack a blueprint directory into a versioned .ctxblueprint archive')
    .option('--dir <path>', 'Directory containing blueprint.yaml (default: current directory)')
    .option('--out <path>', 'Output path for the archive (default: ./<name>-<version>.ctxblueprint)')
    .action((opts: { dir?: string; out?: string }) => blueprintPackCommand(opts));

  blueprint
    .command('install')
    .argument('<path-or-name>', 'Local .ctxblueprint file path, or a registry name[@version] (requires ctxhub cloud configure)')
    .option('--ignore-deps', 'Skip dependency resolution check')
    .description('Install a blueprint from a local .ctxblueprint archive or the Cloud registry')
    .action((target: string, opts: { ignoreDeps?: boolean }) => blueprintInstallCommand(target, opts));

  blueprint
    .command('publish')
    .argument('<path-or-archive>', 'Blueprint source directory or a packed .ctxblueprint file')
    .option('--public', 'Publish visible to every org (default: org-private, visible only to your own org)')
    .description('Publish a blueprint to the Cloud registry (requires ctxhub cloud configure)')
    .action((target: string, opts: { public?: boolean }) => blueprintPublishCommand(target, opts));

  blueprint
    .command('list')
    .description('List installed blueprints')
    .action(() => blueprintListCommand());

  blueprint
    .command('remove')
    .argument('<name>', 'Name of the installed blueprint to remove')
    .description('Remove an installed blueprint')
    .action((name: string) => blueprintRemoveCommand(name));

  // ── Machine Tokens ────────────────────────────────────────────────────────

  const machineToken = program.command('machine-token').description('Manage machine tokens for CI/CD pipeline authentication (ctxm_ prefix)');

  machineToken
    .command('create')
    .description('Create a new machine token')
    .requiredOption('--name <name>', 'Human-readable label for the token (e.g. "github-actions")')
    .option('--role <role>', 'Role to assign (default: machine)', 'machine')
    .option('--expires-in <days>', 'Token validity in days (default: 365)', '365')
    .action((opts: { name: string; role?: string; expiresIn?: string }) =>
      machineTokenCreateCommand(opts)
    );

  machineToken
    .command('list')
    .description('List all machine tokens (never shows raw token values)')
    .action(() => machineTokenListCommand());

  machineToken
    .command('revoke')
    .argument('<id>', 'Token ID (full UUID or first 8 characters)')
    .description('Revoke a machine token (sets revokedAt; token is no longer valid)')
    .action((id: string) => machineTokenRevokeCommand(id));

  // ── Audit log ─────────────────────────────────────────────────────────────

  program
    .command('audit')
    .description('Query the ctxhub audit event log')
    .option('--actor <sub>', 'Filter by actor sub or email (substring match)')
    .option('--action <type>', 'Filter by event type (substring match, e.g. "auth.login")')
    .option('--from <date>', 'Filter events on or after this ISO date')
    .option('--to <date>', 'Filter events on or before this ISO date')
    .option('--limit <n>', 'Max entries to return (default: 20)', '20')
    .option('--format <fmt>', 'Output format: table, json, or csv (default: table)', 'table')
    .option('--out <file>', 'Write output to a file instead of stdout')
    .action((opts: { actor?: string; action?: string; from?: string; to?: string; limit?: string; format?: string; out?: string }) =>
      auditCommand(opts)
    );

  // ── Topology Graph ────────────────────────────────────────────────────────────

  const topology = program.command('topology').description('Manage the topology graph: repositories, services, and their edges');

  const topoRepo = topology.command('repo').description('Manage topology repositories');

  topoRepo
    .command('add')
    .description('Add a repository to the topology graph')
    .requiredOption('--name <name>', 'Repository name')
    .option('--url <url>', 'Repository URL')
    .option('--workspace <id>', 'Linked ctxhub workspace id')
    .option('--lang <language>', 'Primary language (e.g. TypeScript, Go)')
    .option('--tags <tags>', 'Comma-separated tags')
    .action((opts: { name: string; url?: string; workspace?: string; lang?: string; tags?: string }) =>
      topologyRepoAddCommand(opts)
    );

  topoRepo
    .command('list')
    .description('List all repositories in the topology graph')
    .action(() => topologyRepoListCommand());

  const topoService = topology.command('service').description('Manage topology services');

  topoService
    .command('add')
    .description('Add a service to the topology graph')
    .requiredOption('--name <name>', 'Service name')
    .option('--type <type>', 'Service type (api, worker, db, queue, frontend, infra)')
    .option('--repo <repo-id>', 'Repository id that contains this service')
    .option('--description <text>', 'Short description')
    .option('--tags <tags>', 'Comma-separated tags')
    .action((opts: { name: string; type?: string; repo?: string; description?: string; tags?: string }) =>
      topologyServiceAddCommand(opts)
    );

  topoService
    .command('list')
    .description('List all services in the topology graph')
    .action(() => topologyServiceListCommand());

  const topoEdge = topology.command('edge').description('Manage topology edges');

  topoEdge
    .command('add')
    .description('Add an edge between two topology nodes')
    .requiredOption('--from <id>', 'Source node id')
    .requiredOption('--from-type <type>', 'Source node type (service or repository)')
    .requiredOption('--to <id>', 'Target node id')
    .requiredOption('--to-type <type>', 'Target node type (service or repository)')
    .requiredOption('--type <edge-type>', 'Edge type (depends_on, calls, owns, deployed_with, shares_db)')
    .option('--description <text>', 'Optional description')
    .action((opts: { from: string; fromType: string; to: string; toType: string; type: string; description?: string }) =>
      topologyEdgeAddCommand(opts)
    );

  topoEdge
    .command('list')
    .description('List topology edges')
    .option('--from <id>', 'Filter to edges from this node id')
    .action((opts: { from?: string }) => topologyEdgeListCommand(opts));

  topology
    .command('deps')
    .argument('<service-id>', 'Service id to trace dependencies from')
    .description('Show transitive depends_on dependency tree (up to depth 3)')
    .action((serviceId: string) => topologyDepsCommand(serviceId));

  topology
    .command('show')
    .description('Show an ASCII overview of services and their edges')
    .action(() => topologyShowCommand());

  // ── Cascade Rules ─────────────────────────────────────────────────────────────

  const cascade = program.command('cascade').description('Manage cross-org cascade rules: Captain findings in one org trigger runs in another');

  cascade
    .command('list')
    .description('List cascade rules')
    .option('--org-id <id>', 'Filter by trigger org id')
    .action((opts: { orgId?: string }) => cascadeListCommand(opts));

  cascade
    .command('add')
    .description('Add a manual cascade rule')
    .requiredOption('--trigger-org <id>', 'Org id where the Captain finding originates')
    .requiredOption('--target-org <id>', 'Org id where the Captain run should be triggered')
    .requiredOption('--name <name>', 'Rule name')
    .option('--tags <tags>', 'Comma-separated tags: only cascade if finding has these tags')
    .option('--workspace <id>', 'Target workspace id to run Captain in')
    .action((opts: { triggerOrg: string; targetOrg: string; name: string; tags?: string; workspace?: string }) =>
      cascadeAddCommand(opts)
    );

  cascade
    .command('remove')
    .argument('<id>', 'Rule id to remove')
    .description('Remove a cascade rule')
    .action((id: string) => cascadeRemoveCommand(id));

  cascade
    .command('derive')
    .description('Derive cascade rules from topology depends_on edges across orgs')
    .option('--yes', 'Skip confirmation prompt and save rules')
    .action((opts: { yes?: boolean }) => cascadeDeriveCommand(opts));

  // ── Custom Roles ──────────────────────────────────────────────────────────

  const role = program.command('role').description('Manage custom roles with configurable permission sets');

  role
    .command('create')
    .description('Create a new custom role with specified permissions')
    .requiredOption('--name <name>', 'Role name (must not conflict with built-in roles)')
    .requiredOption('--permissions <list>', 'Comma-separated permissions (e.g. knowledge:read,workspace:read)')
    .option('--inherits <role>', 'Built-in or custom role to inherit permissions from')
    .option('--description <text>', 'Short description of the role')
    .action((opts: { name: string; permissions: string; inherits?: string; description?: string }) =>
      roleCreateCommand(opts)
    );

  role
    .command('list')
    .description('List all roles (built-in and custom)')
    .action(() => roleListCommand());

  role
    .command('show')
    .argument('<name>', 'Role name to inspect')
    .description('Show permissions for a role (including inherited)')
    .action((name: string) => roleShowCommand(name));

  role
    .command('delete')
    .argument('<name>', 'Custom role name to delete (cannot delete built-in roles)')
    .description('Delete a custom role')
    .action((name: string) => roleDeleteCommand(name));

  // ── Licence ───────────────────────────────────────────────────────────────

  const licence = program.command('licence').description('Manage air-gapped licence key for enterprise deployments');

  licence
    .command('status')
    .description('Show licence status, org name, seats, features, and expiry')
    .action(() => licenceStatusCommand());

  licence
    .command('install')
    .description('Install a licence file (validates before copying to ~/.ctxhub/licence.json)')
    .requiredOption('--file <path>', 'Path to the licence JSON file')
    .action((opts: { file: string }) => licenceInstallCommand(opts));

  // ── Billing ───────────────────────────────────────────────────────────────

  const billing = program.command('billing').description('Enterprise usage reporting (not pricing/invoicing)');

  billing
    .command('usage')
    .description('Report seats and activity for this instance — the code-only piece of enterprise billing')
    .option('--since <iso>', 'Report activity since this ISO timestamp (default: 30 days ago)')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((opts: BillingUsageOptions) => billingUsageCommand(opts));

  // ── Status ────────────────────────────────────────────────────────────────

  program
    .command('status')
    .description('Print a compact health snapshot: auth, service, workspaces, groups, blueprints, machine tokens')
    .action(() => statusCommand());

  // ── Version ───────────────────────────────────────────────────────────────

  program
    .command('version')
    .description('Print current ctxhub version, optionally checking for updates')
    .option('--check', 'Check npm registry for the latest published version')
    .action(async (opts: { check?: boolean }) => {
      if (opts.check) {
        await versionCheckCommand();
      } else {
        console.log(`ctxhub v${getPackageVersion()}`);
      }
    });

  return program;
}
