import { openApiSpec } from "@/lib/api/openapi";
import { originOf } from "@/lib/api/v1";

/** Public, machine-readable API description (import it into Postman, Swagger UI or an agent's tool list). */
export async function GET(req: Request) {
  return Response.json(openApiSpec(originOf(req)), { headers: { "Cache-Control": "public, max-age=300" } });
}
