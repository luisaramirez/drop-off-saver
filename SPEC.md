# SPEC.md — Passive-to-Active Drop-off Saver

**Version:** 1.0.0  
**Status:** Active Development  
**Classification:** Portfolio / Public

---

## 1. Problem Statement

Online course platforms suffer from silent churn: students stop engaging weeks
before formally withdrawing. Instructors have no early-warning signal. By the
time a student is identified as at-risk, the intervention window has closed.

**Goal:** Predict, 2–4 weeks in advance, which students have a ≥70% likelihood
of dropping a course, and surface that signal in a human-readable format that
requires no ML expertise to interpret.

---

## 2. Scope

### In Scope
- Synthetic EdTech telemetry generation (reproducible seed)
- Binary classification: `is_at_risk ∈ {0, 1}`
- Intervention trigger logic with configurable threshold
- Static JSON export for frontend consumption
- Animated, scroll-driven web visualization

### Out of Scope
- Real-time scoring (batch inference only)
- LMS integration (Moodle, Canvas, etc.)
- User authentication or multi-tenant data isolation

---

## 3. Data Contract

### Input Schema (`students.csv`)

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `user_id` | string | UUID | Anonymized student identifier |
| `days_since_last_login` | int | 0–90 | Recency signal |
| `avg_completion_rate` | float | 0.0–1.0 | Ratio of completed modules |
| `assessment_participation_ratio` | float | 0.0–1.0 | Quizzes attempted / quizzes available |
| `forum_posts_last_30d` | int | 0–50 | Community engagement proxy |
| `video_watch_ratio` | float | 0.0–1.0 | Video content consumption |
| `streak_days` | int | 0–90 | Consecutive active days |
| `age_bracket` | string | {18-24, 25-34, 35-44, 45+} | Demographic context for clustering |
| `employment_status` | string | {student, part_time, full_time, unemployed} | Demographic context for clustering |
| `has_dependents` | bool | {True, False} | Demographic context for clustering |
| `device_primary` | string | {mobile, desktop} | Demographic context for clustering |
| `is_at_risk` | int | {0, 1} | Ground truth label |

Demographic fields are NOT used as inputs to the classifier (`model.py`).
They are reserved exclusively for the clustering stage (`profiler.py`),
which groups already-flagged at-risk students into behavioral profiles.
Keeping demographics out of the classifier avoids the model learning
spurious correlations between protected-adjacent attributes and dropout
risk — see `docs/architecture.md` for the full reasoning.

### Output Schema (`predictions.json`)

```json
{
  "generated_at": "ISO-8601 timestamp",
  "model_version": "semver string",
  "threshold": 0.60,
  "summary": {
    "total_students": 500,
    "at_risk_count": 87,
    "high_risk_count": 58,
    "medium_risk_count": 9,
    "safe_count": 413,
    "risk_profile_breakdown": {
      "Time-Constrained": 19,
      "Disengaged Learner": 27,
      "Quiet Decliner": 21
    }
  },
  "students": [
    {
      "user_id": "STU-001",
      "risk_score": 0.82,
      "risk_label": "HIGH",
      "top_signals": ["days_since_last_login", "avg_completion_rate"],
      "recommended_action": "Send re-engagement email within 48h",
      "risk_profile": {
        "label": "Time-Constrained",
        "description": "Engagement drops driven by availability, not motivation.",
        "suggested_strategy": "Offer flexible deadline extensions and async catch-up."
      },
      "demographics": {
        "age_bracket": "25-34",
        "employment_status": "full_time",
        "has_dependents": false,
        "device_primary": "desktop"
      }
    }
  ]
}
```

`risk_profile` is `null` for students with `risk_label: "LOW"` — profiling
only runs on the at-risk population, by design (see §2 Scope).

---

## 3.5 Risk Profiling (K-Means Clustering)

