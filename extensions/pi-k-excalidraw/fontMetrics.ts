/**
 * fontMetrics — Excalifont text measurement + excalidraw.com-compatible
 * element enrichment for saved .excalidraw files.
 *
 * Why this exists:
 *   pi's save_diagram persists the minimal element shape the model emits
 *   (no width/height/fontFamily on text elements). excalidraw.com imports
 *   scenes with `refreshDimensions: false`, so missing text dimensions stay
 *   0 and the text is dropped as "invisibly small". Enriching before writing
 *   makes saved files open correctly everywhere.
 *
 * Measurement:
 *   A bundled Excalifont latin TTF (assets/excalifont-latin.ttf) is parsed
 *   for glyph advances; CJK / full-width characters fall back to 1em per
 *   glyph (browsers render them with a CJK fallback font at full width), and
 *   unknown latin glyphs fall back to 0.6em — mirroring the reference
 *   implementation in the workspace's .pi/fix_excalidraw.py.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExcalidrawElement } from "./parser.ts";

/** Elements may carry arbitrary extra props (text, fontSize, points, ...). */
export interface EnrichedElement extends ExcalidrawElement {
	[key: string]: unknown;
}

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");
const FONT_PATH = path.join(ASSETS_DIR, "excalifont-latin.ttf");

// ---------------------------------------------------------------------------
// Minimal TTF parsing (head/maxp/hhea/hmtx/cmap) — enough to read advance
// widths per codepoint. ~150 lines, zero dependencies.
// ---------------------------------------------------------------------------

interface FontMetrics {
	unitsPerEm: number;
	advances: number[]; // per glyphId, in font units
	cmap4: { end: number[]; start: number[]; delta: number[]; rangeOffset: number[]; glyphIdArray: number[] } | null;
	cmap12: { start: number[]; end: number[]; glyph: number[] } | null;
}

function u16(buf: Uint8Array, off: number): number {
	return (buf[off] << 8) | buf[off + 1];
}

function i16(buf: Uint8Array, off: number): number {
	const v = u16(buf, off);
	return v & 0x8000 ? v - 0x10000 : v;
}

