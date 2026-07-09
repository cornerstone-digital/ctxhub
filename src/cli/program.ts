import { Argument, Command, Option } from 'commander';
import { initCommand } from '../commands/init.js';
import { repoAddCommand, repoDiscoverCommand, repoHookCommand, repoListCommand } from '../commands/repo.js';
import { indexCommand } from '../commands/index.js';
import { searchCommand } from '../commands/search.js';
import { syncCommand } from '../commands/sync.js';
import { memoryClearCommand, memoryStatusCommand } from '../commands/memory.js';
import { doctorCommand } from '../commands/doctor.js';
import { mcpCommand } from '../commands/mcp.js';
import { agentLaunchCommand, SUPPORTED_AGENTS } from '../commands/agent.js';
import { skillsInstallCommand, SUPPORTED_SKILL_AGENTS } from '../commands/skills.js';
import { onboardCommand } from '../commands/onboard.js';
import { noteAddCommand } from '../commands/note.js';
import { diagramAddCommand } from '../commands/diagram.js';
import { packCommand } from '../commands/pack.js';
import { explainCommand } from '../commands/explain.js';
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
    .version(getPackageVersion());

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
    .description('Add a repository to the workspace')
    .action(repoAddCommand);

  repo
    .command('list')
    .description('List configured repositories')
    .action(repoListCommand);

  repo
    .command('discover')
    .argument('[root]', 'Root folder to scan', '.')
    .description('Discover Git repositories under a folder')
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
    .action(indexCommand);

  program
    .command('sync')
    .description('Pull repos and re-index changed knowledge')
    .option('--no-pull', 'Skip git pull')
    .action(syncCommand);

  program
    .command('search')
    .argument('[query]', 'Search query (omit when using --interactive)')
    .option('-l, --limit <limit>', 'Max results', '5')
    .option('-i, --interactive', 'Launch a live, filterable terminal search UI')
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
    .description('Create a citation-first explanation scaffold from indexed context')
    .action(explainCommand);

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
    .description('Build a context pack for files changed on the current branch')
    .action(prContextCommand);

  program
    .command('handoff')
    .argument('<topic>', 'Topic or task to hand off')
    .option('--repo <name>', 'Limit handoff sections to a configured repo')
    .option('--out <path>', 'Output markdown path')
    .option('--from-pr', 'Include changed files from the current branch')
    .option('--base <ref>', 'Base git ref for --from-pr', 'origin/main')
    .option('-l, --limit <limit>', 'Max context results', '8')
    .description('Create a markdown handoff bundle for another agent or teammate')
    .action(handoffCommand);

  const memory = program.command('memory').description('Manage memory/index store');

  memory
    .command('status')
    .description('Show memory stats')
    .action(memoryStatusCommand);

  memory
    .command('clear')
    .description('Clear local memory chunks')
    .option('-f, --force', 'Clear without confirmation')
    .action(memoryClearCommand);

  program
    .command('doctor')
    .description('Check workspace health')
    .option('--fix', 'Apply safe, low-risk automatic fixes (missing dirs, default privacy config)')
    .option('--dry-run', 'With --fix, explain intended changes without applying them')
    .option('--fix-skills', 'With --fix, reinstall stale skill files (overwrites installed skill files)')
    .addOption(
      new Option('--fix-agent <name>', "With --fix, refresh one agent's MCP config").choices(SUPPORTED_AGENTS)
    )
    .action(doctorCommand);

  program
    .command('mcp')
    .description('Start the ctxhub MCP server (stdio) for AI agent tool use')
    .option('--allow-index', 'Expose opt-in mutating index/sync tools over MCP')
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
    .description('Install ctxhub skill/prompt files (ambient guidance + explicit search) for one or more coding agents')
    .action(skillsInstallCommand);

  const note = program.command('note').description('Scaffold git-tracked, team-shared notes for a repo');

  note
    .command('add')
    .argument('<repo>', 'Repository name (see: ctxhub repo list)')
    .argument('<title>', 'Note title')
    .option('--agent <name>', 'Name of the agent creating this note')
    .description('Create a dated, consistently-formatted note file under <repo>/agent-notes/')
    .action(noteAddCommand);

  const diagram = program.command('diagram').description('Scaffold git-tracked Mermaid architecture diagrams for a repo');

  diagram
    .command('add')
    .argument('<repo>', 'Repository name (see: ctxhub repo list)')
    .argument('<title>', 'Diagram title')
    .option('--agent <name>', 'Name of the agent creating this diagram')
    .option('--dir <path>', 'Directory under the repo', 'docs/architecture')
    .option('--type <type>', 'Mermaid diagram type', 'flowchart')
    .description('Create a dated .mmd architecture diagram under <repo>/docs/architecture/')
    .action(diagramAddCommand);

  program
    .command('eval')
    .option('--file <path>', 'Eval suite JSON path')
    .option('--init', 'Create a starter eval suite')
    .option('--json', 'Print JSON')
    .option('--report', 'Write a Markdown eval report under .ctxhub/cache/evals/')
    .description('Run golden query checks against the workspace index')
    .action(evalCommand);

  const validate = program.command('validate').description('Validate indexed docs and architecture artifacts');

  validate
    .command('docs')
    .option('--json', 'Print JSON')
    .option('--strict-diagrams', 'Run stricter local Mermaid syntax checks')
    .description('Check docs for broken local links and malformed Mermaid files')
    .action(validateDocsCommand);

  program
    .command('graph')
    .option('--json', 'Print JSON')
    .option('--drift', 'Detect missing or unknown architecture graph references')
    .option('--fail-on-drift', 'Exit non-zero when drift findings are present')
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
    .description('Generate a browsable HTML workspace report')
    .action(reportCommand);

  return program;
}
