from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_PATH = Path(__file__).resolve().parent / "models" / "random_forest_v1.pkl"
ml_model = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global ml_model
    try:
        ml_model = joblib.load(MODEL_PATH)
        print(f"Loaded pricing model from {MODEL_PATH}")
    except Exception as error:
        ml_model = None
        print(f"Unable to load pricing model: {error}")
    yield


app = FastAPI(title="Hotel AI Pricing Service", version="1.0.0", lifespan=lifespan)


class PricingRequest(BaseModel):
    lead_time: int = Field(ge=0)
    arrival_month: int = Field(ge=1, le=12)
    is_weekend: int = Field(ge=0, le=1)
    total_of_special_requests: int = Field(ge=0, le=5)


class PricingResponse(BaseModel):
    status: str = "success"
    ai_multiplier: float
    message: str = "Dynamic price multiplier calculated."


@app.get('/health')
@app.get('/api/v1/health')
def health_check() -> dict[str, str]:
    return {"status": "ok" if ml_model is not None else "model_unavailable"}


@app.post('/api/v1/predict-price', response_model=PricingResponse)
def predict_dynamic_price(request: PricingRequest) -> PricingResponse:
    if ml_model is None:
        raise HTTPException(status_code=503, detail="Pricing model is unavailable.")
    frame = pd.DataFrame([request.model_dump()])
    try:
        multiplier = round(float(ml_model.predict(frame)[0]), 3)
        return PricingResponse(ai_multiplier=multiplier)
    except Exception as error:
        raise HTTPException(status_code=500, detail="Pricing inference failed.") from error
