from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal,get_db
from app.boilerplate import create_boilerplate_zip, generate_boilerplate
from app.models.boards import Board
from app.realtime import manager
from app.schemas.boards import BoardCreate, BoardRead, BoardUpdate, BoilerplateCreate, BoilerplateRead

router = APIRouter(tags=["boards"])


@router.post("/boards", response_model=BoardRead, status_code=201)
async def create_board(payload: BoardCreate, db: AsyncSession = Depends(get_db)) -> Board:
    board = Board(name=payload.name, document=payload.document)
    db.add(board)
    await db.commit()
    await db.refresh(board)
    return board


@router.get("/boards", response_model=list[BoardRead])
async def list_boards(db: AsyncSession = Depends(get_db)) -> list[Board]:
    result = await db.scalars(select(Board).order_by(Board.updated_at.desc()))
    return list(result)


@router.get("/boards/{board_id}", response_model=BoardRead)
async def get_board(board_id: UUID, db: AsyncSession = Depends(get_db)) -> Board:
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


@router.patch("/boards/{board_id}", response_model=BoardRead)
async def update_board(board_id: UUID, payload: BoardUpdate, db: AsyncSession = Depends(get_db)) -> Board:
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if payload.name is not None:
        board.name = payload.name
    if payload.document is not None:
        board.document = payload.document
    await db.commit()
    await db.refresh(board)
    # Clear live state when saved to DB
    manager.clear_live_document(board_id)
    return board


@router.delete("/boards/{board_id}", status_code=204)
async def delete_board(board_id: UUID, db: AsyncSession = Depends(get_db)) -> None:
    board = await db.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    await db.delete(board)
    await db.commit()
    # Clear live state when board is deleted
    manager.clear_live_document(board_id)


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


@router.websocket("/ws/boards/{board_id}")
async def board_socket(
    websocket: WebSocket,
    board_id: UUID,
) -> None:

    await manager.connect(board_id, websocket)

    try:
        # ------------------------------------------------
        # Get the current LIVE document.
        # ------------------------------------------------
        live_document = manager.get_live_document(board_id)

        # ------------------------------------------------
        # First user / server restart:
        # live state doesn't exist, so initialize it
        # from the database.
        # ------------------------------------------------
        if live_document is None:
            async with SessionLocal() as db:
                board = await db.get(Board, board_id)

                if not board:
                    await websocket.close(code=1008)
                    return

                live_document = board.document or {}

                manager.update_live_document(
                    board_id,
                    live_document,
                )

        # ------------------------------------------------
        # IMPORTANT:
        # Immediately send the current live document
        # to the user who just joined.
        # ------------------------------------------------
        await websocket.send_json({
            "type": "document:load",
            "document": live_document,
        })

        # Tell existing users that somebody joined.
        await manager.broadcast(
            board_id,
            {
                "type": "presence",
                "event": "joined",
            },
            sender=websocket,
        )

        # ------------------------------------------------
        # Handle live messages
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
            # Every document update becomes the latest
            # live state.
            # ------------------------------------------------
            if event_type == "document:update":
                document = message.get("document")

                if document is not None:
                    manager.update_live_document(
                        board_id,
                        document,
                    )

            # Broadcast to everyone except sender.
            await manager.broadcast(
                board_id,
                message,
                sender=websocket,
            )

    except WebSocketDisconnect:
        manager.disconnect(board_id, websocket)

        await manager.broadcast(
            board_id,
            {
                "type": "presence",
                "event": "left",
            },
        )
