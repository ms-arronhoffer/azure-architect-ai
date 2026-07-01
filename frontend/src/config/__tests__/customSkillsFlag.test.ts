import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCustomSkills,
  hasCustomSkillsOverride,
  setCustomSkillsOverride,
  loadRuntimeConfig,
  subscribeRuntimeFlags,
} from '../runtimeFlags';

beforeEach(() => {
  localStorage.clear();
  (fetch as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('runtimeFlags — custom skills', () => {
  it('defaults to enabled (env fallback) when no override and no server value', () => {
    expect(getCustomSkills()).toBe(true);
    expect(hasCustomSkillsOverride()).toBe(false);
  });

  it('a user override takes precedence over the server value', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ custom_skills: true }),
    });
    await loadRuntimeConfig();
    expect(getCustomSkills()).toBe(true);

    setCustomSkillsOverride(false);
    expect(hasCustomSkillsOverride()).toBe(true);
    expect(getCustomSkills()).toBe(false);

    setCustomSkillsOverride(null); // revert to server default
    expect(hasCustomSkillsOverride()).toBe(false);
    expect(getCustomSkills()).toBe(true);
  });

  it('uses the server value when no override is set', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ custom_skills: false }),
    });
    const notified = vi.fn();
    const unsub = subscribeRuntimeFlags(notified);
    await loadRuntimeConfig();
    expect(notified).toHaveBeenCalled();
    expect(getCustomSkills()).toBe(false);
    unsub();
  });

  it('notifies subscribers when the override changes', () => {
    const notified = vi.fn();
    const unsub = subscribeRuntimeFlags(notified);
    setCustomSkillsOverride(false);
    expect(notified).toHaveBeenCalledTimes(1);
    unsub();
    setCustomSkillsOverride(true);
    expect(notified).toHaveBeenCalledTimes(1); // unsubscribed
  });
});
