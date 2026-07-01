"""
profiler.py — Risk Profile Clustering
======================================
Segments at-risk students into 3 behavioral/demographic clusters using
K-Means, and assigns each cluster a human-readable profile name and a
tailored intervention strategy.

Where this sits in the system:
  model.py predicts WHO is at risk (binary classification).
  profiler.py explains WHAT KIND of at-risk they are (unsupervised clustering).

These are deliberately two separate stages with two separate ML techniques.
Folding demographics directly into the Random Forest as additional input
features was considered and rejected — see docs/architecture.md for the
reasoning. Keeping classification and profiling separate also means each
stage answers exactly one question and can be explained independently.

Clustering runs ONLY on students the classifier already flagged as at-risk
(HIGH or MEDIUM tier). This keeps the profiles focused on the population
the system's CTA is meant to act on, and avoids diluting cluster centroids
with the much larger healthy population.

Usage (imported by notifier.py):
    from profiler import assign_risk_profiles
    profiled_df = assign_risk_profiles(at_risk_df)
"""

import logging

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import OneHotEncoder, StandardScaler

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
N_CLUSTERS = 3
RANDOM_SEED = 42

# Behavioral features used for clustering (numeric, already in 0-1 range
# or comparable scale after engineering in features.py)
CLUSTER_BEHAVIORAL_COLS = [
    "days_since_last_login",
    "avg_completion_rate",
    "engagement_score",
]

# Demographic features used for clustering (categorical, one-hot encoded)
CLUSTER_DEMOGRAPHIC_COLS = [
    "employment_status",
    "has_dependents",
    "device_primary",
]

# Fallback profile used if a cluster's centroid doesn't clearly match any
# named narrative below. Keeps the system from ever emitting an unlabeled
# or crashing on an unexpected centroid shape.
FALLBACK_PROFILE = {
    "label": "Needs Review",
    "description": "Risk pattern doesn't match a known profile — recommend manual review.",
    "action": "Flag for instructor review before automated outreach.",
}

# ---------------------------------------------------------------------------
# Profile definitions
# ---------------------------------------------------------------------------
# Each profile is matched to a cluster AFTER K-Means runs, by inspecting
# the cluster's centroid (average feature values) rather than assuming
# cluster index 0/1/2 always means the same thing. K-Means cluster labels
# are arbitrary — they can flip order between runs even with the same data,
# depending on initialization. Matching by centroid characteristics keeps
# the system correct regardless of label order.
RISK_PROFILES = {
    "time_constrained": {
        "label": "Time-Constrained",
        "description": (
            "Engagement drops driven by availability, not motivation — "
            "often full-time workers or parents balancing competing demands."
        ),
        "action": (
            "Offer flexible deadline extensions and async catch-up sessions. "
            "Avoid synchronous outreach that adds another time commitment."
        ),
    },
    "disengaged_learner": {
        "label": "Disengaged Learner",
        "description": (
            "Passive content consumption without active participation — "
            "watching but not testing, often younger and mobile-primary."
        ),
        "action": (
            "Send lightweight gamified nudges (streaks, badges, quick wins) "
            "rather than heavy-touch outreach which tends to be ignored."
        ),
    },
    "quiet_decliner": {
        "label": "Quiet Decliner",
        "description": (
            "Was previously engaged; sudden, recent drop-off. High investment, "
            "high recoverability — these students are still reachable."
        ),
        "action": (
            "Immediate direct outreach (personal email or call). Highest "
            "intervention priority — recoverable with the right timing."
        ),
    },
}


# ---------------------------------------------------------------------------
# Feature preparation
# ---------------------------------------------------------------------------

def _prepare_cluster_matrix(df: pd.DataFrame) -> tuple:
    """
    Builds a numeric matrix suitable for K-Means from behavioral and
    demographic columns.

    K-Means computes distances between points, which means every feature
    must be numeric and on a comparable scale. Two transformations happen:

      1. Categorical columns (employment_status, device_primary) are
         one-hot encoded — converted into multiple 0/1 columns, since
         K-Means has no concept of categorical distance.
      2. All columns are standardized (mean=0, std=1) via StandardScaler,
         so that no single feature dominates the distance calculation
         just because it happens to have a larger numeric range (e.g.
         days_since_last_login ranging 0-90 vs engagement_score ranging 0-1).

    Args:
        df: At-risk students with behavioral + demographic columns present

    Returns:
        Tuple of (scaled_matrix, feature_names) — feature_names preserved
        for inspecting centroids later.
    """
    numeric_part = df[CLUSTER_BEHAVIORAL_COLS].copy()

    # has_dependents is already boolean (0/1-like) — no encoding needed
    numeric_part["has_dependents"] = df["has_dependents"].astype(int)

    # One-hot encode the remaining categorical columns
    encoder = OneHotEncoder(sparse_output=False, drop=None)
    categorical_cols = ["employment_status", "device_primary"]
    encoded = encoder.fit_transform(df[categorical_cols])
    encoded_names = encoder.get_feature_names_out(categorical_cols)

    encoded_df = pd.DataFrame(encoded, columns=encoded_names, index=df.index)

    combined = pd.concat([numeric_part, encoded_df], axis=1)

    scaler = StandardScaler()
    scaled_matrix = scaler.fit_transform(combined)

    return scaled_matrix, combined.columns.tolist()


