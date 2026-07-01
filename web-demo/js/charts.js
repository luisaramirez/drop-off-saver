/**
 * charts.js — Chart.js Rendering Module
 * ======================================
 * Consumes the predictions payload (passed from app.js) and renders two
 * charts: the risk score distribution histogram, and the risk profile
 * breakdown (count of at-risk students per behavioral cluster).
 *
 * Exposed globally as window.renderCharts(data) so app.js can call it
 * after data is loaded, regardless of script load order.
 *
 * Design choices:
 *   - Distribution: bar chart binned into 0.1 buckets (0.0–0.1, ... 0.9–1.0)
 *     Color-coded bars: green (safe), yellow (medium), red (high)
 *     Threshold line at the configurable RISK_THRESHOLD from the JSON
 *   - Profiles: horizontal bar chart, one bar per cluster, colored to
 *     match the profile badge palette used in the roster table
 *   - No animation conflicts with GSAP — Chart.js handles its own canvas
 */

"use strict";

// CSS variable tokens (must match main.css)
const C = {
  red:    "#e8453c",
  yellow: "#f5c842",
  green:  "#3ecf8e",
  border: "#282a30",
  muted:  "#4a4f5a",
  amber:  "#f5a623",
  text:   "#8a8f9a",
  bg:     "#141518",
  violet: "#9b8cf2",
  cyan:   "#5ec9e8",
  rose:   "#f28cb8",
};

// Maps a risk_profile_breakdown key (from predictions.json summary) to
// its display color. Falls back to muted grey for any unrecognized label
// (e.g. "Unprofiled" or profiler.py's "Needs Review" fallback).
const PROFILE_COLOR_MAP = {
  "Time-Constrained":   C.violet,
  "Disengaged Learner": C.cyan,
  "Quiet Decliner":     C.rose,
};


/**
 * Bins an array of risk scores into 10 buckets (0.0–1.0 in 0.1 steps).
 *
 * @param {number[]} scores - Array of 0–1 probability scores
 * @returns {{ labels: string[], counts: number[], colors: string[] }}
 */
function binScores(scores, threshold) {
  const buckets = Array(10).fill(0);
  const labels  = [];
  const colors  = [];

  // Build bin labels and color-code by risk tier
  for (let i = 0; i < 10; i++) {
    const lo = (i * 0.1).toFixed(1);
    const hi = ((i + 1) * 0.1).toFixed(1);
    labels.push(`${lo}–${hi}`);

    const midpoint = i * 0.1 + 0.05;
    if (midpoint >= 0.75)      colors.push(C.red);
    else if (midpoint >= threshold) colors.push(C.yellow);
    else                       colors.push(C.green);
  }

  // Count scores into buckets
  scores.forEach((score) => {
    const idx = Math.min(Math.floor(score * 10), 9);
    buckets[idx]++;
  });

  return { labels, counts: buckets, colors };
}

/**
 * Renders the risk distribution bar chart onto #chart-distribution.
 *
 * @param {object} data - Full predictions.json payload
 */
function renderDistributionChart(data) {
  const canvas = document.getElementById("chart-distribution");
  if (!canvas) return;

  const scores    = data.students.map((s) => s.risk_score);
  const threshold = data.threshold || 0.60;
  const { labels, counts, colors } = binScores(scores, threshold);

  // Chart.js global defaults for this dark theme
  Chart.defaults.color         = C.text;
  Chart.defaults.borderColor   = C.border;
  Chart.defaults.font.family   = "'Space Grotesk', system-ui, sans-serif";

  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Students",
          data: counts,
          backgroundColor: colors,
          borderRadius: 3,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 900,
        easing: "easeOutQuart",
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c1e22",
          borderColor: C.border,
          borderWidth: 1,
          padding: 10,
          titleFont: { family: "'Space Mono', monospace", size: 11 },
          bodyFont:  { family: "'Space Mono', monospace", size: 11 },
          callbacks: {
            title: (items) => `Risk score: ${items[0].label}`,
            label: (item)  => `  ${item.raw} students`,
          },
        },
        // Threshold annotation line (drawn manually as a plugin below)
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: "'Space Mono', monospace", size: 10 },
            color: C.muted,
            maxRotation: 0,
          },
          border: { color: C.border },
        },
        y: {
          grid: {
            color: "rgba(40,42,48,0.8)",
            drawBorder: false,
          },
          ticks: {
            font: { family: "'Space Mono', monospace", size: 10 },
            color: C.muted,
            stepSize: 10,
          },
          border: { display: false },
        },
      },
    },
    plugins: [thresholdLinePlugin(threshold, labels)],
  });
}

/**
 * Custom Chart.js plugin that draws a vertical dashed threshold line.
 * Placed at the configurable risk threshold from predictions.json.
 *
 * @param {number} threshold   - The risk cutoff value (e.g. 0.60)
 * @param {string[]} labels    - Bin labels array (for x-position lookup)
 * @returns {object} Chart.js plugin object
 */
function thresholdLinePlugin(threshold, labels) {
  // Find which bin index corresponds to the threshold
  const thresholdBin = Math.floor(threshold * 10);

  return {
    id: "thresholdLine",
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;

      const x = scales.x.getPixelForValue(thresholdBin - 0.5);

      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();

      // Label
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.amber;
      ctx.font = `10px 'Space Mono', monospace`;
      ctx.textAlign = "left";
      ctx.fillText(`threshold ${threshold}`, x + 6, chartArea.top + 14);

      ctx.restore();
    },
  };
}

/**
 * Renders the risk profile breakdown as a horizontal bar chart onto
 * #chart-profiles. Reads directly from data.summary.risk_profile_breakdown,
 * which notifier.py computes server-side — no client-side aggregation
 * of the student list needed here.
 *
 * @param {object} data - Full predictions.json payload
 */
function renderProfileChart(data) {
  const canvas = document.getElementById("chart-profiles");
  if (!canvas) return;

  const breakdown = data.summary.risk_profile_breakdown || {};
  const labels = Object.keys(breakdown);
  const counts = Object.values(breakdown);
  const colors = labels.map((label) => PROFILE_COLOR_MAP[label] || C.muted);

  if (labels.length === 0) {
    // No at-risk students were profiled — nothing meaningful to chart.
    // Leave the canvas empty rather than rendering a misleading empty chart.
    return;
  }

  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Students",
          data: counts,
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: "y", // horizontal bars — reads more naturally for 3 named categories
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 900,
        easing: "easeOutQuart",
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1c1e22",
          borderColor: C.border,
          borderWidth: 1,
          padding: 10,
          titleFont: { family: "'Space Mono', monospace", size: 11 },
          bodyFont:  { family: "'Space Mono', monospace", size: 11 },
          callbacks: {
            label: (item) => `  ${item.raw} students`,
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: "rgba(40,42,48,0.8)",
            drawBorder: false,
          },
          ticks: {
            font: { family: "'Space Mono', monospace", size: 10 },
            color: C.muted,
            precision: 0,
          },
          border: { display: false },
        },
        y: {
          grid: { display: false },
          ticks: {
            font: { family: "'Space Grotesk', sans-serif", size: 12 },
            color: C.text,
          },
          border: { color: C.border },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Public API — called from app.js after data loads
// ---------------------------------------------------------------------------

window.renderCharts = function renderCharts(data) {
  renderDistributionChart(data);
  renderProfileChart(data);
};
