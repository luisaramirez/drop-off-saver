"""
generator.py — Synthetic EdTech Telemetry Factory
==================================================
Generates a reproducible students.csv that mimics real-world online course
engagement data, including controlled edge-case cohorts and demographic
context used downstream for risk-profile clustering.

Real EdTech platforms report 15-25% dropout rates. This generator reflects
that reality with a realistic class imbalance: ~13% at-risk, ~87% healthy.
Realistic overlap between cohorts is introduced intentionally — if the
boundaries were perfectly clean, any model would achieve near-perfect scores
and the project would demonstrate nothing meaningful.

Cohorts produced:
  - "healthy"        : 75% — high engagement, low dropout risk
  - "struggling"     : 12% — borderline students, not yet at risk
  - "at_risk"        : 8%  — clear disengagement signals
  - "seasonal_churn" : 3%  — edge case: summer dropout spike
  - "ghost_students" : 2%  — enrolled but never active (missing data)

At-risk rate target: ~13% (at_risk + seasonal + ghost)

Demographic features (new):
  - age_bracket        : 18-24, 25-34, 35-44, 45+
  - employment_status  : student, part_time, full_time, unemployed
  - has_dependents     : boolean
  - device_primary     : mobile, desktop

Demographics are sampled with cohort-specific probability weights rather
than uniformly at random. This matters: a uniform random assignment would
carry no real signal, and any downstream clustering on top of it would be
discovering noise, not patterns. The weights encode plausible real-world
correlations — e.g. seasonal_churn skews toward full-time employment,
matching the "previously engaged, then life got busy" narrative. These are
modeling assumptions, not measured facts, and should be described as such
in any write-up of this project.

Usage:
    python src/generator.py
    python src/generator.py --n 1000 --seed 99 --out data/raw/students.csv

Output: CSV at data/raw/students.csv (default)
"""

