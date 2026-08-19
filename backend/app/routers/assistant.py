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

# A tool call ends a provider's turn (finish_reason "tool_calls"/"tool_use") — the model
# never continues with text in that same response, for either protocol. The tool's result
# has to go back as a new turn before the model can say anything. This caps how many such
# round trips one message may cause, so a model stuck calling tools can't loop forever.
MAX_TOOL_ROUNDS = 8


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

    provider = get_provider(db)

    async def event_stream():
        assistant_text = []
        tool_calls_made = []
        input_tokens_total = None
        output_tokens_total = None
        round_messages = list(messages)

        try:
            for _round_num in range(MAX_TOOL_ROUNDS):
                round_had_tool_call = False

                async for event in provider.chat(round_messages, TOOLS, SYSTEM_PROMPT):
                    if event["type"] == "error":
                        # A provider-level failure is not a turn in the conversation:
                        # it is forwarded to the client and never written to history
                        # (ADR-0089).
                        yield f"data: {json.dumps({'type': 'error', 'message': event['message']})}\n\n"
                        return
                    elif event["type"] == "text":
                        assistant_text.append(event["text"])
                        yield f"data: {json.dumps({'type': 'text', 'text': event['text']})}\n\n"
                    elif event["type"] == "tool_call":
                        round_had_tool_call = True
                        tool_name = event["name"]
                        tool_input = event["input"]
                        tool_id = event.get("id", "")

                        yield f"data: {json.dumps({'type': 'tool_start', 'name': tool_name, 'input': tool_input})}\n\n"

                        result = await dispatch_tool(tool_name, tool_input, db)
                        tool_calls_made.append({"name": tool_name, "id": tool_id, "result": result})

                        yield f"data: {json.dumps({'type': 'tool_result', 'name': tool_name, 'result': result[:500]})}\n\n"

                        # Fed back as plain turns, not a native tool-result block: the
                        # provider abstraction only knows role/content (ADR-0096), and a
                        # reloaded conversation already flattens a stored "tool" role to
                        # "user" the same way (see `messages` above) — this keeps the one
                        # convention instead of teaching each provider a second shape.
                        round_messages.append({"role": "assistant", "content": f"[Calling tool {tool_name}]"})
                        round_messages.append({"role": "user", "content": f"[Result of {tool_name}]: {result}"})

                    elif event["type"] == "usage":
                        # Not forwarded over SSE — this is bookkeeping (ADR-0100), not a
                        # turn. Summed across rounds: each round is a separate completion.
                        input_tokens_total = (input_tokens_total or 0) + event["input_tokens"]
                        output_tokens_total = (output_tokens_total or 0) + event["output_tokens"]

                    elif event["type"] == "done":
                        break

                if not round_had_tool_call:
                    break
            else:
                # Hit MAX_TOOL_ROUNDS without a final text-only round — say so rather
                # than silently ending on whatever the last tool_result was.
                yield f"data: {json.dumps({'type': 'error', 'message': 'Stopped after too many tool calls in a row.'})}\n\n"

            if assistant_text:
                msg = AssistantMessage(
                    conversation_id=conv_id,
                    role="assistant",
                    content="".join(assistant_text),
                    tool_calls=tool_calls_made if tool_calls_made else None,
                    input_tokens=input_tokens_total,
                    output_tokens=output_tokens_total,
                )
                db.add(msg)
                db.commit()

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as exc:
            logger.error("Assistant streaming error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
