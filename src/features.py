"""
features.py — Feature Engineering Pipeline
===========================================
Transforms raw telemetry from students.csv into model-ready features.
Handles: missing value imputation, derived feature creation, train/test split.

This module is the contract between the Data Layer and the Intelligence Layer.
The output of this module is the only thing the model should ever train on.

Usage (imported by model.py):
    from features import build_feature_matrix
    X_train, X_test, y_train, y_test = build_feature_matrix("data/raw/students.csv")
"""

import logging
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

logger = logging.getLogger(__name__)

# Raw feature columns consumed from students.csv
RAW_FEATURE_COLS = [
    "days_since_last_login",
    "avg_completion_rate",
    "assessment_participation_ratio",
    "forum_posts_last_30d",
    "video_watch_ratio",
    "streak_days",
]

TARGET_COL = "is_at_risk"
TEST_SIZE = float(os.getenv("TEST_SIZE", 0.20))
RANDOM_SEED = int(os.getenv("RANDOM_SEED", 42))


# ---------------------------------------------------------------------------
# Imputation
# ---------------------------------------------------------------------------

def _impute_missing(df: pd.DataFrame) -> pd.DataFrame:
    """
    Impute missing values using cohort-level medians where available,
    falling back to global medians.

    Ghost students with NaN completion/video ratios are imputed with 0.0
    (the observed minimum), which is semantically accurate: no data = no
    activity.
    """
    df = df.copy()

    # For ghost cohort, NaN means no engagement — impute with 0
    zero_impute_cols = ["avg_completion_rate", "video_watch_ratio"]
    for col in zero_impute_cols:
        missing_mask = df[col].isna()
        if missing_mask.any():
            logger.warning(
                "Imputing %d missing values in '%s' with 0.0", missing_mask.sum(), col
            )
            df.loc[missing_mask, col] = 0.0

    # Any remaining nulls in numeric cols → global median
    for col in RAW_FEATURE_COLS:
        if df[col].isna().any():
            median_val = df[col].median()
            df[col] = df[col].fillna(median_val)
            logger.warning("Imputed '%s' remaining NaNs with median %.4f", col, median_val)

    return df


# ---------------------------------------------------------------------------
# Derived features
# ---------------------------------------------------------------------------

def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Create derived features that capture interaction effects not visible
    in raw signals alone.

    Engineered features:
      - engagement_score     : weighted composite of core engagement signals
      - recency_penalty      : exponential decay on days_since_last_login
      - participation_gap    : assessment vs completion misalignment signal
    """
    df = df.copy()

    # Composite engagement score (higher = more engaged)
    df["engagement_score"] = (
        0.30 * df["avg_completion_rate"]
        + 0.25 * df["assessment_participation_ratio"]
        + 0.20 * df["video_watch_ratio"]
        + 0.15 * (df["forum_posts_last_30d"] / df["forum_posts_last_30d"].max().clip(1))
        + 0.10 * (df["streak_days"] / 90.0)
    ).clip(0.0, 1.0)

    # Recency penalty: exponential decay, half-life ~14 days
    df["recency_penalty"] = 1.0 - np.exp(-df["days_since_last_login"] / 14.0)

    # Participation gap: student watches content but skips assessments
    # Positive gap = watching without testing (a disengagement signal)
    df["participation_gap"] = (
        df["video_watch_ratio"] - df["assessment_participation_ratio"]
    ).clip(-1.0, 1.0)

    return df


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def build_feature_matrix(
    data_path: str | Path,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
    """
    Full feature engineering pipeline.

    Args:
        data_path: Path to raw students.csv

    Returns:
        Tuple of (X_train, X_test, y_train, y_test) as DataFrames/Series.
        Column names are preserved for feature importance analysis.
    """
    df = pd.read_csv(data_path)
    logger.info("Loaded %d rows from %s", len(df), data_path)

    df = _impute_missing(df)
    df = _engineer_features(df)

    # Final feature set: raw + engineered
    feature_cols = RAW_FEATURE_COLS + [
        "engagement_score",
        "recency_penalty",
        "participation_gap",
    ]

    X = df[feature_cols]
    y = df[TARGET_COL]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_SEED, stratify=y
    )

    logger.info(
        "Train: %d rows | Test: %d rows | At-risk rate (train): %.1f%%",
        len(X_train),
        len(X_test),
        y_train.mean() * 100,
    )

    return X_train, X_test, y_train, y_test, df  # df carried for notifier.py
