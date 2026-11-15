"""Explicit non-ML price comparators, learned only from training aggregates."""
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin


class CalendarRuleBaseline(RegressorMixin, BaseEstimator):
    """Illustrative script: +10% weekend stay, +10% arrival Jan 1/Dec 25.

    Deliberately limited fixed holiday calendar, not an estimated holiday effect.
    """
    def fit(self, X, y):
        self.reference_ = float(np.median(y))
        return self

    def predict(self, X):
        holiday = ((X.arrival_month == 1) & (X.arrival_day == 1)) | ((X.arrival_month == 12) & (X.arrival_day == 25))
        multiplier = 1 + .10 * (X.weekend_share > 0).to_numpy() + .10 * holiday.to_numpy()
        return self.reference_ * multiplier


class SeasonalRoomMedianBaseline(RegressorMixin, BaseEstimator):
    def fit(self, X, y):
        data = X.copy()
        data["_target"] = np.asarray(y)
        self.global_ = float(np.median(y))
        self.groups_ = data.groupby(["hotel","reserved_room_type","arrival_month"])["_target"].median().to_dict()
        self.rooms_ = data.groupby(["hotel","reserved_room_type"])["_target"].median().to_dict()
        return self

    def predict(self, X):
        return np.array([self.groups_.get((r.hotel,r.reserved_room_type,r.arrival_month),
            self.rooms_.get((r.hotel,r.reserved_room_type),self.global_)) for r in X.itertuples()])
