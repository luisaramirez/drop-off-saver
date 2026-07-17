/**
 * app.js — GSAP Scroll Narrative Orchestrator
 * ============================================
 * Consumes predictions.json and drives all scroll-triggered animations.
 *
 * Data flow:
 *   fetch("assets/predictions.json")
 *     → populate hero stats (counter animation)
 *     → populate roster table (staggered row reveal)
 *     → pass risk distribution data to charts.js
 *     → GSAP ScrollTrigger wires each section's entrance animation
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
 * populateSignalCards() sorts feature_importances descending and builds
 * cards ONLY for whichever 3 keys come out on top for the current trained
 * model — this map has to cover all 9 possible features (not just 3)
 * since a retrain on a different dataset can shift which ones matter most.
 *
 * Each icon is a hand-drawn SVG string in the same visual language as the
 * rest of the page: 48x48 viewBox, currentColor stroke, stroke-width 2,
 * rounded caps/joins — kept minimal and geometric rather than a symbol
 * library, matching the existing hero/system-node icon style.
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
// Hero stats — animated counters
// ---------------------------------------------------------------------------

/**
 * Animates a numeric counter from 0 to targetValue using GSAP.
 * @param {HTMLElement} el  - The element to update
 * @param {number} target   - The final value
 * @param {number} decimals - Decimal places (default 0)
 */
function animateCounter(el, target, decimals = 0) {
  const obj = { val: 0 };
  gsap.to(obj, {
    val: target,
    duration: 1.8,
    ease: "power3.out",
    onUpdate() {
      el.textContent = decimals > 0
        ? obj.val.toFixed(decimals)
        : Math.round(obj.val).toLocaleString();
    },
  });
}

