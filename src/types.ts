import type { UnbindFn } from 'bind-event-listener';

export type VCEntryType = {
	time: number;
	vc: number;
	elements: string[];
};

export type ComponentsLogEntry = {
	targetName: string;
	__debug__element: Element | null;
	intersectionRect: DOMRectReadOnly;
	ignored: boolean;
};

export type MetricsDebugTypes = {
	'75': number | null;
	'80': number | null;
	'85': number | null;
	'90': number | null;
	'95': number | null;
	'98': number | null;
	'99': number | null;
};

export type VCResult = {
	[key: string]:
		| boolean
		| number
		| string
		| null
		| VCEntryType[]
		| { w: number; h: number }
		| {
				[key: string]: boolean | number | string[] | null | VCEntryType[];
		  };
};

export type VCAbortReason = 'scroll' | 'keypress' | 'resize' | 'error' | 'not-supported';

export type VCAbortReasonType = {
	reason: null | VCAbortReason;
	info: string;
	timestamp: number;
	blocking: boolean;
};

export type VCRatioType = {
	[elementName: string]: number;
};

export type VCRawDataType = {
	abortReasonInfo: string | null;
	abortReason: VCAbortReasonType;
	heatmap: number[][];
	totalTime: number;
	componentsLog: ComponentsLogType;
	viewport: { w: number; h: number };
	debug: boolean;
	ratios: VCRatioType;
};

export type ComponentsLogType = { [timestamp: number]: ComponentsLogEntry[] };

declare global {
	interface Window {
		__vc?: {
			entries: VCEntryType[];
			log: ComponentsLogType;
			metrics: MetricsDebugTypes;
			heatmap: number[][];
			ratios: VCRatioType;
		};
		__vcNotAvailableReason?: string;
	}
}
