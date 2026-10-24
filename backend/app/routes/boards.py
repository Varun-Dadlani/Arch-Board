from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal,get_db
from app.boilerplate import create_boilerplate_zip, generate_boilerplate
from app.models.boards import Board
from app.models.board_members import BoardMember
from app.models.chat_messages import ChatMessage
from app.models.users import User
from app.realtime import manager
from app.schemas.boards import (
    BoardCreate,
    BoardMemberAdd,
    BoardMemberRead,
    BoardMemberRoleUpdate,
    BoardRead,
    BoardUpdate,
    ChatMessageCreate,
    ChatMessageRead,
    BoilerplateCreate,
    BoilerplateRead,
)
from app.core.dependencies import get_current_user, get_current_user_ws

router = APIRouter(tags=["boards"])
CHAT_HISTORY_LIMIT = 100


def board_read(board: Board, member_role: str) -> BoardRead:
    return BoardRead.model_validate(board).model_copy(update={"member_role": member_role})


@router.post("/boards", response_model=BoardRead, status_code=201)
async def create_board(
    payload: BoardCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> Board:

    board = Board(
        name=payload.name,
        document=payload.document,
        owner_id=user.id,
    )

    db.add(board)

    # Generate board.id before creating BoardMember
    await db.flush()

    board_member = BoardMember(
        board_id=board.id,
        user_id=user.id,
        role="owner",
    )

    db.add(board_member)

    await db.commit()
    await db.refresh(board)

    return board_read(board, "owner")


@router.get("/boards", response_model=list[BoardRead])
async def list_boards(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> list[BoardRead]:
    result = await db.execute(
        select(Board, BoardMember.role)
        .join(BoardMember)
        .where(BoardMember.user_id == user.id)
    )
    return [board_read(board, role) for board, role in result.all()]


@router.get("/boards/{board_id}", response_model=BoardRead)
async def get_board(board_id: UUID, db: AsyncSession = Depends(get_db),user=Depends(get_current_user)) -> Board:
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    board = await db.get(Board, board_id)
    board_member = await db.scalar(select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id))
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if not board_member:
        raise HTTPException(status_code=403, detail="Access denied")
    return board_read(board, board_member.role)


@router.patch("/boards/{board_id}", response_model=BoardRead)
async def update_board(board_id: UUID, payload: BoardUpdate, db: AsyncSession = Depends(get_db),user=Depends(get_current_user)) -> Board:
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    board_member = await db.scalar(select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id))
    if not board_member or board_member.role not in {"owner", "editor"}:
        raise HTTPException(status_code=403, detail="Access denied")
    if payload.name is not None:
        board.name = payload.name
    if payload.document is not None:
        board.document = payload.document
    await db.commit()
    await db.refresh(board)
    # Clear live state when saved to DB
    await manager.clear_live_document(board_id)
    return board_read(board, board_member.role)


@router.delete("/boards/{board_id}", status_code=204)
async def delete_board(board_id: UUID, db: AsyncSession = Depends(get_db),user=Depends(get_current_user)) -> None:
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    board = await db.get(Board, board_id)
    board_member = await db.scalar(select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id))
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if not board_member or board_member.role != "owner":
        raise HTTPException(status_code=403, detail="Access denied")
    await db.delete(board)
    await db.commit()
    # Clear live state when board is deleted
    await manager.clear_live_document(board_id)


@router.post("/boards/{board_id}/boilerplate", response_model=BoilerplateRead)
async def create_boilerplate(
    board_id: UUID,
    payload: BoilerplateCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> dict:
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    board_member = await db.scalar(
        select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id)
    )
    if not board_member or board_member.role not in {"owner", "editor"}:
        raise HTTPException(status_code=403, detail="Access denied")
    return generate_boilerplate(payload.name or board.name, payload.document or board.document)


@router.post("/boards/{board_id}/boilerplate/download")
async def download_boilerplate(
    board_id: UUID,
    payload: BoilerplateCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> StreamingResponse:
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    board_member = await db.scalar(
        select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id)
    )
    if not board_member:
        raise HTTPException(status_code=403, detail="Access denied")
    is_viewer = board_member.role == "viewer"
    document = board.document if is_viewer else payload.document or board.document
    project_name = board.name if is_viewer else payload.name or board.name
    project_name, archive = create_boilerplate_zip(project_name, document)
    return StreamingResponse(
        archive,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{project_name}-boilerplate.zip"'},
    )

