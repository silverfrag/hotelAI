"""Isolated academic models. Never changes checkout prices or booking actions."""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.schemas.academic_schema import AcademicBookingRequest
from app.training.academic_contract import FEATURES, CONTRACT_VERSION, CAVEATS, date_features

logger = logging.getLogger(__name__)
DEFAULT_ACADEMIC_PATH = Path(__file__).resolve().parents[1]/"models/academic_v1"
EXPLANATION_GROUPS = {
    "arrival_and_stay": ["arrival_month","arrival_day","arrival_weekday","stay_nights","weekend_share"],
    "hotel_and_room": ["hotel","reserved_room_type"],
    "lead_time":["lead_time"], "adults":["adults"],"children":["children"],"babies":["babies"],
    "meal":["meal"],"market_segment":["market_segment"],
    "distribution_channel":["distribution_channel"],"customer_type":["customer_type"],
}


class AcademicUnavailableError(RuntimeError):
    pass


class AcademicInferenceService:
    def __init__(self, path: Path = DEFAULT_ACADEMIC_PATH):
        self.path = path
        self.bundle = None
        self.holdout = None

    def load(self):
        try:
            manifest = json.loads((self.path/"manifest.json").read_text(encoding="utf8"))
            for name in ("bundle.joblib","report.json","holdout.json"):
                if hashlib.sha256((self.path/name).read_bytes()).hexdigest()!=manifest["files"][name]:
                    raise ValueError("Academic artifact checksum mismatch")
            bundle = joblib.load(self.path/"bundle.joblib")
            if bundle["metadata"]["feature_contract_version"]!=CONTRACT_VERSION or bundle["metadata"]["features"]!=list(FEATURES):
                raise ValueError("Unsupported academic feature contract")
            if bundle["metadata"]["model_version"]!=manifest["model_version"]:
                raise ValueError("Academic manifest version mismatch")
            self.bundle = bundle
            self.holdout = json.loads((self.path/"holdout.json").read_text(encoding="utf8"))
        except Exception:
            self.bundle = None
            self.holdout = None
            logger.exception("Academic models unavailable at %s",self.path)

    def require_ready(self):
        if not self.bundle or self.holdout is None:
            raise AcademicUnavailableError("Academic artifacts unavailable; run academic_training.")

    def info(self):
        self.require_ready()
        report = self.bundle["metadata"]
        return {"model_version":report["model_version"],"training_run_id":report["training_run_id"],
            "feature_contract_version":CONTRACT_VERSION,"caveats":CAVEATS,
            "data":report["data"],"config":report["config"],
            "tasks":{t:{k:v for k,v in report[t].items() if k not in {"largest_errors","smallest_errors"}}
                     for t in ("adr","cancellation")},
            "categories":self.bundle["tasks"]["cancellation"]["domain"]["categories"]}

    @staticmethod
    def features(payload):
        values = payload.model_dump(exclude={"arrival_date"})
        values.update(date_features(payload.arrival_date,payload.stay_nights))
        return {name:values[name] for name in FEATURES}

    @staticmethod
    def _predict(model, X, task):
        values = np.asarray(model.predict(X) if task=="adr" else model.predict_proba(X)[:,1],dtype=float)
        if not np.isfinite(values).all() or (task=="adr" and (values<0).any()) or (task=="cancellation" and ((values<0)|(values>1)).any()):
            raise ValueError("Non-finite or invalid prediction")
        return values

    def decide(self, payload: AcademicBookingRequest, explain=True):
        self.require_ready()
        values = self.features(payload)
        X = pd.DataFrame([{k:np.nan if v is None else v for k,v in values.items()}],columns=FEATURES)
        warnings, sources, output, baseline_values, explanations = [], {}, {}, {}, {}
        for task, baseline in (("adr","seasonal_room_median"),("cancellation","constant_prevalence")):
            state = self.bundle["tasks"][task]
            model_name = state["selected"]
            model = state["models"][model_name]
            domain = state["domain"]
            for feature, value in values.items():
                if value is None:
                    warnings.append(f"{task}: missing {feature}; training-only imputation is used.")
                elif feature in domain["categories"] and value not in domain["categories"][feature]:
                    warnings.append(f"{task}: unknown {feature}={value}; category encoding has no learned coefficient.")
                elif feature in domain["numeric"]:
                    limits = domain["numeric"][feature]
                    if not limits["min"]<=value<=limits["max"]:
                        warnings.append(f"{task}: {feature} outside training range [{limits['min']}, {limits['max']}].")
            try:
                baseline_values[task] = float(self._predict(state["models"][baseline],X,task)[0])
            except Exception:
                baseline_values[task] = None
            try:
                value = float(self._predict(model,X,task)[0])
                source = ("baseline:" if model_name in {"calendar_rule","seasonal_room_median","constant_prevalence"} else "ml:")+model_name
            except Exception:
                value = baseline_values[task]
                source = f"fallback_baseline:{baseline}" if value is not None else "unavailable"
                warnings.append(f"{task}: model failed; {source}.")
            output[task],sources[task] = value,source
            explanations[task] = []
            if explain and value is not None and not source.startswith(("fallback","unavailable")):
                reference = domain["reference_record"]
                replacements = []
                for group, columns in EXPLANATION_GROUPS.items():
                    changed = X.copy()
                    for name in columns:
                        changed[name] = np.nan if reference[name] is None else reference[name]
                    replacements.append(changed)
                try:
                    altered = self._predict(model,pd.concat(replacements,ignore_index=True),task)
                    explanations[task] = sorted([
                        {"feature_group":group,"difference":float(value-p),
                         "reference_values":{c:reference[c] for c in EXPLANATION_GROUPS[group]}}
                        for group,p in zip(EXPLANATION_GROUPS,altered)],key=lambda item:abs(item["difference"]),reverse=True)
                except Exception:
                    warnings.append(f"{task}: explanation unavailable; prediction remains valid.")
        if payload.arrival_date.year not in {2015,2016,2017}:
            warnings.append("Arrival year outside source period 2015–2017; temporal transfer has not been validated.")
        if any(s.startswith("fallback") or s=="unavailable" for s in sources.values()):
            status = "degraded"
        else:
            status = "success"
        metadata = self.bundle["metadata"]
        return {"status":status,"adr_reference":output["adr"],"cancellation_probability":output["cancellation"],
            "adr_unit":"EUR","model_version":metadata["model_version"],"training_run_id":metadata["training_run_id"],
            "feature_contract_version":CONTRACT_VERSION,"prediction_sources":sources,
            "baselines":baseline_values,"features":values,"explanation":explanations,
            "explanation_method":"grouped reference replacement against one training record; signed differences are non-additive, not causal",
            "business_rules":[{"rule":"advisory_only","source":"application_rule","applied":True,
                "description":"No booking, price write or cancellation action is taken."},
                {"rule":"price_limits","source":"application_rule","applied":False,
                 "description":"No operational floor/ceiling or EUR→VND conversion applied; ADR reference is returned unchanged."},
                {"rule":"risk_threshold","source":"application_rule","value":.5,
                 "description":"Fixed evaluation threshold, not a learned business policy or automatic rejection rule."}],
            "warnings":list(dict.fromkeys(warnings)),"caveats":CAVEATS,"hypothetical":True}

    def list_holdout(self, task="adr", offset=0, limit=20, order="source"):
        self.require_ready()
        rows = self.holdout[task]
        if order in {"largest_error","smallest_error"}:
            rows = sorted(rows,key=lambda r:r["error"],reverse=order=="largest_error")
        return {"task":task,"total":len(rows),"offset":offset,"rows":[
            {k:r[k] for k in ("row_id","arrival_date","hotel","reserved_room_type","observed","prediction","error")}
            for r in rows[offset:offset+limit]],"partition":"test; excluded from fitting and model selection"}

    def experiment(self, task, row_id):
        self.require_ready()
        row = next((r for r in self.holdout[task] if r["row_id"]==row_id),None)
        if row is None:
            raise KeyError("Holdout booking not found")
        fields = {k:row[k] for k in AcademicBookingRequest.model_fields if k!="arrival_date"}
        for key in ("lead_time","stay_nights","adults","children","babies"):
            if fields[key] is not None:
                fields[key] = int(fields[key])
        payload = AcademicBookingRequest(**fields,
            arrival_date=row["arrival_date"][:10])
        result = self.decide(payload)
        result["hypothetical"] = False
        return {"task":task,"row_id":row_id,"partition":"test", "input":payload.model_dump(mode="json"),
            "observed":row["observed"],"stored_predictions":{k.removeprefix("prediction_"):v for k,v in row.items() if k.startswith("prediction_")},
            "decision":result,"target_caveat":self.bundle["metadata"][task]["cohort"]}
