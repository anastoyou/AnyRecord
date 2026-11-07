import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.CLOUDINARY_DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("Set CLOUDINARY_DATABASE_URL or NEON_DATABASE_URL before running migrations.");
}

const migrationsDir = path.join(__dirname, "migrations");
const sql = neon(databaseUrl);

function splitStatements(text) {
	return text
		.split("\n")
		.filter((line) => !line.trim().startsWith("--"))
		.join("\n")
		.split(";")
		.map((s) => s.trim())
		.filter(Boolean);
}

for (const file of readdirSync(migrationsDir)
	.filter((f) => f.endsWith(".sql"))
	.sort()) {
	const fullPath = path.join(migrationsDir, file);
	for (const statement of splitStatements(readFileSync(fullPath, "utf8"))) {
		await sql.query(statement);
	}
	console.log(`Applied migration: ${file}`);
}

const tables = await sql.query(
	"select table_name from information_schema.tables where table_schema = 'public' and table_name like 'cloudinary_%' order by 1",
);
console.log("Cloudinary tables:", tables.map((t) => t.table_name).join(", "));

