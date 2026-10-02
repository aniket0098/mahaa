"""Realtime transport: the WebSocket hub, its event envelope, and cross-instance
fan-out.

This phase ships the foundation only — connection lifecycle, heartbeat, and the
ability to route an event to a connected user. Nothing here publishes business
events yet; the messaging, notification, post and call phases own that.
"""
