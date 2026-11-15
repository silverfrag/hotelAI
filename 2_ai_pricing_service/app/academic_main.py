"""Standalone academic demo: real models, no operational DB or legacy pricing."""
from fastapi import FastAPI
from app.api.endpoints.academic import router
from app.api.endpoints.revenue import router as revenue_router

app = FastAPI(title="HotelAI Academic Decision Support", version="1.0.0")
app.include_router(router)
app.include_router(revenue_router)


@app.get("/health/live")
def live():
    return {"status":"alive"}
