import logging
import os
from dataclasses import dataclass
from pathlib import Path

APP_TITLE = "Hotel AI Pricing Service"
APP_VERSION = "1.2.0"
MODEL_PATH_ENV = "MODEL_PATH"
CONVERSION_MODEL_PATH_ENV = "CONVERSION_MODEL_PATH"
DEFAULT_MODEL_PATH = (
    Path(__file__).resolve().parents[1] / "models" / "random_forest_v2.pkl"
)
DEFAULT_CONVERSION_MODEL_PATH = (
    Path(__file__).resolve().parents[1]
    / "models"
    / "conversion_challenger_v1.pkl"
)


@dataclass(frozen=True, slots=True)
class Settings:
    model_path: Path
    log_level: str = "INFO"
    conversion_model_path: Path = DEFAULT_CONVERSION_MODEL_PATH


def load_settings() -> Settings:
    configured_path = os.getenv(MODEL_PATH_ENV)
    model_path = Path(configured_path).expanduser() if configured_path else DEFAULT_MODEL_PATH
    if not model_path.is_absolute():
        model_path = Path.cwd() / model_path

    configured_conversion_path = os.getenv(CONVERSION_MODEL_PATH_ENV)
    conversion_model_path = (
        Path(configured_conversion_path).expanduser()
        if configured_conversion_path
        else DEFAULT_CONVERSION_MODEL_PATH
    )
    if not conversion_model_path.is_absolute():
        conversion_model_path = Path.cwd() / conversion_model_path

    return Settings(
        model_path=model_path.resolve(),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        conversion_model_path=conversion_model_path.resolve(),
    )


def configure_logging(log_level: str) -> None:
    level = getattr(logging, log_level, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logging.getLogger("app").setLevel(level)
