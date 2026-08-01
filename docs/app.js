const states = ["OK", "SLOW", "VERY_SLOW", "SERVER_ERROR", "TIMEOUT", "UNKNOWN"];
const countsEl = document.querySelector("#counts");
const checkedAtEl = document.querySelector("#checkedAt");
const summaryEl = document.querySelector("#summary");
const summaryMessageEl = document.querySelector("#summaryMessage");
const resultsEl = document.querySelector("#results");
const chartWrapEl = document.querySelector("#chartWrap");
const chartLegendEl = document.querySelector("#chartLegend");
const historyStatsEl = document.querySelector("#historyStats");
const rangeControlsEl = document.querySelector("#rangeControls");
const repoFilterEl = document.querySelector("#repoFilter");
const repoHistoryEl = document.querySelector("#repoHistory");
const repoHistoryTitleEl = document.querySelector("#repoHistoryTitle");
const repoHistoryResultsEl = document.querySelector("#repoHistoryResults");
const recentErrorsEl = document.querySelector("#recentErrors");
const recentErrorsDetailsEl = document.querySelector("#recentErrorsDetails");
const recentErrorsCountEl = document.querySelector("#recentErrorsCount");
const recentErrorResultsEl = document.querySelector("#recentErrorResults");
const ranges = {
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  all: null,
};
// Validated categorical palette (dataviz skill reference instance). Slots 3/4/5
// (aqua/yellow/magenta) are darkened from the skill's documented default so all
// 8 clear 3:1 contrast on this dashboard's actual surfaces (#fbfcfe chart /
// #ffffff legend) -- see issue #32. Assignment is identity-based (colorForKey
// in repo-filter.js), never cycled: a 9th registered target gets FALLBACK_COLOR
// rather than repeating an earlier slot's hue.
const seriesColors = ["#2a78d6", "#eb6834", "#1aa674", "#c48500", "#e46595", "#008300", "#4a3aa7", "#e34948"];
const FALLBACK_COLOR = "#595959";
let historyRecords = [];
let activeRange = "12h";
let canonicalSites = null;
let latestStatus = "pending";
let latestResults = [];
let historyStatus = "pending";
let activeRepoKey = readRepoKeyFromHash();

function text(value, fallback = "-") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)} sec` : "-";
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function percentile(values, percent) {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * (percent / 100);
  const lower = Math.floor(index);
  const upper = Math.min(lower + 1, ordered.length - 1);
  const weight = index - lower;
  return ordered[lower] * (1 - weight) + ordered[upper] * weight;
}

function readRepoKeyFromHash() {
  const match = /^#repo=(.+)$/.exec(location.hash);
  if (!match) {
    return "all";
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "all";
  }
}

function writeRepoKeyToHash(key) {
  const hash = key && key !== "all" ? `#repo=${encodeURIComponent(key)}` : "";
  history.replaceState(null, "", location.pathname + location.search + hash);
}

function renderCounts(counts = {}) {
  countsEl.innerHTML = states.map((state) => `
    <div class="count">
      <span>${state}</span>
      <strong>${Number(counts[state] || 0)}</strong>
    </div>
  `).join("");
}

function renderError(message) {
  checkedAtEl.textContent = "Latest status unavailable";
  summaryEl.dataset.level = "UNKNOWN";
  summaryMessageEl.textContent = message;
  renderCounts({});
  resultsEl.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(message)}</td></tr>`;
}

function renderLatest(latest) {
  const summary = latest.summary || {};
  const results = Array.isArray(latest.results) ? latest.results : [];
  const checkedAt = latest.checked_at ? new Date(latest.checked_at).toLocaleString("ja-JP") : "-";

  checkedAtEl.textContent = `Last checked: ${checkedAt}`;
  summaryEl.dataset.level = summary.level || "UNKNOWN";
  summaryMessageEl.textContent = summary.message || "No status message.";
  renderCounts(summary.counts || {});

  if (results.length === 0) {
    resultsEl.innerHTML = '<tr><td colspan="6" class="empty">No targets available.</td></tr>';
    return;
  }

  resultsEl.innerHTML = results.map((result) => {
    const state = text(result.state, "UNKNOWN");
    const elapsed = result.elapsed_sec === null || result.elapsed_sec === undefined
      ? "-"
      : `${Number(result.elapsed_sec).toFixed(3)} sec`;
    const primary = result.primary ? " <span class=\"muted\">primary</span>" : "";
    const href = RecentErrors.safeHttpsUrl(result.url);
    return `
      <tr>
        <td><strong>${escapeHtml(result.name)}</strong>${primary}</td>
        <td>${href
          ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.url)}</a>`
          : escapeHtml(result.url)}</td>
        <td>${escapeHtml(result.status_code)}</td>
        <td>${elapsed}</td>
        <td><span class="badge ${escapeAttr(state)}">${escapeHtml(state)}</span></td>
        <td>${escapeHtml(result.error)}</td>
      </tr>
    `;
  }).join("");
}

