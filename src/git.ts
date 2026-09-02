import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { GitInfo } from "./types.js";

interface CachedGitEntry {
	info: GitInfo;
	timestamp: number;
}

const gitCache = new Map<string, CachedGitEntry>();
const CACHE_TTL_MS = 2500;

export function getGitInfo(cwd: string, force = false): GitInfo {
	const normalizedCwd = resolve(cwd);
	const now = Date.now();
	const cached = gitCache.get(normalizedCwd);

	if (!force && cached && now - cached.timestamp < CACHE_TTL_MS) {
		return cached.info;
	}

	const fallback: GitInfo = {
		branch: null,
		dirty: false,
		ahead: 0,
		behind: 0,
	};

	try {
		const stdout = execSync("git status --porcelain=v1 --branch", {
			cwd: normalizedCwd,
			encoding: "utf8",
			timeout: 1500,
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true,
		});

		const lines = stdout.split(/\r?\n/).filter(Boolean);
		if (lines.length === 0) {
			gitCache.set(normalizedCwd, { info: fallback, timestamp: now });
			return fallback;
		}

		const branchLine = lines[0] ?? "";
		let branch: string | null = null;
		let ahead = 0;
		let behind = 0;

		const branchMatch = branchLine.match(/^##\s+([\w\d\-_./]+)/);
		if (branchMatch?.[1] && branchMatch[1] !== "HEAD") {
			branch = branchMatch[1];
		}

		const aheadMatch = branchLine.match(/ahead\s+(\d+)/);
		if (aheadMatch?.[1]) {
			ahead = Number.parseInt(aheadMatch[1], 10) || 0;
		}

		const behindMatch = branchLine.match(/behind\s+(\d+)/);
		if (behindMatch?.[1]) {
			behind = Number.parseInt(behindMatch[1], 10) || 0;
		}

		const dirty =
			lines.slice(1).some((l) => !l.startsWith("??") || true) && lines.length > 1;

		const info: GitInfo = {
			branch,
			dirty,
			ahead,
			behind,
		};

		gitCache.set(normalizedCwd, { info, timestamp: now });
		return info;
	} catch {
		gitCache.set(normalizedCwd, { info: fallback, timestamp: now });
		return fallback;
	}
}

export function formatProjectPath(cwd: string, branch: string | null): string {
	const normalized = resolve(cwd).replace(/^[a-zA-Z]:/, (m) => `/${m}`);
	if (branch) {
		return `${normalized}:${branch}`;
	}
	return normalized;
}
