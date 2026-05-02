import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.schemas import ApiKeyCreate, ApiKeyUpdate, ApiKeyOut, ApiKeyCreateOut

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


def _generate_key() -> str:
    return f"tdp_{secrets.token_hex(24)}"


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


@router.get("", response_model=list[ApiKeyOut])
def list_api_keys(db: Session = Depends(get_db)):
    keys = db.query(ApiKey).order_by(ApiKey.created_at.desc()).all()
    return [ApiKeyOut.from_model(k) for k in keys]


@router.post("", response_model=ApiKeyCreateOut, status_code=status.HTTP_201_CREATED)
def create_api_key(body: ApiKeyCreate, db: Session = Depends(get_db)):
    raw_key = _generate_key()
    api_key = ApiKey(
        name=body.name,
        key=None,
        key_hash=_hash_key(raw_key),
        key_last4=raw_key[-4:],
        project_id=body.project_id,
        scopes=body.scopes,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    out = ApiKeyOut.from_model(api_key)
    return ApiKeyCreateOut(**out.model_dump(), key=raw_key)


@router.patch("/{key_id}", response_model=ApiKeyOut)
def update_api_key(key_id: str, body: ApiKeyUpdate, db: Session = Depends(get_db)):
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(api_key, field, value)
    db.commit()
    db.refresh(api_key)
    return ApiKeyOut.from_model(api_key)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_api_key(key_id: str, db: Session = Depends(get_db)):
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    db.delete(api_key)
    db.commit()
