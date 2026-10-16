/**
 * app.js — Page Copy & Roster Orchestrator
 * ============================================
 * Consumes predictions.json and populates all TEXT content across the
 * page — including the Risk Journey section's copy panels — plus the
 * roster table.
 *
 * Data flow:
 *   fetch("assets/predictions.json")
 *     → populate Risk Journey copy panels (student counts, thresholds,
 *       signal features, demographics — populateNarrativeCopy /
 *       populateSignalPanel / populateDemographicsPanel)
 *     → populate roster table (staggered row reveal)
 *     → GSAP ScrollTrigger wires the Roster and System sections' reveal
 *       (Risk Journey's own entrance + pinned sequence live in
 *       riskJourney.js, not here — see that file for why)
 *
 * This module has one external dependency: predictions.json.
 * It knows nothing about Python, sklearn, or how scores were computed.
 */

"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DATA_URL = "assets/predictions.json";
const SIGNAL_LABEL_MAP = {
  days_since_last_login:          "Login recency",
  avg_completion_rate:            "Completion rate",
  assessment_participation_ratio: "Assessment participation",
  forum_posts_last_30d:           "Forum activity",
  video_watch_ratio:              "Video consumption",
  streak_days:                    "Active streak",
  engagement_score:               "Engagement score",
  recency_penalty:                "Recency penalty",
  participation_gap:              "Participation gap",
};

/**
 * Content for every possible feature the model can rank as top-3.
 * populateSignalPanel() sorts feature_importances descending and builds
 * list items ONLY for whichever 3 keys come out on top for the current
 * trained model — this map has to cover all 9 possible features (not
 * just 3) since a retrain on a different dataset can shift which ones
 * matter most.
 *
 * The `icon` field is currently UNUSED — the Signal section moved from
 * a card layout (which had room for icons) to a compact list inside the
 * Risk Journey copy-stack (narrow column, no room for icons alongside
 * title/weight/body for three features at once). Left in place rather
 * than deleted, in case a future layout has room for them again.
 */
const SIGNAL_CONTENT_MAP = {
  days_since_last_login: {
    title: "Recency drift",
    body: "Login gaps compound. A student missing one week is recoverable. Missing three weeks is almost always a permanent exit.",
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/>
      <path d="M24 12v12l8 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
  },
  avg_completion_rate: {
    title: "Completion stall",
    body: "Progress doesn't stop suddenly. It slows — then freezes. A stalled completion rate is a critical early warning.",
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="8" y="8" width="32" height="32" rx="4" stroke="currentColor" stroke-width="2"/>
      <path d="M16 24l6 6 10-12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  },
  assessment_participation_ratio: {
    title: "Assessment silence",
    body: "Skipping quizzes is a leading indicator, not a lagging one. Students who disengage from assessments first, drop out second.",
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 36L24 12l12 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M17 28h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
  },
  forum_posts_last_30d: {
    title: "Community silence",
    body: "Forum activity is a low-effort signal of belonging. When it disappears entirely, the course has often stopped feeling like a place to show up for.",
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10 12h28a2 2 0 012 2v16a2 2 0 01-2 2H24l-8 8v-8h-6a2 2 0 01-2-2V14a2 2 0 012-2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  },
  video_watch_ratio: {
    title: "Passive viewing",
    body: "Watching drops off more slowly than testing does. By the time video consumption falls too, disengagement is usually already advanced.",
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/>
      <path d="M20 16l12 8-12 8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>`,
  },
  streak_days: {
    title: "Broken streak",
    body: "A long streak is momentum — students protect it. Once broken, there's no habit left pulling them back to the course tomorrow.",
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M24 8c-1 6-9 10-9 19a9 9 0 0018 0c0-3-1-5-3-7-1 3-3 4-4 4 1-6-1-11-2-16z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  },
  engagement_score: {
    title: "Composite engagement",
    body: "No single signal tells the whole story. This blended score weighs completion, assessments, video, and community activity into one number.",
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 32a16 16 0 0132 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M24 32l7-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="24" cy="32" r="2.5" stroke="currentColor" stroke-width="2"/>
    </svg>`,
  },
  recency_penalty: {
    title: "Accelerating absence",
    body: "The cost of being away isn't linear. Each additional day gone matters more than the last — risk compounds, it doesn't just add up.",
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 14c8 1 13 6 15 12s6 10 12 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M29 30l6 6m0 0v-6m0 6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  },
  participation_gap: {
    title: "Watching without testing",
    body: "Some students keep consuming content while quietly opting out of being evaluated. That gap between watching and testing is often the earliest tell.",
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16 32V16m0 0l-5 5m5-5l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M32 16v16m0 0l-5-5m5 5l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  },
};

// ---------------------------------------------------------------------------
// Data ingestion
// ---------------------------------------------------------------------------

/**
 * Fetches and validates predictions.json.
 * Returns the parsed payload or throws with a clear message.
 */
async function loadPredictions() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to load ${DATA_URL}: ${response.status} ${response.statusText}. ` +
      `Run "python src/notifier.py" to generate the data file.`
    );
  }
  const data = await response.json();
  if (!data.students || !data.summary) {
    throw new Error("predictions.json is missing required fields: students, summary.");
  }
  return data;
}