function parseHistory(jsonl) {
  return jsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((record) => ({ ...record, checkedAtDate: new Date(record.checked_at) }))
    .filter((record) => !Number.isNaN(record.checkedAtDate.getTime()))
    .sort((a, b) => a.checkedAtDate.getTime() - b.checkedAtDate.getTime());
}

function getFilteredHistory() {
  if (historyRecords.length === 0 || ranges[activeRange] === null) {
    return historyRecords;
  }
  const latestTime = Math.max(...historyRecords.map((record) => record.checkedAtDate.getTime()));
  const fromTime = latestTime - ranges[activeRange];
  return historyRecords.filter((record) => record.checkedAtDate.getTime() >= fromTime);
}

function buildSeries(records) {
  const sites = new Map();
  for (const record of records) {
    const results = Array.isArray(record.results) ? record.results : [];
    for (const result of results) {
      const key = result.url || result.name;
      if (!key) {
        continue;
      }
      if (!sites.has(key)) {
        sites.set(key, {
          key,
          name: text(result.name, key),
          points: [],
        });
      }
      const elapsed = Number(result.elapsed_sec);
      sites.get(key).points.push({
        time: record.checkedAtDate.getTime(),
        elapsed: Number.isFinite(elapsed) ? elapsed : null,
        state: text(result.state, "UNKNOWN"),
      });
    }
  }
  return [...sites.values()].map((site) => {
    const { color, paletteIndex } = RepoFilter.colorForKey(canonicalSites, site.key, seriesColors, FALLBACK_COLOR);
    return {
      ...site,
      color,
      paletteIndex,
      points: site.points.sort((a, b) => a.time - b.time),
    };
  });
}

function renderRecentErrors() {
  const errors = RecentErrors.aggregateRecentErrors(historyRecords);
  const view = RecentErrors.describeRecentErrors(errors);
  recentErrorsEl.hidden = view.hidden;
  recentErrorsDetailsEl.open = view.open;
  recentErrorsCountEl.textContent = view.countText;

  recentErrorResultsEl.innerHTML = errors.map((error) => {
    const repository = error.url
      ? `<a href="${escapeAttr(error.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(error.name)}</a>`
      : escapeHtml(error.name);
    return `
      <tr>
        <td>${repository}</td>
        <td><strong>${error.errorCount}</strong></td>
        <td><strong>${error.timeoutCount}</strong></td>
        <td><time datetime="${new Date(error.latestAt).toISOString()}">${escapeHtml(formatDateTime(error.latestAt))}</time></td>
      </tr>
    `;
  }).join("");
}

