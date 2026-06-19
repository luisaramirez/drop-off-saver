# Architecture — Drop-off Saver

## Data Flow

```
students.csv (generator.py)
     │
     ▼
features.py
  ├─ Imputation (ghost students, missing telemetry)
  ├─ Derived features (engagement_score, recency_penalty, participation_gap)
  └─ train/test split (stratified, 80/20)
     │
     ▼
model.py
  ├─ Random Forest (n_estimators=300, class_weight=balanced)
  ├─ Evaluation vs SPEC.md thresholds
  └─ Serialized → data/processed/model.joblib
     │
     ▼
notifier.py
  ├─ Score all students (batch inference)
  ├─ Assign tier: HIGH / MEDIUM / LOW
  ├─ Rule-based recommended_action
  └─ Export → web-demo/assets/predictions.json
     │
     ▼
index.html + app.js + charts.js
  ├─ fetch("assets/predictions.json")
  ├─ GSAP scroll narrative
  └─ Chart.js risk distribution
```

## Layer Boundaries

Each layer has one interface:

| From → To | Interface |
|-----------|-----------|
| Data → Intelligence | `features.py:build_feature_matrix()` returns sklearn-ready DataFrames |
| Intelligence → Visualization | `predictions.json` schema (defined in SPEC.md §3) |
| Visualization → User | Browser renders `index.html`, no server required |

## Key Design Decisions

**Why `class_weight="balanced"` instead of SMOTE?**
Both address class imbalance. `class_weight` is simpler, has no risk of
overfitting to synthetic minority samples, and is directly supported by
scikit-learn. SMOTE is available via `imbalanced-learn` for benchmarking.

**Why global feature importance instead of SHAP?**
SHAP is the production-grade answer for per-student explanations. For this
portfolio artifact, global importance × local feature value is a defensible
approximation that avoids an additional runtime dependency. SHAP is a
clear upgrade path.

**Why static JSON instead of a REST API?**
The demo is portfolio-facing, not production-facing. A static file eliminates
the need for a running server, simplifies deployment (GitHub Pages, Netlify),
and keeps the frontend–backend contract explicit and version-controlled.
