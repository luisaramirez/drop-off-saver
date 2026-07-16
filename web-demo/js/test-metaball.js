/**
 * test-metaball.js — Isolated Metaball Merge Proof-of-Concept
 * =============================================================
 * Standalone test script for test-metaball.html. NOT linked from the
 * production site, NOT imported by riskJourney.js or app.js.
 *
 * Purpose: prove out the SVG goo-filter + centroid-merge technique on
 * the REAL dataset size (700 students) before committing it to the
 * production scroll sequence. Two adjustable parameters (blur radius,
 * cluster tightness) let us find values that read as clean, distinct
 * blobs rather than a fuzzy smear or a sharp pile of overlapping circles.
 *
 * Once tuned, the winning constants get carried over into riskJourney.js
 * for the real Phase 4 integration — this file itself is not shipped.
 */

"use strict";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DATA_URL = "assets/predictions.json";
const VIEW_W = 800;
const VIEW_H = 500;
const MARGIN = 20;
const DOT_R = 5;

// Two fixed centroid points to merge toward. Positioned with enough
// separation that even the larger (healthy) cluster's blob radius won't
// visually collide with the smaller (at-risk) cluster's, across the
// range of "cluster tightness" values the slider allows.
const HEALTHY_CENTROID = { x: 220, y: 250 };
const AT_RISK_CENTROID = { x: 580, y: 250 };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let circles = [];
let healthyCount = 0;
let atRiskCount = 0;
let currentState = "grid";
let currentK = 6;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const dotsGroup = document.getElementById("dots-group");
const btnGrid = document.getElementById("btn-grid");
const btnMerge = document.getElementById("btn-merge");
const blurSlider = document.getElementById("blur-slider");
const blurValueEl = document.getElementById("blur-value");
const jitterSlider = document.getElementById("jitter-slider");
const jitterValueEl = document.getElementById("jitter-value");
const labelHealthy = document.getElementById("label-healthy");
const labelAtRisk = document.getElementById("label-at-risk");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _resolveCSSColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/**
 * Fetches predictions.json directly — this test page has no dependency
 * on app.js or riskJourney.js, deliberately, to keep iteration fast and
 * isolated from the production page's boot sequence.
 */
async function loadData() {
  const response = await fetch(DATA_URL);
  const data = await response.json();
  return data.students;
}

/**
 * Computes a roughly-square grid (respecting the SVG's aspect ratio)
 * sized to fit `count` dots — adapts automatically if the dataset size
 * changes, rather than assuming exactly 700.
 */
function computeGrid(count) {
  const aspect = VIEW_W / VIEW_H;
  const cols = Math.ceil(Math.sqrt(count * aspect));
  const rows = Math.ceil(count / cols);
  const usableW = VIEW_W - MARGIN * 2;
  const usableH = VIEW_H - MARGIN * 2;
  return {
    cols,
    rows,
    spacingX: cols > 1 ? usableW / (cols - 1) : 0,
    spacingY: rows > 1 ? usableH / (rows - 1) : 0,
  };
}

function gridPosition(index, grid) {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return {
    x: MARGIN + col * grid.spacingX,
    y: MARGIN + row * grid.spacingY,
  };
}

/**
 * Area-preserving cluster radius: a cluster's disk AREA should scale
 * with its student count (so 610 healthy students visually occupy a
 * proportionally larger blob than 90 at-risk students, not an equal-size
 * blob regardless of count) — so radius scales with sqrt(count), not
 * count directly. `k` is the tunable "tightness" constant from the
 * slider: larger k = looser/bigger blobs, smaller k = tighter/denser.
 */
function clusterRadius(count, k) {
  return Math.sqrt(count) * k;
}

/**
 * Renders one <circle> per student in grid formation, colored by a
 * SIMPLIFIED two-way split (healthy vs at-risk) rather than the full
 * three-tier HIGH/MEDIUM/LOW palette — this test is specifically about
 * proving the TWO-cluster merge, matching Screen 3's scope. The finer
 * three-way color distinction returns in later phases when the at-risk
 * cluster itself splits into profiles.
 *
 * Each circle is assigned a FIXED random jitter angle + radius fraction
 * at creation time (stored in dataset), rather than re-randomizing on
 * every merge. This means adjusting the tightness slider scales the same
 * underlying arrangement uniformly instead of the dots jumping to new
 * random spots on every tweak — makes A/B comparing tightness values
 * actually meaningful.
 */
