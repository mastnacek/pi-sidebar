/**
 * Terminal ring gauge renderer.
 *
 * Draws a circular progress ring using braille characters. Each braille
 * character is a 2x4 dot grid, so a `charsW` x `rowsH` canvas yields
 * (charsW * 2) x (rowsH * 4) dots of resolution.
 */

// Braille dot bit masks (U+2800 base): columns x rows, standard 2x4 layout.
const BRAILLE_DOT_BITS: ReadonlyArray<readonly [number, number]> = [
	[0x01, 0x08], // dot row 0
	[0x02, 0x10], // dot row 1
	[0x04, 0x20], // dot row 2
	[0x40, 0x80], // dot row 3
];

const BRAILLE_BASE = 0x2800;
const BRAILLE_MAX = 0x28ff;

/**
 * Render a percent value as a circular braille ring.
 * Starts at 12 o'clock and fills clockwise.
 *
 * @param percent 0-100 usage value (clamped)
 * @param charsW  width of the ring in braille characters (default 5)
 * @param rowsH   height of the ring in braille character rows (default 3)
 * @returns one string per row, each `charsW` characters wide
 */
export function ringGauge(percent: number, charsW = 5, rowsH = 3): string[] {
	const width = Math.max(2, Math.floor(charsW));
	const height = Math.max(1, Math.floor(rowsH));
	const dotsW = width * 2;
	const dotsH = height * 4;

	const clamped = Math.max(0, Math.min(100, percent));
	const fillFraction = clamped / 100;

	// Braille dots are effectively square on screen: each character cell holds
	// 2 dot columns and 4 dot rows, and cells are ~1:2 wide:tall — the ratios
	// cancel out, so plain Euclidean distance gives a true circle.
	const cx = (dotsW - 1) / 2;
	const cy = (dotsH - 1) / 2;
	const rOuter = Math.min(dotsW, dotsH) / 2 - 0.4;
	const rInner = Math.max(0.5, rOuter - 1.1);

	const grid: boolean[][] = Array.from({ length: dotsH }, () =>
		Array<boolean>(dotsW).fill(false),
	);

	for (let y = 0; y < dotsH; y++) {
		for (let x = 0; x < dotsW; x++) {
			const dx = x - cx;
			const dy = y - cy;
			const d = Math.hypot(dx, dy);
			if (d > rOuter || d < rInner) continue;

			// Angle: 0 at 12 o'clock, increasing clockwise to 2π at full circle.
			let ang = Math.atan2(dx, -dy);
			if (ang < 0) ang += Math.PI * 2;
			if (ang <= fillFraction * Math.PI * 2) {
				grid[y][x] = true;
			}
		}
	}

	const rows: string[] = [];
	for (let r = 0; r < height; r++) {
		let line = "";
		for (let c = 0; c < width; c++) {
			let bits = 0;
			for (let dy = 0; dy < 4; dy++) {
				for (let dx = 0; dx < 2; dx++) {
					if (grid[r * 4 + dy][c * 2 + dx]) {
						bits |= BRAILLE_DOT_BITS[dy][dx];
					}
				}
			}
			line += String.fromCharCode(BRAILLE_BASE + bits);
		}
		rows.push(line);
	}
	return rows;
}

/** True when every character in the row is a valid braille pattern char. */
export function isBrailleRow(row: string): boolean {
	for (const ch of row) {
		const code = ch.codePointAt(0) ?? 0;
		if (code < BRAILLE_BASE || code > BRAILLE_MAX) return false;
	}
	return true;
}
