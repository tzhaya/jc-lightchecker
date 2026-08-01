(function (root) {
  "use strict";

  const ERROR_STATES = new Set(["SERVER_ERROR", "TIMEOUT", "UNKNOWN"]);
  const ERROR_MARKER_HALF = 4.2;
  const ERROR_MARKER_STROKE_WIDTH = 2.2;
  const OK_MARKER_RADIUS = 3.2;

  function isErrorState(state) {
    return ERROR_STATES.has(state);
  }

  // Error states (SERVER_ERROR/TIMEOUT/UNKNOWN) draw an X instead of a circle so
  // they read as errors without relying on color, which is already reserved for
  // repository identity (see seriesColors in app.js). Every visual property is a
  // literal SVG attribute here rather than a CSS class, so nothing about the
  // marker's appearance can be forgotten in styles.css.
  function markerMarkup({ state, cx, cy, color, titleHtml = "" }) {
    const x = Number(cx);
    const y = Number(cy);
    const title = titleHtml ? `<title>${titleHtml}</title>` : "";

    if (isErrorState(state)) {
      const x1 = (x - ERROR_MARKER_HALF).toFixed(1);
      const x2 = (x + ERROR_MARKER_HALF).toFixed(1);
      const y1 = (y - ERROR_MARKER_HALF).toFixed(1);
      const y2 = (y + ERROR_MARKER_HALF).toFixed(1);
      return `<path d="M ${x1} ${y1} L ${x2} ${y2} M ${x1} ${y2} L ${x2} ${y1}" stroke="${color}" stroke-width="${ERROR_MARKER_STROKE_WIDTH}" stroke-linecap="round" fill="none">${title}</path>`;
    }

    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${OK_MARKER_RADIUS}" fill="${color}">${title}</circle>`;
  }

  root.ChartMarkers = Object.freeze({
    ERROR_STATES,
    isErrorState,
    markerMarkup,
  });
})(globalThis);
