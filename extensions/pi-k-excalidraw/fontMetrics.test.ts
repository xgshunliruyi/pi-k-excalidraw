/**
 * Unit tests for fontMetrics.ts — measurement + enrichment. Run with:
 *   node --experimental-strip-types --test extensions/pi-k-excalidraw/fontMetrics.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExcalidrawElement } from "./parser.ts";
import { enrichElements, measureTextWidth } from "./fontMetrics.ts";

describe("measureTextWidth", () => {
	it("measures latin text with the bundled Excalifont metrics", () => {
		const w = measureTextWidth("Hello", 20);
		assert.ok(w > 30 && w < 80, `expected sane latin width, got ${w}`);
	});

	it("measures CJK at 1em per glyph", () => {
		assert.equal(measureTextWidth("洋葱", 16), 34); // 2×16 + 2 pad
	});

	it("measures mixed text deterministically", () => {
		const a = measureTextWidth("CoT → ReAct 控制环", 16);
		assert.ok(a > 100 && a < 300, `unexpected mixed width ${a}`);
		assert.equal(a, measureTextWidth("CoT → ReAct 控制环", 16));
	});

	it("rounds up and pads", () => {
		assert.equal(measureTextWidth("A", 10), 9); // Excalifont 'A' = 676/1000em → ceil(6.76) + 2
	});
});

const minimalText: ExcalidrawElement = {
	type: "text",
	id: "t1",
	x: 10,
	y: 20,
	text: "Hello 洋葱",
	fontSize: 20,
	strokeColor: "#1e1e1e",
};

describe("enrichElements", () => {
	it("fills text width/height/fontFamily and common fields", () => {
		const [e] = enrichElements([minimalText]);
		assert.ok(e.width! > 0, "width measured");
		assert.equal(e.height, 25); // 20 × 1.25
		assert.equal(e.fontFamily, 5);
		assert.equal(e.lineHeight, 1.25);
		assert.equal(e.originalText, "Hello 洋葱");
		assert.equal(e.textAlign, "left");
		assert.equal(e.version, 1);
		assert.ok(e.seed && e.versionNonce && e.updated, "seed/versionNonce/updated present");
		assert.deepEqual(e.groupIds, []);
		assert.equal(e.roundness, null);
		assert.equal(e.boundElements, null);
		assert.equal(e.locked, false);
	});

	it("is idempotent", () => {
		const once = enrichElements([minimalText]);
		const twice = enrichElements(once);
		assert.deepEqual(twice, once);
	});

	it("leaves excalidraw.com-style complete elements untouched", () => {
		const complete = {
			type: "text",
			id: "t2",
			x: 0,
			y: 0,
			width: 120,
			height: 25,
			angle: 0,
			strokeColor: "#1e1e1e",
			backgroundColor: "transparent",
			fillStyle: "solid",
			strokeWidth: 2,
			strokeStyle: "solid",
			roughness: 1,
			opacity: 100,
			groupIds: [],
			frameId: null,
			roundness: null,
			seed: 123,
			version: 7,
			versionNonce: 456,
			isDeleted: false,
			boundElements: null,
			updated: 1700000000000,
			link: null,
			locked: false,
			text: "Hi",
			fontSize: 20,
			fontFamily: 2,
			textAlign: "left",
			verticalAlign: "top",
			containerId: null,
			originalText: "Hi",
			autoResize: true,
			lineHeight: 1.25,
		};
		assert.deepEqual(enrichElements([complete]), [complete]);
	});

	it("fills arrow defaults without clobbering existing arrowheads", () => {
		const [a] = enrichElements([
			{ type: "arrow", id: "a1", x: 0, y: 0, width: 100, height: 0, points: [[0, 0], [100, 0]] },
		]);
		assert.equal(a.endArrowhead, "arrow");
		assert.equal(a.startArrowhead, null);
		assert.deepEqual(a.startBinding, null);
		assert.deepEqual(a.endBinding, null);
		assert.deepEqual(a.points, [[0, 0], [100, 0]]);

		const [b] = enrichElements([
			{ type: "arrow", id: "a2", x: 0, y: 0, width: 100, height: 0, points: [[0, 0], [100, 0]], endArrowhead: null, startArrowhead: "dot" },
		]);
		assert.equal(b.endArrowhead, null, "explicit null preserved");
		assert.equal(b.startArrowhead, "dot");
	});

	it("converts label shorthand to a centered standalone text element", () => {
		const shape: ExcalidrawElement = {
			type: "rectangle",
			id: "r1",
			x: 100,
			y: 50,
			width: 200,
			height: 80,
			label: { text: "中间文字", fontSize: 16 },
		};
		const [rect, text] = enrichElements([shape]);
		assert.equal(rect.type, "rectangle");
		assert.ok(!("label" in rect), "label removed from shape");
		assert.equal(text.type, "text");
		assert.equal(text.id, "r1-label");
		assert.equal(text.text, "中间文字");
		const cx = (text.x as number) + (text.width as number) / 2;
		const cy = (text.y as number) + (text.height as number) / 2;
		assert.equal(cx, 200, "horizontally centered on shape");
		assert.equal(cy, 90, "vertically centered on shape");
		assert.equal(text.fontFamily, 5);
	});

	it("drops pseudo-elements defensively", () => {
		const out = enrichElements([
			minimalText,
			{ type: "cameraUpdate", width: 800, height: 600, x: 0, y: 0 },
			{ type: "delete", ids: "x" },
		]);
		assert.equal(out.length, 1);
	});
});
