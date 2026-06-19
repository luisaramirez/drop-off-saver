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

function _buildTooltipContent(student) {
  const f = student.features;
  return [
    `Login gap:    ${f.days_since_last_login}d`,
    `Completion:   ${(f.avg_completion_rate * 100).toFixed(0)}%`,
    `Assessments:  ${(f.assessment_participation_ratio * 100).toFixed(0)}%`,
    `Engagement:   ${(f.engagement_score * 100).toFixed(0)}%`,
  ].join("\n");
}

/**
 * Builds the roster table from at-risk students only.
 * Safe students (LOW) are excluded — instructors don't need to see them.
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

    const topSignal = SIGNAL_LABEL_MAP[student.top_signals[0]] || student.top_signals[0];

    tr.innerHTML = `
      <td><span class="user-id">${student.user_id}</span></td>
      <td>
        <span class="risk-score ${_riskScoreClass(student.risk_label)}">
          ${(student.risk_score * 100).toFixed(0)}%
        </span>
      </td>
      <td><span class="risk-badge risk-badge--${student.risk_label}">${student.risk_label}</span></td>
      <td><span class="signal-tag">${topSignal}</span></td>
      <td><span class="action-text">${student.recommended_action}</span></td>
    `;

    // Tooltip — feature breakdown on hover
    const tooltipContent = _buildTooltipContent(student);
    tr.addEventListener("mouseenter", (e) => showTooltip(e, tooltipContent));
    tr.addEventListener("mousemove",  (e) => moveTooltip(e));
    tr.addEventListener("mouseleave", hideTooltip);

    tbody.appendChild(tr);
  });

  // Wire filter buttons after rows are built
  _wireFilterButtons(atRisk);
}

function _wireFilterButtons(atRiskStudents) {
  const buttons = document.querySelectorAll(".filter-btn");
  const visibleCount = document.getElementById("roster-visible-count");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.filter;

      // Update active state
      buttons.forEach((b) => b.classList.remove("filter-btn--active"));
      btn.classList.add("filter-btn--active");

      // Show/hide rows
      const rows = document.querySelectorAll("#roster-tbody tr");
      let visible = 0;
      rows.forEach((row) => {
        const match = filter === "all" || row.dataset.risk === filter;
        row.style.display = match ? "" : "none";
        if (match) visible++;
      });

      visibleCount.textContent = visible;
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

  // --- Signal cards stagger ---
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
