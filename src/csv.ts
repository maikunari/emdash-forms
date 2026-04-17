/**
 * emdash-forms — RFC 4180 CSV formatter with formula-injection guard
 *
 * Per SPEC-v1.md §4.4 / §13.2 Phase 2. CSV content dumped to disk by
 * one program and opened by a spreadsheet app is a notorious injection
 * surface: a cell starting with `=`, `+`, `-`, `@`, or tab can execute
 * as a formula. We prefix those with a single quote to neutralize.
 *
 * Pattern is the de facto standard — Excel, LibreOffice, and Google
 * Sheets all honor the leading `'` as "this is literal text."
 */

/** Characters that trigger formula interpretation in spreadsheet apps. */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Escape a single value for a CSV cell. Neutralizes formula triggers
 * and quotes per RFC 4180.
 */
export function escapeCsvCell(value: unknown): string {
	const stringValue = value === null || value === undefined ? "" : String(value);

	// Formula-injection guard: prefix with `'` if first char is a trigger.
	const first = stringValue.charAt(0);
	const guarded = FORMULA_TRIGGERS.has(first) ? `'${stringValue}` : stringValue;

	// RFC 4180: if the value contains a comma, quote, or line break,
	// wrap in double quotes and escape embedded quotes by doubling.
	if (/[",\r\n]/.test(guarded)) {
		return `"${guarded.replace(/"/g, '""')}"`;
	}
	return guarded;
}

/**
 * Format a full CSV document. `rows` is an array of objects; `columns`
 * specifies the order and keys to emit.
 *
 * The first row is the header (column labels). Each subsequent row
 * pulls values from the corresponding column keys.
 *
 * Line ending is CRLF per RFC 4180. Most spreadsheet apps accept LF
 * too, but CRLF works everywhere.
 */
export function formatCsv(
	columns: Array<{ key: string; label: string }>,
	rows: Array<Record<string, unknown>>,
): string {
	const lines: string[] = [];
	lines.push(columns.map((c) => escapeCsvCell(c.label)).join(","));
	for (const row of rows) {
		lines.push(columns.map((c) => escapeCsvCell(row[c.key])).join(","));
	}
	return lines.join("\r\n");
}
