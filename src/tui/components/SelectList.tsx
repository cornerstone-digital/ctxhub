import React from 'react';
import { Box, Text } from 'ink';

export type SelectListItem = {
  key: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  items: SelectListItem[];
  selectedIndex: number;
  markerFor?: (item: SelectListItem, index: number) => string;
  maxVisible?: number;
};

// Generalizes the manual arrow-key-highlight list pattern proven in SearchApp.tsx into
// a reusable component: the guided menu's command list, single-choice wizard fields,
// and (via markerFor rendering "[x] "/"[ ] ") multi-select wizard fields all share this.
export function SelectList({ items, selectedIndex, markerFor, maxVisible }: Props) {
  const shouldClip = maxVisible !== undefined && items.length > maxVisible;

  let startIndex = 0;
  if (shouldClip && maxVisible !== undefined) {
    // Keep selectedIndex in view, centering it when possible.
    startIndex = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
    startIndex = Math.min(startIndex, items.length - maxVisible);
  }

  const visibleItems = shouldClip && maxVisible !== undefined
    ? items.slice(startIndex, startIndex + maxVisible)
    : items;

  const itemsAbove = startIndex;
  const itemsBelow = shouldClip && maxVisible !== undefined
    ? items.length - startIndex - visibleItems.length
    : 0;

  return (
    <Box flexDirection="column">
      {itemsAbove > 0 ? (
        <Text dimColor>  ↑ {itemsAbove} more</Text>
      ) : null}
      {visibleItems.map((item, i) => {
        const absoluteIndex = startIndex + i;
        if (item.disabled) {
          return (
            <Text key={item.key} bold color="gray">
              {item.label}
            </Text>
          );
        }

        const active = absoluteIndex === selectedIndex;
        const marker = markerFor ? markerFor(item, absoluteIndex) : '';
        return (
          <Text key={item.key} color={active ? 'black' : undefined} backgroundColor={active ? 'cyan' : undefined}>
            {active ? '> ' : '  '}
            {marker}
            {item.label}
          </Text>
        );
      })}
      {itemsBelow > 0 ? (
        <Text dimColor>  ↓ {itemsBelow} more</Text>
      ) : null}
    </Box>
  );
}

// Moves the selection by `direction`, skipping disabled (e.g. category header) rows,
// wrapping around the ends. Returns `current` unchanged if every item is disabled.
export function nextSelectableIndex(items: SelectListItem[], current: number, direction: 1 | -1): number {
  if (!items.length) return current;

  let index = current;
  for (let step = 0; step < items.length; step++) {
    index = (index + direction + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }

  return current;
}

export function firstSelectableIndex(items: SelectListItem[]): number {
  const index = items.findIndex(item => !item.disabled);
  return index === -1 ? 0 : index;
}

export function toggleSelection(selected: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(selected);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  return next;
}
