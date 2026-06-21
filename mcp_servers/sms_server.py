"""
sms_server.py

MCP server exposing SMS and call log tools backed by Google Drive.
The Android bridge syncs SMS data to Drive; this server lets the AI
assistant read (and eventually send) messages through that same data.

Tools:
  - list_sms_threads  — list conversation summaries (unread filter)
  - read_sms          — read messages in a thread (marks as read)
  - send_sms          — queue an outgoing message via Drive
  - reply_sms         — reply to a thread (resolves thread_id -> phone)
  - mark_sms_read     — mark a thread as read
  - list_calls        — list call log entries
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Add odysseus-server dirs to path so we can import drive_client + sms_tools
_ODYSSEUS_SERVER = Path(__file__).resolve().parent.parent / "data" / "odysseus-server"
sys.path.insert(0, str(_ODYSSEUS_SERVER / "integrations"))
sys.path.insert(0, str(_ODYSSEUS_SERVER / "tools"))

server = Server("sms")

# Late-initialized (set during first tool call)
_drive_client = None
_sms_tools = None
_initialized = False

_CREDENTIALS_PATH = _ODYSSEUS_SERVER / "credentials" / "drive_token.json"


def _text_result(text: str) -> list[TextContent]:
    return [TextContent(type="text", text=text)]


def _ensure_init():
    """Lazy-init DriveClient + SmsTools on first use."""
    global _drive_client, _sms_tools, _initialized
    if _initialized:
        return
    _initialized = True

    if not _CREDENTIALS_PATH.exists():
        return

    try:
        from drive_client import DriveClient
        from sms_tools import SmsTools

        _drive_client = DriveClient.from_credentials_file(str(_CREDENTIALS_PATH))
        _sms_tools = SmsTools(_drive_client)
    except Exception as e:
        import logging
        logging.getLogger(__name__).error("SMS server init failed: %s", e)


# -- Tool definitions -------------------------------------------------

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="list_sms_threads",
            description=(
                "List SMS conversation threads from the user's Android phone. "
                "Returns thread summaries with contact name, phone number, "
                "last message preview, unread count, and message count."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "unread_only": {
                        "type": "boolean",
                        "description": "If true, only return threads with unread messages.",
                        "default": False,
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of threads to return.",
                        "default": 20,
                    },
                },
            },
        ),
        Tool(
            name="read_sms",
            description=(
                "Read all messages in an SMS thread. Returns messages in "
                "chronological order. Marks incoming messages as read."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "thread_id": {
                        "type": "string",
                        "description": "The thread ID (from list_sms_threads).",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of messages to return.",
                        "default": 50,
                    },
                },
                "required": ["thread_id"],
            },
        ),
        Tool(
            name="send_sms",
            description=(
                "Send an SMS message. The message is queued to Google Drive; "
                "the Android bridge picks it up and sends it on the next poll."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": "Recipient phone number (e.g. +15551234567).",
                    },
                    "body": {
                        "type": "string",
                        "description": "Message text.",
                    },
                },
                "required": ["to", "body"],
            },
        ),
        Tool(
            name="reply_sms",
            description=(
                "Reply to an SMS thread. Resolves the thread ID to a phone "
                "number and sends the message."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "thread_id": {
                        "type": "string",
                        "description": "The thread ID to reply to.",
                    },
                    "body": {
                        "type": "string",
                        "description": "Message text.",
                    },
                },
                "required": ["thread_id", "body"],
            },
        ),
        Tool(
            name="mark_sms_read",
            description="Mark all incoming messages in an SMS thread as read.",
            inputSchema={
                "type": "object",
                "properties": {
                    "thread_id": {
                        "type": "string",
                        "description": "The thread ID to mark as read.",
                    },
                },
                "required": ["thread_id"],
            },
        ),
        Tool(
            name="list_calls",
            description=(
                "List recent call log entries from the user's Android phone. "
                "Returns calls with contact name, phone number, type "
                "(incoming/outgoing/missed), duration, and timestamp."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of calls to return.",
                        "default": 20,
                    },
                    "since": {
                        "type": "string",
                        "description": "ISO-8601 datetime. Only return calls after this time.",
                    },
                },
            },
        ),
    ]


# -- Tool dispatch ----------------------------------------------------

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    _ensure_init()

    if not _sms_tools:
        return _text_result(
            "Error: SMS tools unavailable. "
            "Google Drive credentials not found or initialization failed."
        )

    try:
        if name == "list_sms_threads":
            result = _sms_tools.list_sms_threads(**arguments)
        elif name == "read_sms":
            result = _sms_tools.read_sms(**arguments)
        elif name == "send_sms":
            result = _sms_tools.send_sms(**arguments)
        elif name == "reply_sms":
            result = _sms_tools.reply_sms(**arguments)
        elif name == "mark_sms_read":
            result = _sms_tools.mark_sms_read(**arguments)
        elif name == "list_calls":
            result = _sms_tools.list_calls(**arguments)
        else:
            return _text_result(f"Unknown tool: {name}")

        # Serialise to readable JSON
        if isinstance(result, (list, dict)):
            text = json.dumps(result, indent=2, default=str)
        else:
            text = str(result)

        return _text_result(text)
    except Exception as e:
        return _text_result(f"Error calling {name}: {e}")


# -- Entry point ------------------------------------------------------

async def run():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(run())
