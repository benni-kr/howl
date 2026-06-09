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
            {"t": "c", "v": [[0,0]]},
            {"t": "v", "v": [[1,0]], "r": 0},
            {"t": "v", "v": [[0,1]], "r": 0},
            {"t": "v", "v": [[1,1]], "r": 0}
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
