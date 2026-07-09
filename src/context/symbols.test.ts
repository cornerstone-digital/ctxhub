import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSymbols, findEnclosingSymbol, isSourceFile, topLevelSymbols } from './symbols.js';

test('isSourceFile recognizes common JS/TS extensions and rejects docs', () => {
  assert.ok(isSourceFile('src/index.ts'));
  assert.ok(isSourceFile('src/App.tsx'));
  assert.ok(isSourceFile('src/legacy.cjs'));
  assert.ok(!isSourceFile('README.md'));
  assert.ok(!isSourceFile('docs/architecture/runtime.mmd'));
});

test('findEnclosingSymbol returns a named function declaration containing the target line', () => {
  const content = [
    /* 1 */ 'import path from "node:path";',
    /* 2 */ '',
    /* 3 */ 'export function loadThing(id: string) {',
    /* 4 */ '  const value = id.trim();',
    /* 5 */ '  return value;',
    /* 6 */ '}'
  ].join('\n');

  const symbol = findEnclosingSymbol(content, 4);
  assert.equal(symbol?.name, 'loadThing');
  assert.equal(symbol?.kind, 'function');
  assert.equal(symbol?.startLine, 3);
  assert.equal(symbol?.endLine, 6);
});

test('findEnclosingSymbol returns the innermost function when functions are nested', () => {
  const content = [
    /* 1 */ 'export function outer() {',
    /* 2 */ '  function inner() {',
    /* 3 */ '    return 1;',
    /* 4 */ '  }',
    /* 5 */ '  return inner();',
    /* 6 */ '}'
  ].join('\n');

  const atInner = findEnclosingSymbol(content, 3);
  assert.equal(atInner?.name, 'inner');

  const atOuterOnly = findEnclosingSymbol(content, 5);
  assert.equal(atOuterOnly?.name, 'outer');
});

test('findEnclosingSymbol recognizes arrow functions assigned to const', () => {
  const content = [
    /* 1 */ 'export const add = (a: number, b: number) => {',
    /* 2 */ '  return a + b;',
    /* 3 */ '};'
  ].join('\n');

  const symbol = findEnclosingSymbol(content, 2);
  assert.equal(symbol?.name, 'add');
  assert.equal(symbol?.kind, 'arrow');
});

test('findEnclosingSymbol recognizes class methods and the enclosing class', () => {
  const content = [
    /* 1 */ 'export class Widget {',
    /* 2 */ '  private count = 0;',
    /* 3 */ '',
    /* 4 */ '  increment(step: number): number {',
    /* 5 */ '    this.count += step;',
    /* 6 */ '    return this.count;',
    /* 7 */ '  }',
    /* 8 */ '}'
  ].join('\n');

  const atMethod = findEnclosingSymbol(content, 5);
  assert.equal(atMethod?.name, 'increment');
  assert.equal(atMethod?.kind, 'method');
  assert.equal(atMethod?.startLine, 4);
  assert.equal(atMethod?.endLine, 7);

  const atClassOnly = findEnclosingSymbol(content, 2);
  assert.equal(atClassOnly?.name, 'Widget');
  assert.equal(atClassOnly?.kind, 'class');
});

test('findEnclosingSymbol handles multi-line function signatures', () => {
  const content = [
    /* 1 */ 'export function longSignature(',
    /* 2 */ '  first: string,',
    /* 3 */ '  second: number',
    /* 4 */ ') {',
    /* 5 */ '  return first.repeat(second);',
    /* 6 */ '}'
  ].join('\n');

  const symbol = findEnclosingSymbol(content, 5);
  assert.equal(symbol?.name, 'longSignature');
  assert.equal(symbol?.startLine, 1);
  assert.equal(symbol?.endLine, 6);
});

test('findEnclosingSymbol ignores braces inside strings, templates, and comments', () => {
  const content = [
    /* 1 */ 'export function withNoise() {',
    /* 2 */ '  const s = "not a { real brace }";',
    /* 3 */ '  // a comment with a } brace',
    /* 4 */ '  const t = `template ${1 + 1} still fine`;',
    /* 5 */ '  return s + t;',
    /* 6 */ '}'
  ].join('\n');

  const symbol = findEnclosingSymbol(content, 5);
  assert.equal(symbol?.name, 'withNoise');
  assert.equal(symbol?.endLine, 6);
});

test('findEnclosingSymbol does not mistake if/for/catch blocks for methods', () => {
  const content = [
    /* 1 */ 'export function guarded(x: number) {',
    /* 2 */ '  if (x > 0) {',
    /* 3 */ '    return x;',
    /* 4 */ '  }',
    /* 5 */ '  return 0;',
    /* 6 */ '}'
  ].join('\n');

  const symbol = findEnclosingSymbol(content, 3);
  assert.equal(symbol?.name, 'guarded');
});

test('findEnclosingSymbol returns undefined for plain data/config content', () => {
  assert.equal(findEnclosingSymbol('{\n  "a": 1\n}', 2), undefined);
  assert.equal(findEnclosingSymbol('# heading\n\nplain text', 3), undefined);
});

test('topLevelSymbols excludes symbols nested inside another recognized symbol', () => {
  const content = [
    /* 1 */ 'export function outer() {',
    /* 2 */ '  function inner() {',
    /* 3 */ '    return 1;',
    /* 4 */ '  }',
    /* 5 */ '  return inner();',
    /* 6 */ '}',
    /* 7 */ '',
    /* 8 */ 'export function sibling() {',
    /* 9 */ '  return 2;',
    /* 10 */ '}'
  ].join('\n');

  const top = topLevelSymbols(content);
  assert.deepEqual(top.map(s => s.name).sort(), ['outer', 'sibling']);
});

test('extractSymbols sorts by ascending range size (innermost first)', () => {
  const content = [
    'export function outer() {',
    '  function inner() {',
    '    return 1;',
    '  }',
    '  return inner();',
    '}'
  ].join('\n');

  const symbols = extractSymbols(content);
  assert.equal(symbols[0].name, 'inner');
  assert.equal(symbols[1].name, 'outer');
});
