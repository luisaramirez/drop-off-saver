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

## Version 3

Taking advantage of what AI models can accoplish, in this version the product's main objective was repurposed so it won't stop at classifying data. Instead, by using students' demographics (which online learning platforms usually know), we can cluster at-risk students into actionable intervention groups with custom retention plans.

**Demographic columns**
Demographics were included at the generator.py level, so they are available directly from the CSV data file.
  - age_bracket
  - employment_status
  - has_dependents
  - device_primary

**profiler.py**
This new file is the second ML layer of our pipeline. Clustering at-risk students into 3 behavioral profiles:

  - "Time-Constrained"    : Availability-driven drop-off (full-time workers, parents) — Strategy: Flexible deadlines, async support
  - "Disengaged Learner"  : Passive viewing without participation (younger, mobile-primary) — Strategy: Lightweight gamified nudges
  - "Quiet Decliner"      : Previously engaged, sudden recent drop (high recoverability)  — Strategy: Immediate direct outreach

Now, every at-risk student has a complete risk_profile object (label, description, suggested_strategy), what we will use to design a UI/UX that reflects data findings properly in V4.

---

## [In progress] Version 4

Now that we have everything in terms of data, we can work on enhancing the visual narrative we use to display our findings.
The goal is to use visual elements/shapes to represent students and the data we know about them (Risk level and profile) in a cohesive interactive story.

**Work done:**
  - Adding riskJourney.js to fetch data from predictions.json and begin creating UI elements to represent it.
  - Modifying notifier.py in the intelligence layer with dynamic values for high_risk_cutoff.
  - Updating the front-end (index.html, main.css and app.js) to display the proposed interactive visual narrative, as well as replacing all hardcoded values with dynamic placeholders that represent real data from our CSV source of truth.
  - Defining scroll zones for the dots grid entrance and coloring animations
  - Test-metaball HTML and JS files added as a separate module to test the dots animation before full integration.
  - Merge tested blob animation into the actual scroll motion to go from a dot grid into two circular shapes (safe and at-risk students).