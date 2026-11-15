"""FastAPI router for White Sand Hybrid BM25 + TF-IDF RAG & Slot Extraction (E5)."""
from __future__ import annotations

from fastapi import APIRouter

from app.schemas.revenue_schema import ConciergeAskRequest, ConciergeAskResponse
from app.services.concierge_rag import HybridConciergeRagService

router = APIRouter(prefix="/api/v1/concierge", tags=["Concierge RAG"])
_rag = HybridConciergeRagService()


@router.post(
    "/ask",
    response_model=ConciergeAskResponse,
    summary="Retrieve grounded White Sand SOP citations and extract booking slots",
)
def ask_concierge(payload: ConciergeAskRequest):
    return ConciergeAskResponse(**_rag.ask(message=payload.message, language=payload.language))

