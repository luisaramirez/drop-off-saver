/**
 * riskJourney.js — Scroll-Driven Risk Narrative
 * ===============================================
 * Renders the "Students don't disappear, they fade" interactive sequence:
 * 500 individual student dots that color-code by risk, merge into two
 * clusters (healthy / at-risk), then split the at-risk cluster into three
 * clickable behavioral profiles with a student-level drill-down.
 *
 * Kept as a SEPARATE module from charts.js on purpose. charts.js owns the
 * Chart.js bar charts (distribution histogram, profile breakdown bars).
 * This module owns a hand-built SVG scene with its own animation timeline.
 * Mixing the two concerns in one file would make either one harder to
 * reason about — Chart.js manages its own canvas lifecycle and does not
 * compose cleanly with a raw SVG scene driven by GSAP scrub animation.
 *
 * PHASE 1 SCOPE (this file, current state):
 *   - Fetch predictions.json (independently of app.js's fetch — see note
 *     in boot() below)
 *   - Lay out one <circle> per student in a grid inside an SVG canvas
 *   - No color, no animation, no interaction yet — later phases build on
 *     this foundation incrementally.
 *
 * Later phases (not yet built):
 *   Phase 2 — risk-tier fill color + live legend
 *   Phase 3 — metaball merge proof-of-concept (scrub-able)
 *   Phase 4 — wire merge into real data, isolate at-risk cluster
 *   Phase 5 — split at-risk cluster into 3 profile blobs
 *   Phase 6 — resolve blobs into clickable labeled circles
 *   Phase 7 — click → detail panel (profile breakdown + strategy)
 *   Phase 8 — click → student-level drill-down grid
 *   Phase 9 — accessibility + mobile + reduced-motion pass
 */

"use strict";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const JOURNEY_DATA_URL = "assets/predictions.json";

// Grid layout constants for Phase 1's static dot field. These are tuned
// for 500 dots at a comfortable radius inside the SVG viewBox defined
// below — revisit if N_STUDENTS in generator.py changes meaningfully.
const GRID_COLS = 25;              // 500 students / 25 = 20 rows
const DOT_RADIUS = 6;
const DOT_SPACING = 18;            // center-to-center distance
const GRID_MARGIN = 20;            // padding inside the SVG viewBox

// ---------------------------------------------------------------------------
// Data ingestion
// ---------------------------------------------------------------------------

/**
 * Fetches predictions.json independently of app.js.
 *
 * This duplicates app.js's loadPredictions() fetch call. That's a
 * deliberate, temporary choice for Phase 1: keeping riskJourney.js fully
 * self-contained makes it easy to test and iterate on in isolation while
 * the other 8 phases are still being built. Once the full sequence is
 * working, revisit whether app.js should fetch once and pass the payload
 * to both charts.js and riskJourney.js instead of fetching twice.
 */
async function loadJourneyData() {
  const response = await fetch(JOURNEY_DATA_URL);
  if (!response.ok) {
    throw new Error(
      `[riskJourney] Failed to load ${JOURNEY_DATA_URL}: ${response.status} ${response.statusText}`
    );
  }
  const data = await response.json();
  if (!data.students || !data.summary) {
    throw new Error("[riskJourney] predictions.json missing required fields.");
  }
  return data;
}

// ---------------------------------------------------------------------------
// Phase 1 — Static dot grid
// ---------------------------------------------------------------------------

/**
 * Computes the SVG viewBox dimensions needed to fit `count` dots in a
 * grid of GRID_COLS columns, given DOT_SPACING between centers.
 *
 * @param {number} count - Total number of dots to lay out
 * @returns {{ width: number, height: number, rows: number }}
 */
function _computeGridDimensions(count) {
  const rows = Math.ceil(count / GRID_COLS);
  const width = GRID_MARGIN * 2 + (GRID_COLS - 1) * DOT_SPACING + DOT_RADIUS * 2;
  const height = GRID_MARGIN * 2 + (rows - 1) * DOT_SPACING + DOT_RADIUS * 2;
  return { width, height, rows };
}

/**
 * Computes the (x, y) center position for the dot at a given index,
 * assuming row-major left-to-right, top-to-bottom fill order.
 *
 * @param {number} index - Zero-based position in the student array
 * @returns {{ x: number, y: number }}
 */
function _gridPosition(index) {
  const col = index % GRID_COLS;
  const row = Math.floor(index / GRID_COLS);
  return {
    x: GRID_MARGIN + DOT_RADIUS + col * DOT_SPACING,
    y: GRID_MARGIN + DOT_RADIUS + row * DOT_SPACING,
  };
}

/**
 * Builds the SVG element and one <circle> per student, appending the
 * whole scene into the given container element.
 *
 * Phase 1: every circle is the same neutral color (matches the sketch's
 * Screen 1 — plain grey dots, no risk information shown yet). Each circle
 * gets a data-user-id attribute now so later phases (color coding, hover,
 * click) can select individual dots without rebuilding the DOM structure.
 *
 * @param {HTMLElement} container - Where to mount the SVG
 * @param {Array} students - Full student array from predictions.json
 */
function renderDotGrid(container, students) {
  const { width, height } = _computeGridDimensions(students.length);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "risk-journey__svg");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${students.length} students represented as individual dots`
  );

  students.forEach((student, index) => {
    const { x, y } = _gridPosition(index);
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", DOT_RADIUS);
    circle.setAttribute("class", "risk-journey__dot");
    circle.dataset.userId = student.user_id;
    circle.dataset.riskLabel = student.risk_label;
    svg.appendChild(circle);
  });

  container.innerHTML = "";
  container.appendChild(svg);

  return svg;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function bootRiskJourney() {
  const container = document.getElementById("risk-journey-canvas");
  if (!container) {
    // Section not yet added to index.html — safe no-op rather than an error,
    // since this file will be wired into the page incrementally.
    return;
  }

  try {
    const data = await loadJourneyData();
    renderDotGrid(container, data.students);
    console.log(
      `[riskJourney] Phase 1 rendered: ${data.students.length} dots.`
    );
  } catch (err) {
    console.error("[riskJourney]", err.message);
  }
}

window.addEventListener("load", bootRiskJourney);