function renderHistory() {
  const records = getFilteredHistory();
  const series = RepoFilter.filterSeriesByRepo(buildSeries(records), activeRepoKey);
  const values = series.flatMap((site) => site.points.map((point) => point.elapsed).filter(Number.isFinite));
  const latestRecord = historyRecords[historyRecords.length - 1] || {};
  const slowSec = Number(latestRecord.thresholds?.slow_sec || 5);
  const verySlowSec = Number(latestRecord.thresholds?.very_slow_sec || 15);

  if (records.length === 0 || values.length === 0) {
    chartWrapEl.innerHTML = '<div class="chart-empty">No response history available</div>';
    chartLegendEl.innerHTML = "";
    renderHistoryStats([]);
    return;
  }

  const width = 960;
  const height = 360;
  const margin = { top: 24, right: 28, bottom: 48, left: 62 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const minTime = Math.min(...records.map((record) => record.checkedAtDate.getTime()));
  const maxTime = Math.max(...records.map((record) => record.checkedAtDate.getTime()));
  const timeSpan = Math.max(maxTime - minTime, 1);
  const maxValue = Math.max(...values, slowSec, verySlowSec);
  const yMax = Math.max(1, Math.ceil(maxValue * 1.15));
  const x = (time) => margin.left + ((time - minTime) / timeSpan) * plotWidth;
  const y = (value) => margin.top + plotHeight - (value / yMax) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => (yMax / 4) * index);
  const xTicks = Array.from({ length: 4 }, (_, index) => minTime + (timeSpan / 3) * index);
  const thresholdLines = [
    { label: "SLOW", value: slowSec, color: "#9a6a00" },
    { label: "VERY_SLOW", value: verySlowSec, color: "#b64f0a" },
  ].filter((line) => line.value <= yMax);

  const lineMarkup = series.map((site) => {
    const finitePoints = site.points.filter((point) => Number.isFinite(point.elapsed));
    if (finitePoints.length === 0) {
      return "";
    }
    const path = finitePoints
      .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(1)} ${y(point.elapsed).toFixed(1)}`)
      .join(" ");
    const circles = finitePoints.map((point) => `
      <circle cx="${x(point.time).toFixed(1)}" cy="${y(point.elapsed).toFixed(1)}" r="3.2" fill="${site.color}">
        <title>${escapeHtml(`${site.name}: ${formatSeconds(point.elapsed)} (${point.state})\n日時: ${formatDateTime(point.time)}`)}</title>
      </circle>
    `).join("");

    return `
      <path d="${path}" fill="none" stroke="${site.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></path>
      ${circles}
    `;
  }).join("");

  chartWrapEl.innerHTML = `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="response time history chart">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fbfcfe"></rect>
      ${yTicks.map((tick) => `
        <line class="grid" x1="${margin.left}" y1="${y(tick).toFixed(1)}" x2="${width - margin.right}" y2="${y(tick).toFixed(1)}"></line>
        <text class="chart-label" x="${margin.left - 10}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end">${tick.toFixed(tick >= 10 ? 0 : 1)}s</text>
      `).join("")}
      ${xTicks.map((tick) => `
        <text class="chart-label" x="${x(tick).toFixed(1)}" y="${height - 16}" text-anchor="middle">${new Date(tick).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</text>
      `).join("")}
      ${thresholdLines.map((line) => `
        <line class="threshold" x1="${margin.left}" y1="${y(line.value).toFixed(1)}" x2="${width - margin.right}" y2="${y(line.value).toFixed(1)}" stroke="${line.color}"></line>
        <text class="chart-label" x="${width - margin.right - 4}" y="${(y(line.value) - 6).toFixed(1)}" text-anchor="end">${line.label}</text>
      `).join("")}
      <line class="axis" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}"></line>
      <line class="axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"></line>
      ${lineMarkup}
    </svg>
  `;

  // Filtering to one repository names it in the table heading below, so the
  // legend would just repeat it. Unfiltered, every line needs its label -- even
  // when the range happens to leave only one site with samples.
  chartLegendEl.innerHTML = activeRepoKey === "all" ? series.map((site) => `
    <span class="legend-item">
      <span class="legend-swatch legend-swatch--${site.paletteIndex ?? "fallback"}"></span>
      ${escapeHtml(site.name)}
    </span>
  `).join("") : "";
  renderHistoryStats(values, records, series, slowSec);
}

function renderHistoryStats(values, records = [], series = [], slowSec = 5) {
  const slowCount = series.reduce((count, site) => (
    count + site.points.filter((point) => Number.isFinite(point.elapsed) && point.elapsed >= slowSec).length
  ), 0);
  const stats = [
    ["Records", records.length || "-"],
    ["Samples", values.length || "-"],
    ["p50", formatSeconds(percentile(values, 50))],
    ["p95", formatSeconds(percentile(values, 95))],
    ["Slow+", values.length ? slowCount : "-"],
  ];
  historyStatsEl.innerHTML = stats.map(([label, value]) => `
    <div class="stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function renderHistoryError(message) {
  chartWrapEl.innerHTML = `<div class="chart-empty">${escapeHtml(message)}</div>`;
  chartLegendEl.innerHTML = "";
  renderHistoryStats([]);
}

function populateRepoFilterOptions() {
  const options = ['<option value="all">すべて表示</option>'].concat(
    canonicalSites.map((site) => `<option value="${escapeAttr(site.key)}">${escapeHtml(site.name)}</option>`)
  );
  repoFilterEl.innerHTML = options.join("");
  repoFilterEl.value = activeRepoKey;
  repoFilterEl.disabled = false;
}

