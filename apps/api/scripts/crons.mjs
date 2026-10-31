import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const cronSchema = z.object({
	path: z.string().startsWith("/"),
	schedule: z.string().regex(/^\S+(\s+\S+){4}$/, "needs five fields"),
});

const vercelJsonSchema = z.object({ crons: z.array(cronSchema).min(1) });

// The build writes `.vercel/output/config.json`, and Vercel takes cron jobs from
// that file when it exists, not from `apps/api/vercel.json`. This reads the second
// so the first cannot drift from it. It throws rather than return nothing, because
// a build with no crons stays green and quietly stops every scheduled job.
export function readCrons(apiDir) {
	const file = join(apiDir, "vercel.json");
	const parsed = vercelJsonSchema.safeParse(
		JSON.parse(readFileSync(file, "utf8")),
	);

	if (!parsed.success) {
		throw new Error(
			`${file} does not list valid crons: ${z.prettifyError(parsed.error)}`,
		);
	}

	return parsed.data.crons;
}
