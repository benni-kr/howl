import requests

payload = {
  "m": 2,
  "n": 2,
  "achieved_rank": 4,
  "solver_name": "test",
  "cut_sequence": [
    {"type": "cut", "vertices": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 0, "y": 1}, {"x": 1, "y": 1}]}
  ]
}

res = requests.post("http://127.0.0.1:8000/api/submit_solution", json=payload)
print(res.status_code)
print(res.text)
