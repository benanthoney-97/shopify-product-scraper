import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export async function GET() {
  try {
    const file = path.join(process.cwd(), "public", "kb", "puresport.md");
    const md = fs.readFileSync(file, "utf8");
    return new NextResponse(md, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch (e) {
    return new NextResponse(`# KB not built yet\n\nRun \`npm run build:kb\`.`, {
      status: 200,
      headers: { "Content-Type": "text/markdown; charset=utf-8" }
    });
  }
}