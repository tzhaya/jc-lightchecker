const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

before(async () => {
  await import("../docs/chart-markers.js");
});

test("isErrorState classifies SERVER_ERROR / TIMEOUT / UNKNOWN as errors", () => {
  const { isErrorState } = globalThis.ChartMarkers;
  assert.equal(isErrorState("SERVER_ERROR"), true);
  assert.equal(isErrorState("TIMEOUT"), true);
  assert.equal(isErrorState("UNKNOWN"), true);
  assert.equal(isErrorState("OK"), false);
  assert.equal(isErrorState("SLOW"), false);
  assert.equal(isErrorState("VERY_SLOW"), false);
});

test("isErrorState treats unrecognized values as non-error so they still draw as a circle", () => {
  const { isErrorState } = globalThis.ChartMarkers;
  assert.equal(isErrorState(undefined), false);
  assert.equal(isErrorState(null), false);
  assert.equal(isErrorState(""), false);
  assert.equal(isErrorState("SOME_FUTURE_STATE"), false);
});

test("markerMarkup draws a filled circle for non-error states", () => {
  const markup = globalThis.ChartMarkers.markerMarkup({
    state: "OK",
    cx: 10,
    cy: 20,
    color: "#2a78d6",
    titleHtml: "site: 0.123 sec (OK)",
  });
  assert.match(markup, /^<circle /);
  assert.match(markup, /cx="10\.0"/);
  assert.match(markup, /cy="20\.0"/);
  assert.match(markup, /fill="#2a78d6"/);
  assert.match(markup, /<title>site: 0\.123 sec \(OK\)<\/title>/);
  assert.doesNotMatch(markup, /<path/);
});

test("markerMarkup draws a stroked, symmetric X path for error states", () => {
  const markup = globalThis.ChartMarkers.markerMarkup({
    state: "SERVER_ERROR",
    cx: 10,
    cy: 20,
    color: "#e34948",
    titleHtml: "site: 0.123 sec (SERVER_ERROR)",
  });
  assert.match(markup, /^<path /);
  assert.match(markup, /stroke="#e34948"/);
  assert.match(markup, /fill="none"/);
  assert.match(markup, /<title>site: 0\.123 sec \(SERVER_ERROR\)<\/title>/);
  assert.doesNotMatch(markup, /<circle/);

  const d = /d="([^"]+)"/.exec(markup)[1];
  const [x1, y1, x2, y2, x1b, y2b, x2b, y1b] = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.equal(x1, x1b);
  assert.equal(x2, x2b);
  assert.equal(y1, y1b);
  assert.equal(y2, y2b);
  assert.equal((x1 + x2) / 2, 10);
  assert.equal((y1 + y2) / 2, 20);
});

test("markerMarkup treats TIMEOUT and UNKNOWN as error markers too", () => {
  for (const state of ["TIMEOUT", "UNKNOWN"]) {
    const markup = globalThis.ChartMarkers.markerMarkup({ state, cx: 0, cy: 0, color: "#000000" });
    assert.match(markup, /^<path /);
  }
});

test("markerMarkup omits <title> when no titleHtml is given", () => {
  const markup = globalThis.ChartMarkers.markerMarkup({ state: "OK", cx: 1, cy: 1, color: "#000" });
  assert.doesNotMatch(markup, /<title>/);
});

test("ChartMarkers.ERROR_STATES matches check_jairo.py's error-classified states", () => {
  // Keeps the marker shape in sync with classify()'s STATES tuple: if a new
  // state is ever added on the Python side, this fails instead of silently
  // rendering it as a circle.
  const checkJairo = readFileSync(join(__dirname, "..", "scripts", "check_jairo.py"), "utf8");
  const statesMatch = /STATES = \(([^)]*)\)/.exec(checkJairo);
  assert.ok(statesMatch, "expected to find STATES tuple in check_jairo.py");
  const allStates = statesMatch[1].match(/"([A-Z_]+)"/g).map((value) => value.replace(/"/g, ""));

  const { isErrorState } = globalThis.ChartMarkers;
  const errorStates = new Set(allStates.filter((state) => isErrorState(state)));
  const okStates = new Set(allStates.filter((state) => !isErrorState(state)));

  assert.deepEqual(errorStates, new Set(["SERVER_ERROR", "TIMEOUT", "UNKNOWN"]));
  assert.deepEqual(okStates, new Set(["OK", "SLOW", "VERY_SLOW"]));
});
