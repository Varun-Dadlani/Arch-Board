from collections import defaultdict
from typing import Any
from uuid import UUID

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.rooms: dict[UUID, set[WebSocket]] = defaultdict(set)
        self.live_documents: dict[UUID, dict[str, Any]] = {}

    async def connect(
        self,
        board_id: UUID,
        websocket: WebSocket,
    ) -> None:
        await websocket.accept()
        self.rooms[board_id].add(websocket)

    def disconnect(
        self,
        board_id: UUID,
        websocket: WebSocket,
    ) -> None:
        self.rooms[board_id].discard(websocket)

        if not self.rooms[board_id]:
            self.rooms.pop(board_id, None)

            # DON'T clear live_documents here.
            # Another user may still have unsaved changes,
            # and a user who reconnects must receive them.

    async def broadcast(
        self,
        board_id: UUID,
        message: dict[str, Any],
        sender: WebSocket | None = None,
    ) -> None:
        stale: list[WebSocket] = []

        for connection in self.rooms.get(board_id, set()):
            if connection is sender:
                continue

            try:
                await connection.send_json(message)
            except Exception:
                stale.append(connection)

        for connection in stale:
            self.disconnect(board_id, connection)

    def update_live_document(
        self,
        board_id: UUID,
        document: dict[str, Any],
    ) -> None:
        self.live_documents[board_id] = document

    def get_live_document(
        self,
        board_id: UUID,
    ) -> dict[str, Any] | None:
        return self.live_documents.get(board_id)

    def clear_live_document(
        self,
        board_id: UUID,
    ) -> None:
        self.live_documents.pop(board_id, None)


manager = ConnectionManager()