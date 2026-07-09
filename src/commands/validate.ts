import path from 'node:path';
import fg from 'fast-glob';
import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import { pathExists, readText } from '../utils/fs.js';
import { shouldUseInteractive } from '../utils/interactive.js';

export type ValidationIssue = { file: string; message: string; severity: 'error' | 'warning' };
const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
const mermaidDeclarationPattern = /\b(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram|stateDiagram-v2|C4Context|C4Container|C4Component)\b/;

export async function validateDocsCommand(opts: { json?: boolean; strictDiagrams?: boolean; plain?: boolean; interactive?: boolean } = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const issues: ValidationIssue[] = [];
  const knownComponents = new Set(config.repositories.map(repo => repo.name.toLowerCase()));
  let scanned = 0;

  for (const repo of config.repositories) {
    const repoPath = path.resolve(workspaceRoot, repo.path);
    if (!(await pathExists(repoPath))) continue;
    const files = await fg(['**/*.md', '**/*.mmd', '**/*.mermaid'], {
      cwd: repoPath,
      ignore: repo.exclude ?? config.knowledge.exclude,
      onlyFiles: true
    });
    scanned += files.length;

    for (const file of files) {
      const absolutePath = path.join(repoPath, file);
      const content = await readText(absolutePath);
      if (file.endsWith('.md')) {
        for (const match of content.matchAll(markdownLinkPattern)) {
          const target = match[1];
          if (!target || target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:')) continue;
          const linkPath = target.split('#')[0];
          if (!linkPath) continue;
          if (!(await pathExists(path.resolve(path.dirname(absolutePath), linkPath)))) {
            issues.push({ file: `${repo.name}:${file}`, message: `broken local link: ${target}`, severity: 'error' });
          }
        }
      }

      if (isMermaidFile(file) && !mermaidDeclarationPattern.test(content)) {
        issues.push({ file: `${repo.name}:${file}`, message: 'Mermaid file has no recognized diagram declaration', severity: 'error' });
      }

      if (isMermaidFile(file)) {
        if (opts.strictDiagrams) {
          for (const issue of validateMermaidSyntax(content)) {
            issues.push({ ...issue, file: `${repo.name}:${file}` });
          }
        }
        for (const component of extractComponentLikeTokens(content)) {
          if (!knownComponents.has(component.toLowerCase())) {
            issues.push({ file: `${repo.name}:${file}`, message: `component has no matching configured repo: ${component}`, severity: 'warning' });
          }
        }
      }
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ issues }, null, 2));
    return;
  }

  if (!issues.length) {
    if (shouldUseInteractive(opts)) printValidationSummary(scanned, issues);
    console.log(chalk.green('✓ docs validation passed'));
    return;
  }

  if (shouldUseInteractive(opts)) printValidationSummary(scanned, issues);
  for (const issue of issues) {
    const marker = issue.severity === 'error' ? chalk.red('✗') : chalk.yellow('!');
    console.log(`${marker} ${issue.file}: ${issue.message}`);
  }
  if (issues.some(issue => issue.severity === 'error')) process.exitCode = 1;
}

function printValidationSummary(scanned: number, issues: ValidationIssue[]): void {
  const errors = issues.filter(issue => issue.severity === 'error').length;
  const warnings = issues.filter(issue => issue.severity === 'warning').length;
  console.log(chalk.bold('ctxhub validate docs'));
  console.log(chalk.gray(`${scanned} files scanned · ${errors} errors · ${warnings} warnings`));
}

export function validateMermaidSyntax(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = content.split('\n');
  const firstMeaningfulLine = lines.map(line => line.trim()).find(line => line && !line.startsWith('%%'));
  const declaration = firstMeaningfulLine?.split(/\s+/)[0];

  if (!firstMeaningfulLine || !mermaidDeclarationPattern.test(firstMeaningfulLine)) {
    issues.push({ file: '', message: 'Mermaid diagram has no recognized first-line declaration', severity: 'error' });
  }

  for (const delimiterIssue of validateBalancedDelimiters(content)) issues.push(delimiterIssue);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('%%') || mermaidDeclarationPattern.test(line) || line === 'end') return;
    const lineNumber = index + 1;

    if ((declaration === 'flowchart' || declaration === 'graph') && looksLikeBrokenFlowRelationship(line)) {
      issues.push({ file: '', message: `line ${lineNumber}: malformed flowchart relationship`, severity: 'error' });
    }

    if (declaration === 'sequenceDiagram' && looksLikeBrokenSequenceRelationship(line)) {
      issues.push({ file: '', message: `line ${lineNumber}: malformed sequence relationship`, severity: 'error' });
    }
  });

  return dedupeIssues(issues);
}

function extractComponentLikeTokens(content: string): string[] {
  const tokens = new Set<string>();
  for (const line of content.split('\n')) {
    if (!/[-.=]+>|--|<->|->>/.test(line)) continue;
    for (const token of line.replace(/\[[^\]]*\]|\([^)]+\)|\{[^}]+\}/g, ' ').split(/[-.=<>:\s]+/)) {
      if (/^[A-Z][A-Za-z0-9_-]+$/.test(token)) tokens.add(token);
    }
  }
  return [...tokens].slice(0, 100);
}

function isMermaidFile(file: string): boolean {
  return /\.(mmd|mermaid)$/i.test(file);
}

function validateBalancedDelimiters(content: string): ValidationIssue[] {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const closers = new Set(Object.values(pairs));
  const stack: Array<{ opener: string; line: number }> = [];
  const issues: ValidationIssue[] = [];

  content.split('\n').forEach((line, lineIndex) => {
    for (const char of line.replace(/%%.*$/, '')) {
      if (pairs[char]) stack.push({ opener: char, line: lineIndex + 1 });
      if (closers.has(char)) {
        const top = stack.pop();
        if (!top || pairs[top.opener] !== char) {
          issues.push({ file: '', message: `line ${lineIndex + 1}: unmatched closing delimiter "${char}"`, severity: 'error' });
        }
      }
    }
  });

  for (const item of stack) {
    issues.push({ file: '', message: `line ${item.line}: unmatched opening delimiter "${item.opener}"`, severity: 'error' });
  }

  return issues;
}

function looksLikeBrokenFlowRelationship(line: string): boolean {
  if (!/[-.=]+>|--|<->/.test(line)) return false;
  const withoutLabels = line.replace(/\|[^|]*\|/g, ' ');
  const endpoints = withoutLabels
    .split(/\s*(?:<[-.=]+>|[-.=]+>|--|<->)\s*/)
    .map(part => part.trim())
    .filter(Boolean);
  return endpoints.length < 2 || endpoints.some(endpoint => !/^[A-Za-z0-9_./-]+(?:\s*[[({].*)?$/.test(endpoint));
}

function looksLikeBrokenSequenceRelationship(line: string): boolean {
  if (!/[-=]+>>/.test(line)) return false;
  return !/^[A-Za-z][A-Za-z0-9_./-]*\s*[-=]+>>\s*[A-Za-z][A-Za-z0-9_./-]*(?:\s*:\s*.+)?$/.test(line);
}

function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.severity}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
