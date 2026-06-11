from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import case

from database import get_db
from models import Issue
from schemas import IssueCreate, IssueResponse, IssueUpdate

router = APIRouter()

@router.get("/", response_model=List[IssueResponse])
def get_issues(db: Session = Depends(get_db)):
    status_order = case(
        (Issue.status == 'open', 1),
        (Issue.status == 'in_progress', 2),
        (Issue.status == 'closed', 3),
        else_=4
    )
    return db.query(Issue).order_by(status_order, Issue.created_at.desc()).all()

@router.post("/", response_model=IssueResponse)
def create_issue(issue_in: IssueCreate, db: Session = Depends(get_db)):
    new_issue = Issue(
        type=issue_in.type,
        description=issue_in.description,
        influenced_runs=issue_in.influenced_runs,
        created_by=issue_in.created_by
    )
    db.add(new_issue)
    db.commit()
    db.refresh(new_issue)
    return new_issue

@router.patch("/{issue_id}", response_model=IssueResponse)
def update_issue(issue_id: int, issue_in: IssueUpdate, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    
    if issue_in.type is not None:
        issue.type = issue_in.type
    if issue_in.description is not None:
        issue.description = issue_in.description
    if issue_in.influenced_runs is not None:
        issue.influenced_runs = issue_in.influenced_runs
    if issue_in.status is not None:
        issue.status = issue_in.status
        
    issue.last_changed_by = issue_in.last_changed_by
    
    db.commit()
    db.refresh(issue)
    return issue

@router.delete("/{issue_id}", response_model=dict)
def delete_issue(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    
    db.delete(issue)
    db.commit()
    return {"detail": "Issue deleted successfully"}
