import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Daily Sync safeguards', () => {
  it('keeps the scheduled candidate batch below the stage deadline', () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/sync.yml', import.meta.url),
      'utf8'
    );
    const limit = Number(workflow.match(/GH_ENRICHMENT_LIMIT:\s*(\d+)/)?.[1]);
    const deadlineMs = Number(
      workflow.match(/GH_ENRICHMENT_STAGE_TIMEOUT_MS:\s*(\d+)/)?.[1]
    );

    expect(limit).toBe(150);
    expect(deadlineMs).toBe(900_000);
    // The Sep 14 production run needed roughly 1.7s per normalized repository
    // for its three GitHub reads. The batch is deliberately bounded at 150
    // claimed rows (f5b9ecd); budget 1.8s per row (worst case one row per
    // repository) and still retain over ten minutes for tail latency and
    // bounded retries inside the 15-minute stage.
    expect(deadlineMs - limit * 1_800).toBeGreaterThanOrEqual(360_000);
  });
  it('only invalidates cache from a non-empty changed-slug set and never falls back to a global purge', () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/sync.yml', import.meta.url),
      'utf8'
    );
    expect(workflow).toContain('if [ "$count" -eq 0 ]; then');
    expect(workflow).toContain('No changed server rows; cache remains warm.');
    expect(workflow).toContain('skipped cache invalidation and retained time-based refresh');
    expect(workflow).not.toContain("revalidate '{\"full\": true}'");
    expect(workflow).not.toContain("revalidateTag('servers')");
  });

});