@router.post("/boards/{board_id}/members", status_code=201)
async def add_board_member(
    board_id: UUID,
    payload: BoardMemberAdd,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user)
) -> None:
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    
    # Check if the current user is the owner of the board
    board_member = await db.scalar(select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id))
    if not board_member or board_member.role != "owner":
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Check if the user to be added is already a member
    existing_member = await db.scalar(select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == payload.user_id))
    if existing_member:
        raise HTTPException(status_code=400, detail="User is already a member of the board")
    
    new_member = BoardMember(board_id=board_id, user_id=payload.user_id, role=payload.role)
    db.add(new_member)
    await db.commit()
    await manager.broadcast(board_id, {"type": "members:changed"})
    await manager.publish(board_id, {"type": "members:changed"})


@router.get("/boards/{board_id}/members", response_model=list[BoardMemberRead])
async def list_board_members(
    board_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> list[BoardMemberRead]:
    current_member = await db.scalar(
        select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id)
    )
    if not current_member:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(BoardMember.user_id, User.username, BoardMember.role)
        .join(User, User.id == BoardMember.user_id)
        .where(BoardMember.board_id == board_id)
        .order_by(User.username)
    )
    active_user_ids = {active_user["user_id"] for active_user in manager.active_users(board_id)}
    return [
        BoardMemberRead(
            user_id=member_user_id,
            username=username,
            role=role,
            is_active=str(member_user_id) in active_user_ids,
        )
        for member_user_id, username, role in result.all()
    ]


@router.patch("/boards/{board_id}/members/{member_user_id}", status_code=204)
async def update_board_member_role(
    board_id: UUID,
    member_user_id: UUID,
    payload: BoardMemberRoleUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> None:
    current_member = await db.scalar(
        select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id)
    )
    if not current_member or current_member.role != "owner":
        raise HTTPException(status_code=403, detail="Only the board owner can change member roles")

    target_member = await db.scalar(
        select(BoardMember).where(
            BoardMember.board_id == board_id,
            BoardMember.user_id == member_user_id,
        )
    )
    if not target_member:
        raise HTTPException(status_code=404, detail="Board member not found")
    if target_member.role == "owner":
        raise HTTPException(status_code=400, detail="The board owner's role cannot be changed")

    target_member.role = payload.role
    await db.commit()
    await manager.broadcast(
        board_id,
        {"type": "member:role_changed", "user_id": str(member_user_id)},
    )
    await manager.broadcast(board_id, {"type": "members:changed"})
    await manager.publish(
        board_id,
        {"type": "member:role_changed", "user_id": str(member_user_id)},
    )
    await manager.publish(board_id, {"type": "members:changed"})


@router.get("/boards/{board_id}/chat", response_model=list[ChatMessageRead])
async def list_board_chat(
    board_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> list[ChatMessageRead]:
    board_member = await db.scalar(
        select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id)
    )
    if not board_member:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(ChatMessage.id, ChatMessage.user_id, User.username, ChatMessage.content, ChatMessage.created_at)
        .join(User, User.id == ChatMessage.user_id)
        .where(ChatMessage.board_id == board_id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(CHAT_HISTORY_LIMIT)
    )
    messages = [
        ChatMessageRead(
            id=message_id,
            user_id=user_id,
            username=username,
            content=content,
            created_at=created_at,
        )
        for message_id, user_id, username, content, created_at in result.all()
    ]
    return list(reversed(messages))


@router.post("/boards/{board_id}/chat", response_model=ChatMessageRead, status_code=201)
async def create_board_chat_message(
    board_id: UUID,
    payload: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> ChatMessageRead:
    board_member = await db.scalar(
        select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id)
    )
    if not board_member:
        raise HTTPException(status_code=403, detail="Access denied")

    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Message cannot be empty")

    chat_message = ChatMessage(board_id=board_id, user_id=user.id, content=content)
    db.add(chat_message)
    await db.commit()
    await db.refresh(chat_message)

    message = ChatMessageRead(
        id=chat_message.id,
        user_id=user.id,
        username=user.username,
        content=chat_message.content,
        created_at=chat_message.created_at,
    )
    event = {"type": "chat:message", "message": message.model_dump(mode="json")}
    await manager.broadcast(board_id, event)
    await manager.publish(board_id, event)
    return message


