# Passive-to-Active Drop-off Saver

> A production-grade ML system that converts passive student telemetry into
> actionable risk signals  — segmented by behavioral profile and surfaced
> through an animated data narrative.

---

## What it does

Most EdTech platforms know a student dropped out. This system finds them
**2–4 weeks before** that happens — then tells the instructor not just
*that* a student is at risk, but *why*, and *what to do about it*.

The output is a scroll-driven web demo that a course coordinator can read
without any ML knowledge: a risk score, a behavioral profile, and a
specific retention strategy per student.

---

## System Design Overview

This project is structured around three independently testable layers:

```
[Data Layer]             Synthetic telemetry (NumPy / Pandas)
        ↓ students.csv
[Intelligence Layer]     Binary risk classifier (Random Forest)
                         + K-Means behavioral profiling
        ↓ predictions.json
[Visualization Layer]    GSAP scroll narrative + Chart.js dashboard
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
│   └── processed/         # feature-engineered splits | model.joblib, metrics.json
│
├── src/                   # Python backend — "The Brain"
│   ├── generator.py       # Synthetic data factory (5 cohorts + demographics)
│   ├── features.py        # Feature engineering pipeline
│   ├── model.py           # Random Forest training, evaluation, serialization
│   ├── profiler.py        # At-risk clustering (K-means) based on demographics
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
    └── architecture.md    # Layer diagrams and design decisions
```

---

## The Two-Stage Intelligence Layer

This is the core architectural decision worth understanding.

**Stage 1 — Classification (`model.py`)**
A Random Forest answers one question: *is this student likely to drop off?*
It trains on behavioral engagement signals only — login recency, completion
rate, assessment participation. Demographics are deliberately excluded.

**Stage 2 — Profiling (`profiler.py`)**
K-Means (k=3) runs on the at-risk subset only, using behavioral features
combined with demographic context. It answers a different question: *what
kind of at-risk student is this?*

Three profiles are surfaced:

| Profile | Narrative | Strategy |
|---|---|---|
| **Time-Constrained** | Full-time workers, parents — availability, not motivation | Flexible deadlines, async support |
| **Disengaged Learner** | Younger, mobile-primary — passive viewing, skipping assessments | Gamified nudges |
| **Quiet Decliner** | Previously engaged, sudden drop — high investment, high recoverability | Immediate direct outreach |

Why two stages instead of one model? See `docs/architecture.md`.

---

## Quickstart

```bash
# 1. Clone and install
git clone https://github.com/your-username/dropoff-saver.git
cd dropoff-saver
pip install -r requirements.txt

# 2. Generate synthetic dataset
python src/generator.py

# 3. Train model and export predictions
python src/model.py

# 4. Score students + export predictions JSON
python src/notifier.py

# 5. Open the visual demo
open web-demo/index.html
```

All five steps run in under 60 seconds on consumer hardware.

---

## Development Phases

| Phase | Focus | Output |
|---|---|---|
| 1 | Data Simulation & EDA | `students.csv`, EDA notebook |
| 2 | Model Training & Evaluation | `model.joblib`, metrics report |
| 3 | Profiling + Intervention Logic | `predictions.json` |
| 4 | Frontend Data Visualization | Animated web demo |

---

## Success Metrics

| Metric | Threshold | Rationale |
|---|---|---|
| Recall (at-risk class) | ≥ 0.80 | Missing a real dropout is the costliest error |
| Precision | ≥ 0.70 | Too many false alarms erodes instructor trust |
| F1 | ≥ 0.75 | Balances both |
| ROC-AUC | ≥ 0.85 | Measures ranking quality across all thresholds |

Full acceptance criteria in [SPEC.md](./SPEC.md).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Data & ML | Python 3.11+, Pandas, NumPy, Scikit-Learn |
| Visualization | Vanilla JS, GSAP 3 (ScrollTrigger), Chart.js 4 |
| Serialization | joblib (model), JSON (data contract) |
| Dev tooling | pyenv, venv, flake8, black |

---


## Design Decisions

**Synthetic data over real data** Real EdTech telemetry carries PII. Synthetic generation
with controlled edge cases (seasonal churn, missing data bursts) lets us build
a reproducible, shareable portfolio artifact without compliance risk.

**Static JSON over a REST API** — The demo is portfolio-facing. A static
file eliminates a running server requirement, enables GitHub Pages / Netlify
deployment, and makes the data contract explicit and version-controlled.

**GSAP scroll narrative over a React dashboard** — The audience is course
instructors, not developers. Scroll-driven narrative reduces cognitive load:
one insight per section, in a linear sequence that mirrors how an instructor
would actually want to be briefed.

---

## Author

Built as a professional portfolio artifact demonstrating end-to-end ML
system design, two-stage supervised + unsupervised ML, MLOps practices,
and creative data visualization.


---

## AI powered - First Prompt

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

---

## What's new in each version
This is a summary of the changes. For more specific information, please refer to CHANGELOG.md

**Version 2:** Update the generator.py, so it reflects data more realistically. Added a new cohort for struggling students and refactored the percentage for all cohorts.

**Version 3:** A profiling layer was added to the program's logic, to cluster at-risk students into actionable intervention groups with custom retention plans.

---