from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal,get_db
from app.boilerplate import create_boilerplate_zip, generate_boilerplate
from app.models.boards import Board
from app.models.board_members import BoardMember
from app.realtime import manager
from app.schemas.boards import BoardCreate, BoardMemberAdd, BoardRead, BoardUpdate, BoilerplateCreate, BoilerplateRead
from app.core.dependencies import get_current_user, get_current_user_ws

router = APIRouter(tags=["boards"])


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

    return board


@router.get("/boards", response_model=list[BoardRead])
async def list_boards(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> list[Board]:
    result = await db.execute(
        select(Board).join(BoardMember).where(BoardMember.user_id == user.id)
    )
    return result.scalars().all()


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
    return board


@router.patch("/boards/{board_id}", response_model=BoardRead)
async def update_board(board_id: UUID, payload: BoardUpdate, db: AsyncSession = Depends(get_db),user=Depends(get_current_user)) -> Board:
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    board_member = await db.scalar(select(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user.id))
    if not board_member:
        raise HTTPException(status_code=403, detail="Access denied")
    if payload.name is not None:
        board.name = payload.name
    if payload.document is not None:
        board.document = payload.document
    await db.commit()
    await db.refresh(board)
    # Clear live state when saved to DB
    await manager.clear_live_document(board_id)
    return board


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
) -> dict:
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return generate_boilerplate(board.name, payload.document or board.document)


@router.post("/boards/{board_id}/boilerplate/download")
async def download_boilerplate(
    board_id: UUID,
    payload: BoilerplateCreate,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    project_name, archive = create_boilerplate_zip(board.name, payload.document or board.document)
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
    if board_member.role not in {"owner", "editor"}:
        await websocket.close(code=1008)
        return

    # ------------------------------------------------
    # Authorization successful
    # ------------------------------------------------
    await manager.connect(
        board_id,
        websocket,
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

        # ------------------------------------------------
        # Tell existing users somebody joined
        # ------------------------------------------------
        await manager.broadcast(
            board_id,
            {
                "type": "presence",
                "event": "joined",
            },
            sender=websocket,
        )

        # ------------------------------------------------
        # Handle messages
        # ------------------------------------------------
        while True:

            message = await websocket.receive_json()

            event_type = message.get("type")

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

        manager.disconnect(
            board_id,
            websocket,
        )

        await manager.broadcast(
            board_id,
            {
                "type": "presence",
                "event": "left",
            },
        )
