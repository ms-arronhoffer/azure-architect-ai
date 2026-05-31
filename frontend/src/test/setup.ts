import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Stub global fetch so tests can override per-case via (fetch as any).mockResolvedValue(...)
vi.stubGlobal('fetch', vi.fn());
