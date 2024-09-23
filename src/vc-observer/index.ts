import { type UnbindFn } from 'bind-event-listener';

import type {
	VCEntryType,
	VCResult,
	ComponentsLogType,
	VCAbortReason,
	VCAbortReasonType,
	VCRatioType,
	VCRawDataType
} from '../types';

import { attachAbortListeners } from './utils/attachAbortListeners';
import { getViewportHeight, getViewportWidth } from './utils/getViewport';
import { Observers, type SelectorConfig } from './observers';

type PixelsToMap = { l: number; t: number; r: number; b: number };

type AbortReasonEnum = { [key: string]: VCAbortReason };

type GetVCResultType = {
	prefix?: string;
	vc?: VCRawDataType | null;
};

export type VCObserverOptions = {
	heatmapSize?: number | undefined;
	debug?: boolean | undefined;
	selectorConfig?: SelectorConfig | undefined;
};

const abortReason: AbortReasonEnum = {
	scroll: 'scroll',
	keypress: 'keypress',
	resize: 'resize',
	error: 'error',
};

const UNUSED_SECTOR = 0;

export class VCObserver {
	/* abort logic */
	abortReason: VCAbortReasonType = {
		reason: null,
		info: '',
		timestamp: -1,
		blocking: false,
	};

	/** config * */
	static VCParts = ['25', '50', '75', '80', '85', '90', '95', '98', '99'];

	viewport = {
		w: 0,
		h: 0,
	};

	/* heatmap */
	arraySize = 0;

	heatmap: number[][];

	componentsLog: ComponentsLogType = {};

	vcRatios: VCRatioType = {};

	active = false;

	totalTime = 0;

	startTime = 0;

	observers: Observers;

	private _startMeasureTimestamp = -1;

	debug: boolean;

	unbind: UnbindFn[] = [];

	constructor(options: VCObserverOptions) {
		this.arraySize = options.heatmapSize || 200;
		this.debug = options.debug || false;
		this.observers = new Observers({
			selectorConfig: options.selectorConfig || {
				id: false,
				testId: false,
				role: false,
				className: true,
				dataVC: true,
			},
		});
		this.heatmap = this.getCleanHeatmap();
	}

	start({ startTime }: { startTime: number }) {
		this.active = true;
		if (this.observers.isBrowserSupported()) {
			this.setViewportSize();
			this.resetState();
			this.startTime = startTime;
			this.attachAbortListeners();
			this.observers.subscribeResults(this.handleUpdate);
			this.observers.observe();
		} else {
			this.setAbortReason('not-supported', startTime);
		}
	}

	stop() {
		this.observers.disconnect();
		this.detachAbortListeners();
	}

	getAbortReasonInfo = () => {
		if (this.abortReason.reason === null) {
			return null;
		}

		const info = this.abortReason.info !== '' ? ` ${this.abortReason.info}` : '';
		return `${this.abortReason.reason}${info}`;
	};

	getVCRawData = (): VCRawDataType | null => {
		this.measureStart();

		if (!this.active) {
			this.measureStop();
			return null;
		}
		this.stop();

		const abortReasonInfo = this.getAbortReasonInfo();
		this.measureStop();

		return {
			abortReasonInfo,
			abortReason: { ...this.abortReason },
			heatmap: this.heatmap,
			totalTime: Math.round(this.totalTime + this.observers.getTotalTime()),
			componentsLog: { ...this.componentsLog },
			viewport: { ...this.viewport },
			debug: this.debug,
			ratios: this.vcRatios,
		};
	};

