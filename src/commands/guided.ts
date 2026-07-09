import { render } from 'ink';
import React from 'react';
import { GuidedApp } from '../tui/GuidedApp.js';

export async function runGuidedMode(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error('The guided menu needs a real terminal (stdin is not a TTY). Run ctxhub <command> directly instead.');
  }

  const instance = render(React.createElement(GuidedApp));
  await instance.waitUntilExit();
}
