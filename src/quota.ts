import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { KimiUsages, ZaiQuota } from "./types.js";

const BASE_QUOTA_TTL_MS = 60_000;
const MAX_QUOTA_TTL_MS = 600_000;

interface ProviderPollState {
	fetchedAt: number;
	inFlight: boolean;
	consecutiveErrors: number;
	lastLatencyMs: number;
	currentTtlMs: number;
}

const kimiPollState: ProviderPollState = {
	fetchedAt: 0,
	inFlight: false,
	consecutiveErrors: 0,
	lastLatencyMs: 0,
	currentTtlMs: BASE_QUOTA_TTL_MS,
};

const zaiPollState: ProviderPollState = {
	fetchedAt: 0,
	inFlight: false,
	consecutiveErrors: 0,
	lastLatencyMs: 0,
	currentTtlMs: BASE_QUOTA_TTL_MS,
};

let cachedKimiUsages: KimiUsages | null = null;
let cachedZaiQuota: ZaiQuota | null = null;

function computeBackoffTtl(
	state: ProviderPollState,
	isExhausted: boolean,
): number {
	if (state.consecutiveErrors > 0) {
		return Math.min(
			MAX_QUOTA_TTL_MS,
			BASE_QUOTA_TTL_MS * 2 ** Math.min(state.consecutiveErrors, 4),
		);
	}
	if (isExhausted) {
		return Math.min(MAX_QUOTA_TTL_MS, BASE_QUOTA_TTL_MS * 3);
	}
	if (state.lastLatencyMs > 4000) {
		return Math.min(MAX_QUOTA_TTL_MS, BASE_QUOTA_TTL_MS * 2);
	}
	return BASE_QUOTA_TTL_MS;
}

export function readKimiApiKey(): string | undefined {
	try {
		const authPath = join(homedir(), ".pi", "agent", "auth.json");
		if (!existsSync(authPath)) return undefined;
		const auth = JSON.parse(readFileSync(authPath, "utf8"));
		const entry = auth?.["kimi-coding"];
		if (typeof entry?.key === "string" && entry.key.length > 0) return entry.key;
		if (
			typeof entry?.access === "string" &&
			entry.access.length > 0 &&
			(typeof entry.expires !== "number" || entry.expires > Date.now())
		) {
			return entry.access;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function readZaiApiKey(): { key: string; host: string } | undefined {
	try {
		const authPath = join(homedir(), ".pi", "agent", "auth.json");
		if (!existsSync(authPath)) return undefined;
		const auth = JSON.parse(readFileSync(authPath, "utf8"));
		const key = auth?.["zai-coding-cn"]?.key ?? auth?.["zai-coding"]?.key;
		if (typeof key !== "string" || !key) return undefined;

		let host = "https://api.z.ai";
		try {
			const storePath = join(homedir(), ".pi", "agent", "models-store.json");
			if (existsSync(storePath)) {
				const store = JSON.parse(readFileSync(storePath, "utf8"));
				const model = (store?.["zai-coding-cn"] ?? store?.["zai-coding"])
					?.models?.[0];
				const baseUrl: string | undefined = model?.baseUrl;
				if (baseUrl?.includes("bigmodel")) host = "https://open.bigmodel.cn";
			}
		} catch {
			// Non-fatal
		}
		return { key, host };
	} catch {
		return undefined;
	}
}

export async function refreshKimiQuota(
	force = false,
	onUpdate?: () => void,
): Promise<void> {
	if (kimiPollState.inFlight) return;
	if (force) {
		kimiPollState.consecutiveErrors = 0;
		kimiPollState.currentTtlMs = BASE_QUOTA_TTL_MS;
	} else if (Date.now() - kimiPollState.fetchedAt < kimiPollState.currentTtlMs) {
		return;
	}

	const key = readKimiApiKey();
	if (!key) return;

	kimiPollState.inFlight = true;
	const t0 = Date.now();
	try {
		const res = await fetch("https://api.kimi.com/coding/v1/usages", {
			headers: { authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(8000),
		});
		kimiPollState.lastLatencyMs = Date.now() - t0;
		if (res.ok) {
			cachedKimiUsages = (await res.json()) as KimiUsages;
			kimiPollState.fetchedAt = Date.now();
			kimiPollState.consecutiveErrors = 0;
			const used = Number(cachedKimiUsages.usage?.used ?? 0);
			const limit = Number(cachedKimiUsages.usage?.limit ?? 0);
			const isExhausted = limit > 0 && used >= limit;
			kimiPollState.currentTtlMs = computeBackoffTtl(kimiPollState, isExhausted);
			onUpdate?.();
		} else {
			kimiPollState.consecutiveErrors++;
			kimiPollState.currentTtlMs = computeBackoffTtl(kimiPollState, false);
		}
	} catch {
		kimiPollState.consecutiveErrors++;
		kimiPollState.lastLatencyMs = Date.now() - t0;
		kimiPollState.currentTtlMs = computeBackoffTtl(kimiPollState, false);
	} finally {
		kimiPollState.inFlight = false;
	}
}

export async function refreshZaiQuota(
	force = false,
	onUpdate?: () => void,
): Promise<void> {
	if (zaiPollState.inFlight) return;
	if (force) {
		zaiPollState.consecutiveErrors = 0;
		zaiPollState.currentTtlMs = BASE_QUOTA_TTL_MS;
	} else if (Date.now() - zaiPollState.fetchedAt < zaiPollState.currentTtlMs) {
		return;
	}

	const creds = readZaiApiKey();
	if (!creds) return;

	zaiPollState.inFlight = true;
	const t0 = Date.now();
	try {
		const res = await fetch(`${creds.host}/api/monitor/usage/quota/limit`, {
			headers: {
				authorization: `Bearer ${creds.key}`,
				accept: "application/json",
			},
			signal: AbortSignal.timeout(8000),
		});
		zaiPollState.lastLatencyMs = Date.now() - t0;
		if (res.ok) {
			const body = (await res.json()) as { data?: ZaiQuota };
			cachedZaiQuota = body?.data ?? null;
			zaiPollState.fetchedAt = Date.now();
			zaiPollState.consecutiveErrors = 0;
			const isExhausted = Boolean(
				cachedZaiQuota?.limits?.some((l) => (l.percentage ?? 0) >= 100),
			);
			zaiPollState.currentTtlMs = computeBackoffTtl(zaiPollState, isExhausted);
			onUpdate?.();
		} else {
			zaiPollState.consecutiveErrors++;
			zaiPollState.currentTtlMs = computeBackoffTtl(zaiPollState, false);
		}
	} catch {
		zaiPollState.consecutiveErrors++;
		zaiPollState.lastLatencyMs = Date.now() - t0;
		zaiPollState.currentTtlMs = computeBackoffTtl(zaiPollState, false);
	} finally {
		zaiPollState.inFlight = false;
	}
}

export function getKimiQuotas(): KimiUsages | null {
	return cachedKimiUsages;
}

export function getZaiQuotas(): ZaiQuota | null {
	return cachedZaiQuota;
}

export function formatResetTime(iso?: string): string {
	if (!iso) return "?";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "?";
	return `${d.getDate()}.${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatEpochResetTime(ms?: number): string {
	return formatResetTime(
		typeof ms === "number" ? new Date(ms).toISOString() : undefined,
	);
}

export function contextBar(percent: number | null, width = 8): string {
	if (percent === null) return "░".repeat(width);
	const clamped = Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}