	getVCResult = ({ prefix, vc }: GetVCResultType): VCResult => {
		const startTime = performance.now();
		const fullPrefix = prefix !== undefined && prefix !== '' ? `${prefix}:` : '';

		const rawData = vc !== undefined ? vc : this.getVCRawData();
		if (rawData === null) {
			return {};
		}

		const {
			abortReason,
			abortReasonInfo,
			heatmap,
			totalTime,
			componentsLog,
			viewport,
			debug,
			ratios,
		} = rawData;

		if (abortReasonInfo !== null && abortReason.blocking) {

			try {
				if (debug) {
					window.__vcNotAvailableReason = abortReasonInfo;
				}
			} catch (e) {}

			return {
				[`${fullPrefix}vc:state`]: false,
				[`${fullPrefix}vc:abort:reason`]: abortReasonInfo,
				[`${fullPrefix}vc:abort:timestamp`]: abortReason.timestamp,
			};
		}

		const { VC, VCBox, VCEntries, totalPainted } = VCObserver.calculateVC({
			heatmap,
			componentsLog: { ...componentsLog },
			viewport,
		});

		try {
			VCObserver.VCParts.forEach((key) => {
				const duration = VC[key];
				if (duration !== null && duration !== undefined) {
					performance.measure(`VC${key}`, { start: this.startTime, duration });
				}
			});
		} catch (e) {
			/* empty */
		}

		const stopTime = performance.now();

		try {
			if (debug) {
				window.__vc = {
					entries: VCEntries.rel,
					log: componentsLog,
					metrics: {
						'75': VC['75'],
						'80': VC['80'],
						'85': VC['85'],
						'90': VC['90'],
						'95': VC['95'],
						'98': VC['98'],
						'99': VC['99'],
					},
					heatmap,
					ratios,
				};
			}
		} catch (e) {
			/*  do nothing */
		}

		const returnValue = {
			'metrics:vc': VC,
			[`${fullPrefix}vc:state`]: true,
			[`${fullPrefix}vc:clean`]: abortReasonInfo ? false : true,
			[`${fullPrefix}vc:dom`]: VCBox,
			[`${fullPrefix}vc:updates`]: VCEntries.rel.slice(0, 50), // max 50
			[`${fullPrefix}vc:size`]: viewport,
			[`${fullPrefix}vc:time`]: Math.round(totalTime + (stopTime - startTime)),
			[`${fullPrefix}vc:total`]: totalPainted,
			[`${fullPrefix}vc:ratios`]: ratios,
		};

		return returnValue;
	};

	static calculateVC({
		heatmap,
		componentsLog,
		viewport,
	}: {
		heatmap: number[][];
		componentsLog: ComponentsLogType;
		viewport: { w: number; h: number };
	}) {
		const lastUpdate: { [key: string]: number } = {};
		let totalPainted = 0;

		heatmap.forEach((line) => {
			line.forEach((entry) => {
				const rounded = Math.floor(entry);
				totalPainted += rounded !== UNUSED_SECTOR ? 1 : 0;
				if (rounded !== UNUSED_SECTOR) {
					lastUpdate[rounded] = lastUpdate[rounded] ? lastUpdate[rounded] + 1 : 1;
				}
			});
		});

		const entries: number[][] = Object.entries(lastUpdate)
			.map((a) => [parseInt(a[0], 10), a[1]])
			.sort((a, b) => (a[0] > b[0] ? 1 : -1));

		const VC: { [key: string]: number | null } = VCObserver.makeVCReturnObj<number>();
		const VCBox: { [key: string]: string[] | null } = VCObserver.makeVCReturnObj<string[]>();

		entries.reduce((acc = 0, v) => {
			const VCRatio = v[1] / totalPainted + acc;
			const time = v[0];
			VCObserver.VCParts.forEach((key) => {
				const value = parseInt(key, 10);
				if ((VC[key] === null || VC[key] === undefined) && VCRatio >= value / 100) {
					VC[key] = time;
					VCBox[key] = componentsLog[time]?.map((v) => v.targetName);
				}
			});
			return VCRatio;
		}, 0);

		const VCEntries = entries.reduce(
			(acc: { abs: number[][]; rel: VCEntryType[] }, [timestamp, entryPainted], i) => {
				const currentlyPainted = entryPainted + (acc.abs[i - 1]?.[1] || 0);
				const currentlyPaintedRatio = Math.round((currentlyPainted / totalPainted) * 1000) / 10;
				const logEntry = componentsLog[timestamp]?.map((v) => v.targetName);

				acc.abs.push([timestamp, currentlyPainted]);
				acc.rel.push({
					time: timestamp,
					vc: currentlyPaintedRatio,
					elements: logEntry,
				});
				return acc;
			},
			{ abs: [], rel: [] },
		);

		return { VC, VCBox, VCEntries, totalPainted };
	}

