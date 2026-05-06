export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({
    status: "ok",
    name: "fintech-web",
    version: process.env.npm_package_version ?? "0.1.0",
  });
}
