/**
 * riskJourney.js — Scroll-Driven Risk Narrative
 * ===============================================
 * Renders the "Students don't disappear, they fade" interactive sequence:
 * student dots that animate in, wash into risk color as the user scrolls,
 * merge into two clusters (healthy / at-risk), then split the at-risk
 * cluster into three clickable behavioral profiles with a student-level
 * drill-down.
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
 *   - Lay out one <circle> per student in a grid inside an SVG canvas
 *   - Dots grow in with a one-time staggered entrance as the section
 *     scrolls into view (animateDotEntrance)
 *   - Dots then wash from neutral grey to their risk-tier color as the
 *     user continues scrolling, WHILE the left-side copy crossfades from
 *     a general intro panel to a threshold/legend panel — both driven by
 *     one shared GSAP timeline (animateColorAndCopyTransition) so they
 *     can never drift out of sync with each other. This is scrub-tied,
 *     not one-time, so it's directly and reversibly linked to scroll
 *     position — scrolling back up brings back the intro copy and the
 *     grey dots together
 *   - Both animations read color values live from CSS custom properties
 *     (--c-red/--c-yellow/--c-green/--c-border) rather than duplicating
 *     hex values in JS — main.css stays the single source of truth for
 *     the palette, the same principle already applied to dataset numbers
 *   - Graceful degradation: if GSAP/ScrollTrigger are unavailable, or the
 *     user has requested reduced motion, dots render directly in their
 *     final state (full size, correctly colored via the CSS attribute
 *     selectors from Phase 2) — no motion is required for the page to be
 *     correct
 *
 * Not yet built:
 *   Phase 3 — metaball merge proof-of-concept (scrub-able)
 *   Phase 4 — wire merge into real data, isolate at-risk cluster
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

// Scroll zones for the two-stage animation, expressed as ScrollTrigger
// "start"/"end" strings (all relative to #risk-journey's own top edge
// crossing a % of the viewport height). Defined as named constants,
// not inline magic strings, so the relationship between the three zones
// is visible in one place:
//
//   entranceStart ──► entranceEnd   [DWELL: normal scroll]   colorStart ──► colorEnd
//      85%                65%           65% → 45%                45%          15%
//      (scrub, page scrolls   (page scrolls normally,   (PINNED — page freezes;
//       normally)                nothing animates)         scroll drives the
//                                                            color/copy tween;
//                                                            unpins at colorEnd)
//
// The dwell gap (entranceEnd to colorStart) is deliberate: it guarantees
// the user has a comfortable stretch of plain scrolling where the fully-
// grown, fully-grey dot grid and intro copy just sit still and readable,
// before Stage 2 begins. Without a gap, Stage 2 could start the instant
// Stage 1's scrub reaches 100%, which reads as rushed even though it's
// no longer racing against wall-clock time.
//
// Only the color/copy stage is pinned (see animateColorAndCopyTransition).
// Entrance and the dwell zone both scroll normally — pinning is reserved
// for the moment where scroll input needs to drive an animation instead
// of moving the page.
const SCROLL_ZONES = {
  entranceStart: "top 85%",
  entranceEnd: "top 0%",
  colorStart: "top 5%",
  colorEnd: "bottom 50%",
};

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
 * Every circle carries data-user-id and data-risk-label attributes. The
 * risk-tier fill color itself is applied by CSS attribute selectors
 * (main.css), not set here — this function only lays out geometry and
 * identity. animateDotEntrance/animateDotColorWash (below) layer motion
 * on top of that CSS-driven final state; if GSAP is ever unavailable,
 * this function alone still produces a fully correct, fully colored
 * static grid.
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
    },
  });
}

/**
 * Stage 2 — continuous color wash + copy crossfade, one shared timeline.
 * Once dots have appeared, their fill transitions from neutral grey to
 * their risk-tier color as the user keeps scrolling — and the left-side
 * copy crossfades from the intro panel to the threshold/legend panel in
 * the same motion. Both live inside ONE gsap.timeline() with a single
 * scrollTrigger, rather than two separate triggers, specifically so they
 * can never drift out of sync with each other — two independent scrubbed
 * triggers watching the same trigger element should normally agree, but
 * a single shared timeline guarantees it structurally rather than by
 * coincidence.
 *
 * PINNED: this stage locks #risk-journey in place on screen for its
 * entire scroll range (SCROLL_ZONES.colorStart → colorEnd). Nothing on
 * screen moves — no scrolling of the section, no repositioning of the
 * dots — the ONLY thing scroll input does during this stage is advance
 * the color wash + copy crossfade. The section releases and normal
 * scrolling resumes automatically once colorEnd is reached.
 *
 * Uses scrub (not once) because "as the user scrolls" implies a live,
 * reversible link to scroll position — scrolling back up should both
 * un-color the dots AND bring the intro copy back, unlike the one-time
 * dot entrance above.
 *
 * @param {SVGElement[]} circles - The <circle> elements to animate
 */
function animateColorAndCopyTransition(circles) {
  const greyColor = _resolveCSSColor("--c-border");
  const riskColorMap = {
    HIGH: _resolveCSSColor("--c-red"),
    MEDIUM: _resolveCSSColor("--c-yellow"),
    LOW: _resolveCSSColor("--c-green"),
  };

  gsap.set(circles, { fill: greyColor });

  const introPanel = document.getElementById("risk-journey-intro");
  const thresholdPanel = document.getElementById("risk-journey-thresholds");

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: "#risk-journey",
      start: SCROLL_ZONES.colorStart,
      end: SCROLL_ZONES.colorEnd,
      scrub: 1,
      // Pins the section in place on screen for this entire scroll range.
      // Nothing visually scrolls while this stage plays out — continued
      // scroll input drives the color wash + copy crossfade instead of
      // moving the page. GSAP automatically inserts spacing to prevent
      // the rest of the page from jumping when the section unpins at
      // colorEnd and normal scrolling resumes.
      pin: true,
      pinSpacing: true,
    },
  });

  // Dot color wash — each dot resolves its own destination color via a
  // per-element callback reading its data-risk-label, since HIGH/MEDIUM/LOW
  // dots are interspersed throughout the grid.
  tl.to(
    circles,
    {
      fill: (index, target) => riskColorMap[target.dataset.riskLabel] || greyColor,
      stagger: { amount: 0.6, from: "random" },
    },
    0
  );

  // Copy crossfade — added at the same timeline position (0) as the color
  // wash above, so both play out over the identical scrub range. Guarded
  // independently in case the panels are ever removed from the page.
  if (introPanel && thresholdPanel) {
    tl.to(introPanel, { opacity: 0, duration: 0.4 }, 0);
    tl.to(thresholdPanel, { opacity: 1, duration: 0.4 }, 0);
  }
}

/**
 * Sets up both animation stages for the dot grid, or skips straight to
 * the final CSS-driven state if GSAP/ScrollTrigger aren't available or
 * the user prefers reduced motion.
 *
 * @param {SVGElement} svg - The SVG element returned by renderDotGrid()
 */
function initDotAnimations(svg) {
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
  animateColorAndCopyTransition(circles);
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
    const svg = renderDotGrid(container, data.students);
    initDotAnimations(svg);
    console.log(
      `[riskJourney] Rendered ${data.students.length} dots with entrance + color-wash animation.`
    );
  } catch (err) {
    console.error("[riskJourney]", err.message);
  }
}

window.addEventListener("load", bootRiskJourney);
