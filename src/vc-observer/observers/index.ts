import type { BrowserObservers, Callback, MutationRecordWithTimestamp } from './types';

type ObservedMutationMapValue = {
	mutation: MutationRecordWithTimestamp;
	ignored: boolean;
};

export type SelectorConfig = {
	id: boolean;
	testId: boolean;
	role: boolean;
	className: boolean;
	dataVC?: boolean;
};

type ConstructorOptions = {
	selectorConfig: SelectorConfig;
};

export class Observers implements BrowserObservers {
	private intersectionObserver: IntersectionObserver | null;

	private mutationObserver: MutationObserver | null;

	private observedMutations: Map<Element, ObservedMutationMapValue> = new Map();

	private elementsInView = new Set();

	private callbacks = new Set<Callback>();

	private totalTime = 0;

	private _startMeasureTimestamp = -1;

	private selectorConfig: SelectorConfig = {
		id: false,
		testId: false,
		role: false,
		className: true,
		dataVC: true,
	};

	constructor(opts: ConstructorOptions) {
		this.selectorConfig = {
			...this.selectorConfig,
			...opts.selectorConfig,
		};
		this.intersectionObserver = this.getIntersectionObserver();
		this.mutationObserver = this.getMutationObserver();
	}

	isBrowserSupported() {
		return (
			typeof window.IntersectionObserver === 'function' &&
			typeof window.MutationObserver === 'function'
		);
	}

	observe() {
		this.totalTime = 0;
		this.mutationObserver?.observe(document.body, {
			attributeFilter: ['hidden', 'style', 'src'],
			attributeOldValue: true,
			attributes: true,
			childList: true,
			subtree: true,
		});
	}

	disconnect() {
		this.mutationObserver?.disconnect();
		this.intersectionObserver?.disconnect();
		this.observedMutations = new Map();
		this.elementsInView = new Set();
		this.callbacks = new Set();
	}

	subscribeResults = (cb: Callback) => {
		this.callbacks.add(cb);
	};

	getTotalTime() {
		return this.totalTime;
	}

	private observeElement = (
		node: HTMLElement,
		mutation: MutationRecordWithTimestamp,
		_type: string,
		ignored: boolean,
	) => {
		this.intersectionObserver?.observe(node);
		this.observedMutations.set(node, { mutation, ignored });
	};

	private getMutationObserver() {
		return this.isBrowserSupported()
			? new MutationObserver((mutations) => {
					this.measureStart();

					mutations.forEach((mutation: MutationRecordWithTimestamp) => {
						// patching element if timestamp not automatically added
						// eslint-disable-next-line no-param-reassign
						mutation.timestamp =
							mutation.timestamp === undefined ? performance.now() : mutation.timestamp;

						let ignored = false;

						if (mutation.type === 'childList') {
							mutation.addedNodes.forEach((node) => {
								if (
									node instanceof HTMLElement
									/* && !node instanceof HTMLStyleElement && !node instanceof HTMLScriptElement && !node instanceof HTMLLinkElement */
								) {
									this.observeElement(node, mutation, 'html', ignored);
								}
								if (node instanceof Text && node.parentElement != null) {
									this.observeElement(node.parentElement, mutation, 'text', ignored);
								}
							});
							mutation.removedNodes.forEach((node) => {
								if (node instanceof Element) {
									this.elementsInView.delete(node);
									this.intersectionObserver?.unobserve(node);
								}
							});
						} else if (mutation.type === 'attributes') {
							mutation.addedNodes.forEach((node) => {
								if (node instanceof HTMLElement) {
									this.observeElement(node, mutation, 'attr', ignored);
								}
							});
						}
					});
					this.measureStop();
				})
			: null;
	}

	private getElementName(element: HTMLElement) {
		try {
			const tagName = element.localName;
			const dataVCAttr = element.getAttribute('data-vc');
			const dataVC = this.selectorConfig.dataVC && dataVCAttr ? `[data-vc="${dataVCAttr}"]` : '';
			const id = this.selectorConfig.id && element.id ? `#${element.id}` : '';
			let testId = this.selectorConfig.testId
				? element.getAttribute('data-testid') || element.getAttribute('data-test-id')
				: '';
			testId = testId ? `[testid=${testId}]` : '';
			let role = this.selectorConfig.role ? element.getAttribute('role') : '';
			role = role ? `[role=${role}]` : '';
			let classList = this.selectorConfig.className ? Array.from(element.classList).join('.') : '';
			classList = classList === '' ? '' : `.${classList}`;
			const attrs = dataVC ? dataVC : [id, testId, role].join('');

			let idString = '';

			if (attrs === '' && classList === '') {
				const parent = element.parentElement
					? this.getElementName(element.parentElement)
					: 'unknown';
				idString = `${parent} > ${tagName}`;
			} else {
				idString = [tagName, attrs || classList].join('');
			}

			return idString;
		} catch (e) {
			return 'error';
		}
	}

	private getIntersectionObserver() {
		return this.isBrowserSupported()
			? new IntersectionObserver((entries) => {
					this.measureStart();
					entries.forEach(({ isIntersecting, intersectionRect: ir, target }) => {
						const data = this.observedMutations.get(target);
						this.observedMutations.delete(target);

						if (isIntersecting && ir.width > 0 && ir.height > 0) {
							if (!(target instanceof HTMLElement)) {
								return;
							}

							if (!data?.mutation) {
								// ignore intersection report without recent mutation
								return;
							}
							this.callbacks.forEach((callback) => {
								let elementName;
								try {
									elementName = this.getElementName(target);
								} catch (e) {
									elementName = 'error';
								}
								callback(
									data.mutation.timestamp || performance.now(),
									ir,
									elementName,
									target,
									data.ignored,
								);
							});

							this.elementsInView.add(target);
						} else {
							this.elementsInView.delete(target);
						}
					});
					this.measureStop();
				})
			: null;
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
