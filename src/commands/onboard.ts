import { runOnboardMode } from '../tui/OnboardApp.js';

export async function onboardCommand() {
  if (!process.stdin.isTTY) {
    throw new Error('ctxhub onboard needs a real terminal (stdin is not a TTY). Run the individual setup commands directly instead.');
  }

  await runOnboardMode();
}
