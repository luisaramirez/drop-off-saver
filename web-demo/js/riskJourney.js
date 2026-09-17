/**
 * riskJourney.js — Click-Driven Risk Narrative
 * ===============================================
 * Renders the entire opening narrative of the page — this section is the
 * FIRST thing on the page. The hero, signal, distribution, and profiles
 * sections that used to exist separately were removed; their content now
 * lives here, as copy panels shown one at a time across five steps.
 *
 * CLICK-DRIVEN, not scroll-driven. This is a deliberate architecture
 * change from an earlier scroll-scrubbed, pinned version: tying step
 * navigation to scroll gesture precision made it hard to move backward
 * to a specific step, or jump directly to a distant one, without
 * carefully scrubbing back and forth. A fixed, always-visible, clickable
 * progress bar solves both problems directly — any step is one click
 * away, forward or backward, in any order.
 *
 * Two-phase behavior:
 *   1. LOAD-TRIGGERED ENTRANCE (animateEntranceOnLoad) — plays the
 *      instant the page loads: intro copy settles in, the student count
 *      animates up from 0, dots grow in from radius 0. This establishes
 *      Step 1's visual state — no interaction needed to see it.
 *   2. STEP NAVIGATION (initStepNavigation / goToStep) — the fixed
 *      left-side progress bar is the ONLY way to move between steps.
 *      Clicking a step number tweens every dot directly from wherever
 *      it currently is to that step's target state (position, color,
 *      opacity, goo filter on/off), using plain gsap.to() calls — no
 *      ScrollTrigger, no scroll dependency anywhere in this section.
 *
 * Kept as a SEPARATE module from app.js on purpose. app.js owns page TEXT
 * content — including populating what these copy panels actually say
 * (student counts, signal features, thresholds, demographics) — while
 * this module owns the SVG scene and WHEN each panel becomes visible.
 * Content and timing are different concerns with different failure
 * modes; mixing them would make either harder to reason about.
 *
 * CURRENT SCOPE:
 *   - Fetch predictions.json (independently of app.js's fetch — see note
 *     in loadJourneyData() below)
 *   - Lay out one <circle> per student in a grid inside an SVG canvas,
 *     each pre-assigned a fixed jitter angle/fraction reused across every
 *     later clustering stage, and a profileLabel sourced directly from
 *     profiler.py's real K-Means output (renderDotGrid)
 *   - Entrance (animateEntranceOnLoad): intro panel copy + student count
 *     + dots all animate in together on load, establishing Step 1
 *   - Five discrete steps (goToStep), each with a precomputed target
 *     state for every dot — no scroll timeline, just direct tweens from
 *     current state to target state on click:
 *       Step 1 (Early Warning System) — grid positions, grey fill
 *       Step 2 (The Signal)           — grid positions, risk-tier color
 *       Step 3 (Risk Distribution)    — merged into 2 clusters, goo ON
 *       Step 4 (Risk Focus)           — healthy hidden, at-risk red + centered, goo ON
 *       Step 5 (Risk Profiles)        — 3 resolved circles, goo OFF, cluster labels visible
 *   - The goo filter (SVG defs built programmatically in renderDotGrid)
 *     is toggled on/off via setGooFilterActive, NEVER applied
 *     permanently — proven necessary via test-metaball.html, where a
 *     permanently-applied filter softened every circle's edges even in
 *     the spread-out grid state where dots never overlap
 *   - Cluster centroids/radii/blur values are all either derived from the
 *     live viewBox dimensions or tuned via test-metaball.html's sliders
 *     (CLUSTER_TIGHTNESS_K = 4, stdDeviation = 3.5) — nothing here was
 *     guessed blind
 *   - Colors read live from CSS custom properties rather than duplicating
 *     hex values in JS — main.css stays the single source of truth for
 *     the palette, the same principle already applied to dataset numbers
 *   - Clicking one of the three resolved circles at Step 5 shows a detail
 *     panel (HIGH/MEDIUM breakdown + suggested strategy) and de-emphasizes
 *     the other two — navigating to any other step via the progress bar
 *     resets this selection automatically
 *   - Graceful degradation: entrance only needs GSAP core; if GSAP itself
 *     is unavailable, or the user has requested reduced motion, dots
 *     render directly in their final state (full size, correctly colored
 *     via the CSS attribute selectors from Phase 2) — no motion is
 *     required for the page to be correct
 *
 * Not yet built:
 *   Phase 8 — click → student-level drill-down grid
 *   Phase 9 — mobile pass
 */

"use strict";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const JOURNEY_DATA_URL = "assets/predictions.json";

// Grid layout constants. These are tuned for a comfortable dot radius
// inside the SVG viewBox — revisit if N_STUDENTS in generator.py changes
// meaningfully.
const GRID_COLS = 25;
const DOT_RADIUS = 6;
const DOT_SPACING = 18;            // center-to-center distance
const GRID_MARGIN = 20;            // padding inside the SVG viewBox

// Cluster merge constants — proven via the isolated test page
// (test-metaball.html) before being carried over here. Centroids are
// expressed as FRACTIONS of the SVG viewBox's actual width/height, not
// fixed pixel values, so the merge target positions stay correct
// regardless of how many students are in the dataset (which changes the
// viewBox's computed dimensions — see _computeGridDimensions).
const MERGE_CENTROID_HEALTHY_X_FRAC = 0.28;
const MERGE_CENTROID_AT_RISK_X_FRAC = 0.72;
const MERGE_CENTROID_Y_FRAC = 0.5;

// At Step 4, the at-risk blob re-centers here (0.5 = canvas center)
// rather than staying at its off-center Step 3 position (0.72) —
// visually, a single remaining blob sitting off to one side reads as
// unbalanced/incidental; centering it signals "this is now the subject."
const ISOLATE_CENTROID_X_FRAC = 0.5;

