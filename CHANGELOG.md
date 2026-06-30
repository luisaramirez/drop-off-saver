# Changes log
> Description of all changes made per each of the versions as I work on iterating the project.

---

## Version 2

The first version's predictions were too extreme, being pushed by the model to clusters near 0.9 or 0.1, with very few in the middle range. The first big update for this project would be to update the generator.py, so it reflects data more realistically. 

**Updated cohorts:**
  - "healthy"        : 75% — high engagement, low dropout risk
  - "struggling"     : 12% — borderline students, not yet at risk
  - "at_risk"        : 8%  — clear disengagement signals
  - "seasonal_churn" : 3%  — edge case: summer dropout spike
  - "ghost_students" : 2%  — enrolled but never active (missing data)

Now, we have a "struggling" cohort that should reflect students that are not yet at risk of dropping of, but are very close. These should result in uncertainty at the model's layer, and therefore mid-range probability scores (0.35-0.60).

---