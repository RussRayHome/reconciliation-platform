import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

process.env.NODE_ENV = 'test';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

type MutablePerformanceShim = {
	clearMarks?: (name?: string) => void;
	clearMeasures?: (name?: string) => void;
	mark?: (
		markName: string,
		markOptions?: PerformanceMarkOptions,
	) => PerformanceMark;
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
	perf.mark = (markName: string) =>
		({
		name: markName,
		entryType: 'mark',
		startTime: 0,
		duration: 0,
		detail: null,
		toJSON: () => ({}),
		});
}

if (typeof perf?.measure !== 'function') {
	perf.measure = (measureName: string) =>
		({
		name: measureName,
		entryType: 'measure',
		startTime: 0,
		duration: 0,
		detail: null,
		toJSON: () => ({}),
		});
}
