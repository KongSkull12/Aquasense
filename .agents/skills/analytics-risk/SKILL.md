---
name: analytics-risk
description: Assess implemented AquaSense water-quality indicators, trends, threshold estimates, and risk labels when reviewing analytics behavior or claims.
---

# AquaSense Analytics and Risk

Inspect the real implementation and tests before naming its methods. Do not
assume a Z-score, anomaly detector, predictive model, mortality model, or any
particular score exists. Trace inputs, units, calibration and health state,
normalization, weights, thresholds, trend windows, ETA logic, and missing or
invalid data only where the code uses them.

Describe the method as implemented. A computed score or linear extrapolation is
not a validated mortality probability or machine learning. Separate measured,
derived, and estimated values; identify scientific support and calibration
limits. Report evidence, correct interpretation, concrete risks, and focused
verification needs.
