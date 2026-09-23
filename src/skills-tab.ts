import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SkillStateSnapshot } from "./types.js";

/**
 * Channel published by pi-plugin-dev (`SKILL_STATE_CHANNEL` in its index.ts).
 * Declared as a literal here so pi-sidebar has no import dependency on it.
 */
export const SKILL_STATE_CHANNEL = "pi-plugin-dev:state";

/**
 * Structural subset of Pi's `EventBus` that this bridge needs. Declared locally
 * so the module stays decoupled from the engine package and is trivially fakeable
 * in tests without type assertions.
 */
export interface SkillStatePublisher {
	events: {
		on(channel: string, handler: (data: unknown) => void): () => void;
	};
}

const MAX_REFERENCES = 6;
const MAX_ACTIONS = 3;
const MAX_COMPLIANCE = 6;

/**
 * Read-only subscriber to pi-plugin-dev's tracker snapshots on the shared event
 * bus. pi-sidebar deliberately performs **no** skill detection of its own: the
 * publisher stays the single source of truth, so the two plugins cannot drift.
 */
export class SkillBridge {
	private state: SkillStateSnapshot | null = null;
	private seen = false;
	private unsubscribe: (() => void) | null = null;
	private onChange: (() => void) | null = null;

	/**
	 * Notified after every ingested payload, so the panel can repaint without
	 * depending on which extension's handler for the same engine event ran first.
	 */
	setOnChange(handler: () => void): void {
		this.onChange = handler;
	}

	attach(publisher: SkillStatePublisher): void {
		this.detach();
		try {
			this.unsubscribe = publisher.events.on(SKILL_STATE_CHANNEL, (data) => {
				this.ingest(data);
			});
		} catch {
			// Non-fatal: the bus is optional and may be absent in exotic hosts.
			this.unsubscribe = null;
		}
	}

	/** Normalize an untrusted bus payload, or clear state on `live: false`. */
	private ingest(data: unknown): void {
		if (!data || typeof data !== "object") return;
		const raw = data as Partial<SkillStateSnapshot> & { live?: boolean };

		if (raw.live === false) {
			this.seen = true;
			this.state = null;
			this.onChange?.();
			return;
		}

		this.seen = true;
		this.state = {
			live: true,
			activeSkill:
				typeof raw.activeSkill === "string" ? raw.activeSkill : undefined,
			references: Array.isArray(raw.references) ? raw.references : [],
			actions: Array.isArray(raw.actions) ? raw.actions : [],
			compliance: Array.isArray(raw.compliance) ? raw.compliance : [],
			inspectedCount: Number(raw.inspectedCount ?? 0),
			modifiedCount: Number(raw.modifiedCount ?? 0),
			startTime: Number(raw.startTime ?? Date.now()),
			lastUpdateTime: Number(raw.lastUpdateTime ?? Date.now()),
			inTurn: Boolean(raw.inTurn),
			turnCount: Number(raw.turnCount ?? 0),
		};
		this.onChange?.();
	}

	getState(): SkillStateSnapshot | null {
		return this.state;
	}

	/** True once any payload arrived — including a `live: false` clear. */
	hasPublisher(): boolean {
		return this.seen;
	}

