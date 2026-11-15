from __future__ import annotations

import hmac
import os
import subprocess

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.ranker import Document, HashingRanker, RankingResult, create_ranker


class RankRequest(BaseModel):
    query: str = Field(min_length=1, max_length=5000)
    documents: list[Document] = Field(max_length=200)
    limit: int = Field(default=20, ge=1, le=100)


token = os.getenv("GPU_WORKER_TOKEN")
ranker: HashingRanker = create_ranker()
app = FastAPI(title="AegisPR GPU Worker", version="0.1.0", docs_url=None)


def authorize(authorization: str | None = Header(default=None)) -> None:
    if not token:
        return
    expected = f"Bearer {token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "accelerator": ranker.accelerator,
        "device": ranker.device,
        "workload": "hashed term-document cosine ranking",
    }


@app.get("/runtime", dependencies=[Depends(authorize)])
def runtime() -> dict[str, float | None]:
    metrics: dict[str, float | None] = {"gpu_percent": None, "vram_percent": None}
    if ranker.accelerator != "cuda":
        return metrics
    try:
        result = subprocess.run(
            ["nvidia-smi", "--id=0", "--query-gpu=utilization.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, check=True, timeout=1,
        )
        usage, used, total = (item.strip() for item in result.stdout.split(","))
        if usage.isdecimal() and 0 <= int(usage) <= 100:
            metrics["gpu_percent"] = float(usage)
        if used.isdecimal() and total.isdecimal() and 0 < int(total) and int(used) <= int(total):
            metrics["vram_percent"] = round(100 * int(used) / int(total), 1)
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return metrics


@app.post("/rank", response_model=RankingResult, dependencies=[Depends(authorize)])
def rank(payload: RankRequest) -> RankingResult:
    return ranker.rank(payload.query, payload.documents, payload.limit)