function populateHeroStats(summary) {
  const statTotal = document.getElementById("stat-total");
  const statRisk  = document.getElementById("stat-risk");

  document.querySelectorAll(".stat-card").forEach((card) => {
    card.classList.remove("stat-card--loading");
    card.classList.add("stat-card--loaded");
  });

  animateCounter(statTotal.querySelector(".stat-card__value"), summary.total_students);
  animateCounter(statRisk.querySelector(".stat-card__value"),  summary.at_risk_count);
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

// ---------------------------------------------------------------------------
// GSAP — ScrollTrigger animations
// ---------------------------------------------------------------------------

function initScrollAnimations() {
  gsap.registerPlugin(ScrollTrigger);

  // --- Hero entrance ---
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

  tl.to(".hero__eyebrow", { opacity: 1, y: 0, duration: 0.7 })
    .from(".hero__headline-line", {
      yPercent: 110,
      stagger: 0.12,
      duration: 0.9,
      ease: "power4.out",
    }, "-=0.3")
    .to(".hero__subhead", { opacity: 1, y: 0, duration: 0.7 }, "-=0.4")
    .to(".hero__scroll-cue", { opacity: 1, duration: 0.5 }, "-=0.1");

  // Hero stat cards stagger in after data loads (triggered via JS after fetch)
  gsap.set(".stat-card", { opacity: 0, y: 20 });

  // --- Section headings (scroll-triggered) ---
  document.querySelectorAll(".reveal-text").forEach((el) => {
    gsap.to(el, {
      scrollTrigger: { trigger: el, start: "top 80%", once: true },
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: "power3.out",
    });
  });

  // NOTE: Signal card stagger + weight bars are NOT set up here. Those
  // cards don't exist in the DOM yet at this point in the boot sequence —
  // #signal-grid is an empty container until populateSignalCards() builds
  // it from live feature_importances data. See initSignalCardReveal(),
  // called separately from boot() right after the cards are constructed.

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
 * Sets up the scroll-triggered stagger reveal for the Signal section's
 * cards, plus the weight-bar fill animation that follows it.
 *
 * Split out from initScrollAnimations() because — unlike every other
 * scroll-triggered element on the page, which exists in static HTML from
 * first paint — the .signal-card elements are constructed at runtime by
 * populateSignalCards() once feature_importances has been fetched. A
 * ScrollTrigger registered against ".signal-card" before those elements
 * exist would match an empty NodeList and silently do nothing. Calling
 * this function AFTER populateSignalCards() guarantees the elements are
 * already in the DOM when GSAP looks for them.
 */
function initSignalCardReveal() {
  gsap.to(".signal-card", {
    scrollTrigger: {
      trigger: ".signal-grid",
      start: "top 75%",
      once: true,
    },
    opacity: 1,
    y: 0,
    stagger: 0.12,
    duration: 0.7,
    ease: "power3.out",
    onComplete: animateWeightBars,
  });
}

/**
 * Animates the feature importance weight bars on the signal cards.
 * Width targets are set via data-weight attributes in the HTML.
 */
function animateWeightBars() {
  document.querySelectorAll(".signal-card__weight-fill").forEach((bar) => {
    const weight = parseFloat(bar.dataset.weight || 0);
    gsap.to(bar, {
      width: `${weight * 100}%`,
      duration: 1.0,
      ease: "power3.out",
      delay: 0.1,
    });
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

/**
 * Animates hero stat cards in after data is loaded.
 */
function animateStatCards() {
  gsap.to(".stat-card", {
    opacity: 1,
    y: 0,
    stagger: 0.12,
    duration: 0.7,
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

  // Note: signal-card weight bars are NOT patched here. populateSignalCards()
  // builds those cards from scratch with the correct data-weight value
  // already baked in at creation time — see below.
}

/**
 * Builds the Signal section's 3 cards entirely from feature_importances,
 * rather than relying on hardcoded HTML. This exists because a retrain
 * on a different-sized dataset can change not just the WEIGHT PERCENTAGES
 * shown, but which 3 features are actually most predictive — a card
 * hardcoded as "Completion stall" is misleading if avg_completion_rate
 * has dropped out of the true top 3 for the current model. Rebuilding
 * the cards from a full content map (SIGNAL_CONTENT_MAP, covering all 9
 * possible features) keeps the claim "these are the three most influential
 * variables" honest regardless of dataset size or retrain.
 *
 * @param {object} data - Full predictions.json payload
 */
function populateSignalCards(data) {
  const container = document.getElementById("signal-grid");
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
      // added to features.py without a matching card written here).
      console.warn(
        `[Drop-off Saver] No SIGNAL_CONTENT_MAP entry for "${featureKey}" — skipping card.`
      );
      return;
    }

    const card = document.createElement("div");
    card.className = "signal-card";
    card.dataset.signal = featureKey;
    card.innerHTML = `
      <div class="signal-card__icon">${content.icon}</div>
      <h3 class="signal-card__title">${content.title}</h3>
      <p class="signal-card__body">${content.body}</p>
      <div class="signal-card__weight">
        <span class="signal-card__weight-label">Model weight</span>
        <div class="signal-card__weight-bar">
          <div class="signal-card__weight-fill" data-feature-key="${featureKey}" data-weight="${importance.toFixed(2)}" style="width: 0%"></div>
        </div>
      </div>
    `;
    container.appendChild(card);
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
    populateHeroStats(data.summary);
    animateStatCards();

    populateNarrativeCopy(data);

    populateSignalCards(data);
    initSignalCardReveal();

    populateRoster(data.students);
    animateRosterRows();

    populateFooter(data.generated_at);

    // Pass data to chart module (charts.js exposes window.renderCharts)
    if (typeof window.renderCharts === "function") {
      window.renderCharts(data);
    }

  } catch (err) {
    console.error("[Drop-off Saver]", err.message);

    // Graceful degradation: show a visible error for the demo context
    const heroContent = document.querySelector(".hero__content");
    if (heroContent) {
      const errorEl = document.createElement("div");
      errorEl.style.cssText = "margin-top:2rem;padding:1rem 1.25rem;border:1px solid #e8453c;border-radius:6px;font-family:monospace;font-size:0.8rem;color:#e8453c;max-width:60ch;";
      errorEl.textContent = `⚠ ${err.message}`;
      heroContent.appendChild(errorEl);
    }
  }
}

// Run after GSAP + Chart.js are loaded
window.addEventListener("load", boot);
