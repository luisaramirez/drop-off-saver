/**
 * riskJourney.js — Scroll-Driven Risk Narrative
 * ===============================================
 * Renders the entire opening narrative of the page — this section is now
 * the FIRST thing on the page. The hero, signal, distribution, and
 * profiles sections that used to exist separately were removed; their
 * content now lives here, as copy panels crossfading through this one
 * section's animation sequence.
 *
 * Two-phase behavior:
 *   1. LOAD-TRIGGERED ENTRANCE (animateEntranceOnLoad) — plays the
 *      instant the page loads, no scroll required: intro copy settles
 *      in, the student count animates up from 0, dots grow in from
 *      radius 0, and a "scroll to explore" cue fades in once everything
 *      has settled. Not scroll-position-driven at all — there's nothing
 *      above this section to scroll up from anymore, so the old
 *      "reveal as it scrolls into view" trigger has nothing to key off.
 *   2. PINNED SCROLL SEQUENCE (animateMainSequence) — engages the moment
 *      the user starts scrolling (mainStart: "top top"), locking the
 *      section on screen through five labeled segments (colorwash,
 *      merge, isolate, profiles, resolve) before releasing to reveal the
 *      Roster and System sections below.
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
 *     + dots all animate in together on load, ending with the scroll cue
 *   - ONE continuous PINNED sequence (animateMainSequence) covers five
 *     labeled segments sharing a single GSAP timeline + ScrollTrigger,
 *     so they can never drift out of sync and never flicker between
 *     separate pin/unpin transitions:
 *       "colorwash" — dot fill washes grey → risk-tier color; left copy
 *                     crossfades intro panel → signal panel (top 3
 *                     predictive features)
 *       "merge"     — goo filter turns on; dots animate into two organic
 *                     blobs (healthy / at-risk), area-proportional to
 *                     each cluster's actual student count; left copy
 *                     crossfades signal panel → threshold legend panel
 *                     (moved here specifically to align with the moment
 *                     the two clusters actually form)
 *       "isolate"   — healthy blob fades out; at-risk blob turns solid
 *                     red AND re-centers (was off-center to make room
 *                     for the healthy blob, now it's the only subject);
 *                     left copy crossfades to a profiling-framing panel
 *       "profiles"  — the red mass splits into three blobs, one per
 *                     behavioral profile, each colored with that
 *                     profile's established color and sized by its real
 *                     membership count; count+name labels fade in above
 *                     each, positioned with enough clearance to never
 *                     overlap the blob (PROFILE_LABEL_CLEARANCE); left
 *                     copy crossfades to a demographics panel (per-
 *                     profile descriptions sourced from real student
 *                     records — see app.js:populateDemographicsPanel)
 *       "resolve"   — goo filter turns off; the many small per-profile
 *                     dots fade out as three solid, clean circles fade
 *                     in at the same centroid + radius — consolidation,
 *                     not a jarring swap. This has to happen before any
 *                     click handling gets wired up in a later phase
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
 *   - Graceful degradation: entrance only needs GSAP core and runs
 *     regardless of ScrollTrigger's availability; if GSAP itself is
 *     unavailable, or the user has requested reduced motion, dots render
 *     directly in their final state (full size, correctly colored via
 *     the CSS attribute selectors from Phase 2) — no motion is required
 *     for the page to be correct
 *
 * Not yet built:
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

// Scroll zone for the pinned main sequence, expressed as ScrollTrigger
// "start"/"end" strings. Defined as a named constant, not an inline
// magic string, so it's visible in one place.
//
// Entrance (dots growing in, copy fading in) is NO LONGER scroll-tied —
// see animateEntranceOnLoad. It plays automatically the instant the page
// loads, like the site's original hero section used to. This changed
// because Risk Journey is now the FIRST section on the page (the hero,
// signal, distribution, and profiles sections were removed and folded
// into this one) — the old entrance trigger relied on scrolling the
// section up from below the viewport, which no longer happens, since
// there's nothing above it to scroll past anymore.
//
// mainStart → mainEnd: ONE continuous PINNED zone covering five
// sequential segments — color wash + copy crossfade, merge into two
// clusters, isolate the at-risk cluster, split into three profiles, then
// resolve into clean circles. All five live inside ONE gsap.timeline()
// with internal labels (see animateMainSequence), not five separate
// ScrollTriggers — a separate trigger per segment would mean pinning,
// unpinning, and re-pinning between each one, which reads as a jarring
// flicker. One continuous pin across all five keeps the whole sequence
// feeling like a single unbroken moment.
//
// mainStart is "top top" — pinning engages from the very first pixel of
// scroll, since the section is already at the top of the page on load
// (nothing above it to scroll past first). mainEnd uses "+=N" (a fixed
// pixel distance from mainStart) rather than a "top/bottom %" string —
// with five sequential segments packed into one pinned range, a fixed
// distance is far more predictable to reason about and tune than
// tracking how "top X%" and "bottom Y%" interact. If any individual
// segment feels rushed or sluggish once testing, this is the number to
// adjust — use the commented `markers: true` line in animateMainSequence
// to see exactly how much scroll distance is actually available.
const SCROLL_ZONES = {
  mainStart: "top top",
  mainEnd: "+=4200",
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

// Once the healthy cluster fades out during "isolate", the at-risk blob
// re-centers here (0.5 = canvas center) rather than staying at its
// off-center merge position (0.72) — visually, a single remaining blob
// sitting off to one side reads as unbalanced/incidental; centering it
// signals "this is now the subject" instead of "this is what's left of
// a two-blob layout."
const ISOLATE_CENTROID_X_FRAC = 0.5;

// Cluster "tightness" — how densely packed each blob is. Tuned to 4 via
// test-metaball.html's live slider; smaller = tighter/denser blobs,
// larger = looser/more spread out. See _clusterRadius: radius scales
// with sqrt(count), not count directly, so blob AREA (not just radius)
// stays proportional to student count — a cluster with 6x more students
// gets roughly 6x more area, not 6x the radius.
const CLUSTER_TIGHTNESS_K = 4;

// Profile split constants. Once the healthy cluster is gone, the freed-up
// canvas width is used for three evenly-spaced centroids — rather than
// cramming the split into the narrow region the at-risk blob previously
// occupied (which was only ever sized for one blob, not three). Order
// (left to right) and colors match the SAME profile identity used
// everywhere else on the page (roster badges, profile breakdown chart) —
// profiler.py assigns these labels, this is just reusing them, never
// inventing a new mapping here.
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

// Phase 7 click interaction: where the clicked ("selected") circle and
// the two non-clicked ("other") circles move to, expressed as viewBox
// fractions — same convention as every other centroid in this file, so
// the layout stays correct regardless of dataset size. The selected
// circle moves to upper-center and grows slightly (the visual "subject"
// of the detail panel now showing on the left); the other two shrink
// and move to the bottom, still visible but clearly de-emphasized.
const FOCUSED_SELECTED_FRAC = { x: 0.5, y: 0.32 };
const FOCUSED_SELECTED_SCALE = 1.15;
const FOCUSED_OTHER_FRACS = [
  { x: 0.3, y: 0.82 },
  { x: 0.7, y: 0.82 },
];
const FOCUSED_OTHER_SCALE = 0.55;

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
    // Sourced directly from profiler.py's real K-Means output, never
    // reclustered or reinterpreted client-side. Empty string for safe
    // students (risk_profile is null for them) — irrelevant for those
    // circles since they never take part in the profile-split segment.
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
 * Computes the three profile centroid points as actual pixel coordinates,
 * evenly spread across the FULL viewBox width — once the healthy cluster
 * has faded out, that space is free to use, rather than cramming three
 * blobs into the narrower region the single at-risk blob previously
 * occupied.
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
 * Computes an at-risk circle's target (x, y) once it splits into its
 * profile sub-cluster, reusing the SAME fixed jitter angle/fraction
 * assigned back in renderDotGrid — each circle keeps one stable random
 * "personality" reused across every clustering stage (2-cluster merge,
 * then 3-cluster profile split), rather than being re-randomized at
 * every stage.
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
 * tspans), positioned above where that profile's blob will end up —
 * offset upward by that specific blob's own radius, so the label clears
 * the blob regardless of how large or small that profile's cluster is.
 * Matches the original spec requirement that profile clusters show their
 * student count in numbers, not just convey it through blob size alone.
 *
 * Appended directly to the SVG root (not the dots group), since labels
 * should never be affected by the goo filter applied to dotsGroup.
 * Starts at opacity 0 — animateMainSequence fades them in once the
 * profile-split segment plays.
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
 * filter state. This is the "resolve" segment's destination shape: many
 * small individual dots (the blob) fade out, these three fade in at the
 * exact same centroid + radius the blob occupied, so the transition
 * reads as consolidation rather than a jarring size/position jump.
 *
 * Kept deliberately separate from the profile labels (a different
 * element, created in its own function) — labels persist unchanged
 * across both the blob and resolved-circle states (same centroid, same
 * radius, so no label repositioning is needed either), while these
 * circles are new elements specific to the resolved state.
 *
 * Starts at opacity 0 — animateMainSequence fades them in during the
 * "resolve" segment, as the individual dots fade out.
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
 * Entrance — plays automatically the instant the page loads, mirroring
 * the structure of the site's original hero entrance timeline (which no
 * longer exists as a separate section, but the same polished feel is
 * worth preserving): the intro panel's label, heading, and body settle
 * in with a slight stagger, the student count animates up from 0, dots
 * grow in from radius 0, and finally a "scroll to explore" cue fades in
 * once everything has settled.
 *
 * This is NOT tied to ScrollTrigger at all — no scroll position
 * dependency, unlike every other animation in this file. That's a
 * deliberate consequence of Risk Journey being the first section on the
 * page now: there's no "below the viewport" for it to scroll up from,
 * so a scroll-position trigger has nothing meaningful to key off here.
 * Plays once, on load, like the hero always did.
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
  const scrollCue = document.getElementById("risk-journey-scroll-cue");
  const countEl = document.getElementById("risk-journey-student-count");

  const label = introPanel ? introPanel.querySelector(".section__label") : null;
  const heading = introPanel ? introPanel.querySelector(".section__heading") : null;
  const body = introPanel ? introPanel.querySelector(".section__body") : null;

  gsap.set(circles, { attr: { r: 0 } });
  if (label) gsap.set(label, { opacity: 0, y: 10 });
  if (heading) gsap.set(heading, { opacity: 0, y: 16 });
  if (body) gsap.set(body, { opacity: 0, y: 16 });
  if (scrollCue) gsap.set(scrollCue, { opacity: 0 });

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

  if (scrollCue) {
    tl.to(scrollCue, { opacity: 1, duration: 0.5 }, "-=0.1");
  }
}

/**
 * Main pinned sequence — ONE continuous pinned timeline covering five
 * sequential segments: color wash + copy crossfade, merge into two
 * clusters, isolate the at-risk cluster (turning it solid red), split
 * that red mass into three profile blobs, then resolve those blobs into
 * clean circles. All five share a single gsap.timeline() and a single
 * ScrollTrigger, using GSAP labels ("colorwash", "merge", "isolate",
 * "profiles", "resolve") to sequence them — not five separate
 * ScrollTriggers, which would mean pinning/unpinning/re-pinning between
 * each segment and reading as a jarring flicker rather than one
 * continuous moment.
 *
 * PINNED: this stage locks #risk-journey in place on screen for its
 * entire scroll range (SCROLL_ZONES.mainStart → mainEnd), engaging from
 * the very first pixel scrolled (mainStart is "top top" — the section is
 * already at the top of the page on load, so there's no dead zone before
 * pinning kicks in). Nothing on screen moves — no scrolling of the
 * section, no unintended repositioning — the ONLY thing scroll input
 * does during this stage is advance whichever segment is currently
 * active. The section releases and normal scrolling resumes
 * automatically once mainEnd is reached, revealing the Roster and System
 * sections below.
 *
 * Five copy panels crossfade through this sequence — one per segment
 * except "resolve", which needs no new copy:
 *   intro (Step 1, shown during entrance) → colorwash → signal (Step 2)
 *   → merge → thresholds (Step 3) → isolate → profiling (Step 4)
 *   → profiles → demographics (Step 5) → resolve (no crossfade)
 *
 * Segment breakdown:
 *   "colorwash" — dot fill washes from grey to risk-tier color; left
 *                 copy crossfades from the intro panel to the signal
 *                 panel (the model's top 3 predictive features).
 *   "merge"     — the goo filter turns on; every dot animates from its
 *                 grid position to a jittered position within one of two
 *                 cluster centroids (healthy or at-risk), blending into
 *                 two organic blobs. Left copy crossfades from the
 *                 signal panel to the threshold legend panel — moved
 *                 here (rather than colorwash, where it lived
 *                 previously) specifically to align with the moment the
 *                 two clusters actually form, since threshold values are
 *                 what determine that grouping.
 *   "isolate"   — the healthy blob fades out entirely. AT THE SAME TIME,
 *                 the at-risk blob turns uniformly red (previously a
 *                 HIGH/MEDIUM mix of red/yellow from the colorwash
 *                 stage) AND re-centers horizontally (it was off-center
 *                 at 72% width, sharing the canvas with the healthy
 *                 blob — now that it's the only thing left, it moves to
 *                 50% width so it reads as "the subject", not "what's
 *                 left of a two-blob layout"). Left copy crossfades
 *                 again, from the threshold legend to a profiling-
 *                 framing panel.
 *   "profiles"  — the single red mass splits into three blobs, one per
 *                 behavioral profile (Time-Constrained, Disengaged
 *                 Learner, Quiet Decliner), each colored with that
 *                 profile's own established color (matching the roster
 *                 badges elsewhere on the page) and sized proportional
 *                 to its real membership count from profiler.py. A
 *                 count+name label fades in above each. Left copy
 *                 crossfades from the profiling-framing panel to the
 *                 demographics panel (per-profile descriptions, sourced
 *                 from real student records — see
 *                 app.js:populateDemographicsPanel).
 *   "resolve"   — the goo filter turns off, and the many small dots that
 *                 made up each blob fade out as three solid, clean
 *                 circles fade in at the exact same centroid + radius —
 *                 consolidation, not a jarring shape swap. This is the
 *                 "blobs become circles" step that has to happen BEFORE
 *                 click interactivity is wired up in a later phase —
 *                 clicking one of 20-38 overlapping small dots per
 *                 profile is unreliable; clicking one solid circle is not.
 *
 * Uses scrub (not once) throughout because a live, reversible link to
 * scroll position means scrolling back up genuinely reverses every
 * segment — un-resolving, un-splitting, un-isolating, un-merging,
 * un-coloring — not just the last one triggered.
 *
 * @param {SVGGElement} dotsGroup - The <g> wrapping all dot circles
 * @param {SVGElement[]} circles - The <circle> elements to animate
 * @param {object} data - Full predictions.json payload (for summary counts)
 */
