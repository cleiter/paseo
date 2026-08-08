export type WebSocketFramePayload = string | Buffer;

export interface SessionMessage {
  type?: unknown;
  payload?: unknown;
}

/**
 * Parse a raw WebSocket frame from the app's daemon connection into a session
 * message. Direct local connections send plain JSON, either bare or wrapped in
 * a `{ type: "session", message }` envelope; relay connections are encrypted
 * and yield null here.
 */
export function readSessionMessage(payload: WebSocketFramePayload): SessionMessage | null {
  if (typeof payload !== "string") return null;
  try {
    const envelope = JSON.parse(payload) as {
      type?: unknown;
      message?: SessionMessage;
    };
    return envelope.type === "session" ? (envelope.message ?? null) : envelope;
  } catch {
    return null;
  }
}
