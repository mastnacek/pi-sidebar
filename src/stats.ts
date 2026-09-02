import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionContext,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionStats } from "./types.js";

export const THINKING_EMOJI: Record<string, string> = {
	off: "💤",
	minimal: "🔹",
	low: "🧊",
	medium: "⚡",
	high: "🧠",
	xhigh: "🔥",
	max: "🌋",
};

export const THINKING_TOKEN: Record<string, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

export function getSessionStats(ctx: ExtensionContext): SessionStats {
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;
	let latestCacheHitRate: number | undefined;

	try {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				const u = (entry.message as AssistantMessage).usage;
				if (u) {
					totalInputTokens += u.input ?? 0;
					totalOutputTokens += u.output ?? 0;
					totalCacheRead += u.cacheRead ?? 0;
					totalCacheWrite += u.cacheWrite ?? 0;
					totalCost += u.cost?.total ?? 0;

					const prompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
					if (prompt > 0) {
						latestCacheHitRate = ((u.cacheRead ?? 0) / prompt) * 100;
					}
				}
			} else if (
				entry.type === "message" &&
				entry.message.role === "toolResult" &&
				entry.message.usage
			) {
				const u = entry.message.usage;
				totalInputTokens += u.input ?? 0;
				totalOutputTokens += u.output ?? 0;
				totalCacheRead += u.cacheRead ?? 0;
				totalCacheWrite += u.cacheWrite ?? 0;
				totalCost += u.cost?.total ?? 0;
			} else if (
				(entry.type === "branch_summary" || entry.type === "compaction") &&
				entry.usage
			) {
				const u = entry.usage;
				totalInputTokens += u.input ?? 0;
				totalOutputTokens += u.output ?? 0;
				totalCacheRead += u.cacheRead ?? 0;
				totalCacheWrite += u.cacheWrite ?? 0;
				totalCost += u.cost?.total ?? 0;
			}
		}
	} catch {
		// Non-fatal
	}

	const usage = ctx.getContextUsage();
	const model = ctx.model;
	const contextWindow = usage?.contextWindow ?? model?.contextWindow ?? 0;
	const contextTokens = usage?.tokens ?? null;
	const contextPercent =
		usage?.percent ??
		(contextTokens !== null && contextWindow > 0
			? (contextTokens / contextWindow) * 100
			: null);

	return {
		totalInputTokens,
		totalOutputTokens,
		totalCacheRead,
		totalCacheWrite,
		totalCost,
		contextTokens,
		contextWindow,
		contextPercent,
		cacheHitRate: latestCacheHitRate,
	};
}

export function formatTokens(count: number): string {
	if (count <= 0) return "0 tokens";
	if (count < 1000) return `${count} tokens`;
	if (count < 10000) return `${(count / 1000).toFixed(1)}k tokens`;
	if (count < 1000000) return `${Math.round(count / 1000)}k tokens`;
	return `${(count / 1000000).toFixed(1)}M tokens`;
}

export function formatTokensCompact(count: number): string {
	if (count <= 0) return "0";
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCost(cost: number): string {
	if (cost <= 0) return "$0.00 spent";
	if (cost < 0.01) return `$${cost.toFixed(4)} spent`;
	if (cost < 1) return `$${cost.toFixed(3)} spent`;
	return `$${cost.toFixed(2)} spent`;
}

export function formatPercent(percent: number | null): string {
	if (percent === null) return "0% used";
	const clamped = Math.max(0, Math.min(100, percent));
	if (clamped === 0) return "0% used";
	if (clamped < 1) return `${clamped.toFixed(1)}% used`;
	return `${Math.round(clamped)}% used`;
}

export function isAutoCompactEnabled(cwd: string): boolean {
	const files = [
		join(homedir(), ".pi", "agent", "settings.json"),
		join(cwd, ".pi", "settings.json"),
	];
	let enabled = true;
	for (const f of files) {
		try {
			if (!existsSync(f)) continue;
			const s = JSON.parse(readFileSync(f, "utf8"));
			if (s?.compaction && typeof s.compaction.enabled === "boolean") {
				enabled = s.compaction.enabled;
			}
		} catch {
			// Non-fatal
		}
	}
	return enabled;
}
