import path from 'node:path';
import chalk from 'chalk';
import { pathExists, writeText } from '../utils/fs.js';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export type CiInitOptions = {
  force?: boolean;
  withEval?: boolean;
  packageManager?: PackageManager;
};

const WORKFLOW_PATH = path.join('.github', 'workflows', 'ctxhub.yml');

export async function ciInitCommand(opts: CiInitOptions = {}) {
  const packageManager = parsePackageManager(opts.packageManager);
  const outputPath = path.resolve(process.cwd(), WORKFLOW_PATH);

  if ((await pathExists(outputPath)) && !opts.force) {
    throw new Error(`${WORKFLOW_PATH} already exists. Use --force to overwrite.`);
  }

  await writeText(outputPath, createGithubActionsWorkflow({
    packageManager,
    withEval: Boolean(opts.withEval)
  }));

  console.log(chalk.green(`Created ${WORKFLOW_PATH}`));
}

export function createGithubActionsWorkflow(opts: { packageManager: PackageManager; withEval: boolean }): string {
  const commands = packageManagerCommands(opts.packageManager);
  const evalStep = opts.withEval
    ? `
      - name: Run ctxhub evals
        run: npx ctxhub eval
`
    : '';

  return `name: ctxhub

on:
  pull_request:
  workflow_dispatch:

jobs:
  validate-context:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: ${opts.packageManager}

      - name: Install dependencies
        run: ${commands.install}

      - name: Build project
        run: ${commands.build}

      - name: Validate ctxhub docs and diagrams
        run: npx ctxhub validate docs
${evalStep}`;
}

function packageManagerCommands(packageManager: PackageManager): { install: string; build: string } {
  if (packageManager === 'pnpm') {
    return { install: 'pnpm install --frozen-lockfile', build: 'pnpm run build --if-present' };
  }
  if (packageManager === 'yarn') {
    return { install: 'yarn install --frozen-lockfile', build: 'yarn build --if-present' };
  }
  return { install: 'npm ci', build: 'npm run build --if-present' };
}

function parsePackageManager(value: PackageManager | undefined): PackageManager {
  if (!value) return 'npm';
  if (value === 'npm' || value === 'pnpm' || value === 'yarn') return value;
  throw new Error(`Unsupported package manager: ${value}`);
}