// Cluster "tightness" — how densely packed each blob is. Tuned to 4 via
// test-metaball.html's live slider; smaller = tighter/denser blobs,
// larger = looser/more spread out. See _clusterRadius: radius scales
// with sqrt(count), not count directly, so blob AREA (not just radius)
// stays proportional to student count — a cluster with 6x more students
// gets roughly 6x more area, not 6x the radius.
const CLUSTER_TIGHTNESS_K = 4;

// Profile split constants — Step 5's three centroids, spread across the
// FULL canvas width (the healthy cluster is long gone by Step 5, so that
// space is free to use). Order (left to right) and colors match the SAME
// profile identity used everywhere else on the page (roster badges,
// profile breakdown chart) — profiler.py assigns these labels, this is
// just reusing them, never inventing a new mapping here.
const PROFILE_CENTROID_FRACS = {
  "Time-Constrained": { x: 0.2, y: 0.5 },
  "Disengaged Learner": { x: 0.5, y: 0.5 },
  "Quiet Decliner": { x: 0.8, y: 0.5 },
};

const PROFILE_COLOR_VARS = {
  "Time-Constrained": "--c-violet",
  "Disengaged Learner": "--c-cyan",
  "Quiet Decliner": "--c-rose",
};

// Vertical clearance between a blob's top edge and its label's first
// text line. The label is TWO lines (count + name, see
// _createProfileLabels), so this needs to clear the ENTIRE two-line
// block, not just one line — too small a value here was the original
// cause of the name line nearly touching/overlapping the blob.
const PROFILE_LABEL_CLEARANCE = 34;

// Click-to-focus interaction (Step 5 only). The SELECTED profile's
// bubble fades out entirely rather than repositioning — its identity is
// already fully carried by the detail panel (name, counts, strategy,
// all in its own color), so keeping a large redundant circle on screen
// would only compete with that panel and risk overlapping it.
//
// The two remaining bubbles shrink by this factor and move to the
// upper-right. Their exact x positions are NOT fixed constants — they're
// computed at selection time from the bubbles' actual radii and label
// widths (see selectProfile), since fixed fractions can't guarantee
// non-overlap across every combination of which profile is selected and
// how the dataset's profile counts happen to fall.
const FOCUSED_OTHER_SCALE = 0.55;

// Shared tween duration for step-to-step transitions — deliberately the
// SAME regardless of which two steps are involved (adjacent or distant),
// so navigation feels predictable rather than variable-length depending
// on "how far" a jump is.
const STEP_TRANSITION_DURATION = 1.1;

// ---------------------------------------------------------------------------
// Data ingestion
// ---------------------------------------------------------------------------

/**
 * Fetches predictions.json independently of app.js.
 *
 * This duplicates app.js's loadPredictions() fetch call. That's a
 * deliberate, temporary choice: keeping riskJourney.js fully self-
 * contained makes it easy to test and iterate on in isolation. Once the
 * full sequence is settled, revisit whether app.js should fetch once and
 * pass the payload to riskJourney.js instead of fetching twice.
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
// Dot grid construction
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
 * Every circle carries data-user-id and data-risk-label attributes, plus
 * data-jitter-angle and data-jitter-fraction — a FIXED random position
 * within a future cluster blob, assigned once at creation rather than
 * re-randomized every time a step transition runs. This is the same
 * approach proven in test-metaball.html: it means the target position
 * for any given circle at any given step is deterministic once computed,
 * so navigating back and forth between steps doesn't reshuffle a blob's
 * internal arrangement.
 *
 * All circles are appended to a dedicated <g> (dotsGroup), not directly
 * to the <svg> root — this is what lets the goo filter be toggled onto
 * just the dots (via setGooFilterActive) without also affecting other
 * SVG content added later (labels, resolved circles).
 *
 * The risk-tier fill color itself is applied by CSS attribute selectors
 * (main.css), not set here — this function only lays out geometry and
 * identity. The animation functions below layer motion on top of that
 * CSS-driven final state; if GSAP is ever unavailable, this function
 * alone still produces a fully correct, fully colored static grid.
 *
 * @param {HTMLElement} container - Where to mount the SVG
 * @param {Array} students - Full student array from predictions.json
 * @returns {{ svg: SVGElement, dotsGroup: SVGGElement }}
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

  // Goo filter defs — built programmatically since this whole SVG is
  // constructed at runtime. Values (stdDeviation, the color matrix) are
  // the exact ones tuned via test-metaball.html's live sliders. NOT
  // applied to anything by default — see setGooFilterActive.
  const defs = document.createElementNS(svgNS, "defs");
  const filter = document.createElementNS(svgNS, "filter");
  filter.setAttribute("id", "risk-journey-goo");
  const blur = document.createElementNS(svgNS, "feGaussianBlur");
  blur.setAttribute("in", "SourceGraphic");
  blur.setAttribute("stdDeviation", "3.5");
  blur.setAttribute("result", "blur");
  const colorMatrix = document.createElementNS(svgNS, "feColorMatrix");
  colorMatrix.setAttribute("in", "blur");
  colorMatrix.setAttribute("mode", "matrix");
  colorMatrix.setAttribute(
    "values",
    "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
  );
  colorMatrix.setAttribute("result", "goo");
  const composite = document.createElementNS(svgNS, "feComposite");
  composite.setAttribute("in", "SourceGraphic");
  composite.setAttribute("in2", "goo");
  composite.setAttribute("operator", "atop");
  filter.appendChild(blur);
  filter.appendChild(colorMatrix);
  filter.appendChild(composite);
  defs.appendChild(filter);
  svg.appendChild(defs);

  const dotsGroup = document.createElementNS(svgNS, "g");
  dotsGroup.setAttribute("id", "risk-journey-dots-group");
  svg.appendChild(dotsGroup);

  students.forEach((student, index) => {
    const { x, y } = _gridPosition(index);
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", DOT_RADIUS);
    circle.setAttribute("class", "risk-journey__dot");
    circle.dataset.userId = student.user_id;
    circle.dataset.riskLabel = student.risk_label;
    // Sourced directly from profiler.py's real K-Means output, never
    // reclustered or reinterpreted client-side. Empty string for safe
    // students (risk_profile is null for them) — irrelevant for those
    // circles since they never take part in the profile-split step.
    circle.dataset.profileLabel = student.risk_profile ? student.risk_profile.label : "";
    circle.dataset.gridX = x;
    circle.dataset.gridY = y;
    circle.dataset.jitterAngle = Math.random() * Math.PI * 2;
    circle.dataset.jitterFraction = Math.sqrt(Math.random());
    dotsGroup.appendChild(circle);
  });

  container.innerHTML = "";
  container.appendChild(svg);

  return { svg, dotsGroup };
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

/**
 * Respects the user's OS-level motion preference. If true, we skip all
 * GSAP-driven entrance/step animation and let the dots render directly
 * in their final CSS-driven state (full size, correctly colored) — no
 * motion is ever required for the page to be correct, only for it to be
 * animated.
 */
