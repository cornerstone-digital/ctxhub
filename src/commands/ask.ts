import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';
import { createExplainResult, type ExplainResult } from './explain.js';

export type AskResult = {
  question: string;
  answer?: string[];
  citations?: ExplainResult['citations'];
  suggestedReadingOrder?: ExplainResult['suggestedReadingOrder'];
  unavailableNotice?: string;
};

export async function askCommand(
  question: string,
  opts: { limit?: string; json?: boolean; llm?: boolean } = {}
): Promise<void> {
  const result = await createAskResult(question, Number(opts.limit ?? 8), process.cwd(), {
    llmOverride: opts.llm,
    runAgentPromptFn: runAgentPrompt
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.unavailableNotice) {
    console.log(chalk.yellow(result.unavailableNotice));
    return;
  }

  console.log(chalk.bold(`Ask: ${result.question}`));
  for (const line of result.answer ?? []) console.log(`- ${line}`);

  if (result.citations?.length) {
    console.log(`\n${chalk.bold('Citations')}`);
    for (const item of result.citations) {
      console.log(`- [${item.ref}] ${item.repo}:${item.path}${item.title ? ` - ${item.title}` : ''}`);
    }
  }

  if (result.suggestedReadingOrder?.length) {
    console.log(`\n${chalk.bold('Suggested Reading Order')}`);
    for (const item of result.suggestedReadingOrder) console.log(`- ${item.repo}:${item.path}${item.title ? ` - ${item.title}` : ''}`);
  }
}

export async function createAskResult(
  question: string,
  limit = 8,
  cwd = process.cwd(),
  opts: { llmOverride?: boolean; runAgentPromptFn?: typeof runAgentPrompt } = {}
): Promise<AskResult> {
  const { config } = await loadWorkspaceConfig(cwd);
  const llmEnabled = opts.llmOverride === undefined ? config.llm.enabled : opts.llmOverride;

  if (!llmEnabled) {
    return {
      question,
      unavailableNotice:
        `${llmDisabledNotice('ask answers')} Run ctxhub explain "${question}" or ctxhub pack "${question}" for a non-LLM evidence view.`
    };
  }

  const result = await createExplainResult(question, limit, cwd, {
    llmOverride: true,
    runAgentPromptFn: opts.runAgentPromptFn
  });

  if (result.llmNotice) {
    return {
      question,
      unavailableNotice:
        result.evidence.length === 0
          ? 'No indexed evidence matched this question. Run ctxhub index, broaden the question, or inspect ctxhub search first.'
          : `${result.llmNotice} Try ctxhub explain "${question}" or ctxhub pack "${question}" for the raw evidence.`
    };
  }

  return {
    question,
    answer: result.answer,
    citations: result.citations,
    suggestedReadingOrder: result.suggestedReadingOrder
  };
}