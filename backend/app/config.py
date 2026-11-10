from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "AegisPR"
    app_env: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    allowed_origins: str = "http://localhost:3000"
    github_token: str | None = Field(default=None, repr=False)
    api_access_token: str | None = Field(default=None, repr=False, min_length=16)
    nebius_api_key: str | None = Field(default=None, repr=False)
    nebius_base_url: str = "https://api.tokenfactory.nebius.com/v1/"
    nebius_model: str = "nvidia/Nemotron-3_5-Lightning"
    intent_review_models: str = ""
    inference_budget_usd: str = "20"
    inference_run_budget_usd: str = "0.25"
    inference_max_calls_per_run: int = Field(default=5, ge=1, le=10)
    gpu_worker_url: str | None = None
    gpu_worker_token: str | None = Field(default=None, repr=False)
    enable_sandbox: bool = False
    sandbox_timeout_seconds: int = 300
    sandbox_memory: str = "2g"
    sandbox_cpus: float = 2.0
    max_changed_files: int = 100
    max_diff_characters: int = 120_000
    workspace_root: Path = Path("/tmp/aegispr-runs")
    data_path: Path = Path("data/aegispr.sqlite3")
    v2_only: bool = False
    v2_signing_key_path: Path = Path("data/v2-signing-key.pem")
    v2_budget_usd: str = "1"
    v2_run_budget_usd: str = "0.03"
    v2_max_calls: int = Field(default=3, ge=1, le=5)
    v2_enable_models: bool = False
    v2_daily_reviews: int = Field(default=100, ge=1, le=1000)
    v2_allowed_repositories: str = "Hari-Aditya-003/AegisPR-V2-Apart-Research"
    v2_worker_url: str | None = None
    v2_worker_token: str | None = Field(default=None, repr=False)
    v2_worker_public_key: str | None = None
    vultr_api_key: str | None = Field(default=None, repr=False)
    vultr_model: str = "mimo-v2.6-flash"
    github_webhook_secret: str | None = Field(default=None, repr=False)
    github_app_id: str | None = None
    github_app_private_key_path: Path | None = Field(default=None, repr=False)
    github_installation_ids: str = ""
    github_publish_enabled: bool = False

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

