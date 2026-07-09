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
};

// Generalizes the manual arrow-key-highlight list pattern proven in SearchApp.tsx into
// a reusable component: the guided menu's command list, single-choice wizard fields,
// and (via markerFor rendering "[x] "/"[ ] ") multi-select wizard fields all share this.
export function SelectList({ items, selectedIndex, markerFor }: Props) {
  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        if (item.disabled) {
          return (
            <Text key={item.key} bold color="gray">
              {item.label}
            </Text>
          );
        }

        const active = i === selectedIndex;
        const marker = markerFor ? markerFor(item, i) : '';
        return (
          <Text key={item.key} color={active ? 'black' : undefined} backgroundColor={active ? 'cyan' : undefined}>
            {active ? '> ' : '  '}
            {marker}
            {item.label}
          </Text>
        );
      })}
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