// ---------------------------------------------------------------------------
// Roster table — build rows from predictions
// ---------------------------------------------------------------------------

function _riskScoreClass(label) {
  const map = { HIGH: "risk-score--high", MEDIUM: "risk-score--medium", LOW: "risk-score--low" };
  return map[label] || "risk-score--low";
}

/**
 * Maps a risk profile label to a CSS modifier class for badge styling.
 * Falls back to a neutral style for any unrecognized or null profile
 * (e.g. the "Needs Review" fallback profiler.py emits for edge cases).
 */
function _profileBadgeClass(profileLabel) {
  const map = {
    "Time-Constrained":    "profile-badge--time-constrained",
    "Disengaged Learner":  "profile-badge--disengaged",
    "Quiet Decliner":      "profile-badge--quiet-decliner",
  };
  return map[profileLabel] || "profile-badge--default";
}

function _buildTooltipContent(student) {
  const f = student.features;
  const d = student.demographics;
  const lines = [
    `Login gap:    ${f.days_since_last_login}d`,
    `Completion:   ${(f.avg_completion_rate * 100).toFixed(0)}%`,
    `Assessments:  ${(f.assessment_participation_ratio * 100).toFixed(0)}%`,
    `Engagement:   ${(f.engagement_score * 100).toFixed(0)}%`,
  ];
  if (d) {
    lines.push("");
    lines.push(`Age:          ${d.age_bracket}`);
    lines.push(`Employment:   ${d.employment_status}`);
    lines.push(`Dependents:   ${d.has_dependents ? "Yes" : "No"}`);
  }
  if (student.risk_profile) {
    lines.push("");
    lines.push(student.risk_profile.description);
  }
  return lines.join("\n");
}

/**
 * Builds the roster table from at-risk students only.
 * Safe students (LOW) are excluded — instructors don't need to see them.
 *
 * Each row shows the student's risk profile (from K-Means clustering in
 * profiler.py) instead of a generic tier-based action. The profile's
 * tailored strategy is more actionable than "schedule a check-in" applied
 * uniformly to every at-risk student regardless of why they're at risk.
 *
 * @param {Array} students - Full student array from predictions.json
 */
function populateRoster(students) {
  const tbody = document.getElementById("roster-tbody");
  const atRisk = students.filter((s) => s.risk_label !== "LOW");

  document.getElementById("roster-visible-count").textContent = atRisk.length;

  tbody.innerHTML = "";

  atRisk.forEach((student) => {
    const tr = document.createElement("tr");
    tr.dataset.risk = student.risk_label;
    tr.dataset.profile = student.risk_profile ? student.risk_profile.label : "none";

    const profile = student.risk_profile;
    const profileBadge = profile
      ? `<span class="profile-badge ${_profileBadgeClass(profile.label)}">${profile.label}</span>`
      : `<span class="profile-badge profile-badge--default">—</span>`;
    const actionText = profile ? profile.suggested_strategy : student.recommended_action;

    tr.innerHTML = `
      <td><span class="user-id">${student.user_id}</span></td>
      <td>
        <span class="risk-score ${_riskScoreClass(student.risk_label)}">
          ${(student.risk_score * 100).toFixed(0)}%
        </span>
      </td>
      <td><span class="risk-badge risk-badge--${student.risk_label}">${student.risk_label}</span></td>
      <td>${profileBadge}</td>
      <td><span class="action-text">${actionText}</span></td>
    `;

    // Tooltip — feature + demographic breakdown on hover
    const tooltipContent = _buildTooltipContent(student);
    tr.addEventListener("mouseenter", (e) => showTooltip(e, tooltipContent));
    tr.addEventListener("mousemove",  (e) => moveTooltip(e));
    tr.addEventListener("mouseleave", hideTooltip);

    tbody.appendChild(tr);
  });

  // Wire filter buttons after rows are built
  _wireFilterButtons(atRisk);
}

