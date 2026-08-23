Draw the following diagram with the `draw_diagram` tool. Use the Excalidraw element format from the system prompt. Stream a cameraUpdate first, then build the diagram progressively.

{{task}}

After you finish drawing, **you must verify the result before reporting back to the user**:

**Verification method depends on whether your model can receive images:**

- **If your model CAN receive images** (tool-result image attachments are delivered to you), use the screenshot loop below.
- **If your model CANNOT receive images** (image attachments are omitted from tool results — e.g. you see a note like "image omitted" or "does not support images"), do **NOT** call `screenshot_diagram`. The screenshot is not saved anywhere you can read. Instead verify **programmatically**: recompute the bounding box of every element from the coordinates you emitted, and check for:
  - Overlapping shapes, labels, or arrows that obscure each other.
  - Text wider than its container, clipped by the camera, or running outside a shape.
  - Labels with low contrast against their background (unreadable).
  - Arrows that miss their intended source/target coordinates or cross awkwardly.
  - Elements positioned outside the final `cameraUpdate` viewport.
  - Empty / unbalanced regions, or content much smaller than the camera (font too small to read).

**Screenshot loop (vision-capable models only):**

1. Call `screenshot_diagram` to capture the rendered canvas as a PNG.
2. Inspect the image carefully (overlaps, truncation, contrast, mis-targeted arrows, off-camera elements, tiny fonts).
3. If the screenshot looks good, you are done — summarise the diagram for the user.
4. If anything is wrong, fix it with another `draw_diagram` call. Prefer extending the existing canvas via `{"type":"restoreCheckpoint","id":"<id>"}` as the first element, and use `{"type":"delete","ids":"..."}` to remove broken pieces before re-adding them. Then call `screenshot_diagram` again.
5. Repeat the screenshot → fix loop until the diagram is correct. Stop iterating once it looks right (do not over-polish), and bail out if you have already made several attempts without progress and ask the user for guidance instead.
