import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { SelectList, firstSelectableIndex, nextSelectableIndex, toggleSelection, type SelectListItem } from './SelectList.js';

test('SelectList highlights the selected row and renders disabled rows without a highlight marker', () => {
  const items: SelectListItem[] = [
    { key: 'group', label: 'Group Header', disabled: true },
    { key: 'a', label: 'Item A' },
    { key: 'b', label: 'Item B' }
  ];

  const { lastFrame } = render(React.createElement(SelectList, { items, selectedIndex: 1 }));
  const frame = lastFrame() ?? '';
  assert.match(frame, /Group Header/);
  assert.match(frame, /> Item A/);
  assert.match(frame, / {2}Item B/);
});

test('SelectList renders a marker per item when markerFor is provided', () => {
  const items: SelectListItem[] = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];
  const { lastFrame } = render(
    React.createElement(SelectList, {
      items,
      selectedIndex: 0,
      markerFor: (_item: SelectListItem, index: number) => (index === 1 ? '[x] ' : '[ ] ')
    })
  );
  const frame = lastFrame() ?? '';
  assert.match(frame, /\[ \] A/);
  assert.match(frame, /\[x\] B/);
});

test('nextSelectableIndex skips disabled rows and wraps around', () => {
  const items: SelectListItem[] = [
    { key: 'group', label: 'Header', disabled: true },
    { key: 'a', label: 'A' },
    { key: 'b', label: 'B' }
  ];

  assert.equal(nextSelectableIndex(items, 1, 1), 2);
  assert.equal(nextSelectableIndex(items, 2, 1), 1, 'wraps past the disabled header back to the first selectable row');
  assert.equal(nextSelectableIndex(items, 1, -1), 2, 'wraps backward past the disabled header too');
});

test('nextSelectableIndex returns the current index unchanged when every item is disabled', () => {
  const items: SelectListItem[] = [{ key: 'a', label: 'A', disabled: true }];
  assert.equal(nextSelectableIndex(items, 0, 1), 0);
});

test('firstSelectableIndex finds the first non-disabled row, or 0 if none exist', () => {
  const items: SelectListItem[] = [
    { key: 'group', label: 'Header', disabled: true },
    { key: 'a', label: 'A' }
  ];
  assert.equal(firstSelectableIndex(items), 1);
  assert.equal(firstSelectableIndex([{ key: 'a', label: 'A', disabled: true }]), 0);
});

test('toggleSelection adds and removes indices without mutating the input set', () => {
  const original = new Set([1]);
  const added = toggleSelection(original, 2);
  assert.deepEqual([...added].sort(), [1, 2]);
  assert.deepEqual([...original], [1], 'must not mutate the original set');

  const removed = toggleSelection(added, 1);
  assert.deepEqual([...removed].sort(), [2]);
});
