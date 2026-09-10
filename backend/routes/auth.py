import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from schemas import LoginRequest

router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")
AUTH_SECRET = os.getenv("AUTH_SECRET", "howl2026")
GUEST_SECRET = os.getenv("GUEST_SECRET", "howl-guest")

def verify_token(token: str = Depends(oauth2_scheme)):
    if token not in (AUTH_SECRET, GUEST_SECRET):
        raise HTTPException(status_code=401, detail="Invalid token")
    return token

@router.post("/login")
def login(req: LoginRequest):
    if req.username == "admin" and req.password == AUTH_SECRET:
        return {"token": AUTH_SECRET}
    if req.username == "guest" and req.password == GUEST_SECRET:
        return {"token": GUEST_SECRET}
    # Also permit auto-login when secret token is provided directly as password
    if req.password == GUEST_SECRET:
        return {"token": GUEST_SECRET}
    if req.password == AUTH_SECRET and req.username in ("", "admin"):
        return {"token": AUTH_SECRET}
    raise HTTPException(status_code=401, detail="Invalid credentials")