function renderDots(students) {
  const grid = computeGrid(students.length);
  const svgNS = "http://www.w3.org/2000/svg";

  students.forEach((student, index) => {
    const pos = gridPosition(index, grid);
    const isAtRisk = student.risk_label !== "LOW";

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
    circle.setAttribute("r", DOT_R);
    circle.setAttribute(
      "fill",
      isAtRisk ? _resolveCSSColor("--c-red") : _resolveCSSColor("--c-green")
    );

    circle.dataset.riskLabel = student.risk_label;
    circle.dataset.isAtRisk = isAtRisk;
    circle.dataset.gridX = pos.x;
    circle.dataset.gridY = pos.y;
    circle.dataset.jitterAngle = Math.random() * Math.PI * 2;
    circle.dataset.jitterFraction = Math.sqrt(Math.random());

    dotsGroup.appendChild(circle);
    circles.push(circle);
  });
}

/**
 * Computes a circle's target (x, y) when merged, using its pre-assigned
 * fixed jitter angle/fraction scaled by the current cluster radius for
 * its group (healthy or at-risk).
 */
function targetPositionFor(circle, k) {
  const isAtRisk = circle.dataset.isAtRisk === "true";
  const centroid = isAtRisk ? AT_RISK_CENTROID : HEALTHY_CENTROID;
  const count = isAtRisk ? atRiskCount : healthyCount;
  const radius = clusterRadius(count, k);
  const angle = parseFloat(circle.dataset.jitterAngle);
  const frac = parseFloat(circle.dataset.jitterFraction);

  return {
    x: centroid.x + radius * frac * Math.cos(angle),
    y: centroid.y + radius * frac * Math.sin(angle),
  };
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Animates every circle to its merged cluster position.
 *
 * @param {boolean} animate - true for the full reveal transition (used on
 *   button click); false for a quick snap (used when live-adjusting the
 *   tightness slider while already merged, so feedback feels immediate
 *   rather than laggy).
 */
function applyMergedPositions(animate) {
  circles.forEach((circle) => {
    const pos = targetPositionFor(circle, currentK);
    gsap.to(circle, {
      attr: { cx: pos.x, cy: pos.y },
      duration: animate ? 1.2 : 0.3,
      ease: animate ? "power2.inOut" : "power1.out",
    });
  });

  labelHealthy.textContent = `${healthyCount} healthy`;
  labelAtRisk.textContent = `${atRiskCount} at risk`;
  gsap.to([labelHealthy, labelAtRisk], {
    opacity: 1,
    duration: 0.6,
    delay: animate ? 0.9 : 0,
  });
}

function applyGridPositions(animate) {
  circles.forEach((circle) => {
    gsap.to(circle, {
      attr: {
        cx: parseFloat(circle.dataset.gridX),
        cy: parseFloat(circle.dataset.gridY),
      },
      duration: animate ? 1.0 : 0.3,
      ease: "power2.inOut",
    });
  });

  gsap.to([labelHealthy, labelAtRisk], { opacity: 0, duration: 0.3 });
}

// ---------------------------------------------------------------------------
// Controls wiring
// ---------------------------------------------------------------------------

btnMerge.addEventListener("click", () => {
  currentState = "merged";
  btnMerge.classList.add("test-btn--active");
  btnGrid.classList.remove("test-btn--active");
  applyMergedPositions(true);
});

btnGrid.addEventListener("click", () => {
  currentState = "grid";
  btnGrid.classList.add("test-btn--active");
  btnMerge.classList.remove("test-btn--active");
  applyGridPositions(true);
});

blurSlider.addEventListener("input", (e) => {
  const value = e.target.value;
  blurValueEl.textContent = value;
  document.querySelector("#goo feGaussianBlur").setAttribute("stdDeviation", value);
});

jitterSlider.addEventListener("input", (e) => {
  currentK = parseFloat(e.target.value);
  jitterValueEl.textContent = currentK;
  if (currentState === "merged") {
    applyMergedPositions(false); // quick snap, live feedback while dragging
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  const students = await loadData();
  healthyCount = students.filter((s) => s.risk_label === "LOW").length;
  atRiskCount = students.length - healthyCount;
  renderDots(students);
  console.log(
    `[test-metaball] Rendered ${students.length} dots (${healthyCount} healthy, ${atRiskCount} at-risk).`
  );
}

window.addEventListener("load", boot);
