import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSidebarCommands } from "../src/commands.js";

test("sidebar completions include --global and preserve --global prefix", async () => {
	let cmdDef: any = null;
	const mockPi = {
		registerCommand(name: string, def: any) {
			if (name === "sidebar") cmdDef = def;
		},
	};
	// SAFETY: mockPi provides minimal registerCommand interface for tests
	registerSidebarCommands(mockPi as unknown as ExtensionAPI, () => {});
	assert.ok(cmdDef);

	const root = await cmdDef.getArgumentCompletions("");
	assert.ok(root && root.some((c: any) => c.value === "--global "));

	const globalComps = await cmdDef.getArgumentCompletions("--global ");
	assert.ok(globalComps && globalComps.some((c: any) => c.value === "--global tab "));

	const globalTabComps = await cmdDef.getArgumentCompletions("--global tab ");
	assert.ok(globalTabComps && globalTabComps.some((c: any) => c.value === "--global tab status"));
});
