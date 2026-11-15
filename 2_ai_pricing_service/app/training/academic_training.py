"""Reproducible offline ADR and cancellation experiments; no operational pricing."""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import platform

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import (RandomForestRegressor, HistGradientBoostingRegressor,
                              HistGradientBoostingClassifier)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (mean_absolute_error, mean_squared_error, r2_score,
    precision_score, recall_score, f1_score, roc_auc_score, average_precision_score,
    confusion_matrix, brier_score_loss, log_loss)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.training.academic_baselines import CalendarRuleBaseline, SeasonalRoomMedianBaseline
from app.training.academic_contract import (CATEGORICAL, NUMERIC, FEATURES, CONTRACT_VERSION,
    CAVEATS, prepare_dataset, temporal_partitions)


@dataclass(frozen=True)
class ExperimentConfig:
    seed: int = 42
    validation_start: str = "2016-07-01"
    test_start: str = "2017-01-01"
    evaluation_as_of: str = "2017-09-16"
    forest_trees: int = 100
    boosting_iterations: int = 120


def preprocessing():
    return ColumnTransformer([
        ("numeric", Pipeline([("impute",SimpleImputer(strategy="median")),
                              ("scale",StandardScaler())]), list(NUMERIC)),
        ("categorical", Pipeline([("impute",SimpleImputer(strategy="most_frequent")),
            ("encode",OneHotEncoder(handle_unknown="ignore",sparse_output=False))]),list(CATEGORICAL)),
    ], remainder="drop")


def estimators(task, config):
    if task == "adr":
        models = {
            "calendar_rule":CalendarRuleBaseline(),
            "seasonal_room_median":SeasonalRoomMedianBaseline(),
            "random_forest":Pipeline([("preprocess",preprocessing()),("model",RandomForestRegressor(
                n_estimators=config.forest_trees,max_depth=14,min_samples_leaf=8,n_jobs=2,random_state=config.seed))]),
            "hist_gradient_boosting":Pipeline([("preprocess",preprocessing()),("model",HistGradientBoostingRegressor(
                max_iter=config.boosting_iterations,max_leaf_nodes=31,l2_regularization=2,
                early_stopping=False,random_state=config.seed))]),
        }
    else:
        models = {
            "constant_prevalence":DummyClassifier(strategy="prior"),
            "logistic_regression":Pipeline([("preprocess",preprocessing()),("model",LogisticRegression(
                max_iter=1500,C=1,random_state=config.seed))]),
            "hist_gradient_boosting":Pipeline([("preprocess",preprocessing()),("model",HistGradientBoostingClassifier(
                max_iter=config.boosting_iterations,max_leaf_nodes=15,l2_regularization=5,
                early_stopping=False,random_state=config.seed))]),
        }
    return models


def regression_metrics(y, prediction):
    return {"mae":float(mean_absolute_error(y,prediction)),
            "rmse":float(np.sqrt(mean_squared_error(y,prediction))),
            "r2":float(r2_score(y,prediction)) if len(y)>1 else None}


def classification_metrics(y, probability):
    prediction = probability >= .5
    both = len(np.unique(y))==2
    calibration = []
    for i in range(10):
        mask = (probability>=i/10) & ((probability<(i+1)/10) if i<9 else probability<=1)
        if mask.any():
            calibration.append({"bin":i,"rows":int(mask.sum()),
                "mean_probability":float(probability[mask].mean()),"observed_rate":float(np.asarray(y)[mask].mean())})
    return {"precision":float(precision_score(y,prediction,zero_division=0)),
        "recall":float(recall_score(y,prediction,zero_division=0)),
        "f1":float(f1_score(y,prediction,zero_division=0)),
        "roc_auc":float(roc_auc_score(y,probability)) if both else None,
        "pr_auc":float(average_precision_score(y,probability)) if both else None,
        "brier":float(brier_score_loss(y,probability)),
        "log_loss":float(log_loss(y,probability,labels=[0,1])),
        "confusion_matrix":confusion_matrix(y,prediction,labels=[0,1]).tolist(),
        "threshold":.5,"calibration":calibration}


def predictions(model, X, task):
    return np.asarray(model.predict(X) if task=="adr" else model.predict_proba(X)[:,1],dtype=float)


def to_records(frame):
    return json.loads(frame.to_json(orient="records",date_format="iso"))


