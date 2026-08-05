import { describe, it, expect } from 'vitest';
import {
  type ModelEntry,
  compareModels,
  filterAndSortModels,
  isPastDue,
  isRetiringSoon,
} from '../modelLifecycle';

const NOW = new Date('2026-01-01T00:00:00Z').getTime();

function model(overrides: Partial<ModelEntry>): ModelEntry {
  return {
    provider: 'OpenAI',
    model: 'gpt-x',
    version: '1',
    lifecycle: 'GA',
    retirement: null,
    replacement: null,
    soldBy: 'Azure',
    ...overrides,
  };
}

const pastDue = model({ model: 'past-due', retirement: '2025-06-01' });
const retiredFlag = model({ model: 'retired-flag', lifecycle: 'Retired', retirement: '2026-06-01' });
const soon = model({ model: 'soon', retirement: '2026-02-01' });
const soonest = model({ model: 'soonest', retirement: '2026-01-15' });
const later = model({ model: 'later', retirement: '2027-01-01' });
const noDate = model({ model: 'no-date' });
const preview = model({ model: 'preview', lifecycle: 'Preview', retirement: '2026-03-01' });
const previewPastDue = model({ model: 'preview-past', lifecycle: 'Preview', retirement: '2025-01-01' });

describe('isPastDue', () => {
  it('flags models whose retirement date has passed', () => {
    expect(isPastDue(pastDue, NOW)).toBe(true);
    expect(isPastDue(soon, NOW)).toBe(false);
  });

  it('flags models marked Retired even with a future date', () => {
    expect(isPastDue(retiredFlag, NOW)).toBe(true);
  });

  it('does not flag models without a retirement date', () => {
    expect(isPastDue(noDate, NOW)).toBe(false);
  });
});

describe('isRetiringSoon', () => {
  it('includes models retiring within 90 days', () => {
    expect(isRetiringSoon(soon, NOW)).toBe(true);
  });

  it('excludes past due models', () => {
    expect(isRetiringSoon(pastDue, NOW)).toBe(false);
    expect(isRetiringSoon(retiredFlag, NOW)).toBe(false);
  });

  it('excludes models retiring beyond 90 days or with no date', () => {
    expect(isRetiringSoon(later, NOW)).toBe(false);
    expect(isRetiringSoon(noDate, NOW)).toBe(false);
  });
});

describe('compareModels', () => {
  it('sorts live models ahead of past due models', () => {
    const sorted = [pastDue, later, soonest].sort((a, b) => compareModels(a, b, NOW));
    expect(sorted.map((m) => m.model)).toEqual(['soonest', 'later', 'past-due']);
  });

  it('places models without a retirement date after dated live models', () => {
    const sorted = [noDate, pastDue, soon].sort((a, b) => compareModels(a, b, NOW));
    expect(sorted.map((m) => m.model)).toEqual(['soon', 'no-date', 'past-due']);
  });

  it('orders past due models most recently retired first', () => {
    const older = model({ model: 'older', retirement: '2024-01-01' });
    const sorted = [older, pastDue].sort((a, b) => compareModels(a, b, NOW));
    expect(sorted.map((m) => m.model)).toEqual(['past-due', 'older']);
  });
});

describe('filterAndSortModels', () => {
  const all = [pastDue, retiredFlag, soon, soonest, later, noDate, preview, previewPastDue];

  it('keeps past due models out of the retiring-soon filter', () => {
    const rows = filterAndSortModels(all, { filter: 'soon', now: NOW });
    expect(rows.map((m) => m.model)).toEqual(['soonest', 'soon', 'preview']);
  });

  it('lists GA models that are not past due', () => {
    const rows = filterAndSortModels(all, { filter: 'ga', now: NOW });
    expect(rows.map((m) => m.model)).toEqual(['soonest', 'soon', 'later', 'no-date']);
  });

  it('lists Preview models that are not past due', () => {
    const rows = filterAndSortModels(all, { filter: 'preview', now: NOW });
    expect(rows.map((m) => m.model)).toEqual(['preview']);
  });

  it('collects past due and retired models under the retired filter', () => {
    const rows = filterAndSortModels(all, { filter: 'retired', now: NOW });
    expect(rows.map((m) => m.model).sort()).toEqual(['past-due', 'preview-past', 'retired-flag']);
  });

  it('never leads the all view with a past due model', () => {
    const rows = filterAndSortModels(all, { filter: 'all', now: NOW });
    expect(rows[0].model).toBe('soonest');
    expect(rows.slice(-3).every((m) => isPastDue(m, NOW))).toBe(true);
  });

  it('applies search and provider filters', () => {
    const anthropic = model({ provider: 'Anthropic', model: 'claude', retirement: '2026-02-10' });
    const rows = filterAndSortModels([...all, anthropic], {
      filter: 'all',
      search: 'claude',
      provider: 'Anthropic',
      now: NOW,
    });
    expect(rows.map((m) => m.model)).toEqual(['claude']);
  });
});
