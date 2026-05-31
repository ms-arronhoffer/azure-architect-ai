import { describe, it, expect } from 'vitest';
import { lookupService } from '../serviceMetadata';

describe('lookupService', () => {
  it('returns metadata for a known service', () => {
    const meta = lookupService('Azure Key Vault');
    expect(meta).toBeTruthy();
    expect(meta?.category).toBe('Security');
    expect(meta?.docsUrl).toContain('key-vault');
  });

  it('matches case-insensitively', () => {
    const meta = lookupService('AKS');
    expect(meta).toBeTruthy();
    expect(meta?.category).toBe('Containers');
  });

  it('returns null for an unknown service', () => {
    const meta = lookupService('zzz-totally-not-a-service-zzz');
    // lookupService returns null for unknown; treat as falsy.
    expect(meta).toBeFalsy();
  });
});
