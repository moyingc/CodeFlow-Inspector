import assert from "node:assert/strict";
import test from "node:test";
import { buildImagePdf } from "../src/lib/report/local-pdf-export.ts";

test("local report exporter creates a multi-page PDF container", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildImagePdf([jpeg, jpeg]);
  const text = new TextDecoder().decode(pdf);

  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /xref/);
  assert.match(text, /%%EOF$/);
});