	detach(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	/** Drop cached state without unsubscribing (used on session start). */
	reset(): void {
		this.state = null;
		this.onChange?.();
	}
}

export interface SkillsPanelStyle {
	accent: (text: string) => string;
	muted: (text: string) => string;
	dim: (text: string) => string;
	success: (text: string) => string;
	warning: (text: string) => string;
	error: (text: string) => string;
}

const BADGE: Record<string, "success" | "error" | "warning"> = {
	pass: "success",
	fail: "error",
	warn: "warning",
};

function elapsedLabel(ms: number): string {
	const seconds = Math.max(0, ms) / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = Math.floor(seconds % 60)
		.toString()
		.padStart(2, "0");
	return `${minutes}m${rest}s`;
}

function actionIcon(type: string): string {
	if (type === "bash") return "🧪";
	if (type === "edit") return "✏️";
	if (type === "write") return "✍️";
	if (type === "doc_consult") return "📚";
	return "📖";
}

/**
 * Render the Skills tab for a narrow column. One terminal line per entry; the
 * caller owns viewport padding and bottom sections.
 */
export function renderSkillsPanel(
	bridge: SkillBridge,
	innerWidth: number,
	style: SkillsPanelStyle,
	wrapText: (text: string, maxWidth: number) => string[],
	now: number = Date.now(),
): string[] {
	const max = Math.max(1, innerWidth);
	const lines: string[] = [];

	const state = bridge.getState();
	if (!state) {
		const headline = bridge.hasPublisher()
			? "No skill active"
			: "Waiting for pi-plugin-dev…";
		for (const line of wrapText(headline, max)) lines.push(style.dim(line));
		if (!bridge.hasPublisher()) {
			for (const line of wrapText(
				"Enable the pi-plugin-dev extension to publish skill state.",
				max,
			)) {
				lines.push(style.dim(line));
			}
		}
		return lines;
	}

	// Header: active skill + counters
	lines.push(style.accent(truncateToWidth(`🎯 ${state.activeSkill ?? "no skill"}`, max)));
	lines.push(
		style.dim(
			truncateToWidth(
				`${state.references.length} refs · ${elapsedLabel(now - state.startTime)} · ${state.turnCount} turns`,
				max,
			),
		),
	);
	lines.push("");

	// Loaded guidance
	lines.push(style.muted("📖 Guidance"));
	if (state.references.length === 0) {
		lines.push(style.dim("  (none yet)"));
	} else {
		const shown = state.references.slice(-MAX_REFERENCES);
		for (const ref of shown) {
			lines.push(style.success(truncateToWidth(`  ✓ ${ref.name}`, max)));
		}
	}
	lines.push("");

	// Agent focus — most recent actions
	lines.push(style.muted("⚡ Focus"));
	if (state.actions.length === 0) {
		lines.push(style.dim("  (idle)"));
	} else {
		for (const action of state.actions.slice(-MAX_ACTIONS)) {
			lines.push(
				style.dim(
					truncateToWidth(`  ${actionIcon(action.type)} ${action.target}`, max),
				),
			);
		}
	}
	lines.push("");

	// Compliance scorecard
	const passed = state.compliance.filter((c) => c.status === "pass").length;
	const failed = state.compliance.filter((c) => c.status === "fail").length;
	const total = state.compliance.length;
	const scoreText = total > 0 ? `${passed}/${total}` : "n/a";
	const scoreColor =
		failed > 0
			? style.error
			: total > 0 && passed === total
				? style.success
				: style.dim;
	lines.push(`${style.muted("🛡")} ${scoreColor(`Gates ${scoreText}`)}`);

	if (state.compliance.length === 0) {
		lines.push(style.dim("  awaiting code mutations"));
	} else {
		for (const check of state.compliance.slice(-MAX_COMPLIANCE)) {
			const token = BADGE[check.status] ?? "warning";
			const label = `[${token === "success" ? "PASS" : token === "error" ? "FAIL" : "WARN"}]`;
			const badge =
				token === "success"
					? style.success(label)
					: token === "error"
						? style.error(label)
						: style.warning(label);
			lines.push(
				`${badge} ${style.dim(truncateToWidth(check.label, Math.max(1, max - 8)))}`,
			);
		}
	}
	lines.push("");

	// Status footer
	lines.push(
		state.inTurn
			? style.accent("● running")
			: style.success(
					truncateToWidth(
						`✓ settled · ${state.inspectedCount} read · ${state.modifiedCount} written`,
						max,
					),
				),
	);

	return lines.map((line) => truncateToWidth(line, max));
}
