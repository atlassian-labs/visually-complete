import { bind, type UnbindFn } from 'bind-event-listener';

import { getViewportHeight, getViewportWidth } from './getViewport';

export const AbortEvent = {
	wheel: 'wheel',
	keydown: 'keydown',
	resize: 'resize',
} as const;

export const attachAbortListeners = (
	window: Window,
	initialViewPort: { w: number; h: number },
	callback: (key: keyof typeof AbortEvent, time: number) => void,
): UnbindFn[] => {
	const unbindWheel = bind(window, {
		type: AbortEvent.wheel,
		listener: (e: Event) => {
			callback(AbortEvent.wheel, e.timeStamp);
		},
		options: {
			passive: true,
			once: true,
		},
	});
	const unbindKeydown = bind(window, {
		type: AbortEvent.keydown,
		listener: (e: Event) => {
			callback(AbortEvent.keydown, e.timeStamp);
		},
		options: { once: true },
	});
	const unbindResize = bind(window, {
		type: AbortEvent.resize,
		listener: (e: Event) => {
			if (getViewportWidth() !== initialViewPort.w || getViewportHeight() !== initialViewPort.h) {
				callback(AbortEvent.resize, e.timeStamp);
				unbindResize();
			}
		},
	});

	return [unbindWheel, unbindKeydown, unbindResize];
};
