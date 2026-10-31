import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCrons } from "../scripts/crons.mjs";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "crm-crons-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

type VercelJson = {
	$schema?: string;
	crons?: { path: string; schedule: string; extra?: boolean }[];
};

function writeVercelJson(content: VercelJson) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "vercel.json"), JSON.stringify(content));
}

describe("readCrons", () => {
	it("returns the path and schedule of every cron, and nothing else", () => {
		writeVercelJson({
			$schema: "https://openapi.vercel.sh/vercel.json",
			crons: [
				{ path: "/internal/a", schedule: "*/5 * * * *", extra: true },
				{ path: "/internal/b", schedule: "0 6 * * *" },
			],
		});

		expect(readCrons(dir)).toEqual([
			{ path: "/internal/a", schedule: "*/5 * * * *" },
			{ path: "/internal/b", schedule: "0 6 * * *" },
		]);
	});

	it("refuses a file with no crons, so a green build cannot stop every job", () => {
		writeVercelJson({ crons: [] });
		expect(() => readCrons(dir)).toThrow("does not list valid crons");

		writeVercelJson({});
		expect(() => readCrons(dir)).toThrow("does not list valid crons");
	});

	it("refuses a cron without a path that starts with a slash", () => {
		writeVercelJson({ crons: [{ path: "internal/a", schedule: "0 6 * * *" }] });

		expect(() => readCrons(dir)).toThrow("does not list valid crons");
	});

	it("refuses a schedule that is not five fields", () => {
		writeVercelJson({ crons: [{ path: "/internal/a", schedule: "0 6 * *" }] });

		expect(() => readCrons(dir)).toThrow("needs five fields");
	});

	it("reads the real vercel.json, and every job in it is an internal route", () => {
		const crons = readCrons(join(import.meta.dir, ".."));

		expect(crons.length).toBeGreaterThanOrEqual(5);
		expect(crons.map((cron) => cron.path)).toEqual(
			expect.arrayContaining([
				"/internal/sync/mailboxes",
				"/internal/sync/rates",
				"/internal/telemetry/rollup",
				"/internal/tracking/retention",
				"/internal/archive/prune",
			]),
		);
		for (const cron of crons) {
			expect(cron.path.startsWith("/internal/")).toBe(true);
		}
	});
});
