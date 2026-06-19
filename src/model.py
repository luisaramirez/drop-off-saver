"""
model.py — Training, Evaluation & Serialization
================================================
Trains a Random Forest classifier on the feature-engineered dataset,
evaluates against SPEC.md thresholds, and serializes the trained model.

Design decision — Random Forest first, XGBoost optional:
  Random Forest surfaces feature importances that are interpretable to
  non-technical stakeholders. The model_version flag allows swapping in
  XGBoost for performance benchmarking without changing the API contract.

Usage:
    python src/model.py
    python src/model.py --model xgboost
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

# ---------------------------------------------------------------------------
# Local imports — run from project root: python src/model.py
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).parent))
from features import build_feature_matrix

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths & config
# ---------------------------------------------------------------------------
DATA_PATH = Path(os.getenv("DATA_RAW_PATH", "data/raw/students.csv"))
MODEL_DIR = Path(os.getenv("MODEL_DIR", "data/processed"))
MODEL_PATH = MODEL_DIR / "model.joblib"
METRICS_PATH = MODEL_DIR / "metrics.json"
RANDOM_SEED = int(os.getenv("RANDOM_SEED", 42))

# SPEC.md acceptance thresholds
THRESHOLDS = {
    "recall": 0.80,
    "precision": 0.70,
    "f1": 0.75,
    "roc_auc": 0.85,
}


# ---------------------------------------------------------------------------
# Model factory
# ---------------------------------------------------------------------------

def _build_model(model_type: str = "random_forest") -> object:
    """
    Returns an unfitted sklearn-compatible classifier.

    Args:
        model_type: "random_forest" | "xgboost"
    """
    if model_type == "xgboost":
        try:
            from xgboost import XGBClassifier

            return XGBClassifier(
                n_estimators=200,
                max_depth=5,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                use_label_encoder=False,
                eval_metric="logloss",
                random_state=RANDOM_SEED,
                n_jobs=-1,
            )
        except ImportError:
            logger.warning("XGBoost not installed, falling back to Random Forest.")

    # Default: Random Forest — interpretable, no hyperparameter tuning required
    return RandomForestClassifier(
        n_estimators=300,
        max_depth=8,
        min_samples_leaf=5,
        class_weight="balanced",  # Handles class imbalance without SMOTE
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def _evaluate(
    model, X_test, y_test, feature_names: list[str]
) -> dict:
    """
    Evaluates the model against SPEC.md thresholds.
    Logs a clear PASS/FAIL for each metric.

    Returns:
        dict: All computed metrics + feature importances.
    """
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    metrics = {
        "recall": recall_score(y_test, y_pred),
        "precision": precision_score(y_test, y_pred),
        "f1": f1_score(y_test, y_pred),
        "roc_auc": roc_auc_score(y_test, y_proba),
    }

    logger.info("=" * 50)
    logger.info("EVALUATION RESULTS")
    logger.info("=" * 50)
    all_pass = True
    for metric, value in metrics.items():
        threshold = THRESHOLDS[metric]
        status = "✓ PASS" if value >= threshold else "✗ FAIL"
        if value < threshold:
            all_pass = False
        logger.info(
            "  %s  %s: %.4f  (threshold: %.2f)",
            status,
            metric.upper(),
            value,
            threshold,
        )

    if not all_pass:
        logger.warning(
            "One or more metrics below SPEC.md threshold. "
            "Consider tuning hyperparameters or increasing training data."
        )

    logger.info("\nClassification Report:\n%s", classification_report(y_test, y_pred))
    logger.info("Confusion Matrix:\n%s", confusion_matrix(y_test, y_pred))

    # Feature importances
    importances = dict(
        zip(feature_names, model.feature_importances_.tolist())
    )
    importances = dict(
        sorted(importances.items(), key=lambda x: x[1], reverse=True)
    )
    logger.info("Feature Importances: %s", importances)

    metrics["feature_importances"] = importances
    return metrics


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _save_artifacts(model, metrics: dict) -> None:
    """Saves trained model and metrics JSON to MODEL_DIR."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    logger.info("Model saved → %s", MODEL_PATH)

    with open(METRICS_PATH, "w") as f:
        json.dump(metrics, f, indent=2)
    logger.info("Metrics saved → %s", METRICS_PATH)


# ---------------------------------------------------------------------------
# Main training loop
# ---------------------------------------------------------------------------

def train(model_type: str = "random_forest") -> None:
    """End-to-end training pipeline."""
    logger.info("Loading and engineering features from %s", DATA_PATH)
    X_train, X_test, y_train, y_test, _ = build_feature_matrix(DATA_PATH)

    model = _build_model(model_type)
    logger.info("Training %s on %d samples...", model_type, len(X_train))
    model.fit(X_train, y_train)

    metrics = _evaluate(model, X_test, y_test, feature_names=X_train.columns.tolist())
    _save_artifacts(model, metrics)
    logger.info("Training complete.")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the dropout risk classifier.")
    parser.add_argument(
        "--model",
        choices=["random_forest", "xgboost"],
        default="random_forest",
        help="Model architecture to use",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    train(model_type=args.model)