function animateMainSequence(dotsGroup, circles, data) {
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

  gsap.set(circles, { fill: greyColor });

  const scrollCue = document.getElementById("risk-journey-scroll-cue");
  const introPanel = document.getElementById("risk-journey-intro");
  const signalPanel = document.getElementById("risk-journey-signal");
  const thresholdPanel = document.getElementById("risk-journey-thresholds");
  const profilingPanel = document.getElementById("risk-journey-profiling");
  const demographicsPanel = document.getElementById("risk-journey-demographics");

  const healthyCircles = Array.from(circles).filter(
    (c) => c.dataset.riskLabel === "LOW"
  );
  const atRiskCircles = Array.from(circles).filter(
    (c) => c.dataset.riskLabel !== "LOW"
  );
  const healthyCount = data.summary.safe_count;
  const atRiskCount = data.summary.at_risk_count;
  const profileBreakdown = data.summary.risk_profile_breakdown || {};

  // Read the actual rendered viewBox dimensions so cluster centroids are
  // correctly positioned regardless of dataset size.
  const svg = dotsGroup.ownerSVGElement;
  const viewBox = svg.viewBox.baseVal;
  const centroids = _computeClusterCentroids(viewBox.width, viewBox.height);
  const profileCentroids = _computeProfileCentroids(viewBox.width, viewBox.height);

  // Precompute each circle's merge target ONCE (not per-frame inside the
  // tween) — cheap, and keeps the tween's per-property functions trivial
  // lookups rather than recomputing jitter math on every scrub frame.
  circles.forEach((circle) => {
    const pos = _targetMergePosition(circle, centroids, healthyCount, atRiskCount, CLUSTER_TIGHTNESS_K);
    circle.dataset.mergeTargetX = pos.x;
    circle.dataset.mergeTargetY = pos.y;
  });

  // Precompute each at-risk circle's ISOLATE (re-centered) target. Reuses
  // the merge target's Y and jittered arrangement exactly — only X shifts,
  // by the same fixed delta for every circle in the cluster (the distance
  // between the merge centroid's x and the canvas center). This slides
  // the whole blob to center as one rigid unit rather than recomputing a
  // fresh jitter arrangement, which would visually "reshuffle" the dots
  // for no reason.
  const isolateCentroidX = viewBox.width * ISOLATE_CENTROID_X_FRAC;
  const isolateDeltaX = isolateCentroidX - centroids.atRisk.x;
  atRiskCircles.forEach((circle) => {
    circle.dataset.isolateTargetX = parseFloat(circle.dataset.mergeTargetX) + isolateDeltaX;
    circle.dataset.isolateTargetY = circle.dataset.mergeTargetY;
  });

  // Precompute each at-risk circle's profile-split target the same way.
  // Only at-risk circles participate — healthy circles are already faded
  // out by the time this segment plays and never rejoin.
  atRiskCircles.forEach((circle) => {
    const pos = _targetProfilePosition(circle, profileCentroids, profileBreakdown, CLUSTER_TIGHTNESS_K);
    if (pos) {
      circle.dataset.profileTargetX = pos.x;
      circle.dataset.profileTargetY = pos.y;
    }
  });

  const profileLabels = _createProfileLabels(svg, profileCentroids, profileBreakdown, CLUSTER_TIGHTNESS_K);
  const resolvedCircles = _createResolvedCircles(svg, profileCentroids, profileBreakdown, CLUSTER_TIGHTNESS_K, profileColorMap);

  // Convert the profileLabels array into a label-keyed lookup — the
  // array itself (in _createProfileLabels) is built by iterating
  // PROFILE_CENTROID_FRACS' keys in order, so indices line up exactly.
  // The click handler needs to look up "the label element for Quiet
  // Decliner specifically", not just "all label elements in a row".
  const profileLabelElements = {};
  Object.keys(PROFILE_CENTROID_FRACS).forEach((label, i) => {
    profileLabelElements[label] = profileLabels[i];
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

  // The "scroll to explore" cue has done its job the instant the user
  // starts scrolling (which is also the instant this pin engages, since
  // mainStart is "top top") — fade it out immediately so it doesn't sit
  // awkwardly on screen through the rest of the sequence.
  if (scrollCue) {
    tl.to(scrollCue, { opacity: 0, duration: 0.3 }, 0);
  }

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
  if (introPanel && signalPanel) {
    tl.to(introPanel, { opacity: 0, duration: 0.4 }, "colorwash");
    tl.to(signalPanel, { opacity: 1, duration: 0.4 }, "colorwash");
  }

  // --- Segment: merge ---
  // A small "+=0.3" gap after colorwash so the two segments don't feel
  // like they're firing simultaneously — same dwell-gap principle used
  // between the load-triggered entrance and this pinned sequence.
  //
  // The threshold/legend copy crossfades in HERE, not during colorwash —
  // moved forward specifically to align with the moment the two clusters
  // actually form, since threshold values are what determine that
  // grouping (a student's score vs. 0.60 is literally why they end up in
  // one cluster or the other).
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
  if (signalPanel && thresholdPanel) {
    tl.to(signalPanel, { opacity: 0, duration: 0.4 }, "merge");
    tl.to(thresholdPanel, { opacity: 1, duration: 0.4 }, "merge");
  }

  // --- Segment: isolate ---
  // Three things happen together, all part of the same narrative beat
  // ("here is the at-risk group, as one centered thing"): the healthy
  // blob fades out, the at-risk blob turns solid red, and it re-centers
  // horizontally instead of staying at its off-center merge position.
  tl.addLabel("isolate", "+=0.3");
  tl.to(
    healthyCircles,
    {
      opacity: 0,
      stagger: { amount: 0.4, from: "random" },
    },
    "isolate"
  );
  tl.to(
    atRiskCircles,
    {
      duration: 1,
      fill: redColor,
      attr: {
        cx: (index, target) => parseFloat(target.dataset.isolateTargetX),
        cy: (index, target) => parseFloat(target.dataset.isolateTargetY),
      },
      stagger: { amount: 0.4, from: "random" },
    },
    "isolate"
  );
  if (thresholdPanel && profilingPanel) {
    tl.to(thresholdPanel, { opacity: 0, duration: 0.4 }, "isolate");
    tl.to(profilingPanel, { opacity: 1, duration: 0.4 }, "isolate");
  }

  // --- Segment: profiles ---
  // The single red mass differentiates into three profile blobs — both
  // position AND color change together in one motion, since the blob is
  // simultaneously moving apart and taking on a new identity. Sized
  // proportional to each profile's REAL membership count from
  // profiler.py (via data.summary.risk_profile_breakdown), never an
  // even/arbitrary split.
  tl.addLabel("profiles", "+=0.3");
  tl.to(
    atRiskCircles,
    {
      duration: 1,
      attr: {
        cx: (index, target) => {
          const x = target.dataset.profileTargetX;
          return x !== undefined ? parseFloat(x) : parseFloat(target.getAttribute("cx"));
        },
        cy: (index, target) => {
          const y = target.dataset.profileTargetY;
          return y !== undefined ? parseFloat(y) : parseFloat(target.getAttribute("cy"));
        },
      },
      fill: (index, target) => profileColorMap[target.dataset.profileLabel] || redColor,
      stagger: { amount: 0.9, from: "random" },
    },
    "profiles"
  );
  tl.to(
    profileLabels,
    {
      opacity: 1,
      duration: 0.5,
      stagger: 0.1,
    },
    "profiles+=0.6"
  );
  if (profilingPanel && demographicsPanel) {
    tl.to(profilingPanel, { opacity: 0, duration: 0.4 }, "profiles");
    tl.to(demographicsPanel, { opacity: 1, duration: 0.4 }, "profiles");
  }

  // --- Segment: resolve ---
  // Blobs become clean circles. The goo filter turns off (no longer
  // needed — nothing is blending anymore), the many small at-risk dots
  // fade out, and the three solid resolved circles (created upfront,
  // starting at opacity 0) fade in at the exact same position + radius
  // the blob occupied. Deliberately sequenced BEFORE any click handling
  // gets wired up in a later phase.
  tl.addLabel("resolve", "+=0.3");
  tl.call(() => setGooFilterActive(dotsGroup, false), null, "resolve");
  tl.to(
    atRiskCircles,
    {
      opacity: 0,
      duration: 0.6,
      stagger: { amount: 0.4, from: "random" },
    },
    "resolve"
  );
  tl.to(
    Object.values(resolvedCircles),
    {
      opacity: 1,
      duration: 0.6,
      stagger: 0.1,
    },
    "resolve+=0.2"
  );

  // Phase 7: click interactivity on the resolved circles. Deliberately
  // set up OUTSIDE the timeline (not tied to any scroll label) — clicking
  // is a discrete user action independent of scroll position, and should
  // keep working whether the pin is still active or has already released.
  attachProfileClickHandlers(resolvedCircles, profileLabelElements, profileCentroids, profileBreakdown, data, viewBox);
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
 * Phase 7 — click interactivity on the three resolved profile circles.
 * Clicking one shows a detail panel (HIGH/MEDIUM breakdown + suggested
 * strategy for that profile) and visually de-emphasizes the other two
 * circles (shrink + reposition to the bottom), while the clicked circle
 * grows and moves to upper-center. Clicking the same circle again, or
 * the panel's "back" link, reverses everything.
 *
 * Deliberately independent of the scroll timeline — this is a discrete
 * click action, not a scroll-scrubbed one, so plain gsap.to() calls are
 * used here rather than anything tied to the pinned ScrollTrigger.
 *
 * @param {object} resolvedCircles - label -> SVGCircleElement (from _createResolvedCircles)
 * @param {object} profileLabelElements - label -> SVGTextElement (from _createProfileLabels)
 * @param {object} profileCentroids - label -> {x,y}, the ORIGINAL (unfocused) positions
 * @param {object} profileBreakdown - data.summary.risk_profile_breakdown
 * @param {object} data - Full predictions.json payload
 * @param {SVGRect} viewBox - The SVG's viewBox.baseVal
 */
function attachProfileClickHandlers(resolvedCircles, profileLabelElements, profileCentroids, profileBreakdown, data, viewBox) {
  const detailPanel = document.getElementById("risk-journey-detail");
  const demographicsPanel = document.getElementById("risk-journey-demographics");
  const backBtn = document.getElementById("risk-journey-detail-back");
  const ctaBtn = document.getElementById("risk-journey-detail-cta");

  const detailNameEl = document.getElementById("risk-journey-detail-name");
  const detailHighEl = document.getElementById("risk-journey-detail-high");
  const detailMediumEl = document.getElementById("risk-journey-detail-medium");
  const detailStrategyEl = document.getElementById("risk-journey-detail-strategy");

  let selectedLabel = null;

  // Each profile's TRUE base radius (unfocused state) — needed so the
  // "focused" scaled size is computed relative to that profile's actual
  // size, not a one-size-fits-all constant. A 38-student blob and a
  // 20-student blob shouldn't shrink to the same absolute radius.
  const baseRadii = {};
  Object.keys(PROFILE_CENTROID_FRACS).forEach((label) => {
    baseRadii[label] = _clusterRadius(profileBreakdown[label] || 0, CLUSTER_TIGHTNESS_K);
  });

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

  function selectProfile(label) {
    selectedLabel = label;

    const selectedCentroid = {
      x: viewBox.width * FOCUSED_SELECTED_FRAC.x,
      y: viewBox.height * FOCUSED_SELECTED_FRAC.y,
    };
    const selectedRadius = baseRadii[label] * FOCUSED_SELECTED_SCALE;

    gsap.to(resolvedCircles[label], {
      duration: 0.7,
      ease: "power2.inOut",
      attr: { cx: selectedCentroid.x, cy: selectedCentroid.y, r: selectedRadius },
    });
    resolvedCircles[label].classList.add("risk-journey__resolved-circle--selected");
    // The clicked circle's own floating label fades out — its name is
    // already shown prominently as the detail panel's heading, so
    // keeping both visible would be redundant.
    _animateLabelTo(profileLabelElements[label], selectedCentroid.x, selectedCentroid.y, selectedRadius, 0, 0.4);

    const otherLabels = Object.keys(PROFILE_CENTROID_FRACS).filter((l) => l !== label);
    otherLabels.forEach((otherLabel, i) => {
      const frac = FOCUSED_OTHER_FRACS[i];
      const centroid = { x: viewBox.width * frac.x, y: viewBox.height * frac.y };
      const radius = baseRadii[otherLabel] * FOCUSED_OTHER_SCALE;

      gsap.to(resolvedCircles[otherLabel], {
        duration: 0.7,
        ease: "power2.inOut",
        attr: { cx: centroid.x, cy: centroid.y, r: radius },
      });
      resolvedCircles[otherLabel].classList.remove("risk-journey__resolved-circle--selected");
      _animateLabelTo(profileLabelElements[otherLabel], centroid.x, centroid.y, radius, 1, 0.7);
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

    if (demographicsPanel) gsap.to(demographicsPanel, { opacity: 0, duration: 0.3 });
    if (detailPanel) {
      detailPanel.style.pointerEvents = "auto";
      gsap.to(detailPanel, { opacity: 1, duration: 0.4, delay: 0.15 });
    }
  }

  function deselectProfile() {
    if (!selectedLabel) return;

    Object.keys(PROFILE_CENTROID_FRACS).forEach((label) => {
      const centroid = profileCentroids[label];
      const radius = baseRadii[label];

      gsap.to(resolvedCircles[label], {
        duration: 0.6,
        ease: "power2.inOut",
        attr: { cx: centroid.x, cy: centroid.y, r: radius },
      });
      resolvedCircles[label].classList.remove("risk-journey__resolved-circle--selected");
      _animateLabelTo(profileLabelElements[label], centroid.x, centroid.y, radius, 1, 0.6);
    });

    if (detailPanel) {
      detailPanel.style.pointerEvents = "none";
      gsap.to(detailPanel, { opacity: 0, duration: 0.3 });
    }
    if (demographicsPanel) {
      gsap.to(demographicsPanel, { opacity: 1, duration: 0.4, delay: 0.15 });
    }

    selectedLabel = null;
  }

  Object.keys(resolvedCircles).forEach((label) => {
    resolvedCircles[label].addEventListener("click", () => {
      if (selectedLabel === label) {
        deselectProfile();
      } else {
        selectProfile(label);
      }
    });
  });

  if (backBtn) backBtn.addEventListener("click", deselectProfile);

  if (ctaBtn) {
    ctaBtn.addEventListener("click", () => {
      // Phase 8 hook — student-level drill-down not yet built.
      console.log("[riskJourney] See detailed data clicked for:", selectedLabel);
    });
  }
}

/**
 * Sets up the entrance and main pinned sequence, or skips straight to
 * the final CSS-driven state if GSAP is unavailable entirely, or the
 * user prefers reduced motion.
 *
 * Entrance and the main sequence have DIFFERENT dependencies: entrance
 * (animateEntranceOnLoad) only needs GSAP core — no ScrollTrigger, since
 * it's a pure load-triggered timeline now, not scroll-position-driven.
 * The main sequence (animateMainSequence) needs ScrollTrigger for its
 * pin/scrub behavior. If ScrollTrigger specifically is unavailable but
 * GSAP core is present, entrance still runs — a graceful partial
 * degradation rather than an all-or-nothing check.
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

  // Entrance runs regardless of ScrollTrigger's availability — it never
  // needed it in the first place.
  animateEntranceOnLoad(circles, data);

  if (typeof ScrollTrigger === "undefined") {
    console.warn("[riskJourney] ScrollTrigger unavailable — pinned sequence skipped, entrance-only.");
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
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
      `[riskJourney] Rendered ${data.students.length} dots — load entrance, then pinned colorwash/merge/isolate/profiles/resolve sequence.`
    );
  } catch (err) {
    console.error("[riskJourney]", err.message);
  }
}

window.addEventListener("load", bootRiskJourney);
