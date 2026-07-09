export type SymbolKind = 'function' | 'method' | 'class' | 'arrow';

export type SymbolRange = {
  name?: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
};

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

export function isSourceFile(filePath: string): boolean {
  return SOURCE_FILE_PATTERN.test(filePath);
}

// Returns every function/method/class/arrow-function block ctxhub can recognize, sorted
// by range size ascending (innermost first) -- so consumers picking the first match that
// contains a target line naturally get the most specific enclosing symbol.
export function extractSymbols(content: string): SymbolRange[] {
  const lines = content.split('\n');
  const symbols: SymbolRange[] = [];

  for (const { openLine, closeLine } of matchBraces(content)) {
    const declaration = detectDeclaration(lines, openLine);
    if (!declaration) continue;
    symbols.push({ ...declaration, endLine: closeLine });
  }

  return symbols.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
}

// Only symbols not nested inside another recognized symbol -- used for source-code
// chunking, where we want one chunk per top-level function/class rather than a chunk
// per nested closure too.
export function topLevelSymbols(content: string): SymbolRange[] {
  const all = extractSymbols(content).sort((a, b) => a.startLine - b.startLine);
  const topLevel: SymbolRange[] = [];

  for (const symbol of all) {
    const isNested = topLevel.some(existing => existing.startLine <= symbol.startLine && symbol.endLine <= existing.endLine);
    if (!isNested) topLevel.push(symbol);
  }

  return topLevel;
}

export function findEnclosingSymbol(content: string, line: number): SymbolRange | undefined {
  return extractSymbols(content).find(symbol => symbol.startLine <= line && line <= symbol.endLine);
}

type BracePair = { openLine: number; closeLine: number };

// A best-effort brace matcher: tracks string/template/comment state so braces inside
// them don't perturb depth, but does not fully parse the language (no handling of
// regex literals or `${}` interpolation inside template strings). Good enough for
// typically-formatted TS/JS; callers should treat a missing match as "give up", not
// as a hard parse error.
function matchBraces(content: string): BracePair[] {
  const pairs: BracePair[] = [];
  const stack: number[] = [];
  let line = 1;
  let state: 'normal' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'template' = 'normal';

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '\n') {
      line++;
      if (state === 'line-comment') state = 'normal';
      continue;
    }

    if (state === 'line-comment') continue;

    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        state = 'normal';
        i++;
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      if (ch === '\\') {
        i++;
        continue;
      }
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) {
        state = 'normal';
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      state = 'line-comment';
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block-comment';
      i++;
      continue;
    }
    if (ch === "'") {
      state = 'single';
      continue;
    }
    if (ch === '"') {
      state = 'double';
      continue;
    }
    if (ch === '`') {
      state = 'template';
      continue;
    }
    if (ch === '{') {
      stack.push(line);
      continue;
    }
    if (ch === '}') {
      const openLine = stack.pop();
      if (openLine !== undefined) pairs.push({ openLine, closeLine: line });
    }
  }

  return pairs;
}

const FUNCTION_PATTERN = /\bfunction\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)?\s*\(/;
const CLASS_PATTERN = /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
const ARROW_PATTERN = /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(?[^(){}]*\)?\s*(?::[^=]+)?=>/;
const METHOD_PATTERN = /^\s*(?:(?:public|private|protected|static|async|readonly)\s+)*(?:get\s+|set\s+)?\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^()]*\)\s*(?::\s*[^{};]+)?\s*$/;
const NON_METHOD_KEYWORDS = /^(if|for|while|switch|catch|else|do|try|finally)$/;
const MAX_LOOKBACK_LINES = 6;

function detectDeclaration(lines: string[], openLine: number): { name?: string; kind: SymbolKind; startLine: number } | undefined {
  const openLineText = lines[openLine - 1] ?? '';
  let startIdx = openLine - 1;
  let joined = openLineText;

  for (let back = 1; back <= MAX_LOOKBACK_LINES; back++) {
    const idx = openLine - 1 - back;
    if (idx < 0) break;
    const prevLine = lines[idx];
    const trimmed = prevLine.trim();
    if (!trimmed || /[;{}]$/.test(trimmed)) break;
    joined = `${prevLine}\n${joined}`;
    startIdx = idx;
  }

  const functionMatch = joined.match(FUNCTION_PATTERN);
  if (functionMatch) return { name: functionMatch[1], kind: 'function', startLine: startIdx + 1 };

  const classMatch = joined.match(CLASS_PATTERN);
  if (classMatch) return { name: classMatch[1], kind: 'class', startLine: startIdx + 1 };

  const arrowMatch = joined.match(ARROW_PATTERN);
  if (arrowMatch) return { name: arrowMatch[1], kind: 'arrow', startLine: startIdx + 1 };

  const withoutBrace = openLineText.replace(/\{\s*$/, '');
  const methodMatch = withoutBrace.match(METHOD_PATTERN);
  if (methodMatch && !NON_METHOD_KEYWORDS.test(methodMatch[1])) {
    return { name: methodMatch[1], kind: 'method', startLine: openLine };
  }

  return undefined;
}