import argparse
import logging
import os
import uuid
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RANDOM_SEED = int(os.getenv("RANDOM_SEED", 42))
DEFAULT_N = int(os.getenv("N_STUDENTS", 500))
OUTPUT_PATH = Path(os.getenv("DATA_RAW_PATH", "data/raw/students.csv"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Demographic value spaces
# ---------------------------------------------------------------------------
AGE_BRACKETS = ["18-24", "25-34", "35-44", "45+"]
EMPLOYMENT_STATUSES = ["student", "part_time", "full_time", "unemployed"]
DEVICE_TYPES = ["mobile", "desktop"]

# Per-cohort sampling weights for demographics. Each list of probabilities
# must sum to 1.0 and align positionally with the value space above.
#
# These weights are modeling assumptions encoding plausible narratives per
# cohort, not measured real-world statistics. They exist to give downstream
# clustering something structured to find, rather than pure noise.
DEMOGRAPHIC_WEIGHTS = {
    "healthy": {
        "age_bracket": [0.35, 0.35, 0.20, 0.10],
        "employment_status": [0.40, 0.25, 0.25, 0.10],
        "has_dependents": 0.20,  # P(True)
        "device_primary": [0.30, 0.70],  # [mobile, desktop]
    },
    "struggling": {
        "age_bracket": [0.30, 0.30, 0.25, 0.15],
        "employment_status": [0.25, 0.30, 0.30, 0.15],
        "has_dependents": 0.30,
        "device_primary": [0.45, 0.55],
    },
    "at_risk": {
        # Skews younger + mobile-primary + lower employment stability —
        # the "disengaged learner" narrative
        "age_bracket": [0.45, 0.30, 0.15, 0.10],
        "employment_status": [0.30, 0.20, 0.20, 0.30],
        "has_dependents": 0.15,
        "device_primary": [0.60, 0.40],
    },
    "seasonal_churn": {
        # Skews toward full-time employment + dependents — the
        # "previously engaged, then life got busy" narrative
        "age_bracket": [0.10, 0.30, 0.35, 0.25],
        "employment_status": [0.05, 0.20, 0.60, 0.15],
        "has_dependents": 0.55,
        "device_primary": [0.35, 0.65],
    },
    "ghost": {
        # No strong narrative — these students never engaged enough to
        # form a clear behavioral pattern, so weights stay close to uniform
        "age_bracket": [0.25, 0.25, 0.25, 0.25],
        "employment_status": [0.25, 0.25, 0.25, 0.25],
        "has_dependents": 0.25,
        "device_primary": [0.50, 0.50],
    },
}


def _sample_demographics(
    rng: np.random.Generator, n: int, cohort: str
) -> dict:
    """
    Samples demographic columns for n students using the cohort-specific
    weights defined in DEMOGRAPHIC_WEIGHTS.

    Args:
        rng:    Shared random generator (preserves reproducibility)
        n:      Number of students to sample for
        cohort: One of the keys in DEMOGRAPHIC_WEIGHTS

    Returns:
        dict of column_name -> np.ndarray, ready to merge into a DataFrame
    """
    weights = DEMOGRAPHIC_WEIGHTS[cohort]

    return {
        "age_bracket": rng.choice(AGE_BRACKETS, size=n, p=weights["age_bracket"]),
        "employment_status": rng.choice(
            EMPLOYMENT_STATUSES, size=n, p=weights["employment_status"]
        ),
        "has_dependents": rng.random(size=n) < weights["has_dependents"],
        "device_primary": rng.choice(
            DEVICE_TYPES, size=n, p=weights["device_primary"]
        ),
    }


# ---------------------------------------------------------------------------
# Cohort generators
# ---------------------------------------------------------------------------

def _generate_healthy_cohort(rng: np.random.Generator, n: int) -> pd.DataFrame:
    """
    Students who are actively engaged. Low dropout probability.
    Characterized by recent logins, solid completion, and regular assessment
    participation.

    Realistic variance is intentional: healthy students still miss days,
    skip occasional quizzes, and have varying completion rates. A dataset
    where every healthy student scores 0.95+ teaches the model nothing
    useful about the boundary between safe and at-risk.
    """
    return pd.DataFrame(
        {
            "user_id": [f"STU-{uuid.uuid4().hex[:6].upper()}" for _ in range(n)],
            "cohort": "healthy",
            # Login recency: most logged in recently, some took a short break
            "days_since_last_login": rng.integers(0, 14, size=n),
            # Completion rate: solid progress, not necessarily perfect
            "avg_completion_rate": rng.uniform(0.55, 1.00, size=n),
            # Assessment participation: engaged but not obsessive
            "assessment_participation_ratio": rng.uniform(0.50, 1.00, size=n),
            # Community activity: varies widely — some students lurk, some post
            "forum_posts_last_30d": rng.integers(0, 25, size=n),
            # Video consumption: most watch regularly
            "video_watch_ratio": rng.uniform(0.55, 1.00, size=n),
            # Consecutive active days: wide range is realistic
            "streak_days": rng.integers(3, 90, size=n),
            "is_at_risk": 0,
        }
    )


def _generate_struggling_cohort(rng: np.random.Generator, n: int) -> pd.DataFrame:
    """
    NEW COHORT: Borderline students — not yet at risk, but showing early
    warning signs. This is the hardest cohort for the model to classify
    correctly, and the most important one to get right in practice.

    Characteristics: moderate login gaps, stalled-but-not-zero completion,
    inconsistent assessment participation. These students are recoverable
    with early intervention — which is exactly the use case this system
    is designed for.

    Labelled is_at_risk=0 because they haven't crossed the threshold yet,
    but their features will produce mid-range probability scores (0.35-0.60),
    which is realistic — the model should be uncertain about them.
    """
    return pd.DataFrame(
        {
            "user_id": [f"STU-{uuid.uuid4().hex[:6].upper()}" for _ in range(n)],
            "cohort": "struggling",
            # Login gap: present but irregular — missed 1-2 weeks
            "days_since_last_login": rng.integers(7, 21, size=n),
            # Completion: started strong, now slowing
            "avg_completion_rate": rng.uniform(0.30, 0.60, size=n),
            # Assessment: attempts some but skips others
            "assessment_participation_ratio": rng.uniform(0.25, 0.55, size=n),
            # Forum: occasional post, mostly silent
            "forum_posts_last_30d": rng.integers(0, 5, size=n),
            # Video: watching less than before
            "video_watch_ratio": rng.uniform(0.30, 0.65, size=n),
            # Streak broken but not long ago
            "streak_days": rng.integers(0, 14, size=n),
            "is_at_risk": 0,
        }
    )


def _generate_at_risk_cohort(rng: np.random.Generator, n: int) -> pd.DataFrame:
    """
    Students showing clear disengagement signals. High dropout probability.
    Characterized by extended login absence, stalled completion, and
    assessment silence.
    """
    return pd.DataFrame(
        {
            "user_id": [f"STU-{uuid.uuid4().hex[:6].upper()}" for _ in range(n)],
            "cohort": "at_risk",
            # Login recency: gone for 3-8 weeks
            "days_since_last_login": rng.integers(21, 60, size=n),
            # Completion rate: stalled early, never recovered
            "avg_completion_rate": rng.uniform(0.03, 0.35, size=n),
            # Assessment participation: rarely or never attempts quizzes
            "assessment_participation_ratio": rng.uniform(0.0, 0.25, size=n),
            # Forum: completely silent
            "forum_posts_last_30d": rng.integers(0, 2, size=n),
            # Video: stopped watching
            "video_watch_ratio": rng.uniform(0.02, 0.30, size=n),
            # Streak: broken early and never rebuilt
            "streak_days": rng.integers(0, 5, size=n),
            "is_at_risk": 1,
        }
    )


def _generate_seasonal_churn_cohort(
    rng: np.random.Generator, n: int
) -> pd.DataFrame:
    """
    Edge case: students who were previously healthy but show a sudden
    drop in engagement. Mimics real seasonal churn patterns observed in
    EdTech platforms (Q3 summer dip, Q1 post-holiday drop).

    These students are dangerous precisely because their historical
    engagement was good — a naive rule-based system would miss them.
    """
    return pd.DataFrame(
        {
            "user_id": [f"STU-{uuid.uuid4().hex[:6].upper()}" for _ in range(n)],
            "cohort": "seasonal_churn",
            # Recently logged in but activity dropping fast
            "days_since_last_login": rng.integers(12, 28, size=n),
            # Was making real progress, now stalled mid-course
            "avg_completion_rate": rng.uniform(0.35, 0.60, size=n),
            # Partially engaged — attendance becoming erratic
            "assessment_participation_ratio": rng.uniform(0.20, 0.50, size=n),
            "forum_posts_last_30d": rng.integers(0, 4, size=n),
            "video_watch_ratio": rng.uniform(0.25, 0.55, size=n),
            # Streak recently broken
            "streak_days": rng.integers(0, 5, size=n),
            "is_at_risk": 1,
        }
    )


def _generate_ghost_students_cohort(
    rng: np.random.Generator, n: int
) -> pd.DataFrame:
    """
    Edge case: enrolled but never meaningfully active. Represents missing
    data patterns — NaN values are introduced and then imputed downstream
    in the feature engineering pipeline.

    These students have never established a baseline, making them a special
    category: high risk by absence of signal rather than by declining signal.
    """
    df = pd.DataFrame(
        {
            "user_id": [f"STU-{uuid.uuid4().hex[:6].upper()}" for _ in range(n)],
            "cohort": "ghost",
            # Force maximum inactivity
            "days_since_last_login": np.full(n, 90),
            # Introduce NaN values to simulate missing telemetry
            "avg_completion_rate": rng.choice(
                [np.nan, 0.0], size=n, p=[0.4, 0.6]
            ),
            "assessment_participation_ratio": np.zeros(n),
            "forum_posts_last_30d": np.zeros(n, dtype=int),
            "video_watch_ratio": rng.choice(
                [np.nan, 0.0], size=n, p=[0.3, 0.7]
            ),
            "streak_days": np.zeros(n, dtype=int),
            "is_at_risk": 1,
        }
    )
    return df


# ---------------------------------------------------------------------------
# Demographic attachment
# ---------------------------------------------------------------------------

def _attach_demographics(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Adds demographic columns to the combined cohort DataFrame, sampling
    per-row using the cohort each row already belongs to.

    This runs AFTER cohorts are concatenated (not inside each cohort
    generator) so the demographic sampling logic lives in exactly one
    place, regardless of how many cohorts exist.

    Args:
        df:  Combined DataFrame with a 'cohort' column already present
        rng: Shared random generator

    Returns:
        pd.DataFrame with age_bracket, employment_status, has_dependents,
        and device_primary columns appended.
    """
    df = df.copy()

    # Pre-allocate output columns
    df["age_bracket"] = ""
    df["employment_status"] = ""
    df["has_dependents"] = False
    df["device_primary"] = ""

    for cohort_name in df["cohort"].unique():
        mask = df["cohort"] == cohort_name
        n_rows = mask.sum()
        demo = _sample_demographics(rng, n_rows, cohort_name)

        df.loc[mask, "age_bracket"] = demo["age_bracket"]
        df.loc[mask, "employment_status"] = demo["employment_status"]
        df.loc[mask, "has_dependents"] = demo["has_dependents"]
        df.loc[mask, "device_primary"] = demo["device_primary"]

    return df


# ---------------------------------------------------------------------------
# Noise injection
# ---------------------------------------------------------------------------

def _inject_noise(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Add small Gaussian noise to continuous features to prevent artificially
    clean decision boundaries — a common synthetic data pitfall.

    Increased noise standard deviation (0.03 -> 0.05) to create more
    realistic overlap at cohort boundaries. The model should be uncertain
    about borderline students, not perfectly confident about every row.

    Clips values to valid ranges after noise injection.
    """
    continuous_cols = [
        "avg_completion_rate",
        "assessment_participation_ratio",
        "video_watch_ratio",
    ]
    for col in continuous_cols:
        if col in df.columns:
            noise = rng.normal(0, 0.05, size=len(df))
            df[col] = (df[col] + noise).clip(0.0, 1.0)

    return df


# ---------------------------------------------------------------------------
# Main factory
# ---------------------------------------------------------------------------

def generate_dataset(n: int = DEFAULT_N, seed: int = RANDOM_SEED) -> pd.DataFrame:
    """
    Orchestrates cohort generation and returns a combined, shuffled DataFrame.

    Cohort split — designed to match real EdTech dropout rates (~13-20%):
      75% healthy, 12% struggling, 8% at_risk, 3% seasonal_churn, 2% ghost

    The struggling cohort is labelled safe (is_at_risk=0) but produces
    mid-range model scores — this is intentional and realistic. Not every
    disengaged student drops out; the model should reflect that uncertainty.

    Args:
        n:    Total number of student records to generate.
        seed: NumPy random seed for reproducibility.

    Returns:
        pd.DataFrame: Combined dataset, shuffled, index reset.
    """
    rng = np.random.default_rng(seed)

    n_healthy   = int(n * 0.75)
    n_struggling = int(n * 0.12)
    n_at_risk   = int(n * 0.08)
    n_seasonal  = int(n * 0.03)
    n_ghost     = n - n_healthy - n_struggling - n_at_risk - n_seasonal

    logger.info(
        "Generating cohorts: healthy=%d, struggling=%d, at_risk=%d, "
        "seasonal=%d, ghost=%d",
        n_healthy, n_struggling, n_at_risk, n_seasonal, n_ghost,
    )

    cohorts = [
        _generate_healthy_cohort(rng, n_healthy),
        _generate_struggling_cohort(rng, n_struggling),
        _generate_at_risk_cohort(rng, n_at_risk),
        _generate_seasonal_churn_cohort(rng, n_seasonal),
        _generate_ghost_students_cohort(rng, n_ghost),
    ]

    df = pd.concat(cohorts, ignore_index=True)
    df = _attach_demographics(df, rng)
    df = _inject_noise(df, rng)

    # Shuffle to break cohort ordering that could leak into training
    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)

    at_risk_rate = df["is_at_risk"].mean() * 100
    logger.info(
        "Dataset generated: %d rows | at_risk rate: %.1f%% | safe rate: %.1f%%",
        len(df),
        at_risk_rate,
        100 - at_risk_rate,
    )
    return df


def save_dataset(df: pd.DataFrame, output_path: Path = OUTPUT_PATH) -> None:
    """Persists the dataset to CSV, creating parent directories as needed."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    logger.info("Dataset saved → %s", output_path)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate synthetic EdTech telemetry dataset."
    )
    parser.add_argument(
        "--n", type=int, default=DEFAULT_N, help="Number of student records"
    )
    parser.add_argument(
        "--seed", type=int, default=RANDOM_SEED, help="Random seed"
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=OUTPUT_PATH,
        help="Output CSV path",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    dataset = generate_dataset(n=args.n, seed=args.seed)
    save_dataset(dataset, output_path=args.out)
    print(dataset.head(10).to_string())
    print(f"\nClass distribution:\n{dataset['is_at_risk'].value_counts()}")
    print(f"\nCohort breakdown:\n{dataset['cohort'].value_counts()}")