function _prefersReducedMotion() {
  return (
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Reads a color value directly from a CSS custom property on :root.
 *
 * This exists so riskJourney.js never duplicates a hex value that also
 * lives in main.css. GSAP needs a concrete, interpolatable color to
 * animate toward — it can't tween a raw "var(--c-red)" string — so we
 * resolve the variable once, at animation setup time, via the browser's
 * own computed style. If the design tokens in main.css ever change, this
 * picks up the new colors automatically with no matching edit required
 * here, the same "single source of truth" principle already applied to
 * dataset numbers in app.js.
 *
 * @param {string} varName - CSS custom property name, e.g. "--c-red"
 * @returns {string} Resolved color value (e.g. "#e8453c")
 */
function _resolveCSSColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/**
 * Computes the two cluster centroid points (healthy, at-risk) as actual
 * pixel coordinates within the SVG's viewBox. Expressed via the
 * MERGE_CENTROID_*_FRAC constants (fractions of width/height) rather
 * than fixed pixels, so these stay correctly positioned regardless of
 * the viewBox's computed dimensions — which themselves depend on how
 * many students are in the dataset (see _computeGridDimensions).
 *
 * @param {number} viewWidth - The SVG viewBox's width
 * @param {number} viewHeight - The SVG viewBox's height
 * @returns {{ healthy: {x,y}, atRisk: {x,y} }}
 */
function _computeClusterCentroids(viewWidth, viewHeight) {
  return {
    healthy: {
      x: viewWidth * MERGE_CENTROID_HEALTHY_X_FRAC,
      y: viewHeight * MERGE_CENTROID_Y_FRAC,
    },
    atRisk: {
      x: viewWidth * MERGE_CENTROID_AT_RISK_X_FRAC,
      y: viewHeight * MERGE_CENTROID_Y_FRAC,
    },
  };
}

/**
 * Area-preserving cluster radius: a cluster's disk AREA should scale
 * with its student count (so a cluster with 6x more students occupies
 * roughly 6x more area, not 6x the radius), so radius scales with
 * sqrt(count), not count directly. Proven via test-metaball.html.
 *
 * @param {number} count - Number of students in this cluster
 * @param {number} k - Tightness constant (CLUSTER_TIGHTNESS_K)
 */
function _clusterRadius(count, k) {
  return Math.sqrt(count) * k;
}

/**
 * Toggles the goo filter on/off the dots group.
 *
 * Never applied permanently — see the finding recorded in
 * test-metaball.js's header docstring. Applying it constantly softens
 * every circle's edges even in the grid/spread-out state, where dots
 * never overlap. The filter should exist only while circles are close
 * enough to actually blend into each other.
 *
 * @param {SVGGElement} dotsGroup
 * @param {boolean} active
 */
function setGooFilterActive(dotsGroup, active) {
  if (active) {
    dotsGroup.setAttribute("filter", "url(#risk-journey-goo)");
  } else {
    dotsGroup.removeAttribute("filter");
  }
}

/**
 * Updates the fixed left-side progress bar: which step marker is
 * "active" (current), which are "complete" (already passed), and how
 * tall the connecting fill line is. Unlike an earlier scroll-driven
 * version, "complete" here just means "a lower step number than the
 * current one" — there's no notion of scroll progress anymore, since
 * navigation is a direct jump, not a continuous scrub.
 *
 * @param {number} step - Current step number (1-5)
 */
function updateProgressBar(step) {
  document.querySelectorAll(".risk-journey__progress-step").forEach((el) => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.toggle("risk-journey__progress-step--active", s === step);
    el.classList.toggle("risk-journey__progress-step--complete", s < step);
  });

  const fill = document.getElementById("risk-journey-progress-fill");
  if (fill) {
    const progress = (step - 1) / 4; // step 1 -> 0%, step 5 -> 100%
    gsap.to(fill, { height: `${progress * 100}%`, duration: 0.6, ease: "power2.out" });
  }
}

/**
 * Enables/disables the five progress-bar step buttons during a step
 * transition. Sets the `disabled` property (not just a CSS class) so the
 * browser itself refuses the click — belt-and-braces alongside
 * goToStep's own isTransitioning guard, and it gets keyboard/screen
 * reader semantics right for free rather than only blocking mouse input.
 * The matching CSS class drives the visual dimmed/not-allowed state.
 *
 * @param {boolean} enabled
 */
function _setStepButtonsEnabled(enabled) {
  document.querySelectorAll(".risk-journey__progress-step").forEach((el) => {
    el.disabled = !enabled;
    el.classList.toggle("risk-journey__progress-step--locked", !enabled);
  });
}

/**
 * Computes a circle's target (x, y) when merged into its 2-cluster
 * group (Step 3), using its pre-assigned fixed jitter angle/fraction
 * (set once in renderDotGrid) scaled by that cluster's current radius.
 *
 * @param {SVGElement} circle
 * @param {{healthy, atRisk}} centroids
 * @param {number} healthyCount
 * @param {number} atRiskCount
 * @param {number} k - Tightness constant
 */
function _targetMergePosition(circle, centroids, healthyCount, atRiskCount, k) {
  const isAtRisk = circle.dataset.riskLabel !== "LOW";
  const centroid = isAtRisk ? centroids.atRisk : centroids.healthy;
  const count = isAtRisk ? atRiskCount : healthyCount;
  const radius = _clusterRadius(count, k);
  const angle = parseFloat(circle.dataset.jitterAngle);
  const frac = parseFloat(circle.dataset.jitterFraction);

  return {
    x: centroid.x + radius * frac * Math.cos(angle),
    y: centroid.y + radius * frac * Math.sin(angle),
  };
}

/**
 * Computes the three profile centroid points as actual pixel coordinates,
 * evenly spread across the FULL viewBox width — by Step 5 the healthy
 * cluster is long gone, so that space is free to use, rather than
 * cramming three blobs into the narrower region the single at-risk blob
 * occupied at Step 4.
 *
 * @param {number} viewWidth
 * @param {number} viewHeight
 * @returns {{ [profileLabel: string]: {x, y} }}
 */
function _computeProfileCentroids(viewWidth, viewHeight) {
  const centroids = {};
  Object.keys(PROFILE_CENTROID_FRACS).forEach((label) => {
    const frac = PROFILE_CENTROID_FRACS[label];
    centroids[label] = { x: viewWidth * frac.x, y: viewHeight * frac.y };
  });
  return centroids;
}

/**
 * Computes an at-risk circle's target (x, y) at Step 5, reusing the SAME
 * fixed jitter angle/fraction assigned back in renderDotGrid — each
 * circle keeps one stable random "personality" reused across every
 * step, rather than being re-randomized on every navigation.
 *
 * @param {SVGElement} circle
 * @param {object} centroids - From _computeProfileCentroids
 * @param {object} profileBreakdown - data.summary.risk_profile_breakdown
 * @param {number} k - Tightness constant
 */
function _targetProfilePosition(circle, centroids, profileBreakdown, k) {
  const label = circle.dataset.profileLabel;
  const centroid = centroids[label];
  if (!centroid) return null; // defensive: unexpected/missing profile label

  const count = profileBreakdown[label] || 1;
  const radius = _clusterRadius(count, k);
  const angle = parseFloat(circle.dataset.jitterAngle);
  const frac = parseFloat(circle.dataset.jitterFraction);

  return {
    x: centroid.x + radius * frac * Math.cos(angle),
    y: centroid.y + radius * frac * Math.sin(angle),
  };
}

/**
 * Creates one <text> label per profile (count + name, two lines via
 * tspans), positioned above where that profile's resolved circle sits —
 * offset upward by that specific circle's own radius, so the label
 * clears it regardless of how large or small that profile's cluster is.
 *
 * Appended directly to the SVG root (not the dots group), since labels
 * should never be affected by the goo filter applied to dotsGroup.
 * Starts at opacity 0 — goToStep(5) fades them in.
 *
 * @param {SVGElement} svg
 * @param {object} centroids - From _computeProfileCentroids
 * @param {object} profileBreakdown - data.summary.risk_profile_breakdown
 * @param {number} k - Tightness constant
 * @returns {SVGTextElement[]}
 */
function _createProfileLabels(svg, centroids, profileBreakdown, k) {
  const svgNS = "http://www.w3.org/2000/svg";
  const labels = [];

  Object.keys(PROFILE_CENTROID_FRACS).forEach((profileLabel) => {
    const centroid = centroids[profileLabel];
    const count = profileBreakdown[profileLabel] || 0;
    const radius = _clusterRadius(count, k);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("class", "risk-journey__cluster-label");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("x", centroid.x);
    text.setAttribute("y", centroid.y - radius - PROFILE_LABEL_CLEARANCE);
    text.style.opacity = "0";

    const countSpan = document.createElementNS(svgNS, "tspan");
    countSpan.setAttribute("class", "risk-journey__cluster-label-count");
    countSpan.setAttribute("x", centroid.x);
    countSpan.textContent = String(count);

    const nameSpan = document.createElementNS(svgNS, "tspan");
    nameSpan.setAttribute("class", "risk-journey__cluster-label-name");
    nameSpan.setAttribute("x", centroid.x);
    nameSpan.setAttribute("dy", "16");
    nameSpan.textContent = profileLabel;

    text.appendChild(countSpan);
    text.appendChild(nameSpan);
    svg.appendChild(text);
    labels.push(text);
  });

  return labels;
}

/**
 * Creates one solid, clean <circle> per profile — NOT part of dotsGroup,
 * so the goo filter never applies to these regardless of dotsGroup's
 * filter state. This is Step 5's destination shape: many small
 * individual dots fade out, these three fade in at the exact same
 * centroid + radius, so the transition reads as consolidation rather
 * than a jarring size/position jump.
 *
 * Starts at opacity 0 — goToStep(5) fades them in.
 *
 * @param {SVGElement} svg
 * @param {object} centroids - From _computeProfileCentroids
 * @param {object} profileBreakdown - data.summary.risk_profile_breakdown
 * @param {number} k - Tightness constant
 * @param {object} colorMap - profileLabel -> resolved CSS color string
 * @returns {{ [profileLabel: string]: SVGCircleElement }}
 */
function _createResolvedCircles(svg, centroids, profileBreakdown, k, colorMap) {
  const svgNS = "http://www.w3.org/2000/svg";
  const circles = {};

  Object.keys(PROFILE_CENTROID_FRACS).forEach((profileLabel) => {
    const centroid = centroids[profileLabel];
    const count = profileBreakdown[profileLabel] || 0;
    const radius = _clusterRadius(count, k);

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("class", "risk-journey__resolved-circle");
    circle.setAttribute("cx", centroid.x);
    circle.setAttribute("cy", centroid.y);
    circle.setAttribute("r", radius);
    circle.setAttribute("fill", colorMap[profileLabel]);
    circle.dataset.profileLabel = profileLabel;
    circle.style.opacity = "0";

    svg.appendChild(circle);
    circles[profileLabel] = circle;
  });

  return circles;
}

/**
 * Animates a profile label (count+name text) to a new position, scaling
 * its clearance to a given radius and fading its opacity. Handles the
 * text element's OWN x/y attributes AND its child tspans' x attributes —
 * SVG multi-line text via tspans needs both updated to stay centered,
 * since text-anchor:middle only centers relative to each tspan's own x.
 *
 * @param {SVGTextElement} textEl
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} opacity
 * @param {number} duration
 */
function _animateLabelTo(textEl, cx, cy, radius, opacity, duration) {
  if (!textEl) return;
  gsap.to(textEl, {
    duration,
    ease: "power2.inOut",
    opacity,
    attr: { x: cx, y: cy - radius - PROFILE_LABEL_CLEARANCE },
  });
  Array.from(textEl.children).forEach((tspan) => {
    gsap.to(tspan, { duration, ease: "power2.inOut", attr: { x: cx } });
  });
}

/**
 * Entrance — plays automatically the instant the page loads: the intro
 * panel's label, heading, and body settle in with a slight stagger, the
 * student count animates up from 0, and dots grow in from radius 0.
 * Establishes Step 1's visual state.
 *
 * Not tied to any interaction — plays once, unconditionally, on load.
 *
 * The student count element (#risk-journey-student-count) is OWNED by
 * this function, not app.js's populateNarrativeCopy — app.js still
 * fetches and would otherwise write the same element, which risked a
 * race (whichever fetch resolved second would stomp the other's write,
 * or worse, restart the animated count-up after it had already settled).
 * Giving this element exactly one writer removes that race structurally.
 *
 * @param {SVGElement[]} circles - The <circle> elements to grow in
 * @param {object} data - Full predictions.json payload (for student count)
 */
function animateEntranceOnLoad(circles, data) {
  const introPanel = document.getElementById("risk-journey-intro");
  const countEl = document.getElementById("risk-journey-student-count");

  const label = introPanel ? introPanel.querySelector(".section__label") : null;
  const heading = introPanel ? introPanel.querySelector(".section__heading") : null;
  const body = introPanel ? introPanel.querySelector(".section__body") : null;

  gsap.set(circles, { attr: { r: 0 } });
  // Explicitly set grey fill. Without this, the CSS attribute selectors
  // in main.css (.risk-journey__dot[data-risk-label="HIGH"] etc.) apply
  // immediately and the dots render ALREADY COLORED on first load —
  // i.e. visually in Step 2's state while the progress bar says Step 1.
  // Setting fill inline here wins over those selectors, so the grid
  // genuinely starts grey and only colors when Step 2 is clicked. (Those
  // CSS selectors still matter as the no-JS/reduced-motion fallback, so
  // they're deliberately left in place rather than removed.)
  gsap.set(circles, { fill: _resolveCSSColor("--c-border") });
  if (label) gsap.set(label, { opacity: 0, y: 10 });
  if (heading) gsap.set(heading, { opacity: 0, y: 16 });
  if (body) gsap.set(body, { opacity: 0, y: 16 });

  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

  if (label) tl.to(label, { opacity: 1, y: 0, duration: 0.6 });
  if (heading) tl.to(heading, { opacity: 1, y: 0, duration: 0.7 }, "-=0.35");
  if (body) tl.to(body, { opacity: 1, y: 0, duration: 0.6 }, "-=0.45");

  if (countEl) {
    const counter = { val: 0 };
    const target = data.summary.total_students;
    tl.to(
      counter,
      {
        val: target,
        duration: 1.1,
        ease: "power2.out",
        onUpdate() {
          countEl.textContent = Math.round(counter.val).toLocaleString();
        },
      },
      "-=0.5"
    );
  }

  tl.to(
    circles,
    {
      attr: { r: DOT_RADIUS },
      duration: 0.9,
      ease: "power2.out",
      stagger: { amount: 1.0, from: "random" },
    },
    "-=0.4"
  );
}

/**
 * Sets up click-driven navigation across the five steps, plus the
 * Step-5-only detail panel interaction on the three resolved circles.
 * Both live in ONE function (rather than being split, as an earlier
 * version did) specifically so they can share state directly via
 * closures — navigating away from Step 5 needs to reset any active
 * profile selection, which is far simpler when both concerns already
 * share the same `currentStep`/`selectedProfile` variables rather than
 * needing to coordinate across two independent modules.
 *
 * @param {SVGGElement} dotsGroup - The <g> wrapping all dot circles
 * @param {SVGElement[]} circles - The <circle> elements to animate
 * @param {object} data - Full predictions.json payload
 */
function initStepNavigation(dotsGroup, circles, data) {
  const svg = dotsGroup.ownerSVGElement;
  const viewBox = svg.viewBox.baseVal;

  const greyColor = _resolveCSSColor("--c-border");
  const redColor = _resolveCSSColor("--c-red");
  const riskColorMap = {
    HIGH: _resolveCSSColor("--c-red"),
    MEDIUM: _resolveCSSColor("--c-yellow"),
    LOW: _resolveCSSColor("--c-green"),
  };
  const profileColorMap = {};
  Object.keys(PROFILE_COLOR_VARS).forEach((label) => {
    profileColorMap[label] = _resolveCSSColor(PROFILE_COLOR_VARS[label]);
  });

  const healthyCircles = Array.from(circles).filter((c) => c.dataset.riskLabel === "LOW");
  const atRiskCircles = Array.from(circles).filter((c) => c.dataset.riskLabel !== "LOW");
  const healthyCount = data.summary.safe_count;
  const atRiskCount = data.summary.at_risk_count;
  const profileBreakdown = data.summary.risk_profile_breakdown || {};

  const centroids = _computeClusterCentroids(viewBox.width, viewBox.height);
  const profileCentroids = _computeProfileCentroids(viewBox.width, viewBox.height);

  // Precompute every circle's target position for each clustering stage
  // ONCE (not per-click) — cheap, and keeps goToStep()'s tweens simple
  // dataset lookups rather than recomputing jitter math on every
  // navigation.
  circles.forEach((circle) => {
    const mergePos = _targetMergePosition(circle, centroids, healthyCount, atRiskCount, CLUSTER_TIGHTNESS_K);
    circle.dataset.mergeTargetX = mergePos.x;
    circle.dataset.mergeTargetY = mergePos.y;
  });

  const isolateCentroidX = viewBox.width * ISOLATE_CENTROID_X_FRAC;
  const isolateDeltaX = isolateCentroidX - centroids.atRisk.x;
  atRiskCircles.forEach((circle) => {
    circle.dataset.isolateTargetX = parseFloat(circle.dataset.mergeTargetX) + isolateDeltaX;
    circle.dataset.isolateTargetY = circle.dataset.mergeTargetY;
  });

  atRiskCircles.forEach((circle) => {
    const pos = _targetProfilePosition(circle, profileCentroids, profileBreakdown, CLUSTER_TIGHTNESS_K);
    if (pos) {
      circle.dataset.profileTargetX = pos.x;
      circle.dataset.profileTargetY = pos.y;
    }
  });

  const profileLabels = _createProfileLabels(svg, profileCentroids, profileBreakdown, CLUSTER_TIGHTNESS_K);
  const resolvedCircles = _createResolvedCircles(svg, profileCentroids, profileBreakdown, CLUSTER_TIGHTNESS_K, profileColorMap);
  const profileLabelElements = {};
  Object.keys(PROFILE_CENTROID_FRACS).forEach((label, i) => {
    profileLabelElements[label] = profileLabels[i];
  });

  const baseRadii = {};
  Object.keys(PROFILE_CENTROID_FRACS).forEach((label) => {
    baseRadii[label] = _clusterRadius(profileBreakdown[label] || 0, CLUSTER_TIGHTNESS_K);
  });

  const panels = {
    1: document.getElementById("risk-journey-intro"),
    2: document.getElementById("risk-journey-signal"),
    3: document.getElementById("risk-journey-thresholds"),
    4: document.getElementById("risk-journey-profiling"),
    5: document.getElementById("risk-journey-demographics"),
  };
  const detailPanel = document.getElementById("risk-journey-detail");
  const completionBar = document.getElementById("risk-journey-completion");
  const detailNameEl = document.getElementById("risk-journey-detail-name");
  const detailHighEl = document.getElementById("risk-journey-detail-high");
  const detailMediumEl = document.getElementById("risk-journey-detail-medium");
  const detailStrategyEl = document.getElementById("risk-journey-detail-strategy");

  let currentStep = 1;
  let selectedProfile = null;
  // Guards against rapid successive clicks on the progress bar. Without
  // it, a second click mid-transition starts a new set of tweens while
  // the previous set is still running — both target the same elements,
  // so they fight, and panels/labels end up visibly overlapping in
  // half-finished states. Set true when a transition starts, cleared
  // when it finishes (see goToStep).
  let isTransitioning = false;

  /** Crossfades to the target step's copy panel, hiding all others. */
  function showPanel(step) {
    Object.keys(panels).forEach((key) => {
      const panel = panels[key];
      if (!panel) return;
      gsap.to(panel, { opacity: Number(key) === step ? 1 : 0, duration: 0.4 });
    });
  }

  /**
   * Counts HIGH vs MEDIUM tier students within one profile — computed
   * fresh per click from the real student array, never a precomputed or
   * hardcoded split.
   */
  function _computeHighMediumSplit(profileLabel) {
    let high = 0;
    let medium = 0;
    data.students.forEach((s) => {
      if (s.risk_profile && s.risk_profile.label === profileLabel) {
        if (s.risk_label === "HIGH") high++;
        else if (s.risk_label === "MEDIUM") medium++;
      }
    });
    return { high, medium };
  }

  /** Restores all three resolved circles + labels to their Step 5 base layout. */
  function resetProfileSelection() {
    if (!selectedProfile) return;

    Object.keys(PROFILE_CENTROID_FRACS).forEach((label) => {
      const centroid = profileCentroids[label];
      const radius = baseRadii[label];

      gsap.to(resolvedCircles[label], {
        duration: 0.6,
        ease: "power2.inOut",
        // opacity must be restored explicitly: selectProfile now fades
        // the selected bubble fully out, so without this it would stay
        // invisible after deselecting.
        opacity: 1,
        attr: { cx: centroid.x, cy: centroid.y, r: radius },
      });
      resolvedCircles[label].classList.remove("risk-journey__resolved-circle--selected");
      _animateLabelTo(profileLabelElements[label], centroid.x, centroid.y, radius, 1, 0.6);
    });

    if (detailPanel) {
      detailPanel.style.pointerEvents = "none";
      gsap.to(detailPanel, { opacity: 0, duration: 0.3 });
    }

    selectedProfile = null;
  }

  /** Focuses one profile: fades its bubble out, repositions the other two. */
  function selectProfile(label) {
    selectedProfile = label;

    // The selected bubble fades away entirely rather than moving and
    // growing. Its identity is already fully represented by the detail
    // panel (name heading, counts, strategy, all in its own color), so
    // keeping a large redundant circle on screen only competes with that
    // panel for attention and risks overlapping it.
    gsap.to(resolvedCircles[label], { opacity: 0, duration: 0.45, ease: "power2.inOut" });
    resolvedCircles[label].classList.add("risk-journey__resolved-circle--selected");
    gsap.to(profileLabelElements[label], { opacity: 0, duration: 0.35 });

    // The two remaining bubbles sit side by side in the upper-right.
    // Their x positions are computed from their ACTUAL radii rather than
    // fixed viewBox fractions: with fixed fractions, two large profiles
    // (or a narrow viewBox) could overlap each other, and their labels
    // — which are wider than the bubbles themselves — would collide well
    // before the circles did. Spacing off real widths guarantees
    // separation regardless of which profile is selected or how the
    // dataset's profile counts shift.
    const otherLabels = Object.keys(PROFILE_CENTROID_FRACS).filter((l) => l !== label);
    const otherRadii = otherLabels.map((l) => baseRadii[l] * FOCUSED_OTHER_SCALE);
    // Label text is the real constraint on spacing, not circle width —
    // a 12px-radius bubble can carry a "DISENGAGED LEARNER" label several
    // times wider than itself.
    const labelHalfWidth = 62;
    const slotHalfWidth = Math.max(otherRadii[0], otherRadii[1], labelHalfWidth);
    const gap = 16;
    const totalWidth = slotHalfWidth * 4 + gap;
    const rightEdge = viewBox.width * 0.97;
    const firstCx = rightEdge - totalWidth + slotHalfWidth;
    const otherCy = viewBox.height * 0.16;

    otherLabels.forEach((otherLabel, i) => {
      const cx = firstCx + i * (slotHalfWidth * 2 + gap);
      const radius = otherRadii[i];

      gsap.to(resolvedCircles[otherLabel], {
        duration: 0.7,
        ease: "power2.inOut",
        opacity: 1,
        attr: { cx, cy: otherCy, r: radius },
      });
      resolvedCircles[otherLabel].classList.remove("risk-journey__resolved-circle--selected");
      _animateLabelTo(profileLabelElements[otherLabel], cx, otherCy, radius, 1, 0.7);
    });

    const { high, medium } = _computeHighMediumSplit(label);
    const sampleStudent = data.students.find(
      (s) => s.risk_profile && s.risk_profile.label === label
    );

    if (detailNameEl) detailNameEl.textContent = label;
    if (detailHighEl) detailHighEl.textContent = high;
    if (detailMediumEl) detailMediumEl.textContent = medium;
    if (detailStrategyEl) {
      detailStrategyEl.textContent = sampleStudent ? sampleStudent.risk_profile.suggested_strategy : "";
    }

    // Single write, three consumers: the button background, the profile
    // name heading, and the "Suggested strategy" label all reference
    // var(--profile-accent-color) in CSS (main.css) — setting it once
    // here means those three can never disagree with each other.
    if (detailPanel) {
      detailPanel.style.setProperty("--profile-accent-color", profileColorMap[label]);
      detailPanel.style.pointerEvents = "auto";
      gsap.to(detailPanel, { opacity: 1, duration: 0.4, delay: 0.15 });
    }
  }

  /**
   * Navigates directly to any step (1-5), forward or backward, from
   * whatever the current state happens to be. Every dot tweens straight
   * from its current position/color/opacity to the target step's values
   * — there is no intermediate "replay" of skipped steps; jumping from
   * Step 2 to Step 5 animates directly there, over the same fixed
   * duration as any other transition (STEP_TRANSITION_DURATION).
   *
   * @param {number} step - Target step, 1 through 5
   */
  function goToStep(step) {
    if (step === currentStep) return;
    // Ignore clicks fired while a transition is still running — see the
    // isTransitioning declaration above for why.
    if (isTransitioning) return;

    isTransitioning = true;
    _setStepButtonsEnabled(false);

    resetProfileSelection();

    const staggerCfg = { amount: 0.6, from: "random" };

    switch (step) {
      case 1:
        setGooFilterActive(dotsGroup, false);
        gsap.to(circles, {
          duration: STEP_TRANSITION_DURATION,
          attr: {
            cx: (i, t) => parseFloat(t.dataset.gridX),
            cy: (i, t) => parseFloat(t.dataset.gridY),
          },
          fill: greyColor,
          opacity: 1,
          stagger: staggerCfg,
        });
        gsap.to(Object.values(resolvedCircles), { opacity: 0, duration: 0.4 });
        gsap.to(profileLabels, { opacity: 0, duration: 0.4 });
        break;

      case 2:
        setGooFilterActive(dotsGroup, false);
        gsap.to(circles, {
          duration: STEP_TRANSITION_DURATION,
          attr: {
            cx: (i, t) => parseFloat(t.dataset.gridX),
            cy: (i, t) => parseFloat(t.dataset.gridY),
          },
          fill: (i, t) => riskColorMap[t.dataset.riskLabel] || greyColor,
          opacity: 1,
          stagger: staggerCfg,
        });
        gsap.to(Object.values(resolvedCircles), { opacity: 0, duration: 0.4 });
        gsap.to(profileLabels, { opacity: 0, duration: 0.4 });
        break;

      case 3:
        setGooFilterActive(dotsGroup, true);
        gsap.to(circles, {
          duration: STEP_TRANSITION_DURATION,
          attr: {
            cx: (i, t) => parseFloat(t.dataset.mergeTargetX),
            cy: (i, t) => parseFloat(t.dataset.mergeTargetY),
          },
          fill: (i, t) => riskColorMap[t.dataset.riskLabel] || greyColor,
          opacity: 1,
          stagger: staggerCfg,
        });
        gsap.to(Object.values(resolvedCircles), { opacity: 0, duration: 0.4 });
        gsap.to(profileLabels, { opacity: 0, duration: 0.4 });
        break;

      case 4:
        setGooFilterActive(dotsGroup, true);
        gsap.to(healthyCircles, {
          duration: STEP_TRANSITION_DURATION * 0.7,
          opacity: 0,
          stagger: staggerCfg,
        });
        gsap.to(atRiskCircles, {
          duration: STEP_TRANSITION_DURATION,
          attr: {
            cx: (i, t) => parseFloat(t.dataset.isolateTargetX),
            cy: (i, t) => parseFloat(t.dataset.isolateTargetY),
          },
          fill: redColor,
          opacity: 1,
          stagger: staggerCfg,
        });
        gsap.to(Object.values(resolvedCircles), { opacity: 0, duration: 0.4 });
        gsap.to(profileLabels, { opacity: 0, duration: 0.4 });
        break;

      case 5:
        gsap.to(healthyCircles, { duration: 0.6, opacity: 0 });
        gsap.to(atRiskCircles, {
          duration: 0.6,
          attr: {
            cx: (i, t) => {
              const x = t.dataset.profileTargetX;
              return x !== undefined ? parseFloat(x) : parseFloat(t.getAttribute("cx"));
            },
            cy: (i, t) => {
              const y = t.dataset.profileTargetY;
              return y !== undefined ? parseFloat(y) : parseFloat(t.getAttribute("cy"));
            },
          },
          opacity: 0,
          stagger: staggerCfg,
        });
        setGooFilterActive(dotsGroup, false);
        gsap.to(Object.values(resolvedCircles), { opacity: 1, duration: 0.6, stagger: 0.1, delay: 0.3 });
        gsap.to(profileLabels, { opacity: 1, duration: 0.5, stagger: 0.1, delay: 0.3 });
        break;

      default:
        console.warn(`[riskJourney] goToStep called with invalid step: ${step}`);
        // Release the lock before bailing out — without this, an invalid
        // step number would leave isTransitioning stuck true forever and
        // permanently freeze all navigation.
        isTransitioning = false;
        _setStepButtonsEnabled(true);
        return;
    }

    showPanel(step);
    updateProgressBar(step);

    if (completionBar) {
      gsap.to(completionBar, { opacity: step === 5 ? 1 : 0, duration: 0.4 });
    }

    currentStep = step;

    // Release the lock once every tween in this transition has finished.
    // Uses gsap.delayedCall rather than an onComplete on any one tween:
    // each step fires SEVERAL parallel tweens with different durations,
    // staggers, and delays, so no single tween reliably marks "the whole
    // transition is done." The longest possible tail is the Step 5 case
    // (0.3s delay + 0.6s duration), so STEP_TRANSITION_DURATION plus the
    // stagger amount safely covers every branch.
    gsap.delayedCall(STEP_TRANSITION_DURATION + 0.6, () => {
      isTransitioning = false;
      _setStepButtonsEnabled(true);
    });
  }

  // Wire the progress bar's five buttons — the ONLY navigation control
  // for this section now.
  document.querySelectorAll(".risk-journey__progress-step").forEach((el) => {
    el.addEventListener("click", () => {
      const step = parseInt(el.dataset.step, 10);
      goToStep(step);
    });
  });

  // Step 5's resolved-circle click interaction.
  Object.keys(resolvedCircles).forEach((label) => {
    resolvedCircles[label].addEventListener("click", () => {
      if (selectedProfile === label) {
        resetProfileSelection();
      } else {
        selectProfile(label);
      }
    });
  });

  const backBtn = document.getElementById("risk-journey-detail-back");
  if (backBtn) backBtn.addEventListener("click", resetProfileSelection);

  const ctaBtn = document.getElementById("risk-journey-detail-cta");
  if (ctaBtn) {
    ctaBtn.addEventListener("click", () => {
      // Phase 8 hook — student-level drill-down not yet built.
      console.log("[riskJourney] See detailed data clicked for:", selectedProfile);
    });
  }

  // Initialize the progress bar to reflect Step 1 — no tween needed
  // here, since animateEntranceOnLoad already established Step 1's
  // visual state; this just syncs the progress bar's own display.
  updateProgressBar(1);
}

/**
 * Sets up the entrance and step navigation, or skips straight to the
 * final CSS-driven state if GSAP is unavailable entirely, or the user
 * prefers reduced motion.
 *
 * @param {SVGElement} svg - The SVG element returned by renderDotGrid()
 * @param {SVGGElement} dotsGroup - The <g> wrapping all dot circles
 * @param {object} data - Full predictions.json payload
 */
function initDotAnimations(svg, dotsGroup, data) {
  if (typeof gsap === "undefined") {
    console.warn("[riskJourney] GSAP unavailable — dots render statically.");
    return;
  }
  if (_prefersReducedMotion()) {
    return;
  }

  const circles = svg.querySelectorAll(".risk-journey__dot");
  if (circles.length === 0) return;

  animateEntranceOnLoad(circles, data);
  initStepNavigation(dotsGroup, circles, data);
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
    const { svg, dotsGroup } = renderDotGrid(container, data.students);
    initDotAnimations(svg, dotsGroup, data);
    console.log(
      `[riskJourney] Rendered ${data.students.length} dots — load entrance (Step 1), then click-driven navigation across 5 steps.`
    );
  } catch (err) {
    console.error("[riskJourney]", err.message);
  }
}

window.addEventListener("load", bootRiskJourney);
