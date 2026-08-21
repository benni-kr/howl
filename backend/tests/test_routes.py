import os

def test_login_success(client):
    auth_secret = os.getenv("AUTH_SECRET", "howl2026")
    response = client.post("/api/auth/login", json={"username": "admin", "password": auth_secret})
    assert response.status_code == 200
    assert response.json() == {"token": auth_secret}

def test_login_failure(client):
    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrongpassword"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"



def test_leaderboard_empty(client):
    auth_secret = os.getenv("AUTH_SECRET", "howl2026")
    response = client.get("/api/leaderboard", headers={"Authorization": f"Bearer {auth_secret}"})
    assert response.status_code == 200
    assert response.json() == []

def test_submit_solution_success(client):
    auth_secret = os.getenv("AUTH_SECRET", "howl2026")
    response = client.post("/api/submit_solution", json={
        "m": 2,
        "n": 2,
        "achieved_rank": 3,
        "solver_name": "TestUser",
        "cut_sequence": [
            {"t": "c", "v": [[0,0], [1,1]]}
        ]
    }, headers={"Authorization": f"Bearer {auth_secret}"})
    assert response.status_code == 200
    data = response.json()
    assert data["updated"] is True
    assert data["solution"]["solver_name"] == "TestUser"
    assert data["solution"]["rank"] == 3

    # Check leaderboard
    lb_response = client.get("/api/leaderboard", headers={"Authorization": f"Bearer {auth_secret}"})
    lb_data = lb_response.json()
    assert len(lb_data) == 1
    assert lb_data[0]["solver_name"] == "TestUser"

def test_submit_solution_mismatch(client):
    auth_secret = os.getenv("AUTH_SECRET", "howl2026")
    # Submitting a true rank 3 solution but claiming rank 1
    response = client.post("/api/submit_solution", json={
        "m": 2,
        "n": 2,
        "achieved_rank": 1,
        "solver_name": "Cheater",
        "cut_sequence": [
            {"t": "c", "v": [[0,0], [1,1]]}
        ]
    }, headers={"Authorization": f"Bearer {auth_secret}"})
    assert response.status_code == 400
    assert "Rank mismatch" in response.json()["detail"]

def test_submit_solution_incomplete(client):
    auth_secret = os.getenv("AUTH_SECRET", "howl2026")
    # Submitting a 2x2 with no cuts at all -> mathematically incomplete (rank 999999)
    response = client.post("/api/submit_solution", json={
        "m": 2,
        "n": 2,
        "achieved_rank": 4,
        "solver_name": "IncompleteUser",
        "cut_sequence": []
    }, headers={"Authorization": f"Bearer {auth_secret}"})
    assert response.status_code == 400
    assert "Incomplete sequence" in response.json()["detail"]


def test_submit_solution_reserved_alias(client):
    auth_secret = os.getenv("AUTH_SECRET", "howl2026")
    blocked_names = ["alphawolf", "alphawolf2", "AlphaWolf_Bot", "my_alphawolf", "computer", "Computer", "GOD", "god"]
    for name in blocked_names:
        response = client.post("/api/submit_solution", json={
            "m": 2,
            "n": 2,
            "achieved_rank": 3,
            "solver_name": name,
            "cut_sequence": [{"t": "c", "v": [[0,0], [1,1]]}]
        }, headers={"Authorization": f"Bearer {auth_secret}"})
        assert response.status_code == 403, f"Expected 403 for reserved name '{name}', got {response.status_code}"
        assert response.json()["detail"] == "Reserved system alias"


def test_matrix_leaderboard_solver_type_filtering(client):
    auth_secret = os.getenv("AUTH_SECRET", "howl2026")
    # Submit a human solution for 2x2 (rank 3)
    res_human = client.post("/api/submit_solution", json={
        "m": 2,
        "n": 2,
        "achieved_rank": 3,
        "solver_name": "HumanHero",
        "cut_sequence": [{"t": "c", "v": [[0,0], [1,1]]}]
    }, headers={"Authorization": f"Bearer {auth_secret}"})
    assert res_human.status_code == 200

    # Test solver_type=all
    res_all = client.get("/api/leaderboard/matrix?solver_type=all", headers={"Authorization": f"Bearer {auth_secret}"})
    assert res_all.status_code == 200
    all_data = res_all.json()
    assert len(all_data) >= 1
    cell = next(c for c in all_data if c["m"] == 2 and c["n"] == 2)
    assert cell["solver_name"] == "HumanHero"
    assert cell["is_ai"] is False

    # Test solver_type=humans
    res_humans = client.get("/api/leaderboard/matrix?solver_type=humans", headers={"Authorization": f"Bearer {auth_secret}"})
    assert res_humans.status_code == 200
    humans_data = res_humans.json()
    cell_h = next(c for c in humans_data if c["m"] == 2 and c["n"] == 2)
    assert cell_h["solver_name"] == "HumanHero"
    assert cell_h["is_ai"] is False

    # Test solver_type=ai (no AI submitted 2x2 yet, so should be empty for 2x2)
    res_ai = client.get("/api/leaderboard/matrix?solver_type=ai", headers={"Authorization": f"Bearer {auth_secret}"})
    assert res_ai.status_code == 200
    ai_data = res_ai.json()
    assert not any(c["m"] == 2 and c["n"] == 2 for c in ai_data)

