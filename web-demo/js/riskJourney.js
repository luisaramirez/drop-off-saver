/**
 * riskJourney.js — Scroll-Driven Risk Narrative
 * ===============================================
 * Renders the "Students don't disappear, they fade" interactive sequence:
 * student dots that animate in, wash into risk color, merge into two
 * clusters (healthy / at-risk), then isolate the at-risk cluster alone
 * on screen — all as the user scrolls through one continuous pinned
 * section. Splitting the at-risk cluster into three clickable behavioral
 * profiles with a student-level drill-down comes in later phases.
 *
 * Kept as a SEPARATE module from charts.js on purpose. charts.js owns the
 * Chart.js bar charts (distribution histogram, profile breakdown bars).
 * This module owns a hand-built SVG scene with its own animation timeline.
 * Mixing the two concerns in one file would make either one harder to
 * reason about — Chart.js manages its own canvas lifecycle and does not
 * compose cleanly with a raw SVG scene driven by GSAP scrub animation.
 *
 * CURRENT SCOPE:
 *   - Fetch predictions.json (independently of app.js's fetch — see note
 *     in loadJourneyData() below)
 *   - Lay out one <circle> per student in a grid inside an SVG canvas,
 *     each pre-assigned a fixed jitter angle/fraction for its eventual
 *     cluster position (renderDotGrid)
 *   - Dots grow in with a scroll-scrubbed staggered entrance as the
 *     section scrolls into view (animateDotEntrance) — NOT pinned, the
 *     page scrolls normally during this stage
 *   - ONE continuous PINNED sequence (animateMainSequence) covers three
 *     labeled segments sharing a single GSAP timeline + ScrollTrigger,
 *     so they can never drift out of sync and never flicker between
 *     separate pin/unpin transitions:
 *       "colorwash" — dot fill washes grey → risk-tier color; left copy
 *                     crossfades intro panel → threshold legend panel
 *       "merge"     — goo filter turns on; dots animate into two organic
 *                     blobs (healthy / at-risk), area-proportional to
 *                     each cluster's actual student count
 *       "isolate"   — healthy blob fades out entirely; left copy
 *                     crossfades threshold panel → profiling-framing
 *                     panel, leaving only the at-risk blob on screen
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
 *   - Graceful degradation: if GSAP/ScrollTrigger are unavailable, or the
 *     user has requested reduced motion, dots render directly in their
 *     final state (full size, correctly colored via the CSS attribute
 *     selectors from Phase 2) — no motion is required for the page to be
 *     correct
 *
 * Not yet built:
 *   Phase 5 — split at-risk cluster into 3 profile blobs
 *   Phase 6 — resolve blobs into clickable labeled circles
 *   Phase 7 — click → detail panel (profile breakdown + strategy)
 *   Phase 8 — click → student-level drill-down grid
 *   Phase 9 — mobile pass
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

// Scroll zones for the animation sequence, expressed as ScrollTrigger
// "start"/"end" strings. Defined as named constants, not inline magic
// strings, so the relationship between zones is visible in one place.
//
// entranceStart → entranceEnd: Stage 1 (dot grow-in), scrub, NOT pinned —
// the page scrolls normally while dots grow in.
//
// mainStart → mainEnd: ONE continuous PINNED zone covering three
// sequential segments — color wash + copy crossfade, then merge into two
// clusters, then isolate the at-risk cluster (fade out healthy, copy
// crossfades again). All three live inside ONE gsap.timeline() with
// internal labels (see animateMainSequence), not three separate
// ScrollTriggers — a separate trigger per segment would mean pinning,
// unpinning, and re-pinning between each one, which reads as a jarring
// flicker. One continuous pin across all three keeps the whole sequence
// feeling like a single unbroken moment.
//
// mainEnd uses "+=N" (a fixed pixel distance from mainStart) rather than
// another "top/bottom %" string. With three sequential segments packed
// into one pinned range, a fixed distance is far more predictable to
// reason about and tune than tracking how "top X%" and "bottom Y%"
// interact — that math only gets harder to reason about as more content
// gets packed into the same pinned window. If any individual segment
// feels rushed or sluggish once testing, this is the number to adjust —
// use the commented `markers: true` line in animateMainSequence to see
// exactly how much scroll distance is actually available.
const SCROLL_ZONES = {
  entranceStart: "top 85%",
  entranceEnd: "top 0%",
  mainStart: "top 5%",
  mainEnd: "+=2600",
};

// Cluster merge constants — proven via the isolated test page
// (test-metaball.html) before being carried over here. Centroids are
// expressed as FRACTIONS of the SVG viewBox's actual width/height, not
// fixed pixel values, so the merge target positions stay correct
// regardless of how many students are in the dataset (which changes the
// viewBox's computed dimensions — see _computeGridDimensions).
const MERGE_CENTROID_HEALTHY_X_FRAC = 0.28;
const MERGE_CENTROID_AT_RISK_X_FRAC = 0.72;
const MERGE_CENTROID_Y_FRAC = 0.5;

// Cluster "tightness" — how densely packed each blob is. Tuned to 4 via
// test-metaball.html's live slider; smaller = tighter/denser blobs,
// larger = looser/more spread out. See _clusterRadius: radius scales
// with sqrt(count), not count directly, so blob AREA (not just radius)
// stays proportional to student count — a cluster with 6x more students
// gets roughly 6x more area, not 6x the radius.
const CLUSTER_TIGHTNESS_K = 4;

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
 * Every circle carries data-user-id and data-risk-label attributes, plus
 * data-jitter-angle and data-jitter-fraction — a FIXED random position
 * within a future cluster blob, assigned once at creation rather than
 * re-randomized every time a merge animation runs. This is the same
 * approach proven in test-metaball.html: it means the merge target for
 * any given circle is deterministic once computed, so re-running the
 * merge (e.g. on a window resize recalculation) doesn't reshuffle the
 * blob's internal arrangement.
 *
 * All circles are appended to a dedicated <g> (dotsGroup), not directly
 * to the <svg> root — this is what lets the goo filter be toggled onto
 * just the dots (via setGooFilterActive) without also affecting other
 * SVG content that might be added later (labels, etc.).
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

  // Goo filter defs — built programmatically (rather than static markup
  // in index.html) since this whole SVG is constructed at runtime. Values
  // (stdDeviation, the color matrix) are the exact ones tuned via
  // test-metaball.html's live sliders. NOT applied to anything by
  // default — see setGooFilterActive, toggled on only during/after the
  // merge segment of animateMainSequence.
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
 * GSAP-driven entrance/scrub animation and let the dots render directly
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
 * enough to actually blend into each other: turned on right as the merge
 * segment begins, and left on through the resting blob + isolate
 * segments, since those still need to read as smooth merged shapes.
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
 * Computes a circle's target (x, y) when merged into its cluster, using
 * its pre-assigned fixed jitter angle/fraction (set once in
 * renderDotGrid) scaled by that cluster's current radius.
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
 * Stage 1 — entrance. Dots grow from radius 0 to full size as the user
 * scrolls through this stage's dedicated range.
 *
 * This is scrub-tied, NOT a time-based once-trigger. An earlier version
 * used `duration + stagger + once: true`, fired at a single scroll
 * position — but that animation plays out over real wall-clock time
 * (~1.4s), while the user's scroll position keeps moving regardless of
 * whether that time has elapsed. At any normal scroll speed, the user
 * could cross into Stage 2's trigger zone before Stage 1 finished
 * growing the dots in, so the color wash would start advancing on dots
 * that hadn't even fully appeared yet.
 *
 * Tying entrance to scrub instead removes the race entirely: progress is
 * now purely a function of scroll position, not time, so by the moment
 * the user reaches END_ENTRANCE the dots are GUARANTEED fully grown,
 * regardless of how fast or slow they scrolled to get there.
 *
 * @param {SVGElement[]} circles - The <circle> elements to animate
 */
