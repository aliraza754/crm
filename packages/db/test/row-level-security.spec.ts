import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PRISMA = join(import.meta.dir, "..", "prisma");
const MIGRATIONS = join(PRISMA, "migrations");
const SCHEMA = join(PRISMA, "schema.prisma");

const PART = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)';
const REF = String.raw`(?:${PART}\s*\.\s*)?${PART}`;
const ALTER = String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${REF})`;

const PATTERNS = {
	create: new RegExp(
		String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(${REF})`,
		"gi",
	),
	anyCreate: /\bCREATE\s+(?:[A-Z]+\s+)*?TABLE\b/gi,
	drop: new RegExp(
		String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(${REF}(?:\s*,\s*${REF})*)`,
		"gi",
	),
	rename: new RegExp(String.raw`${ALTER}\s+RENAME\s+TO\s+(${PART})`, "gi"),
	security: new RegExp(
		String.raw`${ALTER}\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY`,
		"gi",
	),
	forced: /(?<!\bNO\s+)\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/gi,
	ref: new RegExp(REF, "g"),
	part: new RegExp(PART, "g"),
	model: /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm,
	map: /@@map\(\s*"([^"]+)"\s*\)/,
};

type Migration = { name: string; sql: string };

type Statement =
	| { at: number; kind: "create"; table: string | null; ifNotExists: boolean }
	| { at: number; kind: "drop"; tables: (string | null)[] }
	| { at: number; kind: "rename"; table: string | null; to: string }
	| { at: number; kind: "security"; table: string | null; enabled: boolean };

type Table = { createdIn: string; secured: boolean };

function identifier(part: string): string {
	return part.startsWith('"') ? part.slice(1, -1) : part.toLowerCase();
}

function publicTable(ref: string): string | null {
	const parts = [...ref.matchAll(PATTERNS.part)].map((match) =>
		identifier(match[0]),
	);
	const table = parts.at(-1);

	if (!table) throw new Error(`Cannot read the table name in "${ref}".`);
	if (parts.length > 1 && parts[0] !== "public") return null;

	return table;
}

function withoutComments(sql: string): string {
	return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function statements(sql: string): Statement[] {
	const text = withoutComments(sql);
	const read: Statement[] = [];

	for (const match of text.matchAll(PATTERNS.create)) {
		read.push({
			at: match.index,
			kind: "create",
			table: publicTable(match[2] ?? ""),
			ifNotExists: Boolean(match[1]),
		});
	}

	for (const match of text.matchAll(PATTERNS.drop)) {
		read.push({
			at: match.index,
			kind: "drop",
			tables: [...(match[1] ?? "").matchAll(PATTERNS.ref)].map((ref) =>
				publicTable(ref[0]),
			),
		});
	}

	for (const match of text.matchAll(PATTERNS.rename)) {
		read.push({
			at: match.index,
			kind: "rename",
			table: publicTable(match[1] ?? ""),
			to: identifier(match[2] ?? ""),
		});
	}

	for (const match of text.matchAll(PATTERNS.security)) {
		read.push({
			at: match.index,
			kind: "security",
			table: publicTable(match[1] ?? ""),
			enabled: match[2]?.toUpperCase() === "ENABLE",
		});
	}

	return read.sort((a, b) => a.at - b.at);
}

function unreadCreates(migrations: Migration[]): string[] {
	return migrations.flatMap((migration) => {
		const text = withoutComments(migration.sql);
		const read = new Set(
			[...text.matchAll(PATTERNS.create)].map((match) => match.index),
		);

		return [...text.matchAll(PATTERNS.anyCreate)]
			.filter((match) => !read.has(match.index))
			.map((match) => `${migration.name}: ${match[0]}`);
	});
}

function forced(migrations: Migration[]): string[] {
	return migrations.flatMap((migration) =>
		[...withoutComments(migration.sql).matchAll(PATTERNS.forced)].map(
			() => migration.name,
		),
	);
}

function replay(migrations: Migration[]): Map<string, Table> {
	const tables = new Map<string, Table>();

	for (const migration of migrations) {
		for (const statement of statements(migration.sql)) {
			if (statement.kind === "create") {
				if (statement.table === null) continue;
				if (statement.ifNotExists && tables.has(statement.table)) continue;
				tables.set(statement.table, {
					createdIn: migration.name,
					secured: false,
				});
			} else if (statement.kind === "drop") {
				for (const table of statement.tables) {
					if (table !== null) tables.delete(table);
				}
			} else if (statement.kind === "rename") {
				if (statement.table === null) continue;
				const table = tables.get(statement.table);
				if (!table) continue;
				tables.delete(statement.table);
				tables.set(statement.to, table);
			} else {
				if (statement.table === null) continue;
				const table = tables.get(statement.table);
				if (table) table.secured = statement.enabled;
			}
		}
	}

	return tables;
}

function unsecured(tables: Map<string, Table>): string[] {
	return [...tables]
		.filter(([, table]) => !table.secured)
		.map(([name, table]) => `${name} (created in ${table.createdIn})`);
}

function onDisk(): Migration[] {
	return readdirSync(MIGRATIONS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
		.map((name) => ({
			name,
			sql: readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"),
		}));
}

function schemaTables(): string[] {
	const schema = readFileSync(SCHEMA, "utf8");

	return [...schema.matchAll(PATTERNS.model)].map(
		(model) => model[2]?.match(PATTERNS.map)?.[1] ?? model[1] ?? "",
	);
}

function check(...sql: string[]): string[] {
	return unsecured(
		replay(sql.map((text, index) => ({ name: `m${index + 1}`, sql: text }))),
	);
}

describe("row-level security in the migrations", () => {
	const migrations = onDisk();
	const tables = replay(migrations);

	it("is enabled on every table the migrations leave behind", () => {
		expect(unsecured(tables)).toEqual([]);
	});

	it("is checked for every model in schema.prisma", () => {
		const models = schemaTables();

		expect(models.length).toBeGreaterThan(0);
		expect(models.filter((table) => !tables.has(table))).toEqual([]);
	});

	it("is checked for every CREATE TABLE statement", () => {
		expect(unreadCreates(migrations)).toEqual([]);
	});

	it("is never forced on the role that owns the tables", () => {
		expect(forced(migrations)).toEqual([]);
	});
});

describe("the row-level security replay", () => {
	const organization =
		'CREATE TABLE "organization" (\n    "id" TEXT NOT NULL,\n    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")\n);';

	it("reports a table that a migration creates without it", () => {
		expect(check(organization)).toEqual(["organization (created in m1)"]);
	});

	it("accepts the table when a later migration enables it", () => {
		expect(
			check(
				organization,
				'ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;',
			),
		).toEqual([]);
	});

	it("reports a table that is dropped and created again", () => {
		expect(
			check(
				`${organization}\nALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;`,
				'DROP TABLE IF EXISTS "organization";',
				organization,
			),
		).toEqual(["organization (created in m3)"]);
	});

	it("keeps it on a table that is renamed", () => {
		expect(
			check(
				`${organization}\nALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;`,
				'ALTER TABLE "organization" RENAME TO "workspace";',
			),
		).toEqual([]);
	});

	it("reports a table where a later migration disables it", () => {
		expect(
			check(
				`${organization}\nALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;`,
				'ALTER TABLE ONLY "organization" DISABLE ROW LEVEL SECURITY;',
			),
		).toEqual(["organization (created in m1)"]);
	});

	it("reads unquoted and public-qualified names", () => {
		expect(
			check(
				"CREATE TABLE public.Lead (id text);",
				'ALTER TABLE IF EXISTS "public"."lead" ENABLE ROW LEVEL SECURITY;',
				"CREATE UNLOGGED TABLE IF NOT EXISTS audit (id text);",
			),
		).toEqual(["audit (created in m3)"]);
	});

	it("ignores a table in another schema", () => {
		expect(check('CREATE TABLE "private"."secret" (id text);')).toEqual([]);
	});

	it("keeps it when CREATE TABLE IF NOT EXISTS meets an existing table", () => {
		expect(
			check(
				`${organization}\nALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;`,
				'CREATE TABLE IF NOT EXISTS "organization" (id text);',
			),
		).toEqual([]);
	});

	it("does not read statements inside comments", () => {
		expect(
			check(
				organization,
				'-- ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;\n/* ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY; */',
			),
		).toEqual(["organization (created in m1)"]);
	});

	it("reports a CREATE TABLE form that it cannot read", () => {
		expect(
			unreadCreates([
				{ name: "m1", sql: "CREATE TEMPORARY TABLE scratch (id text);" },
			]),
		).toEqual(["m1: CREATE TEMPORARY TABLE"]);
	});

	it("reports FORCE ROW LEVEL SECURITY and accepts NO FORCE", () => {
		expect(
			forced([
				{
					name: "m1",
					sql: 'ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;',
				},
				{
					name: "m2",
					sql: 'ALTER TABLE "organization" NO FORCE ROW LEVEL SECURITY;',
				},
			]),
		).toEqual(["m1"]);
	});
});
