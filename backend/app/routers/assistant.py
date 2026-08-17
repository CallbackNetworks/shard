import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AssistantConversation, AssistantMessage
from app.schemas import (
    AssistantConversationOut,
    AssistantConversationSummary,
    AssistantSendMessage,
)
from app.services.assistant_tools import TOOLS, dispatch_tool
from app.services.llm import get_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assistant", tags=["assistant"])

SYSTEM_PROMPT = """You are an AI assistant embedded in a personal task management platform.
You have access to tools to read and modify tasks, projects, and activity.
Be concise and helpful. When the user asks about tasks, use tools to get current data rather than making up information.
Respond in the same language the user uses."""


@router.get("/conversations", response_model=list[AssistantConversationSummary])
def list_conversations(
    q: str | None = None,
    db: Session = Depends(get_db),
):
    if q:
        # Search conversations by title or message content
        conv_ids_by_msg = (
            db.query(AssistantMessage.conversation_id).filter(AssistantMessage.content.ilike(f"%{q}%")).distinct().all()
        )
        conv_ids = [c[0] for c in conv_ids_by_msg]
        return (
            db.query(AssistantConversation)
            .filter((AssistantConversation.title.ilike(f"%{q}%")) | (AssistantConversation.id.in_(conv_ids)))
            .order_by(AssistantConversation.updated_at.desc())
            .limit(20)
            .all()
        )
    return db.query(AssistantConversation).order_by(AssistantConversation.updated_at.desc()).limit(20).all()


@router.post("/conversations", response_model=AssistantConversationOut, status_code=status.HTTP_201_CREATED)
def create_conversation(db: Session = Depends(get_db)):
    conv = AssistantConversation()
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


@router.get("/conversations/{conv_id}", response_model=AssistantConversationOut)
def get_conversation(conv_id: str, db: Session = Depends(get_db)):
    conv = db.query(AssistantConversation).filter(AssistantConversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.delete("/conversations/{conv_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conv_id: str, db: Session = Depends(get_db)):
    conv = db.query(AssistantConversation).filter(AssistantConversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(conv)
    db.commit()


@router.post("/conversations/{conv_id}/messages")
async def send_message(conv_id: str, body: AssistantSendMessage, db: Session = Depends(get_db)):
    conv = db.query(AssistantConversation).filter(AssistantConversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Save user message
    user_msg = AssistantMessage(conversation_id=conv_id, role="user", content=body.content)
    db.add(user_msg)

    # Auto-title from first user message
    if conv.title == "New conversation":
        conv.title = body.content[:60] + ("…" if len(body.content) > 60 else "")

    db.commit()

    # Build message history for LLM
    history = (
        db.query(AssistantMessage)
        .filter(AssistantMessage.conversation_id == conv_id)
        .order_by(AssistantMessage.created_at)
        .all()
    )

    messages = [{"role": m.role if m.role != "tool" else "user", "content": m.content} for m in history]

    provider = get_provider()

    async def event_stream():
        assistant_text = []
        tool_calls_made = []

        try:
            async for event in provider.chat(messages, TOOLS, SYSTEM_PROMPT):
                if event["type"] == "error":
                    # A provider-level failure is not a turn in the conversation:
                    # it is forwarded to the client and never written to history
                    # (ADR-0089).
                    yield f"data: {json.dumps({'type': 'error', 'message': event['message']})}\n\n"
                elif event["type"] == "text":
                    assistant_text.append(event["text"])
                    yield f"data: {json.dumps({'type': 'text', 'text': event['text']})}\n\n"
                elif event["type"] == "tool_call":
                    tool_name = event["name"]
                    tool_input = event["input"]
                    tool_id = event.get("id", "")

                    yield f"data: {json.dumps({'type': 'tool_start', 'name': tool_name, 'input': tool_input})}\n\n"

                    result = await dispatch_tool(tool_name, tool_input, db)
                    tool_calls_made.append({"name": tool_name, "id": tool_id, "result": result})

                    yield f"data: {json.dumps({'type': 'tool_result', 'name': tool_name, 'result': result[:500]})}\n\n"

                elif event["type"] == "done":
                    # Save assistant message
                    if assistant_text:
                        msg = AssistantMessage(
                            conversation_id=conv_id,
                            role="assistant",
                            content="".join(assistant_text),
                            tool_calls=tool_calls_made if tool_calls_made else None,
                        )
                        db.add(msg)
                        db.commit()

                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return

        except Exception as exc:
            logger.error("Assistant streaming error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
