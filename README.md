# Passive-to-Active Drop-off Saver

> A production-grade ML system that converts passive student telemetry into
> actionable risk signals — surfaced through an animated data narrative.

---

## System Design Overview

This project is structured around three independently testable layers:

```
[Data Layer]         → Synthetic telemetry (NumPy/Pandas)
[Intelligence Layer] → Binary risk classifier (Random Forest / XGBoost)
[Visualization Layer]→ GSAP scroll-narrative + Chart.js risk dashboard
```

Each layer has a clean interface boundary: the ML pipeline exports a
`predictions.json` contract that the frontend consumes. The frontend knows
nothing about Python. The model knows nothing about HTML.

---

## Repository Structure

```
dropoff-saver/
├── README.md              # You are here
├── SPEC.md                # Success criteria and acceptance thresholds
├── requirements.txt       # Python dependencies (pinned)
│
├── data/                  # Versioned data artifacts
│   ├── raw/               # students.csv (generated)
│   └── processed/         # feature-engineered splits
│
├── src/                   # Python backend — "The Brain"
│   ├── generator.py       # Synthetic data factory
│   ├── features.py        # Feature engineering pipeline
│   ├── model.py           # Training, evaluation, serialization
│   └── notifier.py        # Intervention trigger + JSON export
│
├── notebooks/             # Exploratory and explanatory analysis
│   ├── 01_eda.ipynb
│   └── 02_model_evaluation.ipynb
│
├── web-demo/              # "The Visual System Narrative"
│   ├── index.html
│   ├── css/
│   │   └── main.css
│   ├── js/
│   │   ├── app.js         # GSAP orchestration + data ingestion
│   │   └── charts.js      # Chart.js render logic
│   └── assets/
│       └── predictions.json  # ← ML pipeline output, consumed by frontend
│
└── docs/
    └── architecture.md    # Layer diagrams and data flow
```

---

## Development Phases

| Phase | Focus | Key Output |
|-------|-------|------------|
| 1 | Data Simulation & EDA | `students.csv`, EDA notebook |
| 2 | Model Training & Evaluation | Trained model, metrics report |
| 3 | Intervention Logic & API Mock | `predictions.json` |
| 4 | Frontend Data Visualization | Animated landing page |

---

## Quickstart

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Generate synthetic dataset
python src/generator.py

# 3. Train model and export predictions
python src/model.py

# 4. Run intervention trigger + export JSON
python src/notifier.py

# 5. Open the visual demo
open web-demo/index.html
```

---

## Design Decisions

**Why synthetic data?** Real EdTech telemetry carries PII. Synthetic generation
with controlled edge cases (seasonal churn, missing data bursts) lets us build
a reproducible, shareable portfolio artifact without compliance risk.

**Why Random Forest first?** Interpretability via feature importances is a
communication asset. A stakeholder can ask *why* a student is flagged and get
a ranked list of contributing signals, not a black box.

**Why GSAP over a React dashboard?** The audience is course instructors and
academic coordinators, not developers. Scroll-driven narrative reduces cognitive
load — each section surfaces one insight at a time.

---

## Success Metrics

See [SPEC.md](./SPEC.md) for full acceptance thresholds.

- Recall (At-Risk) ≥ 0.80 — we prioritize catching real at-risk students
- Precision ≥ 0.70 — reducing false alarms that waste coordinator time
- F1 ≥ 0.75

---

## Author

Built as a professional portfolio artifact demonstrating end-to-end ML system
design, MLOps practices, and creative data visualization.

---

## AI powered - Prompt

Act as a Senior AI/ML Architect. I am building a 'Passive-to-Active Drop-off Saver' as a portfolio project to demonstrate professional-grade system engineering and MLOps workflows. The project was thought as a tool to have an easy to read screen where students with the highest likelihood to drop off an online course are discovered.
Please provide a project scaffold and implementation guide based on these requirements:

1. Project Scope & Architecture:
* The project must be modular, separating the Data Layer, Intelligence Layer, and Visualization/Action Layer.
* Use a synthetic data generation approach (via NumPy/Pandas) that mimics real-world EdTech telemetry, including 'edge cases' (e.g., seasonal churn, missing data).
* The end-to-end workflow is: Data Generation → Feature Engineering → Binary Classification Model (Random Forest/XGBoost) → Intervention Trigger logic → JSON Export → Landing page for results visualization.

2. Development Phases:
Please break the development into four distinct phases:
(1) Data Simulation & EDA, (2) Model Training & Evaluation, (3) Intervention Logic & API Mocking, (4) Frontend Data Visualization (using GSAP for interactive storytelling through scrolltrigger and chart.js or D3.js).

3. Technology Stack (Optimization for Professional Performance):
Language: Python 3.10+
Data/ML: Pandas, NumPy, Scikit-Learn.
Frontend: Vanilla JS + GSAP (for high-performance animations).
MLOps: Include instructions for a requirements.txt and a professional README.md that highlights system design, not just code snippets.

4. Deliverables requested:
* Provide a directory structure optimized for a professional repository.
* Provide a SPEC.md template defining clear success metrics (Precision/Recall).
* Provide a boilerplate generator.py that outputs a students.csv with the following features: user_id, days_since_last_login, avg_completion_rate, assessment_participation_ratio, and is_at_risk.
* Provide a high-level explanation of how the frontend web-demo will ingest the model's JSON output to animate student status changes.
5. Suggested folder structure
```
dropoff-saver/
├── README.md              # The "Executive Summary"
├── SPEC.md                # Project requirements
├── data/                  # Source data and synthetic logs
├── src/                   # Python backend (The "Brain")
│   ├── generator.py
│   ├── model.py
│   └── notifier.py
├── notebooks/             # EDA and Model performance
├── web-demo/              # The "Visual System Narrative"
│   ├── index.html         # The entry point for the demo
│   ├── css/               # Styles
│   ├── js/                # GSAP + Logic for animations
│   └── assets/            # JSON data output from your model
└── requirements.txt
```

Ensure the code is clean, well-commented, and follows PEP 8 standards, as this will be a public-facing portfolio piece.

Feel free to make any changes to the suggested folder structure above, just make sure to explain/argument your updates.
