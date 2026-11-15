from typing import Literal
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.schemas.academic_schema import AcademicBookingRequest, AcademicDecisionResponse, HoldoutRequest
from app.services.academic_inference import AcademicInferenceService, AcademicUnavailableError, DEFAULT_ACADEMIC_PATH

router = APIRouter(prefix="/api/v1/academic",tags=["academic decision support"])


def get_academic_service(request: Request):
    if not hasattr(request.app.state,"academic_inference"):
        service = AcademicInferenceService(Path(os.getenv("ACADEMIC_MODEL_DIR",str(DEFAULT_ACADEMIC_PATH))))
        service.load()
        request.app.state.academic_inference = service
    service = request.app.state.academic_inference
    try:
        service.require_ready()
    except AcademicUnavailableError as error:
        raise HTTPException(503,str(error)) from error
    return service


@router.get("/info")
def info(service=Depends(get_academic_service)):
    return service.info()


@router.post("/decision",response_model=AcademicDecisionResponse)
def decide(payload: AcademicBookingRequest,service=Depends(get_academic_service)):
    return service.decide(payload)


@router.get("/holdout")
def holdout(task: Literal["adr","cancellation"]="adr",offset: int=Query(0,ge=0),
            limit: int=Query(20,ge=1,le=100),
            order: Literal["source","largest_error","smallest_error"]="source",
            service=Depends(get_academic_service)):
    return service.list_holdout(task,offset,limit,order)


@router.post("/experiment")
def experiment(payload: HoldoutRequest,service=Depends(get_academic_service)):
    try:
        return service.experiment(payload.task,payload.row_id)
    except KeyError as error:
        raise HTTPException(404,"Holdout booking not found") from error
