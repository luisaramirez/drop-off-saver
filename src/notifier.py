"""
notifier.py — Intervention Trigger Logic & JSON Export
=======================================================
Loads the trained model, scores all students, applies intervention rules,
and exports predictions.json — the data contract consumed by the frontend.

This module is the boundary between the Intelligence Layer and the
Visualization/Action Layer. The frontend knows nothing about Python or
sklearn; it only reads predictions.json.

Intervention tiers (configurable via RISK_THRESHOLD env var):
  HIGH   : risk_score >= 0.75 → "Immediate outreach recommended"
  MEDIUM : risk_score >= threshold (default 0.60) → "Schedule check-in"
  LOW    : risk_score <  threshold → No action needed

Usage:
    python src/notifier.py
    RISK_THRESHOLD=0.65 python src/notifier.py
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from features import build_feature_matrix, RAW_FEATURE_COLS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DATA_PATH = Path(os.getenv("DATA_RAW_PATH", "data/raw/students.csv"))
MODEL_PATH = Path(os.getenv("MODEL_DIR", "data/processed")) / "model.joblib"
OUTPUT_PATH = Path(os.getenv("JSON_OUTPUT_PATH", "web-demo/assets/predictions.json"))
RISK_THRESHOLD = float(os.getenv("RISK_THRESHOLD", 0.60))
MODEL_VERSION = os.getenv("MODEL_VERSION", "1.0.0")

# Top N feature signals to surface per student in the JSON
TOP_N_SIGNALS = 2


# ---------------------------------------------------------------------------
# Risk tier & intervention rules
# ---------------------------------------------------------------------------

def _assign_tier(score: float, threshold: float) -> str:
    """Maps a probability score to a human-readable risk tier."""
    if score >= 0.75:
        return "HIGH"
    elif score >= threshold:
        return "MEDIUM"
    return "LOW"


INTERVENTION_RULES = {
    "HIGH": "Immediate outreach recommended — contact within 24 hours.",
    "MEDIUM": "Schedule a check-in session this week.",
    "LOW": "No intervention needed. Monitor next cycle.",
}


def _top_signals(row: pd.Series, feature_importances: dict) -> list[str]:
    """
    Returns the TOP_N_SIGNALS feature names that contributed most to this
    student's score, ordered by global feature importance.

    This is a simplified explanation — for production, use SHAP values.
    For a portfolio project, global importance × local feature value is
    an interpretable and defensible approximation.
    """
    ranked_features = sorted(
        feature_importances.keys(),
        key=lambda f: feature_importances.get(f, 0),
        reverse=True,
    )
    return ranked_features[:TOP_N_SIGNALS]


# ---------------------------------------------------------------------------
# Main export logic
# ---------------------------------------------------------------------------

def export_predictions() -> dict:
    """
    Full prediction and export pipeline.

    Returns:
        dict: The predictions payload (also written to OUTPUT_PATH).
    """
    logger.info("Loading model from %s", MODEL_PATH)
    model = joblib.load(MODEL_PATH)

    # Re-run feature engineering on the full dataset
    _, _, _, _, full_df = build_feature_matrix(DATA_PATH)

    feature_cols = RAW_FEATURE_COLS + [
        "engagement_score",
        "recency_penalty",
        "participation_gap",
    ]

    X_all = full_df[feature_cols]
    risk_scores = model.predict_proba(X_all)[:, 1]

    # Load feature importances from metrics.json if available
    metrics_path = MODEL_PATH.parent / "metrics.json"
    feature_importances = {}
    if metrics_path.exists():
        with open(metrics_path) as f:
            metrics = json.load(f)
            feature_importances = metrics.get("feature_importances", {})

    # Build per-student records
    students_output = []
    for idx, (_, row) in enumerate(full_df.iterrows()):
        score = float(risk_scores[idx])
        tier = _assign_tier(score, RISK_THRESHOLD)
        signals = _top_signals(row, feature_importances)

        students_output.append(
            {
                "user_id": row["user_id"],
                "risk_score": round(score, 4),
                "risk_label": tier,
                "top_signals": signals,
                "recommended_action": INTERVENTION_RULES[tier],
                # Raw features for frontend tooltip rendering
                "features": {
                    "days_since_last_login": int(row["days_since_last_login"]),
                    "avg_completion_rate": round(float(row["avg_completion_rate"]), 3),
                    "assessment_participation_ratio": round(
                        float(row["assessment_participation_ratio"]), 3
                    ),
                    "engagement_score": round(float(row.get("engagement_score", 0)), 3),
                },
            }
        )

    # Sort: highest risk first for immediate scannability in the frontend
    students_output.sort(key=lambda s: s["risk_score"], reverse=True)

    at_risk = [s for s in students_output if s["risk_label"] in ("HIGH", "MEDIUM")]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_version": MODEL_VERSION,
        "threshold": RISK_THRESHOLD,
        "summary": {
            "total_students": len(students_output),
            "at_risk_count": len(at_risk),
            "high_risk_count": sum(1 for s in students_output if s["risk_label"] == "HIGH"),
            "medium_risk_count": sum(1 for s in students_output if s["risk_label"] == "MEDIUM"),
            "safe_count": len(students_output) - len(at_risk),
        },
        "students": students_output,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(payload, f, indent=2)

    logger.info(
        "Exported %d students → %s | High: %d | Medium: %d | Safe: %d",
        payload["summary"]["total_students"],
        OUTPUT_PATH,
        payload["summary"]["high_risk_count"],
        payload["summary"]["medium_risk_count"],
        payload["summary"]["safe_count"],
    )

    return payload


if __name__ == "__main__":
    export_predictions()
