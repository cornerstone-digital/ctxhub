export type RedactionResult = {
  content: string;
  redacted: boolean;
};

export function redactContent(content: string, patterns: string[]): RedactionResult {
  let redacted = false;
  let next = content;

  for (const pattern of patterns) {
    try {
      next = next.replace(new RegExp(pattern, 'gi'), () => {
        redacted = true;
        return '[REDACTED]';
      });
    } catch {
      // Invalid user-provided patterns are ignored here; doctor surfaces risky config separately.
    }
  }

  return { content: next, redacted };
}
