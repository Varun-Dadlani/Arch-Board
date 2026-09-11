from collections import defaultdict
from typing import Any
from uuid import UUID, uuid4
import asyncio
import json

from fastapi import WebSocket
from app.core.redis_client import redis
from redis.asyncio import Redis
 
class ConnectionManager:
    def __init__(self, redis: Redis) -> None:
        self.rooms: dict[UUID, set[WebSocket]] = defaultdict(set)

        # Redis is now the shared live-document store
        self.redis = redis

        self.instance_id = str(uuid4())
        self.subscriber_tasks: dict[UUID, asyncio.Task] = {}

    # -------------------------
    # Redis live document helpers
    # -------------------------

    def live_document_key(self, board_id: UUID) -> str:
        return f"archboard:live:{board_id}"

    async def update_live_document(
        self,
        board_id: UUID,
        document: dict[str, Any],
    ) -> None:
        key = self.live_document_key(board_id)

        await self.redis.set(
            key,
            json.dumps(document),
            ex=3600,  # Expire after 1 hour of inactivity
        )

    async def get_live_document(
        self,
        board_id: UUID,
    ) -> dict[str, Any] | None:
        key = self.live_document_key(board_id)

        data = await self.redis.get(key)

        if data is None:
            return None

        return json.loads(data)

    async def clear_live_document(
        self,
        board_id: UUID,
    ) -> None:
        key = self.live_document_key(board_id)

        await self.redis.delete(key)

    # -------------------------
    # WebSocket connections
    # -------------------------

    async def connect(
        self,
        board_id: UUID,
        websocket: WebSocket,
    ) -> None:
        await websocket.accept()

        was_empty = not self.rooms[board_id]

        self.rooms[board_id].add(websocket)

        if was_empty:
            self.subscriber_tasks[board_id] = asyncio.create_task(
                self.subscribe_to_board(board_id)
            )

    def disconnect(
        self,
        board_id: UUID,
        websocket: WebSocket,
    ) -> None:
        self.rooms[board_id].discard(websocket)

        if not self.rooms[board_id]:
            self.rooms.pop(board_id, None)

            task = self.subscriber_tasks.pop(board_id, None)

            if task:
                task.cancel()

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

    # -------------------------
    # Redis Pub/Sub
    # -------------------------

    async def publish(
        self,
        board_id: UUID,
        message: dict[str, Any],
    ) -> None:
        channel = f"archboard:board:{board_id}"

        payload = {
            "instance_id": self.instance_id,
            "message": message,
        }

        await self.redis.publish(
            channel,
            json.dumps(payload),
        )

    async def subscribe_to_board(
        self,
        board_id: UUID,
    ) -> None:
        channel = f"archboard:board:{board_id}"

        pubsub = self.redis.pubsub()

        await pubsub.subscribe(channel)

        print(f"Subscribed to Redis channel: {channel}")

        try:
            async for item in pubsub.listen():

                if item["type"] != "message":
                    continue

                payload = json.loads(item["data"])

                # Ignore messages published by this same
                # FastAPI instance because local broadcast
                # already handled them.
                if payload["instance_id"] == self.instance_id:
                    continue

                message = payload["message"]

                await self.broadcast(
                    board_id,
                    message,
                )

        except asyncio.CancelledError:

            print(f"Stopped Redis subscription: {channel}")

        finally:

            await pubsub.unsubscribe(channel)
            await pubsub.close()

manager=ConnectionManager(redis)