function animateDotEntrance(circles) {
  gsap.set(circles, { attr: { r: 0 } });

  gsap.to(circles, {
    attr: { r: DOT_RADIUS },
    ease: "power2.out",
    stagger: { amount: 0.5, from: "random" },
    scrollTrigger: {
      trigger: "#risk-journey",
      start: SCROLL_ZONES.entranceStart,
      end: SCROLL_ZONES.entranceEnd,
      scrub: 1,
      // markers: true, // uncomment to visualize actual trigger points in-browser
    },
  });
}

/**
 * Stage 2 — ONE continuous pinned timeline covering three sequential
 * segments: color wash + copy crossfade, merge into two clusters, then
 * isolate the at-risk cluster. All three share a single gsap.timeline()
 * and a single ScrollTrigger, using GSAP labels ("colorwash", "merge",
 * "isolate") to sequence them — not three separate ScrollTriggers, which
 * would mean pinning/unpinning/re-pinning between each segment and
 * reading as a jarring flicker rather than one continuous moment.
 *
 * PINNED: this stage locks #risk-journey in place on screen for its
 * entire scroll range (SCROLL_ZONES.mainStart → mainEnd). Nothing on
 * screen moves — no scrolling of the section, no unintended
 * repositioning — the ONLY thing scroll input does during this stage is
 * advance whichever segment is currently active. The section releases
 * and normal scrolling resumes automatically once mainEnd is reached.
 *
 * Segment breakdown:
 *   "colorwash" — dot fill washes from grey to risk-tier color; left
 *                 copy crossfades from the intro panel to the threshold
 *                 legend panel. (Unchanged from the previous phase.)
 *   "merge"     — the goo filter turns on; every dot animates from its
 *                 grid position to a jittered position within one of two
 *                 cluster centroids (healthy or at-risk), blending into
 *                 two organic blobs.
 *   "isolate"   — the healthy blob fades out entirely, leaving only the
 *                 at-risk blob on screen; left copy crossfades again,
 *                 from the threshold legend to a profiling-framing panel.
 *
 * Uses scrub (not once) throughout because a live, reversible link to
 * scroll position means scrolling back up genuinely reverses every
 * segment — un-isolating, un-merging, un-coloring — not just the last
 * one triggered.
 *
 * @param {SVGGElement} dotsGroup - The <g> wrapping all dot circles
 * @param {SVGElement[]} circles - The <circle> elements to animate
 * @param {object} data - Full predictions.json payload (for summary counts)
 */
