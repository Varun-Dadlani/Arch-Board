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
        self.connection_users: dict[UUID, dict[WebSocket, dict[str, str]]] = defaultdict(dict)

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
        user_id: UUID,
        username: str,
    ) -> tuple[list[dict[str, str]], bool]:
        await websocket.accept()

        was_empty = not self.rooms[board_id]
        was_user_online = any(
            connection_user["user_id"] == str(user_id)
            for connection_user in self.connection_users[board_id].values()
        )

        self.rooms[board_id].add(websocket)
        self.connection_users[board_id][websocket] = {
            "user_id": str(user_id),
            "username": username,
        }

        if was_empty:
            self.subscriber_tasks[board_id] = asyncio.create_task(
                self.subscribe_to_board(board_id)
            )

        return self.active_users(board_id), not was_user_online

    def active_users(self, board_id: UUID) -> list[dict[str, str]]:
        users: dict[str, dict[str, str]] = {}
        for connection_user in self.connection_users.get(board_id, {}).values():
            users[connection_user["user_id"]] = connection_user
        return list(users.values())

    def disconnect(
        self,
        board_id: UUID,
        websocket: WebSocket,
    ) -> dict[str, str] | None:
        connection_user = self.connection_users.get(board_id, {}).pop(websocket, None)
        self.rooms[board_id].discard(websocket)
        user_left = connection_user and not any(
            active_user["user_id"] == connection_user["user_id"]
            for active_user in self.connection_users.get(board_id, {}).values()
        )

        if not self.rooms[board_id]:
            self.rooms.pop(board_id, None)
            self.connection_users.pop(board_id, None)

            task = self.subscriber_tasks.pop(board_id, None)

            if task:
                if task is not asyncio.current_task():
                    task.cancel()

        return connection_user if user_left else None

    async def revoke_user(self, board_id: UUID, user_id: str) -> dict[str, str] | None:
        connections = [
            websocket
            for websocket, connection_user in self.connection_users.get(board_id, {}).items()
            if connection_user["user_id"] == user_id
        ]
        user_left = None

        for websocket in connections:
            try:
                await websocket.close(code=1008, reason="Board access was removed")
            except Exception:
                pass
            user_left = self.disconnect(board_id, websocket) or user_left

        return user_left

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

                if message.get("type") == "member:removed":
                    removed_user = await self.revoke_user(board_id, message["user_id"])
                    await self.broadcast(
                        board_id,
                        {
                            "type": "presence",
                            "event": "left",
                            "user_id": message["user_id"],
                            "username": removed_user["username"] if removed_user else "",
                        },
                    )
                    await self.broadcast(board_id, {"type": "members:changed"})
                    if not self.rooms.get(board_id):
                        return
                    continue

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