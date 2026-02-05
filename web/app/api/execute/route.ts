import { NextRequest, NextResponse } from "next/server";
import { runTerminal } from "@/lib/mcp-tools";

export async function POST(request: NextRequest) {
  try {
    const { command, approval_token, cwd } = await request.json();

    if (!approval_token) {
      return NextResponse.json({ error: "Missing approval_token" }, { status: 400 });
    }

    if (!command) {
      return NextResponse.json({ error: "Missing command" }, { status: 400 });
    }

    const output = await runTerminal(command, approval_token, cwd);
    
    return NextResponse.json({
      success: true,
      output,
    });
  } catch (error: any) {
    console.error("Execute error:", error);
    return NextResponse.json(
      { 
        success: false,
        error: error.message 
      },
      { status: error.message.includes("PERMISSION DENIED") ? 403 : 500 }
    );
  }
}