/**
 * Wires both filter groups: risk-level (existing) and risk-profile (new).
 * Each group operates independently — they filter on different dataset
 * attributes (data-risk vs data-profile) and combine with AND logic, so
 * a user can narrow to e.g. "HIGH risk" + "Time-Constrained" simultaneously.
 */
function _wireFilterButtons(atRiskStudents) {
  const riskButtons = document.querySelectorAll(".filter-btn[data-filter]");
  const profileButtons = document.querySelectorAll(".filter-btn[data-profile-filter]");
  const visibleCount = document.getElementById("roster-visible-count");

  let activeRiskFilter = "all";
  let activeProfileFilter = "all";

  function applyFilters() {
    const rows = document.querySelectorAll("#roster-tbody tr");
    let visible = 0;
    rows.forEach((row) => {
      const riskMatch = activeRiskFilter === "all" || row.dataset.risk === activeRiskFilter;
      const profileMatch = activeProfileFilter === "all" || row.dataset.profile === activeProfileFilter;
      const match = riskMatch && profileMatch;
      row.style.display = match ? "" : "none";
      if (match) visible++;
    });
    visibleCount.textContent = visible;
  }

  riskButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeRiskFilter = btn.dataset.filter;
      riskButtons.forEach((b) => b.classList.remove("filter-btn--active"));
      btn.classList.add("filter-btn--active");
      applyFilters();
    });
  });

  profileButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeProfileFilter = btn.dataset.profileFilter;
      profileButtons.forEach((b) => b.classList.remove("filter-btn--active"));
      btn.classList.add("filter-btn--active");
      applyFilters();
    });
  });
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

const tooltip  = document.getElementById("tooltip");
const tooltipContent = document.getElementById("tooltip-content");

function showTooltip(e, content) {
  tooltipContent.textContent = content;
  tooltip.setAttribute("aria-hidden", "false");
  moveTooltip(e);
}

function moveTooltip(e) {
  const offset = 16;
  tooltip.style.left = `${e.clientX + offset}px`;
  tooltip.style.top  = `${e.clientY + offset}px`;
}

function hideTooltip() {
  tooltip.setAttribute("aria-hidden", "true");
}

// Exposed globally so riskJourney.js's student drill-down dots can reuse
// this EXACT tooltip system — same DOM element, same content format as
// the roster table rows. There is only one #tooltip element on the page;
// having two independent JS modules each build their own would either
// require a second DOM element (visually inconsistent, more markup to
// keep in sync) or silently fight over this one (last mouseover wins,
// unpredictably). One owner, two callers, is the simpler structure.
window.riskJourneyTooltip = {
  show: showTooltip,
  move: moveTooltip,
  hide: hideTooltip,
  buildContent: _buildTooltipContent,
};

// ---------------------------------------------------------------------------
// GSAP — ScrollTrigger animations
// ---------------------------------------------------------------------------

function initScrollAnimations() {
  gsap.registerPlugin(ScrollTrigger);

  // --- Section headings (scroll-triggered) ---
  // Still used by the Roster and System sections, which are untouched.
  // The Risk Journey section's own headings are NOT in this list — its
  // entrance is a load-triggered timeline owned by riskJourney.js
  // (animateEntranceOnLoad), and its later panels crossfade via that
  // same file's pinned main sequence, neither of which needs this
  // generic scroll-into-view reveal.
  document.querySelectorAll(".reveal-text").forEach((el) => {
    gsap.to(el, {
      scrollTrigger: { trigger: el, start: "top 80%", once: true },
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: "power3.out",
    });
  });

  // --- System nodes stagger ---
  gsap.to(".system-node", {
    scrollTrigger: {
      trigger: ".system-flow",
      start: "top 75%",
      once: true,
    },
    opacity: 1,
    y: 0,
    stagger: 0.15,
    duration: 0.7,
    ease: "power3.out",
  });
}

/**
 * Stagger-animates the roster rows into view once the table is populated.
 * Called after populateRoster() builds the DOM.
 */
