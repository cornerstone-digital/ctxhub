export type InteractionOptions = {
  interactive?: boolean;
  plain?: boolean;
  json?: boolean;
};

export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CI === 'true' || env.GITHUB_ACTIONS === 'true' || env.BUILD_BUILDID !== undefined;
}

export function shouldUseInteractive(opts: InteractionOptions = {}): boolean {
  const argv = process.argv.slice(2);
  const rootOptOut = argv.includes('--plain') || argv.includes('--no-interactive');
  if (opts.json || opts.plain || opts.interactive === false || rootOptOut) return false;
  if (opts.interactive === true) return Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (isCiEnvironment()) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
