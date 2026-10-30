import { describe, expect, test } from "bun:test";
import { cleanCode, isCompleteCode } from "../lib/email-code";

describe("the sign-in code field", () => {
	test("keeps digits only", () => {
		expect(cleanCode("48 29-13")).toBe("482913");
		expect(cleanCode("abc")).toBe("");
	});

	test("cuts a paste to the code length", () => {
		expect(cleanCode("48291399")).toBe("482913");
	});

	test("is complete at the code length and not before", () => {
		expect(isCompleteCode("48291")).toBe(false);
		expect(isCompleteCode("482913")).toBe(true);
	});
});
