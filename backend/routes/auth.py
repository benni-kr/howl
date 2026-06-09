import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from schemas import LoginRequest

router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")
AUTH_SECRET = os.getenv("AUTH_SECRET", "howl2026")

def verify_token(token: str = Depends(oauth2_scheme)):
    if token != AUTH_SECRET:
        raise HTTPException(status_code=401, detail="Invalid token")
    return token

@router.post("/login")
def login(req: LoginRequest):
    if req.username == "admin" and req.password == AUTH_SECRET:
        return {"token": AUTH_SECRET}
    raise HTTPException(status_code=401, detail="Invalid credentials")
