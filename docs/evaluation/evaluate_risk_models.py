"""
Honest evaluation of the AquaSense mortality-risk models.

Runs in Google Colab or locally:
    python evaluate_risk_models.py [path/to/crayfish_dataset_with_risk_score_stability.csv]

Every number printed here is computed from the models' own predictions. Nothing is
tuned toward target values. Differences from an earlier draft of this script:
  * The "ML calibration alignment" step was removed. It copied the true labels and
    randomly flipped rows to hit chosen sensitivity/false-alarm targets, so its
    output described the random flips, not any model.
  * Response time is measured (algorithm compute time), not typed in.
  * Early-warning time is reported as not measurable: the dataset has no time series.
  * Cut-off tuning, if used, is fitted on a training split and reported on a held-out
    test split.
  * The model as deployed in AquaSense (no dissolved-oxygen probe, ammonia only from
    manual TAN entry) is evaluated alongside the original formula.
"""
import sys
import time

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, confusion_matrix, recall_score
from sklearn.model_selection import train_test_split

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252 and cannot print "≥"

PATH = sys.argv[1] if len(sys.argv) > 1 else "/content/crayfish_dataset_with_risk_score_stability.csv"
LABELS = ["Low", "Moderate", "High", "Extreme"]
DANGER = ["High", "Extreme"]

df = pd.read_csv(PATH)
print(f"Rows: {len(df)}")
print("Label distribution:", df["risk_label"].value_counts().reindex(LABELS).to_dict())

# =========================================
# MODELS (same rules as the study / AquaSense backend)
# =========================================

def threshold_violations(r):
    return int(r["dissolved_oxygen_mgL"] < 4.5) + int(r["ammonia_mgL"] > 2.0) + int(r["temperature_c"] > 32) \
        + int(r["ph"] < 6.5 or r["ph"] > 8.5) + int(r["turbidity_NTU"] > 70)


def threshold_based(r):
    v = threshold_violations(r)
    return "Low" if v <= 0 else "Moderate" if v == 1 else "High" if v == 2 else "Extreme"


def risk_score_only(r, use_do=True, use_ammonia=True):
    s = 0
    do, am, t, ph, tu, d = (r["dissolved_oxygen_mgL"], r["ammonia_mgL"], r["temperature_c"], r["ph"],
                            r["turbidity_NTU"], r["duration_violation_min"])
    if use_do:
        s += 35 if do < 3 else 20 if do < 4 else 10 if do < 5 else 0
    if use_ammonia:
        s += 30 if am > 5 else 20 if am > 3 else 10 if am > 1.5 else 0
    s += 25 if t > 35 else 15 if t > 32 else 8 if t > 30 else 0
    s += 20 if (ph < 6 or ph > 8.5) else 10 if (ph < 6.5 or ph > 8.0) else 0
    s += 15 if tu > 80 else 8 if tu > 60 else 0
    s += 25 if d > 60 else 15 if d > 30 else 8 if d > 15 else 0
    return s


def risk_score_trend(r, use_do=True, use_ammonia=True):
    s = risk_score_only(r, use_do, use_ammonia)
    if use_do and r["oxygen_trend"] == "Decreasing": s += 8
    if use_ammonia and r["ammonia_trend"] == "Rising": s += 8
    if r["temp_trend"] == "Rising": s += 5
    return min(s, 100)


def classify(score, cuts=(30, 55, 80)):
    a, b, c = cuts
    return "Low" if score <= a else "Moderate" if score <= b else "High" if score <= c else "Extreme"


# =========================================
# EVALUATION
# =========================================

def evaluate(actual, predicted):
    actual, predicted = pd.Series(actual).reset_index(drop=True), pd.Series(predicted).reset_index(drop=True)
    a_bin, p_bin = actual.isin(DANGER), predicted.isin(DANGER)
    tn, fp, fn, tp = confusion_matrix(a_bin, p_bin, labels=[False, True]).ravel()
    return {
        "accuracy": round(accuracy_score(actual, predicted) * 100, 2),
        "sensitivity": round(recall_score(a_bin, p_bin, zero_division=0) * 100, 2),
        "false_alarm": round(fp / (fp + tn) * 100, 2) if (fp + tn) else 0.0,
        "confusion_matrix": confusion_matrix(actual, predicted, labels=LABELS),
    }


def time_per_row(fn, frame, repeats=3):
    rows = frame.to_dict("records")
    best = float("inf")
    for _ in range(repeats):
        start = time.perf_counter()
        for r in rows:
            fn(r)
        best = min(best, (time.perf_counter() - start) / len(rows))
    return best * 1e6  # microseconds


def consistency(scores):
    """1 / (1 + coefficient of variation): how tightly scores cluster. It measures spread, not stability over time."""
    scores = pd.Series(scores, dtype=float)
    return round((1 / (1 + scores.std() / max(scores.mean(), 1))) * 100, 2)


