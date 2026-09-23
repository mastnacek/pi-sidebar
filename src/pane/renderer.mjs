#!/usr/bin/env node
/**
 * Standalone sidebar face for a herdr pane.
 *
 * Runs as an ordinary process with **no model access and no LLM context**: it
 * polls a JSON snapshot written by the pi-sidebar extension and repaints the
 * pane's screen with ANSI escapes. Zero dependencies on purpose — it must run
 * under any node/bun available to the pane, without resolving pi's packages.
 *
 * Usage: node renderer.mjs --snapshot <path> [--poll 300]
 */
import {
	existsSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import process from "node:process";

const argv = process.argv.slice(2);
const flagValue = (name, fallback) => {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};

const snapshotPath = flagValue("--snapshot", null);
const pollMs = Math.max(100, Number(flagValue("--poll", "300")) || 300);

if (!snapshotPath) {
	process.stderr.write("pi-sidebar renderer: --snapshot <path> is required\n");
	process.exit(2);
}

const pidPath = `${snapshotPath}.pid`;

/** Single-instance guard: a reload must not stack a second renderer. */
function claimLock() {
	try {
		if (existsSync(pidPath)) {
			const previous = Number(readFileSync(pidPath, "utf8").trim());
			if (previous && previous !== process.pid) {
				try {
					process.kill(previous, 0);
					process.exit(0); // A live renderer already owns this pane.
				} catch {
					// Stale pid — fall through and take over.
				}
			}
		}
	} catch {
		// Non-fatal: worst case two renderers race, last write wins.
	}
	try {
		writeFileSync(pidPath, String(process.pid), "utf8");
	} catch {
		// Non-fatal.
	}
}

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR = "\x1b[2J";
const CLEAR_TO_END = "\x1b[J";

let finished = false;
let lastSignature = "";

/**
 * Fit a pre-rendered line to the pane's real TTY width. The extension already
 * pads/truncates using display width, so this is a safety net for the (roughly
 * two-column) gap between herdr's layout rect and the PTY it hands the renderer.
 */
function fitLine(line, columns) {
	const trimmed = line.replace(/ +$/, "");
	let visible = 0;
	let index = 0;
	let out = "";
	while (index < trimmed.length) {
		const rest = trimmed.slice(index);
		const escape = rest.match(/^\x1b\[[0-9;]*[A-Za-z]/);
		if (escape) {
			out += escape[0];
			index += escape[0].length;
			continue;
		}
		const codePoint = trimmed.codePointAt(index) ?? 0;
		const width = codePoint > 0x1f300 || codePoint === 0x2764 ? 2 : 1;
		if (visible + width > columns) break;
		const char = String.fromCodePoint(codePoint);
		out += char;
		visible += width;
		index += char.length;
	}
	return out;
}

function paint(lines) {
	const columns = process.stdout.columns || 0;
	const fitted =
		columns > 0 ? lines.map((line) => fitLine(line, columns)) : lines;
	const body = `${HIDE_CURSOR}${HOME}${CLEAR}${fitted.join("\n")}${CLEAR_TO_END}`;
	process.stdout.write(body);
}

function paintMessage(message) {
	paint([`│ ${message}`]);
}

function cleanup() {
	try {
		process.stdout.write(SHOW_CURSOR);
	} catch {
		// Terminal already gone.
	}
	try {
		if (existsSync(pidPath)) {
			const owner = Number(readFileSync(pidPath, "utf8").trim());
			if (owner === process.pid) unlinkSync(pidPath);
		}
	} catch {
		// Non-fatal.
	}
}

function tick() {
	if (finished) return;
	if (!existsSync(snapshotPath)) {
		paintMessage("Waiting for pi-sidebar…");
		return;
	}

	let signature = "";
	try {
		const stat = statSync(snapshotPath);
		signature = `${stat.mtimeMs}:${stat.size}`;
	} catch {
		return;
	}
	if (signature === lastSignature) return;
	lastSignature = signature;

	let snapshot = null;
	try {
		snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
	} catch {
		return; // Partially written file: keep the previous frame.
	}
	if (!snapshot || !Array.isArray(snapshot.lines)) return;

	if (snapshot.live === false) {
		// Final frame: leave it on screen and stop burning cycles.
		paint(snapshot.lines.length > 0 ? snapshot.lines : ["│ session ended"]);
		finished = true;
		cleanup();
		return;
	}

	paint(snapshot.lines);
}

claimLock();
process.stdout.write(HIDE_CURSOR);
paintMessage("Waiting for pi-sidebar…");

const timer = setInterval(tick, pollMs);
tick();

function shutdown() {
	finished = true;
	clearInterval(timer);
	cleanup();
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", cleanup);