// Freezes canonicalSites (and the repo filter's options) at most once, from
// whichever fetch settles first with a usable site list. No-op once frozen:
// colors and the option list must never change after first shown, so a
// repository's color stays constant across a visit (see issue #32).
function tryFreezeCanonicalSites() {
  if (canonicalSites !== null) {
    return;
  }
  const resolved = RepoFilter.resolveCanonicalSites({ latestStatus, latestResults, historyRecords });
  if (resolved === null) {
    return;
  }
  canonicalSites = resolved;
  activeRepoKey = RepoFilter.resolveActiveRepoKey(activeRepoKey, canonicalSites);
  populateRepoFilterOptions();
  writeRepoKeyToHash(activeRepoKey);
}

// The single entry point for (re)drawing the history panel: called after every
// latest.json / history.jsonl settle in any order, and from the filter controls.
// Attempts the one-time freeze above, then decides what to show right now.
function renderIfReady() {
  tryFreezeCanonicalSites();
  if (historyStatus === "failed") {
    renderHistoryError("history.jsonl could not be loaded");
    recentErrorsEl.hidden = true;
    return;
  }
  if (historyStatus === "pending") {
    return;
  }
  if (canonicalSites === null) {
    // Colors are keyed to the canonical order, so while latest.json could still
    // arrive with one, wait rather than paint a provisional palette. Once it has
    // settled too, no source carries any site at all — fall through and let
    // renderHistory show its empty state instead of a stuck placeholder.
    if (latestStatus === "pending") {
      return;
    }
    activeRepoKey = RepoFilter.resolveActiveRepoKey(activeRepoKey, canonicalSites);
  }
  renderHistory();
  renderRepoHistory();
}

function renderRepoHistory() {
  if (activeRepoKey === "all") {
    repoHistoryEl.hidden = true;
    repoHistoryResultsEl.innerHTML = "";
    return;
  }
  const rows = RepoFilter.buildRepoHistoryRows(getFilteredHistory(), activeRepoKey);
  const site = (canonicalSites || []).find((entry) => entry.key === activeRepoKey);
  const siteName = site ? site.name : activeRepoKey;

  repoHistoryTitleEl.textContent = `${siteName} のチェック履歴（${rows.length}件のチェック）`;
  repoHistoryResultsEl.innerHTML = rows.length ? rows.map((row) => {
    const elapsed = Number.isFinite(row.elapsedSec) ? `${row.elapsedSec.toFixed(3)} sec` : "-";
    return `
      <tr>
        <td><time datetime="${new Date(row.checkedAt).toISOString()}">${escapeHtml(formatDateTime(row.checkedAt))}</time></td>
        <td>${escapeHtml(row.statusCode)}</td>
        <td>${elapsed}</td>
        <td><span class="badge ${escapeAttr(row.state)}">${escapeHtml(row.state)}</span></td>
        <td>${escapeHtml(row.error)}</td>
      </tr>
    `;
  }).join("") : '<tr><td colspan="5" class="empty">この期間のチェック記録がありません。</td></tr>';
  repoHistoryEl.hidden = false;
}

rangeControlsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-range]");
  if (!button) {
    return;
  }
  activeRange = button.dataset.range;
  for (const rangeButton of rangeControlsEl.querySelectorAll("[data-range]")) {
    rangeButton.setAttribute("aria-pressed", String(rangeButton === button));
  }
  renderIfReady();
});

repoFilterEl.addEventListener("change", () => {
  activeRepoKey = repoFilterEl.value;
  writeRepoKeyToHash(activeRepoKey);
  renderIfReady();
});

fetch("latest.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) {
      throw new Error(`latest.json returned ${response.status}`);
    }
    return response.json();
  })
  .then((latest) => {
    renderLatest(latest);
    latestStatus = "success";
    latestResults = Array.isArray(latest.results) ? latest.results : [];
    renderIfReady();
  })
  .catch(() => {
    renderError("latest.json could not be loaded");
    latestStatus = "failed";
    renderIfReady();
  });

fetch("history.jsonl", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) {
      throw new Error(`history.jsonl returned ${response.status}`);
    }
    return response.text();
  })
  .then((jsonl) => {
    historyRecords = parseHistory(jsonl);
    historyStatus = "success";
    renderRecentErrors();
    renderIfReady();
  })
  .catch(() => {
    historyStatus = "failed";
    renderIfReady();
  });
