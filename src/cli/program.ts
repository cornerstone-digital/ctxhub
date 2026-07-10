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
import { evalCommand } from '../commands/eval.js';
import { validateDocsCommand } from '../commands/validate.js';
import { graphCommand } from '../commands/graph.js';
import { openCommand } from '../commands/open.js';
import { prContextCommand } from '../commands/prContext.js';
import { watchCommand } from '../commands/watch.js';
import { reportCommand } from '../commands/report.js';
import { ciInitCommand } from '../commands/ci.js';
import { runGuidedMode } from '../commands/guided.js';
import { checkForDriftOnce } from '../utils/driftCheck.js';
import { getPackageVersion } from '../utils/version.js';

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
    .action(indexCommand);

  program
    .command('sync')
    .description('Pull repos and re-index changed knowledge')
    .option('--no-pull', 'Skip git pull')
    .option('--plain', 'Use plain progress output')
    .option('--no-interactive', 'Disable the live progress view')
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
    .description('Create a citation-first explanation from indexed context, LLM-synthesized when llm.enabled')
    .action(explainCommand);

  program
    .command('ask')
    .argument('<question>', 'Question to answer from indexed evidence')
    .option('-l, --limit <limit>', 'Max context results', '8')
    .option('--json', 'Print JSON')
    .option('--llm', 'Force LLM-backed ask synthesis for this call, even if disabled in config')
    .option('--no-llm', 'Disable ask synthesis for this call and print the fallback guidance')
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
    .description('Create a markdown handoff bundle for another agent or teammate, with an LLM-synthesized summary when llm.enabled')
    .action(handoffCommand);

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
    .option('--plain', 'Print plain health-check output')
    .option('--no-interactive', 'Disable the live checklist')
    .addOption(
      new Option('--fix-agent <name>', "With --fix, refresh one agent's MCP config").choices(SUPPORTED_AGENTS)
    )
    .action(doctorCommand);

  program
    .command('mcp')
    .description('Start the ctxhub MCP server (stdio) for AI agent tool use')
    .option('--allow-index', 'Expose opt-in mutating index/sync tools over MCP')
    .option('--allow-memory-write', 'Expose opt-in mutating MemPalace write tools (memory_add, diary_write) over MCP')
    .option('--restart-on-stale', 'Exit when a newer build is detected on disk (only an effective restart if your MCP host auto-respawns a stopped server)')
    .action(mcpCommand);

  program
    .command('agent')
    .addArgument(new Argument('<name>', 'Agent to launch').choices(SUPPORTED_AGENTS))
    .description("Write the agent's MCP config for this workspace and launch it, pre-wired with the ctxhub MCP server")
    .option('--no-launch', 'Only write the MCP config, do not launch the agent')
    .action(agentLaunchCommand);

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
    .option('--suggest-queries', 'Ask the configured agent CLI for additional golden queries and append them to the eval suite for review')
    .option('--json', 'Print JSON')
    .option('--report', 'Write a Markdown eval report under .ctxhub/cache/evals/')
    .option('--plain', 'Print plain eval output')
    .option('--no-interactive', 'Disable interactive terminal summaries')
    .option('--agent-report', 'Check whether an agent reaches for the tool ctxhub\'s skill docs recommend (requires llm.enabled)')
    .description('Run golden query checks against the workspace index')
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
    .option('--interval <seconds>', 'Polling interval in seconds', '30')
    .description('Continuously re-index changed workspace files')
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

  return program;
}
