import { describe, expect, it } from "vitest";

import { useItemSearch } from "../src/posapp/composables/pos/items/useItemSearch";
import { MIN_SEARCH_TERM_LENGTH } from "../src/posapp/utils/searchConstants";

describe("useItemSearch display filtering", () => {
	it("does not re-run text search when the source is already search-scoped", () => {
		const { filterAndPaginate } = useItemSearch();
		const alreadyScopedResults = [
			{
				item_code: "ITEM-001",
				item_name: "Server Matched Item",
				rate: 10,
			},
			{
				item_code: "ITEM-002",
				item_name: "Another Indexed Hit",
				rate: 12,
			},
		];

		const result = filterAndPaginate(alreadyScopedResults, {
			searchTerm: "alpha",
			searchAlreadyApplied: true,
			limit: 50,
		});

		expect(result.map((item) => item.item_code)).toEqual([
			"ITEM-001",
			"ITEM-002",
		]);
	});

	it("still applies display-only filters after search has already been applied", () => {
		const { filterAndPaginate } = useItemSearch();
		const alreadyScopedResults = [
			{
				item_code: "ITEM-001",
				item_name: "Server Matched Item",
				rate: 0,
			},
			{
				item_code: "ITEM-002",
				item_name: "Another Indexed Hit",
				rate: 12,
				variant_of: "ITEM-TEMPLATE",
			},
			{
				item_code: "ITEM-003",
				item_name: "Barcode Hit",
				rate: 15,
				item_barcode: [{ barcode: "ABC-003" }],
			},
		];

		const result = filterAndPaginate(alreadyScopedResults, {
			searchTerm: "alpha",
			searchAlreadyApplied: true,
			hideZeroRate: true,
			hideVariants: true,
			onlyBarcode: true,
			limit: 50,
		});

		expect(result.map((item) => item.item_code)).toEqual(["ITEM-003"]);
	});

	it("shows nothing for a non-empty search term below the shared minimum length, even with no other filters active", () => {
		const { filterAndPaginate } = useItemSearch();
		const items = [
			{ item_code: "ITEM-001", item_name: "Cotton Shirt", rate: 10 },
			{ item_code: "ITEM-002", item_name: "Another Item", rate: 12 },
		];

		const shortTerm = "a".repeat(MIN_SEARCH_TERM_LENGTH - 1);
		const result = filterAndPaginate(items, {
			searchTerm: shortTerm,
			limit: 50,
		});

		expect(result).toEqual([]);
	});

	it("still searches normally once the term reaches the shared minimum length", () => {
		const { filterAndPaginate } = useItemSearch();
		const items = [
			{ item_code: "ITEM-001", item_name: "Cotton Shirt", rate: 10 },
			{ item_code: "ITEM-002", item_name: "Another Item", rate: 12 },
		];

		const result = filterAndPaginate(items, {
			searchTerm: "cot",
			limit: 50,
		});

		expect(result.map((item) => item.item_code)).toEqual(["ITEM-001"]);
	});

	it("matches mid-word, not just as a prefix, once the term is at or above the minimum length", () => {
		const { filterAndPaginate } = useItemSearch();
		const items = [
			{ item_code: "ITEM-001", item_name: "Cotton Shirt", rate: 10 },
			{ item_code: "ITEM-002", item_name: "Wool Sweater", rate: 12 },
		];

		// "otton" only appears mid-word inside "Cotton" -- never as a prefix
		// of any field on any item, so a prefix-only match would find nothing.
		const result = filterAndPaginate(items, {
			searchTerm: "otton",
			limit: 50,
		});

		expect(result.map((item) => item.item_code)).toEqual(["ITEM-001"]);
	});

	it("an empty search term does not trigger the below-minimum-length empty result (browse/no-term case is unaffected)", () => {
		const { filterAndPaginate } = useItemSearch();
		const items = [
			{ item_code: "ITEM-001", item_name: "Cotton Shirt", rate: 10 },
			{ item_code: "ITEM-002", item_name: "Another Item", rate: 12 },
		];

		const result = filterAndPaginate(items, {
			searchTerm: "",
			limit: 50,
		});

		expect(result.map((item) => item.item_code)).toEqual([
			"ITEM-001",
			"ITEM-002",
		]);
	});
});