function u32(buf: Uint8Array, off: number): number {
	return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function parseCmap(
	buf: Uint8Array,
	cmapOff: number,
): { cmap4: FontMetrics["cmap4"]; cmap12: FontMetrics["cmap12"] } {
	const numTables = u16(buf, cmapOff + 2);
	let best4: FontMetrics["cmap4"] = null;
	let best12: FontMetrics["cmap12"] = null;
	for (let i = 0; i < numTables; i++) {
		const rec = cmapOff + 4 + i * 8;
		const platform = u16(buf, rec);
		const encoding = u16(buf, rec + 2);
		const subOff = cmapOff + u32(buf, rec + 4);
		// Prefer Windows Unicode (3,1) format 4, and any format 12 (full range)
		if (u16(buf, subOff) === 4 && platform === 3 && encoding === 1 && !best4) {
			const segCount = u16(buf, subOff + 6) >> 1;
			let p = subOff + 14;
			const endCodes: number[] = [];
			for (let s = 0; s < segCount; s++) { endCodes.push(u16(buf, p)); p += 2; }
			p += 2; // reservedPad
			const startCodes: number[] = [];
			for (let s = 0; s < segCount; s++) { startCodes.push(u16(buf, p)); p += 2; }
			const idDelta: number[] = [];
			for (let s = 0; s < segCount; s++) { idDelta.push(i16(buf, p)); p += 2; }
			const idRangeOffset: number[] = [];
			for (let s = 0; s < segCount; s++) { idRangeOffset.push(u16(buf, p)); p += 2; }
			const glyphIdArray: number[] = [];
			const arrayLen = (subOff + u16(buf, subOff + 2) - p) / 2;
			for (let s = 0; s < arrayLen; s++) { glyphIdArray.push(u16(buf, p)); p += 2; }
			best4 = { end: endCodes, start: startCodes, delta: idDelta, rangeOffset: idRangeOffset, glyphIdArray };
		} else if (u16(buf, subOff) === 12 && !best12) {
			const nGroups = u32(buf, subOff + 12);
			const start: number[] = [];
			const end: number[] = [];
			const glyph: number[] = [];
			let p = subOff + 16;
			for (let g = 0; g < nGroups; g++) {
				start.push(u32(buf, p));
				end.push(u32(buf, p + 4));
				glyph.push(u32(buf, p + 8));
				p += 12;
			}
			best12 = { start, end, glyph };
		}
	}
	return { cmap4: best4, cmap12: best12 };
}

let cached: FontMetrics | null = null;
let fontLoadError: string | null = null;

function loadFont(): FontMetrics | null {
	if (cached) return cached;
	if (fontLoadError) return null;
	try {
		const data = readFileSync(FONT_PATH);
		const buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		const numTables = u16(buf, 4);
		let headOff = 0, maxpOff = 0, hheaOff = 0, hmtxOff = 0, cmapOff = 0;
		for (let i = 0; i < numTables; i++) {
			const rec = 12 + i * 16;
			const tag = String.fromCharCode(buf[rec], buf[rec + 1], buf[rec + 2], buf[rec + 3]);
			const off = u32(buf, rec + 8);
			if (tag === "head") headOff = off;
			else if (tag === "maxp") maxpOff = off;
			else if (tag === "hhea") hheaOff = off;
			else if (tag === "hmtx") hmtxOff = off;
			else if (tag === "cmap") cmapOff = off;
		}
		if (!headOff || !maxpOff || !hheaOff || !hmtxOff || !cmapOff) throw new Error("missing TTF table");
		const unitsPerEm = u16(buf, headOff + 18);
		const numGlyphs = u16(buf, maxpOff + 4);
		const numberOfHMetrics = u16(buf, hheaOff + 34);
		// hmtx: numberOfHMetrics × (advance u16, lsb i16); remaining glyphs share last advance
		const advances: number[] = new Array(numGlyphs).fill(0);
		let lastAdvance = 0;
		for (let g = 0; g < numberOfHMetrics; g++) {
			lastAdvance = u16(buf, hmtxOff + g * 4);
			advances[g] = lastAdvance;
		}
		for (let g = numberOfHMetrics; g < numGlyphs; g++) advances[g] = lastAdvance;
		cached = { unitsPerEm, advances, ...parseCmap(buf, cmapOff) };
	} catch (e) {
		fontLoadError = e instanceof Error ? e.message : String(e);
		cached = null;
	}
	return cached;
}

/** Glyph advance width in font units for a codepoint, or undefined if missing. */
function advanceFor(cp: number, m: FontMetrics): number | undefined {
	let gid: number | undefined;
	if (m.cmap12) {
		const { start, end, glyph } = m.cmap12;
		let lo = 0, hi = start.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (cp < start[mid]) hi = mid - 1;
			else if (cp > end[mid]) lo = mid + 1;
			else { gid = glyph[mid] + (cp - start[mid]); break; }
		}
	}
	if (gid === undefined && m.cmap4) {
		const { start, end, delta, rangeOffset, glyphIdArray } = m.cmap4;
		for (let s = 0; s < end.length; s++) {
			if (cp >= start[s] && cp <= end[s]) {
				if (rangeOffset[s] === 0) gid = (cp + delta[s]) & 0xffff;
				else {
					const idx = rangeOffset[s] / 2 + (cp - start[s]) - (end.length - s);
					const g = glyphIdArray[idx];
					if (g !== 0) gid = (g + delta[s]) & 0xffff;
				}
				break;
			}
		}
	}
	if (gid === undefined || gid >= m.advances.length) return undefined;
	return m.advances[gid];
}

// ---------------------------------------------------------------------------
// Width measurement (mirrors .pi/fix_excalidraw.py)
// ---------------------------------------------------------------------------

/** Width in px of a single line of text at the given font size. */
export function measureTextWidth(text: string, fontSize: number): number {
	const m = loadFont();
	let total = 0;
	for (const ch of text) {
		const cp = ch.codePointAt(0)!;
		if (ch === " ") {
			if (m) total += (advanceFor(0x20, m) ?? 0.3 * m.unitsPerEm) * (fontSize / m.unitsPerEm);
			else total += 0.3 * fontSize;
			continue;
		}
		if (cp >= 0x2e80 || (cp >= 0x2190 && cp <= 0x2193)) {
			total += fontSize; // CJK / arrows → full-width fallback
			continue;
		}
		if (m) {
			const a = advanceFor(cp, m);
			total += (a ?? 0.6 * m.unitsPerEm) * (fontSize / m.unitsPerEm);
		} else {
			total += 0.6 * fontSize;
		}
	}
	return Math.ceil(total) + 2;
}