function animateMainSequence(dotsGroup, circles, data) {
  const greyColor = _resolveCSSColor("--c-border");
  const riskColorMap = {
    HIGH: _resolveCSSColor("--c-red"),
    MEDIUM: _resolveCSSColor("--c-yellow"),
    LOW: _resolveCSSColor("--c-green"),
  };

  gsap.set(circles, { fill: greyColor });

  const introPanel = document.getElementById("risk-journey-intro");
  const thresholdPanel = document.getElementById("risk-journey-thresholds");
  const profilingPanel = document.getElementById("risk-journey-profiling");

  const healthyCircles = Array.from(circles).filter(
    (c) => c.dataset.riskLabel === "LOW"
  );
  const atRiskCircles = Array.from(circles).filter(
    (c) => c.dataset.riskLabel !== "LOW"
  );
  const healthyCount = data.summary.safe_count;
  const atRiskCount = data.summary.at_risk_count;

  // Read the actual rendered viewBox dimensions so cluster centroids are
  // correctly positioned regardless of dataset size.
  const viewBox = dotsGroup.ownerSVGElement.viewBox.baseVal;
  const centroids = _computeClusterCentroids(viewBox.width, viewBox.height);

  // Precompute each circle's merge target ONCE (not per-frame inside the
  // tween) — cheap, and keeps the tween's per-property functions trivial
  // lookups rather than recomputing jitter math on every scrub frame.
  circles.forEach((circle) => {
    const pos = _targetMergePosition(circle, centroids, healthyCount, atRiskCount, CLUSTER_TIGHTNESS_K);
    circle.dataset.mergeTargetX = pos.x;
    circle.dataset.mergeTargetY = pos.y;
  });

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: "#risk-journey",
      start: SCROLL_ZONES.mainStart,
      end: SCROLL_ZONES.mainEnd,
      scrub: 1,
      pin: true,
      pinSpacing: true,
      // markers: true, // uncomment to visualize actual trigger points in-browser
    },
  });

  // --- Segment: colorwash ---
  tl.addLabel("colorwash");
  tl.to(
    circles,
    {
      fill: (index, target) => riskColorMap[target.dataset.riskLabel] || greyColor,
      stagger: { amount: 0.6, from: "random" },
    },
    "colorwash"
  );
  if (introPanel && thresholdPanel) {
    tl.to(introPanel, { opacity: 0, duration: 0.4 }, "colorwash");
    tl.to(thresholdPanel, { opacity: 1, duration: 0.4 }, "colorwash");
  }

  // --- Segment: merge ---
  // A small "+=0.3" gap after colorwash so the two segments don't feel
  // like they're firing simultaneously — same dwell-gap principle used
  // between Stage 1 (entrance) and Stage 2 earlier.
  tl.addLabel("merge", "+=0.3");
  tl.call(() => setGooFilterActive(dotsGroup, true), null, "merge");
  tl.to(
    circles,
    {
      duration: 1,
      attr: {
        cx: (index, target) => parseFloat(target.dataset.mergeTargetX),
        cy: (index, target) => parseFloat(target.dataset.mergeTargetY),
      },
      stagger: { amount: 0.8, from: "random" },
    },
    "merge"
  );

  // --- Segment: isolate ---
  tl.addLabel("isolate", "+=0.3");
  tl.to(
    healthyCircles,
    {
      opacity: 0,
      stagger: { amount: 0.4, from: "random" },
    },
    "isolate"
  );
  if (thresholdPanel && profilingPanel) {
    tl.to(thresholdPanel, { opacity: 0, duration: 0.4 }, "isolate");
    tl.to(profilingPanel, { opacity: 1, duration: 0.4 }, "isolate");
  }
}

/**
 * Sets up both animation stages for the dot grid, or skips straight to
 * the final CSS-driven state if GSAP/ScrollTrigger aren't available or
 * the user prefers reduced motion.
 *
 * @param {SVGElement} svg - The SVG element returned by renderDotGrid()
 * @param {SVGGElement} dotsGroup - The <g> wrapping all dot circles
 * @param {object} data - Full predictions.json payload
 */
function initDotAnimations(svg, dotsGroup, data) {
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.warn("[riskJourney] GSAP/ScrollTrigger unavailable — dots render statically.");
    return;
  }
  if (_prefersReducedMotion()) {
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  const circles = svg.querySelectorAll(".risk-journey__dot");
  if (circles.length === 0) return;

  animateDotEntrance(circles);
  animateMainSequence(dotsGroup, circles, data);
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
      `[riskJourney] Rendered ${data.students.length} dots with entrance, color-wash, merge, and isolate animation.`
    );
  } catch (err) {
    console.error("[riskJourney]", err.message);
  }
}

window.addEventListener("load", bootRiskJourney);
