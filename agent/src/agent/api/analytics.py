"""Quality Analytics & AI Insights API Endpoints."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agent.analyzer.ai_insights import default_ai_insights_engine
from agent.analyzer.fleet_analytics import default_fleet_aggregator
from agent.analyzer.quality_dimensions import default_quality_evaluator
from agent.api.runs import get_run_store

logger = logging.getLogger("agent.api.analytics")
router = APIRouter(prefix="/analytics", tags=["analytics"])


class AIQueryRequest(BaseModel):
    query: str = Field(..., description="Natural language prompt asking about fleet health or root causes")


@router.get("/overview")
async def get_analytics_overview(limit: int = 100) -> dict[str, Any]:
    """Returns aggregated fleet-level quality metrics, 8-dimension breakdown, and proactive AI insights."""
    store = get_run_store()
    bounded_runs = store.list_all(limit=max(1, min(limit, 500)))

    fleet_metrics = default_fleet_aggregator.aggregate_runs(bounded_runs)
    insights = default_ai_insights_engine.generate_fleet_insights(fleet_metrics, bounded_runs)

    return {
        "metrics": fleet_metrics.to_dict(),
        "insights": [i.to_dict() for i in insights],
        "total_analyzed_runs": len(bounded_runs),
    }


@router.get("/runs/{run_id}")
async def get_run_quality_analytics(run_id: str) -> dict[str, Any]:
    """Returns comprehensive quality report and per-path analysis for a specific job."""
    store = get_run_store()
    record = store.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")

    res = record.result or {}
    quality_report = res.get("quality_dimensions")

    if not quality_report:
        # Calculate dynamically if not previously cached
        journeys = res.get("journey_artifacts") or []
        report_obj = default_quality_evaluator.evaluate_run(
            run_record=record,
            journeys=journeys,
        )
        quality_report = report_obj.to_dict()

    return {
        "run_id": record.run_id,
        "branch": record.branch,
        "sha": record.sha,
        "scope": record.scope,
        "status": record.status,
        "quality_report": quality_report,
    }


@router.post("/query")
async def query_ai_analyst(payload: AIQueryRequest) -> dict[str, Any]:
    """Interactive natural language QA analyst query endpoint."""
    store = get_run_store()
    bounded_runs = store.list_all(limit=100)
    fleet_metrics = default_fleet_aggregator.aggregate_runs(bounded_runs)

    response = default_ai_insights_engine.answer_query(
        query=payload.query,
        fleet_metrics=fleet_metrics,
        recent_runs=bounded_runs,
    )
    return response
