import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getUnifiedAgents,
  hasUnifiedAgentsOverride,
  setUnifiedAgentsOverride,
  loadRuntimeConfig,
  subscribeRuntimeFlags,
} from '../runtimeFlags';

beforeEach(() => {
  localStorage.clear();
  (fetch as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('runtimeFlags — unified agents', () => {
  it('defaults to disabled (env fallback) when no override and no server value', () => {
    expect(getUnifiedAgents()).toBe(false);
    expect(hasUnifiedAgentsOverride()).toBe(false);
  });

  it('a user override takes precedence over the server value', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unified_agents: true }),
    });
    await loadRuntimeConfig();
    expect(getUnifiedAgents()).toBe(true);

    setUnifiedAgentsOverride(false);
    expect(hasUnifiedAgentsOverride()).toBe(true);
    expect(getUnifiedAgents()).toBe(false);

    setUnifiedAgentsOverride(null); // revert to server default
    expect(hasUnifiedAgentsOverride()).toBe(false);
    expect(getUnifiedAgents()).toBe(true);
  });

  it('uses the server value when no override is set', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unified_agents: false }),
    });
    const notified = vi.fn();
    const unsub = subscribeRuntimeFlags(notified);
    await loadRuntimeConfig();
    expect(notified).toHaveBeenCalled();
    expect(getUnifiedAgents()).toBe(false);
    unsub();
  });

  it('notifies subscribers when the override changes', () => {
    const notified = vi.fn();
    const unsub = subscribeRuntimeFlags(notified);
    setUnifiedAgentsOverride(false);
    expect(notified).toHaveBeenCalledTimes(1);
    unsub();
    setUnifiedAgentsOverride(true);
    expect(notified).toHaveBeenCalledTimes(1); // unsubscribed
  });
});
