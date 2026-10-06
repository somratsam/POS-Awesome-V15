import { afterEach, describe, expect, it, vi } from "vitest";

import {
	dispatchStockLookupScan,
	isStockLookupScanActive,
	registerStockLookupScanHandler,
	resetStockLookupScanRoute,
} from "../src/posapp/composables/pos/items/stockLookupScanRoute";

describe("stockLookupScanRoute", () => {
	afterEach(() => {
		resetStockLookupScanRoute();
		vi.restoreAllMocks();
	});

	it("claims nothing when no Check Stock dialog has registered", () => {
		expect(isStockLookupScanActive()).toBe(false);
		expect(dispatchStockLookupScan("4524019703")).toBe(false);
	});

	it("claims scans only between register and unregister", () => {
		const handler = vi.fn();
		const unregister = registerStockLookupScanHandler(handler, vi.fn());

		expect(dispatchStockLookupScan("CODE-1")).toBe(true);
		expect(handler).toHaveBeenCalledWith("CODE-1");

		unregister();
		expect(isStockLookupScanActive()).toBe(false);
		expect(dispatchStockLookupScan("CODE-2")).toBe(false);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("a stale unregister does not remove a newer registration", () => {
		const first = registerStockLookupScanHandler(vi.fn(), vi.fn());
		const secondHandler = vi.fn();
		registerStockLookupScanHandler(secondHandler, vi.fn());

		first();
		expect(dispatchStockLookupScan("CODE")).toBe(true);
		expect(secondHandler).toHaveBeenCalledWith("CODE");
	});

	it("drops the route and reports when the handler throws synchronously", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const onFailure = vi.fn();
		registerStockLookupScanHandler(() => {
			throw new Error("boom");
		}, onFailure);

		expect(dispatchStockLookupScan("CODE")).toBe(true);
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(isStockLookupScanActive()).toBe(false);
		expect(dispatchStockLookupScan("NEXT")).toBe(false);
	});

	it("drops the route and reports when the handler rejects", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const onFailure = vi.fn();
		registerStockLookupScanHandler(async () => {
			throw new Error("async boom");
		}, onFailure);

		expect(dispatchStockLookupScan("CODE")).toBe(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(dispatchStockLookupScan("NEXT")).toBe(false);
	});

	it("still drops the route when the failure handler itself throws", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		registerStockLookupScanHandler(
			() => {
				throw new Error("boom");
			},
			() => {
				throw new Error("notify boom");
			},
		);

		expect(() => dispatchStockLookupScan("CODE")).not.toThrow();
		expect(isStockLookupScanActive()).toBe(false);
	});

	it("starts with no route after a fresh module load (page reload)", async () => {
		registerStockLookupScanHandler(vi.fn(), vi.fn());
		vi.resetModules();
		const fresh = await import(
			"../src/posapp/composables/pos/items/stockLookupScanRoute"
		);
		expect(fresh.isStockLookupScanActive()).toBe(false);
		expect(fresh.dispatchStockLookupScan("CODE")).toBe(false);
	});
});
