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
| `is_at_risk` | int | {0, 1} | Ground truth label |

### Output Schema (`predictions.json`)

```json
{
  "generated_at": "ISO-8601 timestamp",
  "model_version": "semver string",
  "threshold": 0.60,
  "summary": {
    "total_students": 500,
    "at_risk_count": 87,
    "safe_count": 413
  },
  "students": [
    {
      "user_id": "STU-001",
      "risk_score": 0.82,
      "risk_label": "HIGH",
      "top_signals": ["days_since_last_login", "avg_completion_rate"],
      "recommended_action": "Send re-engagement email within 48h"
    }
  ]
}
```

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