df["threshold_prediction"] = df.apply(threshold_based, axis=1)
df["threshold_score"] = df.apply(threshold_violations, axis=1) * 25
df["risk_score_only"] = df.apply(risk_score_only, axis=1)
df["risk_scoring_prediction"] = df["risk_score_only"].apply(classify)
df["risk_score_trend"] = df.apply(risk_score_trend, axis=1)
df["risk_scoring_trend_prediction"] = df["risk_score_trend"].apply(classify)
# As deployed in AquaSense today: no DO probe, no ammonia unless a TAN measurement was entered.
df["aquasense_no_do_no_ammonia"] = df.apply(lambda r: classify(risk_score_trend(r, False, False)), axis=1)
df["aquasense_no_do_with_tan"] = df.apply(lambda r: classify(risk_score_trend(r, False, True)), axis=1)

models = {
    "Threshold-Based": ("threshold_prediction", lambda r: threshold_based(r), "threshold_score"),
    "Risk Scoring": ("risk_scoring_prediction", lambda r: classify(risk_score_only(r)), "risk_score_only"),
    "Risk Scoring + Trend": ("risk_scoring_trend_prediction", lambda r: classify(risk_score_trend(r)), "risk_score_trend"),
}

results = {}
for name, (column, fn, score_column) in models.items():
    m = evaluate(df["risk_label"], df[column])
    m["compute_us"] = round(time_per_row(fn, df), 2)
    m["consistency"] = consistency(df[score_column])
    results[name] = m

# Cut-offs tuned on a training split only, reported on the held-out test split.
train, test = train_test_split(df, test_size=0.3, random_state=42, stratify=df["risk_label"])
best_cuts, best_acc = None, -1
for a in range(10, 60):
    for b in range(a + 1, 85):
        for c in range(b + 1, 101):
            acc = (train["risk_score_trend"].apply(lambda s: classify(s, (a, b, c))) == train["risk_label"]).mean()
            if acc > best_acc:
                best_cuts, best_acc = (a, b, c), acc
tuned_test = evaluate(test["risk_label"], test["risk_score_trend"].apply(lambda s: classify(s, best_cuts)))
default_test = evaluate(test["risk_label"], test["risk_score_trend"].apply(classify))

# =========================================
# REPORT
# =========================================

table = pd.DataFrame({
    "Metric": ["Classification Accuracy", "Sensitivity (High/Extreme)", "False Alarm Rate",
               "Algorithm compute time", "Early Warning Time", "Score consistency (1/(1+CV))"],
    "Target": ["≥90%", "≥90%", "≤15%", "≤5 sec end-to-end", "≥15 min", "≥65%"],
    **{name: [f"{m['accuracy']}%", f"{m['sensitivity']}%", f"{m['false_alarm']}%", f"{m['compute_us']} µs/assessment",
              "Not measurable (no time series)", f"{m['consistency']}%"] for name, m in results.items()},
})

print("\n====================================")
print(" EVALUATION TABLE (computed, not tuned to targets)")
print("====================================")
print(table.to_string(index=False))

print("\nConfusion matrix, Risk Scoring + Trend (rows = actual, cols = predicted; Low, Moderate, High, Extreme):")
print(results["Risk Scoring + Trend"]["confusion_matrix"])

print("\nHeld-out test split (30%), Risk Scoring + Trend:")
print(f"  study cut-offs (30/55/80):  accuracy {default_test['accuracy']}%  sensitivity {default_test['sensitivity']}%  false alarm {default_test['false_alarm']}%")
print(f"  cut-offs tuned on train {best_cuts}: accuracy {tuned_test['accuracy']}%  sensitivity {tuned_test['sensitivity']}%  false alarm {tuned_test['false_alarm']}%")

print("\nAs deployed in AquaSense (Risk Scoring + Trend with the sensors actually installed):")
for label, column in [("no DO probe, no ammonia", "aquasense_no_do_no_ammonia"), ("no DO probe, ammonia from TAN entry", "aquasense_no_do_with_tan")]:
    m = evaluate(df["risk_label"], df[column])
    print(f"  {label:<38} accuracy {m['accuracy']}%  sensitivity {m['sensitivity']}%  false alarm {m['false_alarm']}%")

print("\nNotes for the report:")
print("  * Response time of the full system = telemetry interval (5 s) + backend processing; measure it from")
print("    the reading timestamps and alert/SMS log times on the running system, not from this script.")
print("  * Early-warning time needs time-series data (readings leading up to a mortality event).")
print("  * This dataset has", int((df['risk_label'] == 'Low').sum()), "'Low' rows; results do not show field accuracy.")
print("  * AquaSense adds an ORP factor with provisional limits; it is not in this dataset and is not evaluated here.")

df.to_csv("crayfish_risk_scoring_results.csv", index=False)
table.to_csv("crayfish_validation_table.csv", index=False)
print("\nSaved crayfish_risk_scoring_results.csv and crayfish_validation_table.csv")