A second, unsupervised stage runs after classification: at-risk students
(HIGH or MEDIUM tier) are clustered into exactly 3 behavioral/demographic
profiles using K-Means. This answers a different question than the
classifier — not "is this student at risk" but "what kind of at-risk
student is this, and what intervention fits."

### Profile definitions

| Profile | Narrative | Strategy |
|---|---|---|
| Time-Constrained | Availability-driven disengagement — full-time workers, parents | Flexible deadlines, async support |
| Disengaged Learner | Passive consumption without active participation — often younger, mobile-primary | Lightweight gamified nudges |
| Quiet Decliner | Previously engaged, recent sudden drop — high investment, high recoverability | Immediate direct outreach |

Cluster-to-profile matching is rule-based on centroid characteristics
(see `profiler.py:_match_clusters_to_profiles`), not hardcoded by cluster
index — K-Means cluster labels are arbitrary and can reorder between runs.

### Acceptance criteria

- [ ] Clustering runs only on HIGH/MEDIUM tier students, never the full population
- [ ] Every at-risk student receives exactly one profile label
- [ ] Profile assignment is deterministic for a fixed `RANDOM_SEED`
- [ ] System degrades gracefully (fallback profile) when fewer than 3 at-risk students exist

---

## 4. Success Metrics

### Model Performance (on held-out test set, 20% split)

| Metric | Minimum Threshold | Target |
|--------|------------------|--------|
| Recall (At-Risk class) | **0.80** | 0.85 |
| Precision (At-Risk class) | **0.70** | 0.78 |
| F1 Score | **0.75** | 0.81 |
| ROC-AUC | **0.85** | 0.90 |

> **Why Recall is the primary metric:** A false negative (missing an at-risk
> student) is more costly than a false positive (flagging a healthy student).
> Course coordinators can absorb a small number of false alerts; they cannot
> recover students who dropped without warning.

### System Quality

| Criterion | Acceptance Standard |
|-----------|-------------------|
| Data generation | Reproducible with fixed `RANDOM_SEED` |
| Pipeline runtime | End-to-end < 60s on consumer hardware |
| JSON output | Valid against schema, human-readable |
| Frontend | Loads in < 2s, no external API calls |
| Code style | PEP 8 compliant, flake8 clean |

---

## 5. Edge Cases to Handle

| Scenario | Handling Strategy |
|----------|------------------|
| Missing `avg_completion_rate` | Impute with cohort median |
| Student with 0 logins ever | Force `days_since_last_login = 90` |
| Seasonal churn spike (summer) | Inject synthetic cohort with elevated risk |
| Perfect engagement score | Model should not over-penalize; add noise |
| Duplicate `user_id` | De-duplicate on ingest, log warning |

---

## 6. Development Phases & Acceptance Gates

### Phase 1 — Data Simulation & EDA
- [ ] `generator.py` produces reproducible `students.csv`
- [ ] Dataset includes ≥3 edge case cohorts
- [ ] EDA notebook confirms feature distributions are realistic

### Phase 2 — Model Training & Evaluation
- [ ] Model meets all thresholds in §4
- [ ] Feature importance chart is generated and saved
- [ ] Confusion matrix exported to `notebooks/`

### Phase 3 — Intervention Logic & API Mock
- [ ] `notifier.py` generates valid `predictions.json`
- [ ] Threshold is configurable via environment variable
- [ ] `recommended_action` field is rule-based on risk tier

### Phase 4 — Frontend Visualization
- [ ] GSAP scroll narrative functional across Chrome, Firefox, Safari
- [ ] Chart.js renders risk distribution and top signals
- [ ] Demo works fully offline (no CDN dependency in production build)

---

## 7. Risk & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Synthetic data doesn't generalize | Medium | Validate feature distributions against published EdTech research |
| Model overfits to synthetic patterns | Medium | Cross-validation + holdout test set |
| GSAP animation performance on low-end devices | Low | `prefers-reduced-motion` media query respected |