function animateRosterRows() {
  const rows = document.querySelectorAll("#roster-tbody tr");
  gsap.to(rows, {
    scrollTrigger: {
      trigger: "#roster-table",
      start: "top 80%",
      once: true,
    },
    opacity: 1,
    x: 0,
    stagger: 0.04,
    duration: 0.5,
    ease: "power3.out",
  });
}

// ---------------------------------------------------------------------------
// Narrative copy — dynamic placeholders
// ---------------------------------------------------------------------------

/**
 * Replaces every hardcoded numeric claim in the page's static copy with
 * the live value from predictions.json. Without this, retraining on a
 * differently-sized dataset (e.g. regenerating students.csv with 700 rows
 * instead of 500) silently leaves stale numbers sitting in the HTML —
 * "500 students tracked", feature-importance percentages, and risk
 * threshold values would all describe a dataset that no longer exists.
 *
 * Threshold values use a BROADCAST pattern: rather than one `id` per
 * element (which needs new JS wiring every time the same number appears
 * in a new place — e.g. once in the Distribution legend, then again in
 * the Risk Journey legend), elements share a class (.value-risk-threshold,
 * .value-high-cutoff) and every matching element on the page gets updated
 * in one querySelectorAll pass. Adding a third or fourth legend elsewhere
 * later requires zero changes here — just reuse the same class in HTML.
 *
 * @param {object} data - Full predictions.json payload
 */
function populateNarrativeCopy(data) {
  // --- Risk Journey section: total student count ---
  const journeyCount = document.getElementById("risk-journey-student-count");
  if (journeyCount) {
    journeyCount.textContent = data.summary.total_students.toLocaleString();
  }

  // --- Risk Journey section: at-risk count (profiling-framing panel) ---
  const journeyAtRiskCount = document.getElementById("risk-journey-atrisk-count");
  if (journeyAtRiskCount) {
    journeyAtRiskCount.textContent = data.summary.at_risk_count.toLocaleString();
  }

  // --- Risk threshold values: broadcast to every instance on the page ---
  // data.threshold is the configurable RISK_THRESHOLD (env var in notifier.py).
  // data.high_risk_cutoff is HIGH_RISK_CUTOFF — technically a fixed constant
  // today, but exported rather than hardcoded so the HTML never silently
  // drifts from the Python source of truth if that constant ever changes.
  const thresholdFormatted = data.threshold.toFixed(2);
  const highCutoffFormatted = data.high_risk_cutoff.toFixed(2);

  document.querySelectorAll(".value-risk-threshold").forEach((el) => {
    el.textContent = thresholdFormatted;
  });

  document.querySelectorAll(".value-high-cutoff").forEach((el) => {
    el.textContent = highCutoffFormatted;
  });
}

/**
 * Builds the Risk Journey "signal" panel's content entirely from
 * feature_importances, rather than relying on hardcoded HTML. This
 * exists because a retrain on a different-sized dataset can change not
 * just the WEIGHT PERCENTAGES shown, but which 3 features are actually
 * most predictive — a hardcoded "Completion stall" entry is misleading
 * if avg_completion_rate has dropped out of the true top 3 for the
 * current model. Rebuilding from a full content map (SIGNAL_CONTENT_MAP,
 * covering all 9 possible features) keeps the claim "these are the three
 * most influential variables" honest regardless of dataset size or retrain.
 *
 * Compact list format, not cards — the copy-stack column is narrow
 * (44ch max-width) and needs to show all three features' full info
 * (title, body, weight) simultaneously in one panel, unlike the old
 * Signal section which had a full-width row to spread 3 cards across.
 *
 * This panel's VISIBILITY (when it fades in/out) is controlled entirely
 * by riskJourney.js's shared pinned timeline — this function only ever
 * builds its CONTENT, once, when data first loads.
 *
 * @param {object} data - Full predictions.json payload
 */
