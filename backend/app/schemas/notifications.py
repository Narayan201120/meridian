from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator
from typing import Literal


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1)
    auth: str = Field(min_length=1)


class PushSubscription(BaseModel):
    """A browser push subscription.

    endpoint is the URL the push service will POST to; it doubles as the device's
    natural key so re-subscribing updates one row instead of adding another.
    """

    endpoint: str = Field(min_length=1)
    keys: PushSubscriptionKeys

    @model_validator(mode="after")
    def _require_https_endpoint(self) -> "PushSubscription":
        if not self.endpoint.startswith("https://"):
            raise ValueError("push endpoint must be https")
        return self


class DeviceCreate(BaseModel):
    platform: Literal["ios", "android", "web"]
    device_name: str | None = None
    push_subscription: PushSubscription


class DeviceRead(BaseModel):
    id: UUID
    user_id: UUID
    platform: str
    device_name: str | None
    # Never echo the raw push endpoint back to the client; it identifies a
    # specific browser install and has no use outside this server.
    has_push_token: bool
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PushConfigRead(BaseModel):
    """What the frontend needs to subscribe: the server's public VAPID key."""

    enabled: bool
    public_key: str | None = None