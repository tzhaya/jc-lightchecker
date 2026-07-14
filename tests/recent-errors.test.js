const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

before(async () => {
  await import("../docs/recent-errors.js");
});

const NOW = Date.parse("2026-07-14T12:00:00Z");

function record(ageMs, results) {
  return { checkedAtDate: new Date(NOW - ageMs), results };
}

test("separately counts HTTP errors and timeouts and sorts by latest event", () => {
  const records = [
    record(60_000, [{ name: "new", url: "https://new.example/", status_code: null, state: "TIMEOUT" }]),
    record(120_000, [{ name: "old", url: "https://old.example/", status_code: 503, state: "SERVER_ERROR" }]),
    record(30_000, [{ name: "old", url: "https://old.example/", status_code: 504, state: "TIMEOUT" }]),
  ];

  const result = globalThis.RecentErrors.aggregateRecentErrors(records, NOW);
  assert.deepEqual(result.map(({ name, errorCount, timeoutCount }) => ({ name, errorCount, timeoutCount })), [
    { name: "old", errorCount: 2, timeoutCount: 1 },
    { name: "new", errorCount: 0, timeoutCount: 1 },
  ]);
});

test("includes the seven-day boundary and excludes older, future, normal, and malformed records", () => {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const result = globalThis.RecentErrors.aggregateRecentErrors([
    record(sevenDays, [{ name: "boundary", status_code: 500, state: "SERVER_ERROR" }]),
    record(sevenDays + 1, [{ name: "too-old", status_code: 500, state: "SERVER_ERROR" }]),
    record(-1, [{ name: "future", status_code: 500, state: "SERVER_ERROR" }]),
    record(1, [{ name: "normal", status_code: 200, state: "OK" }]),
    { checkedAtDate: new Date("invalid"), results: [] },
    { checkedAtDate: new Date(NOW), results: "invalid" },
  ], NOW);

  assert.deepEqual(result.map(({ name }) => name), ["boundary"]);
});

test("only accepts HTTPS links", () => {
  const { safeHttpsUrl } = globalThis.RecentErrors;
  assert.equal(safeHttpsUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(safeHttpsUrl("http://example.com"), null);
  assert.equal(safeHttpsUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpsUrl("not a url"), null);
});

test("uses external assets with a CSP that forbids inline code", () => {
  const html = readFileSync(join(__dirname, "..", "docs", "index.html"), "utf8");
  const app = readFileSync(join(__dirname, "..", "docs", "app.js"), "utf8");
  assert.match(html, /style-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline/);
  assert.doesNotMatch(html, /<style[\s>]/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(app, /\bstyle\s*=/i);
});
