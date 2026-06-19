"""
generator.py — Synthetic EdTech Telemetry Factory
==================================================
Generates a reproducible students.csv that mimics real-world online course
engagement data, including controlled edge-case cohorts.

Cohorts produced:
  - "healthy"        : high engagement, low churn risk
  - "at_risk"        : declining engagement patterns
  - "seasonal_churn" : edge case — summer dropout spike
  - "ghost_students" : enrolled but never active (missing data scenario)

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
# Cohort generators
# ---------------------------------------------------------------------------

def _generate_healthy_cohort(rng: np.random.Generator, n: int) -> pd.DataFrame:
    """
    Students who are actively engaged. Low dropout probability.
    Characterized by recent logins, high completion, and regular assessment
    participation.
    """
    return pd.DataFrame(
        {
            "user_id": [f"STU-{uuid.uuid4().hex[:6].upper()}" for _ in range(n)],
            "cohort": "healthy",
            # Login recency: healthy students logged in within the last week
            "days_since_last_login": rng.integers(0, 7, size=n),
            # Completion rate: 70–100%
            "avg_completion_rate": rng.uniform(0.70, 1.00, size=n),
            # Assessment participation: high engagement
            "assessment_participation_ratio": rng.uniform(0.65, 1.00, size=n),
            # Community activity
            "forum_posts_last_30d": rng.integers(2, 20, size=n),
            # Video consumption
            "video_watch_ratio": rng.uniform(0.70, 1.00, size=n),
            # Consecutive active days
            "streak_days": rng.integers(7, 90, size=n),
            "is_at_risk": 0,
        }
    )


def _generate_at_risk_cohort(rng: np.random.Generator, n: int) -> pd.DataFrame:
    """
    Students showing disengagement signals. High dropout probability.
    Characterized by infrequent logins, stalled completion, and low
    assessment activity.
    """
    return pd.DataFrame(
        {
            "user_id": [f"STU-{uuid.uuid4().hex[:6].upper()}" for _ in range(n)],
            "cohort": "at_risk",
            # Login recency: haven't logged in for 3+ weeks
            "days_since_last_login": rng.integers(21, 60, size=n),
            # Completion rate: stalled early in the course
            "avg_completion_rate": rng.uniform(0.05, 0.45, size=n),
            # Assessment participation: rarely attempts quizzes
            "assessment_participation_ratio": rng.uniform(0.0, 0.35, size=n),
            # Forum silence
            "forum_posts_last_30d": rng.integers(0, 3, size=n),
            # Low video consumption
            "video_watch_ratio": rng.uniform(0.05, 0.40, size=n),
            # Streak broken early
            "streak_days": rng.integers(0, 10, size=n),
            "is_at_risk": 1,
        }
    )


def _generate_seasonal_churn_cohort(
    rng: np.random.Generator, n: int
) -> pd.DataFrame:
    """
    Edge case: students who were previously healthy but show a sudden summer
    drop in engagement. Moderate-to-high risk. Mimics real seasonal churn
    patterns observed in EdTech platforms (Q3 dip).
    """
    return pd.DataFrame(
        {
            "user_id": [f"STU-{uuid.uuid4().hex[:6].upper()}" for _ in range(n)],
            "cohort": "seasonal_churn",
            # Recently logged in but not as active as before
            "days_since_last_login": rng.integers(10, 25, size=n),
            # Was making progress, now stalled mid-course
            "avg_completion_rate": rng.uniform(0.40, 0.65, size=n),
            # Partially engaged — attends some assessments
            "assessment_participation_ratio": rng.uniform(0.25, 0.55, size=n),
            "forum_posts_last_30d": rng.integers(0, 5, size=n),
            "video_watch_ratio": rng.uniform(0.30, 0.65, size=n),
            "streak_days": rng.integers(0, 7, size=n),
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
    category for the model: high risk by absence of signal.
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
# Noise injection
# ---------------------------------------------------------------------------

def _inject_noise(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """
    Add small Gaussian noise to continuous features to prevent artificially
    clean decision boundaries — a common synthetic data pitfall.

    Clips values to valid ranges after noise injection.
    """
    continuous_cols = [
        "avg_completion_rate",
        "assessment_participation_ratio",
        "video_watch_ratio",
    ]
    for col in continuous_cols:
        if col in df.columns:
            noise = rng.normal(0, 0.03, size=len(df))
            df[col] = (df[col] + noise).clip(0.0, 1.0)

    return df


# ---------------------------------------------------------------------------
# Main factory
# ---------------------------------------------------------------------------

def generate_dataset(n: int = DEFAULT_N, seed: int = RANDOM_SEED) -> pd.DataFrame:
    """
    Orchestrates cohort generation and returns a combined, shuffled DataFrame.

    Cohort split (approximate):
      50% healthy, 30% at_risk, 12% seasonal_churn, 8% ghost

    Args:
        n:    Total number of student records to generate.
        seed: NumPy random seed for reproducibility.

    Returns:
        pd.DataFrame: Combined dataset, shuffled, index reset.
    """
    rng = np.random.default_rng(seed)

    n_healthy = int(n * 0.50)
    n_at_risk = int(n * 0.30)
    n_seasonal = int(n * 0.12)
    n_ghost = n - n_healthy - n_at_risk - n_seasonal  # remainder

    logger.info(
        "Generating cohorts: healthy=%d, at_risk=%d, seasonal=%d, ghost=%d",
        n_healthy,
        n_at_risk,
        n_seasonal,
        n_ghost,
    )

    cohorts = [
        _generate_healthy_cohort(rng, n_healthy),
        _generate_at_risk_cohort(rng, n_at_risk),
        _generate_seasonal_churn_cohort(rng, n_seasonal),
        _generate_ghost_students_cohort(rng, n_ghost),
    ]

    df = pd.concat(cohorts, ignore_index=True)
    df = _inject_noise(df, rng)

    # Shuffle to break cohort ordering that could leak into training
    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)

    logger.info(
        "Dataset generated: %d rows | at_risk rate: %.1f%%",
        len(df),
        df["is_at_risk"].mean() * 100,
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