// ---------------------------------------------------------------------------
// Element enrichment (mirrors .pi/fix_excalidraw.py)
// ---------------------------------------------------------------------------

const COMMON_DEFAULTS: Record<string, unknown> = {
	angle: 0,
	strokeStyle: "solid",
	roughness: 1,
	opacity: 100,
	groupIds: [],
	frameId: null,
	strokeWidth: 2,
	version: 1,
	isDeleted: false,
	boundElements: null,
	link: null,
	locked: false,
};

const TEXT_DEFAULTS: Record<string, unknown> = {
	fontFamily: 5,
	textAlign: "left",
	verticalAlign: "top",
	containerId: null,
	autoResize: true,
	lineHeight: 1.25,
};

const PSEUDO_TYPES = new Set(["cameraUpdate", "delete", "restoreCheckpoint"]);

function randInt(): number {
	return Math.floor(Math.random() * 0x7fffffff) + 1;
}

/** Fill missing excalidraw.com-required fields. Idempotent: existing values
 *  (e.g. from files previously saved by excalidraw.com) are left untouched. */
export function enrichElements(elements: readonly ExcalidrawElement[]): EnrichedElement[] {
	const now = Date.now();
	const out: EnrichedElement[] = [];
	for (const raw of elements) {
		const e = { ...raw } as EnrichedElement;
		if (PSEUDO_TYPES.has(e.type)) continue; // resolved away before save; defensive
		for (const [k, v] of Object.entries(COMMON_DEFAULTS)) {
			if (e[k] === undefined) e[k] = v;
		}
		if (e.seed === undefined) e.seed = randInt();
		if (e.versionNonce === undefined) e.versionNonce = randInt();
		if (e.updated === undefined) e.updated = now;
		if (e.fillStyle === undefined) e.fillStyle = "solid";
		if (e.strokeColor === undefined) e.strokeColor = "#1e1e1e";
		if (e.backgroundColor === undefined) e.backgroundColor = "transparent";
		if (e.roundness === undefined) e.roundness = null;

		// pi-preview `label` shorthand → standalone text element centered on the shape
		const label = e.label as { text?: unknown; fontSize?: unknown; strokeColor?: unknown } | undefined;
		if (label && typeof label === "object" && typeof label.text === "string" && label.text) {
			const fontSize = typeof label.fontSize === "number" ? label.fontSize : 20;
			const w = measureTextWidth(label.text, fontSize);
			const h = Math.round(fontSize * 1.25 * 10) / 10;
			const x = (e.x ?? 0) + ((e.width ?? 0) - w) / 2;
			const y = (e.y ?? 0) + ((e.height ?? 0) - h) / 2;
			delete e.label;
			out.push(e);
			out.push({
				...e,
				id: `${e.id}-label`,
				type: "text",
				x,
				y,
				width: w,
				height: h,
				text: label.text,
				fontSize,
				strokeColor: typeof label.strokeColor === "string" ? label.strokeColor : e.strokeColor,
				...TEXT_DEFAULTS,
				originalText: label.text,
			});
			continue;
		}

		if (e.type === "text") {
			const fontSize = typeof e.fontSize === "number" ? e.fontSize : undefined;
			if (fontSize && (!e.width || !e.height)) {
				e.width = measureTextWidth(String(e.text ?? ""), fontSize);
				e.height = Math.round(fontSize * 1.25 * 10) / 10;
			}
			for (const [k, v] of Object.entries(TEXT_DEFAULTS)) {
				if (e[k] === undefined) e[k] = v;
			}
			if (e.originalText === undefined) e.originalText = e.text ?? "";
		} else if (e.type === "arrow") {
			if (e.startBinding === undefined) e.startBinding = null;
			if (e.endBinding === undefined) e.endBinding = null;
			if (e.startArrowhead === undefined) e.startArrowhead = null;
			if (e.endArrowhead === undefined) e.endArrowhead = "arrow";
		}
		out.push(e);
	}
	return out;
}