# ---------------------------------------------------------------------------
# Cluster-to-profile matching
# ---------------------------------------------------------------------------

def _match_clusters_to_profiles(centroids, feature_names) -> dict:
    """
    Inspects each cluster's centroid and assigns the best-matching named
    profile from RISK_PROFILES, based on simple, interpretable rules.

    This is intentionally rule-based rather than another ML model — at
    3 clusters and 4 profile dimensions, explicit rules are more
    transparent and easier to defend in an explanation than a second
    layer of inference on top of clustering output.

    Matching logic (checked in order, first match wins):
      - Highest "full_time" + "has_dependents" centroid value
          -> Time-Constrained
      - Highest "mobile" - engagement_score centroid value (of remaining)
          -> Disengaged Learner
      - Whatever's left
          -> Quiet Decliner

    Args:
        centroids:      KMeans cluster_centers_ array, shape (n_clusters, n_features)
        feature_names:  Column names matching centroid columns, in order

    Returns:
        dict mapping cluster_id (int) -> profile dict from RISK_PROFILES
    """
    name_to_idx = {name: i for i, name in enumerate(feature_names)}

    def _centroid_value(centroid, col_name: str) -> float:
        """Safely reads a centroid's value for a given feature column."""
        idx = name_to_idx.get(col_name)
        return centroid[idx] if idx is not None else 0.0

    scored_clusters = []
    for cluster_id, centroid in enumerate(centroids):
        full_time_score = _centroid_value(centroid, "employment_status_full_time")
        dependents_score = _centroid_value(centroid, "has_dependents")
        mobile_score = _centroid_value(centroid, "device_primary_mobile")
        engagement_score = _centroid_value(centroid, "engagement_score")
        recency_score = _centroid_value(centroid, "days_since_last_login")

        scored_clusters.append(
            {
                "cluster_id": cluster_id,
                "time_constrained_score": full_time_score + dependents_score,
                "disengaged_score": mobile_score - engagement_score,
                "quiet_decliner_score": recency_score - engagement_score,
            }
        )

    assignment = {}
    remaining = scored_clusters.copy()

    # Assign Time-Constrained to whichever remaining cluster has the
    # highest combined full-time + dependents centroid value
    best = max(remaining, key=lambda c: c["time_constrained_score"])
    assignment[best["cluster_id"]] = RISK_PROFILES["time_constrained"]
    remaining = [c for c in remaining if c["cluster_id"] != best["cluster_id"]]

    # Assign Disengaged Learner to whichever remaining cluster skews
    # most mobile + least engaged
    if remaining:
        best = max(remaining, key=lambda c: c["disengaged_score"])
        assignment[best["cluster_id"]] = RISK_PROFILES["disengaged_learner"]
        remaining = [c for c in remaining if c["cluster_id"] != best["cluster_id"]]

    # Whatever's left is Quiet Decliner
    for c in remaining:
        assignment[c["cluster_id"]] = RISK_PROFILES["quiet_decliner"]

    logger.info(
        "Cluster to profile assignment: %s",
        {cid: p["label"] for cid, p in assignment.items()},
    )

    return assignment


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def assign_risk_profiles(at_risk_df: pd.DataFrame) -> pd.DataFrame:
    """
    Runs K-Means clustering on at-risk students and attaches profile
    columns: risk_profile_label, risk_profile_description, risk_profile_action.

    Args:
        at_risk_df: DataFrame of students already filtered to HIGH/MEDIUM
                    risk tier, with behavioral + demographic columns present
                    (output of features.py:build_feature_matrix, filtered).

    Returns:
        Copy of at_risk_df with three new columns appended. If fewer than
        N_CLUSTERS students are present, all students are assigned the
        FALLBACK_PROFILE since K-Means requires at least k samples.
    """
    df = at_risk_df.copy()

    if len(df) < N_CLUSTERS:
        logger.warning(
            "Only %d at-risk students — too few to cluster into %d groups. "
            "Assigning fallback profile to all.",
            len(df),
            N_CLUSTERS,
        )
        df["risk_profile_label"] = FALLBACK_PROFILE["label"]
        df["risk_profile_description"] = FALLBACK_PROFILE["description"]
        df["risk_profile_action"] = FALLBACK_PROFILE["action"]
        return df

    matrix, feature_names = _prepare_cluster_matrix(df)

    kmeans = KMeans(n_clusters=N_CLUSTERS, random_state=RANDOM_SEED, n_init=10)
    cluster_ids = kmeans.fit_predict(matrix)

    assignment = _match_clusters_to_profiles(kmeans.cluster_centers_, feature_names)

    df["_cluster_id"] = cluster_ids
    df["risk_profile_label"] = df["_cluster_id"].map(
        lambda cid: assignment.get(cid, FALLBACK_PROFILE)["label"]
    )
    df["risk_profile_description"] = df["_cluster_id"].map(
        lambda cid: assignment.get(cid, FALLBACK_PROFILE)["description"]
    )
    df["risk_profile_action"] = df["_cluster_id"].map(
        lambda cid: assignment.get(cid, FALLBACK_PROFILE)["action"]
    )
    df = df.drop(columns=["_cluster_id"])

    logger.info(
        "Risk profile distribution: %s",
        df["risk_profile_label"].value_counts().to_dict(),
    )

    return df
