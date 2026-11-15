"""Unit tests for Scenario Sandbox Simulator in HotelAI (P8)."""
from fastapi.testclient import TestClient

from app.academic_main import app
from app.services.scenario_simulator import ScenarioSandboxSimulator


def test_scenario_sandbox_simulator_all_presets():
    simulator = ScenarioSandboxSimulator()
    scenarios = simulator.list_scenarios()
    assert len(scenarios) == 4

    preset_ids = [s["id"] for s in scenarios]
    assert "storm_surge" in preset_ids
    assert "vip_clash" in preset_ids
    assert "price_war" in preset_ids
    assert "policy_negotiation" in preset_ids

    for sc_id in preset_ids:
        res = simulator.run_scenario(sc_id)
        assert res.scenario_id == sc_id
        assert len(res.timeline) >= 4
        assert res.scorecard.overall_score >= 90
        assert res.scorecard.zero_oversell_guarantee is True
        assert res.duration_ms >= 0


def test_api_sandbox_endpoints():
    client = TestClient(app)

    # Test list scenarios
    res_list = client.get("/api/v1/revenue/sandbox/scenarios")
    assert res_list.status_code == 200
    data = res_list.json()
    assert "scenarios" in data
    assert len(data["scenarios"]) == 4

    # Test run storm_surge
    res_run = client.post(
        "/api/v1/revenue/sandbox/run",
        json={"scenario_id": "storm_surge", "custom_params": {}},
    )
    assert res_run.status_code == 200
    run_data = res_run.json()
    assert run_data["scenario_id"] == "storm_surge"
    assert len(run_data["timeline"]) == 4
    assert run_data["scorecard"]["overall_score"] == 96
    assert run_data["scorecard"]["zero_oversell_guarantee"] is True

    # Test run vip_clash (Google OR-Tools solver execution)
    res_vip = client.post(
        "/api/v1/revenue/sandbox/run",
        json={"scenario_id": "vip_clash", "custom_params": {}},
    )
    assert res_vip.status_code == 200
    vip_data = res_vip.json()
    assert vip_data["scenario_id"] == "vip_clash"
    assert vip_data["scorecard"]["overall_score"] == 99
