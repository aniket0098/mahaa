"""Models owned by this service. Exactly one: ``message_requests``."""

from app.models.message_request import MessageRequest, MessageRequestStatus

__all__ = ["MessageRequest", "MessageRequestStatus"]
