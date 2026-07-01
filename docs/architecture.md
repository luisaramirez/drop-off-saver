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
profiler.py
  ├─ Filters to HIGH/MEDIUM tier students only
  ├─ K-Means (k=3) on behavioral + demographic features
  ├─ Centroid-based cluster → profile label matching
  └─ Returns DataFrame with risk_profile_* columns appended
     │
     ▼
notifier.py
  ├─ Score all students (batch inference)
  ├─ Assign tier: HIGH / MEDIUM / LOW
  ├─ Call profiler.py on the at-risk subset
  ├─ Rule-based recommended_action + cluster-based suggested_strategy
  └─ Export → web-demo/assets/predictions.json
     │
     ▼
index.html + app.js + charts.js
  ├─ fetch("assets/predictions.json")
  ├─ GSAP scroll narrative
  └─ Chart.js risk distribution + risk profile breakdown
```

## Layer Boundaries

Each layer has one interface:

| From → To | Interface |
|-----------|-----------|
| Data → Intelligence | `features.py:build_feature_matrix()` returns sklearn-ready DataFrames |
| Classifier → Profiler | `profiler.py:assign_risk_profiles()` takes a DataFrame of at-risk students, returns it with profile columns appended |
| Intelligence → Visualization | `predictions.json` schema (defined in SPEC.md §3) |
| Visualization → User | Browser renders `index.html`, no server required |

## Key Design Decisions

**Why classification and clustering as two separate stages, not one model?**
`model.py` answers "is this student at risk" — a supervised, labeled
problem with ground truth (`is_at_risk`). `profiler.py` answers "what kind
of at-risk student is this" — an unsupervised problem with no ground truth;
nothing in the synthetic data says which profile a student belongs to,
only that K-Means finds 3 natural groupings. Conflating the two into a
single model would muddy what each stage is actually claiming to know.

**Why not feed demographics into the Random Forest as input features?**
This was the more obvious path and was deliberately rejected. Two reasons:
first, it risks the classifier learning correlations between demographic
attributes and dropout risk that are misleading or look discriminatory in
a portfolio context — e.g. "is_at_risk" partly explained by employment
status, when the actual signal should come from engagement behavior.
Second, it collapses two distinct questions into one model's output,
losing the ability to explain risk type independently of risk presence.
Keeping demographics confined to `profiler.py`, which only runs on
students *already* flagged at-risk by behavior alone, sidesteps both
problems.

**Why K-Means with k=3, not a data-driven cluster count?**
Methods like the elbow method or silhouette score can choose k
algorithmically, but for this portfolio's purpose — giving instructors
3 distinct, nameable, actionable categories — a fixed k=3 keeps the
output legible and consistent across reruns. This is a conscious
trade-off of statistical rigor for interpretability, and is documented
as such rather than presented as the "objectively correct" cluster count.

**Why match clusters to profiles by centroid inspection instead of fixed
cluster IDs?**
K-Means assigns cluster labels (0, 1, 2) arbitrarily based on
initialization — cluster 0 in one run might correspond to "Time-Constrained"
and in another run, after a code change or reseed, correspond to
"Disengaged Learner." `profiler.py:_match_clusters_to_profiles` inspects
each cluster's centroid values (e.g. how strongly it skews toward
full-time employment + dependents) and assigns the profile name based on
those characteristics, not the arbitrary numeric ID. This keeps the system
correct regardless of run-to-run label reordering.

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
