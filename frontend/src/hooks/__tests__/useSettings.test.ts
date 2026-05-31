import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSettings } from '../useSettings';

beforeEach(() => {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('useSettings', () => {
  it('exposes githubTokenConfigured === true after fetch returns {configured: true}', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/api/auth/github-token')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ configured: true }),
        });
      }
      // /api/settings
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ mode_models: {} }),
      });
    });

    const { result } = renderHook(() => useSettings());
    await waitFor(() => {
      expect(result.current.githubTokenConfigured).toBe(true);
    });
  });
});
