/**
 * SSE Stream API
 * 
 * Streams terminal output and agent events to the client.
 */

import { NextRequest } from "next/server";

// Store active streams
const streams = new Map<string, ReadableStreamDefaultController>();

export async function GET(request: NextRequest) {
  const streamId = request.nextUrl.searchParams.get("id") || "default";

  const stream = new ReadableStream({
    start(controller) {
      streams.set(streamId, controller);
      
      // Send initial connection message
      const data = JSON.stringify({ type: "connected", streamId });
      controller.enqueue(`data: ${data}\n\n`);
    },
    cancel() {
      streams.delete(streamId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
