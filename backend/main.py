"""FastAPI backend bridge for the HOWL grid-ranking game."""

import logging
import traceback

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from database import Base, engine
from routes import auth, game, leaderboard, issues

logger = logging.getLogger("howl.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    Base.metadata.create_all(bind=engine)
    yield
    # Shutdown

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb_str = traceback.format_exc()
    logger.error(f"Exception on {request.url}:\n{tb_str}")
    
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}", "traceback": tb_str},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        },
    )

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(game.router, prefix="/api", tags=["game"])
app.include_router(leaderboard.router, prefix="/api/leaderboard", tags=["leaderboard"])
app.include_router(issues.router, prefix="/api/issues", tags=["issues"])
