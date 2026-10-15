"""Schemas owned by this service."""

from app.schemas.message_requests import (
    MessageRequestCreate,
    MessageRequestPage,
    MessageRequestRead,
    PendingCount,
    SenderSummary,
)

__all__ = [
    "MessageRequestCreate",
    "MessageRequestPage",
    "MessageRequestRead",
    "PendingCount",
    "SenderSummary",
]