@router.delete("/boards/{board_id}/members/{member_user_id}", status_code=204)
async def remove_board_member(
    board_id: UUID,
    member_user_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> None:
    current_member = await db.scalar(
        select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id)
    )
    if not current_member or current_member.role != "owner":
        raise HTTPException(status_code=403, detail="Only the board owner can remove members")

    target_member = await db.scalar(
        select(BoardMember).where(
            BoardMember.board_id == board_id,
            BoardMember.user_id == member_user_id,
        )
    )
    if not target_member:
        raise HTTPException(status_code=404, detail="Board member not found")
    if target_member.role == "owner":
        raise HTTPException(status_code=400, detail="The board owner cannot be removed")

    await db.delete(target_member)
    await db.commit()

    await manager.revoke_user(board_id, str(member_user_id))
    await manager.broadcast(
        board_id,
        {"type": "presence", "event": "left", "user_id": str(member_user_id)},
    )
    await manager.broadcast(board_id, {"type": "members:changed"})
    await manager.publish(
        board_id,
        {"type": "member:removed", "user_id": str(member_user_id)},
    )




@router.websocket("/ws/boards/{board_id}")
async def board_socket(
    websocket: WebSocket,
    board_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:

    # ------------------------------------------------
    # Authenticate user
    # ------------------------------------------------
    user = await get_current_user_ws(
        websocket,
        db,
    )

    if user is None:
        await websocket.close(code=1008)
        return

    # ------------------------------------------------
    # Check board exists
    # ------------------------------------------------
    board = await db.get(Board, board_id)

    if board is None:
        await websocket.close(code=1008)
        return

    # ------------------------------------------------
    # Check board membership
    # ------------------------------------------------
    board_member = await db.scalar(
        select(BoardMember).where(
            BoardMember.board_id == board_id,
            BoardMember.user_id == user.id,
        )
    )

    if board_member is None:
        await websocket.close(code=1008)
        return

    # ------------------------------------------------
    # Only owner/editor can use the board
    # ------------------------------------------------
    if board_member.role not in {"owner", "editor", "viewer"}:
        await websocket.close(code=1008)
        return

    # ------------------------------------------------
    # Authorization successful
    # ------------------------------------------------
    active_users, is_new_presence = await manager.connect(
        board_id,
        websocket,
        user.id,
        user.username,
    )

    try:
        # ------------------------------------------------
        # Get current LIVE document from Redis
        # ------------------------------------------------
        live_document = await manager.get_live_document(
            board_id
        )

        # ------------------------------------------------
        # If Redis has no live state,
        # initialize from PostgreSQL
        # ------------------------------------------------
        if live_document is None:

            live_document = board.document or {}

            await manager.update_live_document(
                board_id,
                live_document,
            )

        # ------------------------------------------------
        # Send current live document
        # ------------------------------------------------
        await websocket.send_json({
            "type": "document:load",
            "document": live_document,
        })

        await websocket.send_json({
            "type": "presence:snapshot",
            "users": active_users,
        })

        # ------------------------------------------------
        # Tell existing users somebody joined
        # ------------------------------------------------
        if is_new_presence:
            presence_message = {
                "type": "presence",
                "event": "joined",
                "user_id": str(user.id),
                "username": user.username,
            }
            await manager.broadcast(board_id, presence_message, sender=websocket)
            await manager.publish(board_id, presence_message)

        # ------------------------------------------------
        # Handle messages
        # ------------------------------------------------
        while True:

            message = await websocket.receive_json()

            event_type = message.get("type")

            if board_member.role == "viewer":
                await websocket.send_json({
                    "type": "error",
                    "message": "Viewers cannot send board events",
                })
                continue

            if event_type not in {
                "document:update",
                "cursor:move",
                "selection:change",
            }:
                await websocket.send_json({
                    "type": "error",
                    "message": "Unsupported event",
                })
                continue

            # ------------------------------------------------
            # Document update
            # Both owner and editor can edit
            # ------------------------------------------------
            if event_type == "document:update":

                document = message.get("document")

                if document is not None:

                    await manager.update_live_document(
                        board_id,
                        document,
                    )

            # ------------------------------------------------
            # Broadcast locally
            # ------------------------------------------------
            await manager.broadcast(
                board_id,
                message,
                sender=websocket,
            )

            # ------------------------------------------------
            # Publish to other FastAPI instances
            # ------------------------------------------------
            await manager.publish(
                board_id,
                message,
            )

    except WebSocketDisconnect:

        user_left = manager.disconnect(
            board_id,
            websocket,
        )

        if user_left:
            presence_message = {
                "type": "presence",
                "event": "left",
                **user_left,
            }
            await manager.broadcast(board_id, presence_message)
            await manager.publish(board_id, presence_message)