def evaluate_task(frame, task, config):
    parts, split = temporal_partitions(frame,task,config.validation_start,config.test_start,config.evaluation_as_of)
    target = "adr" if task=="adr" else "is_canceled"
    metric = regression_metrics if task=="adr" else classification_metrics
    selection_metric = "mae" if task=="adr" else "log_loss"
    models = estimators(task,config)
    validation, test_metrics, test_predictions = {}, {}, {}
    train, valid, test = (parts[name] for name in ("train","validation","test"))
    for name, model in models.items():
        print(f"{task}: fitting {name} on {len(train)} rows",flush=True)
        model.fit(train.loc[:,FEATURES],train[target])
        validation[name] = metric(valid[target],predictions(model,valid.loc[:,FEATURES],task))
    selected = min(models,key=lambda name:validation[name][selection_metric])
    # Freeze selection before inspecting test. No test-driven refit/tuning.
    print(f"{task}: selected {selected} using validation {selection_metric}",flush=True)
    for name, model in models.items():
        p = predictions(model,test.loc[:,FEATURES],task)
        test_predictions[name] = p
        test_metrics[name] = metric(test[target],p)
    p = test_predictions[selected]
    slices = {}
    for column in ("hotel","reserved_room_type","arrival_month","market_segment"):
        slices[column] = {}
        for value, group in test.groupby(column):
            positions = test.index.get_indexer(group.index)
            slices[column][str(value)] = {"rows":len(group),**metric(group[target],p[positions])}
    reference = "seasonal_room_median" if task=="adr" else "constant_prevalence"
    difference = test_metrics[reference][selection_metric]-test_metrics[selected][selection_metric]
    ml_names = ("random_forest","hist_gradient_boosting") if task=="adr" else ("logistic_regression","hist_gradient_boosting")
    report = {"selected":selected,"selection_partition":"validation","selection_metric":selection_metric,
        "selection_frozen_before_test":True,"fit_partition":"train only; no refit on validation/test",
        "split":split,"validation":validation,"test":test_metrics,"slices":slices,
        "baseline_reference":reference,"test_improvement_over_reference":float(difference),
        "ml_beats_reference_on_test":any(test_metrics[n][selection_metric]<test_metrics[reference][selection_metric] for n in ml_names),
        "target":target,"adr_unit":"EUR" if task=="adr" else None,
        "cohort":"positive ADR, Check-Out/non-canceled only; conditional-on-completion bias" if task=="adr" else "valid unique booking records; is_canceled includes No-Show"}
    display = test.loc[:,["row_id","arrival_date","creation_date",*FEATURES,target]].copy()
    display["observed"] = test[target]
    for name, values in test_predictions.items():
        display[f"prediction_{name}"] = values
    display["prediction"] = p
    display["error"] = np.abs(np.asarray(test[target])-p)
    report["largest_errors"] = to_records(display.nlargest(10,"error"))
    report["smallest_errors"] = to_records(display.nsmallest(5,"error"))
    # Store per-feature training ranges/categories so serving can report weak inputs.
    domain = {"numeric":{c:{"min":float(train[c].min()),"max":float(train[c].max()),
        "median":float(train[c].median())} for c in NUMERIC},
        "categories":{c:sorted(train[c].dropna().unique().tolist()) for c in CATEGORICAL},
        "reference_record":json.loads(train.loc[:,FEATURES].iloc[len(train)//2].to_json())}
    return {"models":models,"selected":selected,"domain":domain}, report, to_records(display)


def run_experiment(data_path: Path, output: Path, config=ExperimentConfig()):
    frame, quality = prepare_dataset(data_path)
    code_hash = hashlib.sha256(b"".join(Path(__file__).with_name(n).read_bytes() for n in
        ("academic_contract.py","academic_baselines.py","academic_training.py"))).hexdigest()
    run_id = hashlib.sha256(json.dumps({"data":quality["sha256"],"config":asdict(config),
        "contract":CONTRACT_VERSION,"code":code_hash},sort_keys=True).encode()).hexdigest()[:16]
    report = {"schema_version":"1.0.0","model_version":f"academic-v1-{run_id}","training_run_id":run_id,
        "feature_contract_version":CONTRACT_VERSION,"features":list(FEATURES),"config":asdict(config),
        "data":quality,"caveats":CAVEATS,"code_sha256":code_hash,
        "runtime":{"python":platform.python_version(),"sklearn":sklearn.__version__,"pandas":pd.__version__,"numpy":np.__version__}}
    bundle = {"metadata":report,"tasks":{}}
    holdout = {}
    for task in ("adr","cancellation"):
        task_bundle, task_report, rows = evaluate_task(frame,task,config)
        bundle["tasks"][task] = task_bundle
        report[task] = task_report
        holdout[task] = rows
    output.mkdir(parents=True,exist_ok=True)
    joblib.dump(bundle,output/"bundle.joblib",compress=3)
    (output/"report.json").write_text(json.dumps(report,indent=2,allow_nan=False),encoding="utf8")
    (output/"holdout.json").write_text(json.dumps(holdout,allow_nan=False),encoding="utf8")
    files = {name:hashlib.sha256((output/name).read_bytes()).hexdigest() for name in ("bundle.joblib","report.json","holdout.json")}
    (output/"manifest.json").write_text(json.dumps({"model_version":report["model_version"],"files":files},indent=2),encoding="utf8")
    return report


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data",type=Path,default=root/"notebooks/hotel_bookings.csv")
    parser.add_argument("--output",type=Path,default=root/"app/models/academic_v1")
    args = parser.parse_args()
    report = run_experiment(args.data,args.output)
    print(json.dumps({task:{"selected":report[task]["selected"],"test":report[task]["test"]} for task in ("adr","cancellation")},indent=2))


if __name__ == "__main__":
    main()
