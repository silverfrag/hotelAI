from contextlib import asynccontextmanager

from fastapi import FastAPI
from app.api.endpoints.academic import router as academic_router
from app.api.endpoints.concierge import router as concierge_router
from app.api.endpoints.conversion import router as conversion_router
from app.api.endpoints.monitoring import router as monitoring_router
from app.api.endpoints.pricing import router as pricing_router
from app.api.endpoints.revenue import router as revenue_router
from app.core.config import APP_TITLE, APP_VERSION, Settings, configure_logging, load_settings
from app.services.conversion_inference import ConversionInferenceService
from app.services.inference import PricingInferenceService


def create_app(
    settings: Settings | None = None,
    inference_service: PricingInferenceService | None = None,
    conversion_inference_service: ConversionInferenceService | None = None,
) -> FastAPI:
    app_settings = settings or load_settings()
    service = inference_service or PricingInferenceService(app_settings.model_path)
    conversion_service = conversion_inference_service or ConversionInferenceService(
        app_settings.conversion_model_path
    )
    configure_logging(app_settings.log_level)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.pricing_inference = service
        application.state.conversion_inference = conversion_service
        service.load()
        conversion_service.load()
        yield
        conversion_service.unload()
        service.unload()

    application = FastAPI(
        title=APP_TITLE,
        version=APP_VERSION,
        lifespan=lifespan,
    )
    application.include_router(pricing_router)
    application.include_router(revenue_router)
    application.include_router(concierge_router)
    application.include_router(academic_router)
    application.include_router(conversion_router)
    application.include_router(monitoring_router)
    return application


app = create_app()