function populateSignalPanel(data) {
  const container = document.getElementById("signal-list");
  if (!container || !data.feature_importances) return;

  // Rank all features by importance, descending, and take the top 3.
  const ranked = Object.entries(data.feature_importances).sort(
    (a, b) => b[1] - a[1]
  );
  const top3 = ranked.slice(0, 3);

  container.innerHTML = "";

  top3.forEach(([featureKey, importance]) => {
    const content = SIGNAL_CONTENT_MAP[featureKey];
    if (!content) {
      // Defensive fallback: a feature the model ranked highly but that
      // isn't in the content map yet (e.g. a brand-new engineered feature
      // added to features.py without a matching entry written here).
      console.warn(
        `[Drop-off Saver] No SIGNAL_CONTENT_MAP entry for "${featureKey}" — skipping.`
      );
      return;
    }

    const item = document.createElement("div");
    item.className = "signal-list-item";
    item.dataset.signal = featureKey;
    // Weight bar width is set directly here, not animated — by the time
    // this panel's opacity crossfades to visible (during the "colorwash"
    // segment, much later), the bar is already at its correct width, so
    // there's no separate "fill" moment for the viewer to see anyway.
    item.innerHTML = `
      <div class="signal-list-item__header">
        <span class="signal-list-item__title">${content.title}</span>
        <span class="signal-list-item__weight">${Math.round(importance * 100)}%</span>
      </div>
      <p class="signal-list-item__body">${content.body}</p>
      <div class="signal-list-item__bar">
        <div class="signal-list-item__bar-fill" style="width: ${(importance * 100).toFixed(0)}%"></div>
      </div>
    `;
    container.appendChild(item);
  });
}

/**
 * Builds the Risk Journey "demographics" panel's content by sourcing
 * each profile's description directly from a real student record in
 * predictions.json (student.risk_profile.description) — never a second,
 * hand-typed copy of text that already lives in profiler.py's
 * RISK_PROFILES dict. If that text ever changes in profiler.py, this
 * panel picks up the new wording automatically on the next data refresh,
 * with no matching manual edit required here.
 *
 * PROFILE_ORDER is a display-order choice (left-to-right narrative
 * flow), not "data" — it's fine for this to be a fixed constant, unlike
 * the description text itself.
 *
 * @param {object} data - Full predictions.json payload
 */
const PROFILE_ORDER = ["Time-Constrained", "Disengaged Learner", "Quiet Decliner"];
const PROFILE_DOT_CLASS_MAP = {
  "Time-Constrained": "profile-legend__dot--time-constrained",
  "Disengaged Learner": "profile-legend__dot--disengaged",
  "Quiet Decliner": "profile-legend__dot--quiet-decliner",
};

function populateDemographicsPanel(data) {
  const container = document.getElementById("demographics-list");
  if (!container) return;

  // Find one sample student per profile label — every student sharing a
  // label has identical description text (it's set once per cluster in
  // profiler.py), so the first match found is sufficient.
  const descriptionsByLabel = {};
  for (const student of data.students) {
    if (!student.risk_profile) continue;
    const label = student.risk_profile.label;
    if (!descriptionsByLabel[label]) {
      descriptionsByLabel[label] = student.risk_profile.description;
    }
  }

  container.innerHTML = "";

  PROFILE_ORDER.forEach((label) => {
    const description = descriptionsByLabel[label];
    if (!description) return; // profile absent from current dataset — skip gracefully

    const item = document.createElement("div");
    item.className = "profile-legend__item";
    const dotClass = PROFILE_DOT_CLASS_MAP[label] || "";
    item.innerHTML = `
      <span class="profile-legend__dot ${dotClass}"></span>
      <div>
        <strong>${label}</strong>
        <p>${description}</p>
      </div>
    `;
    container.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// Footer metadata
// ---------------------------------------------------------------------------

function populateFooter(generatedAt) {
  const el = document.getElementById("footer-generated-at");
  if (!el) return;
  const date = new Date(generatedAt);
  el.textContent = `Model scored: ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  try {
    // Initialize GSAP scroll animations before data loads
    initScrollAnimations();

    // Fetch data
    const data = await loadPredictions();

    // Populate UI
    populateNarrativeCopy(data);
    populateSignalPanel(data);
    populateDemographicsPanel(data);

    populateRoster(data.students);
    animateRosterRows();

    populateFooter(data.generated_at);

  } catch (err) {
    console.error("[Drop-off Saver]", err.message);

    // Graceful degradation: show a visible error for the demo context.
    // Anchored to the Risk Journey intro panel now — the hero section
    // (previously used as the error anchor) no longer exists.
    const introPanel = document.getElementById("risk-journey-intro");
    if (introPanel) {
      const errorEl = document.createElement("div");
      errorEl.style.cssText = "margin-top:2rem;padding:1rem 1.25rem;border:1px solid #e8453c;border-radius:6px;font-family:monospace;font-size:0.8rem;color:#e8453c;max-width:60ch;";
      errorEl.textContent = `⚠ ${err.message}`;
      introPanel.appendChild(errorEl);
    }
  }
}

// Run after GSAP + Chart.js are loaded
window.addEventListener("load", boot);
