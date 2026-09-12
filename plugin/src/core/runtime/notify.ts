export type NotifyCue = 'done' | 'fail';

/** User cancel is silent. A finished turn beeps done; a crash or drop beeps fail. */
export function turnNotify(input: { cancelled?: boolean; failed?: boolean }): NotifyCue | undefined {
  if (input.cancelled) {
    return undefined;
  }
  return input.failed ? 'fail' : 'done';
}
