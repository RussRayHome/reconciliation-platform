import '@testing-library/jest-dom/vitest';

import { configure } from '@testing-library/react';
import { vi } from 'vitest';

process.env.NODE_ENV = 'test';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Testing Library defaults waitFor/findBy to 1000ms. That holds when `test:unit` runs alone, but
// `npm run coverage` runs the web, core, api, and Docker-backed persistence projects against the
// same machine, and under that contention the App workspace tests time out waiting on a render
// that does eventually complete. The failure is scheduling latency, not a product bug, so give
// the async utilities real headroom rather than let load decide whether the suite is green.
configure({ asyncUtilTimeout: 15000 });

class ResizeObserverStub {
  observe(): void {
    // no-op for tests
  }

  unobserve(): void {
    // no-op for tests
  }

  disconnect(): void {
    // no-op for tests
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverStub,
  writable: true,
});

Object.defineProperty(globalThis, 'matchMedia', {
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
  writable: true,
});

// jsdom does not expose localStorage under this configuration, so anything touching it has to
// bring its own. Setup files run per test file, so each file gets a fresh, isolated store.
// Declared `configurable` so a test file that wants its own instrumented stub can still override.
const localStorageEntries = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string): string | null => localStorageEntries.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      localStorageEntries.set(key, String(value));
    },
    removeItem: (key: string): void => {
      localStorageEntries.delete(key);
    },
    clear: (): void => {
      localStorageEntries.clear();
    },
    key: (index: number): string | null => [...localStorageEntries.keys()][index] ?? null,
    get length(): number {
      return localStorageEntries.size;
    },
  },
});

type MutablePerformanceShim = {
  clearMarks?: (name?: string) => void;
  clearMeasures?: (name?: string) => void;
  mark?: (markName: string, markOptions?: PerformanceMarkOptions) => PerformanceMark;
  measure?: (
    measureName: string,
    startOrMeasureOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ) => PerformanceMeasure;
};

const perf = globalThis.performance as unknown as MutablePerformanceShim;

if (typeof perf?.clearMarks !== 'function') {
  perf.clearMarks = () => {
    // no-op for test runtime compatibility
  };
}

if (typeof perf?.clearMeasures !== 'function') {
  perf.clearMeasures = () => {
    // no-op for test runtime compatibility
  };
}

if (typeof perf?.mark !== 'function') {
  perf.mark = (markName: string) => ({
    name: markName,
    entryType: 'mark',
    startTime: 0,
    duration: 0,
    detail: null,
    toJSON: () => ({}),
  });
}

if (typeof perf?.measure !== 'function') {
  perf.measure = (measureName: string) => ({
    name: measureName,
    entryType: 'measure',
    startTime: 0,
    duration: 0,
    detail: null,
    toJSON: () => ({}),
  });
}
