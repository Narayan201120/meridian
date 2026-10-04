from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.db.session import get_db_session
from app.models import Device
from app.schemas.notifications import DeviceCreate, DeviceRead, PushConfigRead
from app.services import notifications

router = APIRouter()


@router.get("/push/config", response_model=PushConfigRead, summary="Public VAPID key and whether push is configured")
async def push_config() -> PushConfigRead:
    """Lets the frontend hide the enable button when the server cannot send."""
    enabled = settings.web_push_enabled
    if not enabled:
        return PushConfigRead(enabled=False, public_key=None)
    # The stored value is a PEM; PushManager.subscribe needs the base64url
    # uncompressed point, so convert rather than handing the client a PEM.
    try:
        public_key = notifications.encode_vapid_public_key(settings.web_push_public_key_pem or "")
    except (ValueError, TypeError):
        return PushConfigRead(enabled=False, public_key=None)
    return PushConfigRead(enabled=True, public_key=public_key)


@router.get("/devices", response_model=list[DeviceRead], summary="List this user's push devices")
async def list_devices(
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[DeviceRead]:
    devices = await notifications.list_devices_for_user(session, user_id=current_user_id)
    return [
        DeviceRead(
            id=d.id,
            user_id=d.user_id,
            platform=d.platform.value if hasattr(d.platform, "value") else str(d.platform),
            device_name=d.device_name,
            has_push_token=bool(d.push_token),
            last_seen_at=d.last_seen_at,
            created_at=d.created_at,
            updated_at=d.updated_at,
        )
        for d in devices
    ]


@router.post(
    "/devices",
    response_model=DeviceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register or refresh a push device",
)
async def register_device(
    payload: DeviceCreate,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> DeviceRead:
    """Idempotent on the push endpoint: a browser re-subscribing updates one row."""
    device = await notifications.register_device(
        session,
        user_id=current_user_id,
        platform=payload.platform,
        push_endpoint=payload.push_subscription.endpoint,
        device_name=payload.device_name,
    )
    return DeviceRead(
        id=device.id,
        user_id=device.user_id,
        platform=device.platform.value if hasattr(device.platform, "value") else str(device.platform),
        device_name=device.device_name,
        has_push_token=bool(device.push_token),
        last_seen_at=device.last_seen_at,
        created_at=device.created_at,
        updated_at=device.updated_at,
    )


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Stop sending to a device")
async def delete_device(
    device_id: UUID,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> Response:
    device = await session.get(Device, device_id)
    if device is None or device.user_id != current_user_id:
        return Response(status_code=status.HTTP_404_NOT_FOUND)
    await session.delete(device)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
