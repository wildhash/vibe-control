import { NextRequest, NextResponse } from "next/server";
import { grantApproval } from "@/lib/mcp-tools";

export async function POST(request: NextRequest) {
  try {
    const { request_id } = await request.json();

    if (!request_id) {
      return NextResponse.json({ error: "Missing request_id" }, { status: 400 });
    }

    const result = await grantApproval(request_id);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Approve error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