	private handleUpdate = (
		rawTime: number,
		intersectionRect: DOMRectReadOnly,
		targetName: string,
		element: HTMLElement,
		ignored: boolean,
	) => {
		this.measureStart();

		if (this.abortReason.reason === null || this.abortReason.blocking === false) {
			const time = Math.round(rawTime - this.startTime);
			const mappedValues = this.mapPixelsToHeatmap(
				intersectionRect.left,
				intersectionRect.top,
				intersectionRect.width,
				intersectionRect.height,
			);
			this.vcRatios[targetName] = this.getElementRatio(mappedValues);

			if (!ignored) {
				this.applyChangesToHeatMap(mappedValues, time, this.heatmap);
			}

			if (!this.componentsLog[time]) {
				this.componentsLog[time] = [];
			}

			this.componentsLog[time].push({
				__debug__element: this.debug ? element : null,
				intersectionRect,
				targetName,
				ignored,
			});
		}

		this.measureStop();
	};

	private setAbortReason(abort: VCAbortReason, timestamp: number, info = '') {
		if (this.abortReason.reason === null || this.abortReason.blocking === false) {
			this.abortReason.reason = abort;
			this.abortReason.info = info;
			this.abortReason.timestamp = timestamp;
			this.abortReason.blocking = abort !== abortReason.scroll;
			if (this.abortReason.blocking) {
				this.detachAbortListeners();
			}
		}
	}

	private resetState() {
		this.abortReason = {
			reason: null,
			info: '',
			timestamp: -1,
			blocking: false,
		};
		this.detachAbortListeners();
		this.heatmap = this.getCleanHeatmap();

		this.totalTime = 0;
		this.componentsLog = {};
		this.vcRatios = {};
	}

	private getCleanHeatmap() {
		return Array(this.arraySize)
			.fill('')
			.map(() => Array(this.arraySize).fill(UNUSED_SECTOR));
	}

	private setViewportSize() {
		this.viewport.w = getViewportWidth();
		this.viewport.h = getViewportHeight();
	}

	private mapPixelsToHeatmap = (
		left: number,
		top: number,
		width: number,
		height: number,
	): PixelsToMap => {
		const { w, h } = this.viewport;

		const l = Math.floor((left / w) * this.arraySize);
		const t = Math.floor((top / h) * this.arraySize);
		const r = Math.ceil(((left + width) / w) * this.arraySize);
		const b = Math.ceil(((top + height) / h) * this.arraySize);

		// correct values to min - 0, max - arraySize
		const result = {
			l: Math.max(0, l),
			t: Math.max(0, t),
			r: Math.min(this.arraySize, r),
			b: Math.min(this.arraySize, b),
		};

		return result;
	};

	private getElementRatio = (mappedValues: PixelsToMap): number => {
		const { r, l, b, t } = mappedValues;
		return ((r - l) * (b - t)) / (this.arraySize * this.arraySize);
	};

	private applyChangesToHeatMap(a: PixelsToMap, time: number, heatmap: number[][]) {
		const { l, t, r, b } = a;
		const localHeatmap = heatmap;
		for (let row = t; row < b; row++) {
			for (let col = l; col < r; col++) {
				if (localHeatmap[row] === undefined) {
					try {
						this.setAbortReason(abortReason.error, time);
					} catch (e) {
						this.setAbortReason(abortReason.error, time);
					}
					return;
				} else {
					localHeatmap[row][col] = time;
				}
			}
		}
	}

	static makeVCReturnObj<T>() {
		const vc: { [key: string]: null | T } = {};
		VCObserver.VCParts.forEach((v) => {
			vc[v] = null;
		});
		return vc;
	}

	private abortReasonCallback = (key: string, time: number) => {
		switch (key) {
			case 'wheel':
				this.setAbortReason(abortReason.scroll, time);
				break;
			case 'keydown':
				this.setAbortReason(abortReason.keypress, time);
				break;
			case 'resize':
				this.setAbortReason(abortReason.resize, time);
				break;
		}
	};

	private attachAbortListeners = () => {
		this.detachAbortListeners();
		let unbinds = attachAbortListeners(window, this.viewport, this.abortReasonCallback);
		this.unbind = unbinds;
	};

	private detachAbortListeners() {
		this.unbind.forEach((fn) => fn());
		this.unbind = [];
	}

	private measureStart() {
		this._startMeasureTimestamp = performance.now();
	}

	private measureStop() {
		if (this._startMeasureTimestamp === -1) {
			return;
		}
		this.totalTime += performance.now() - this._startMeasureTimestamp;
		this._startMeasureTimestamp = -1;
	}
}
