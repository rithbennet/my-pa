import { buildHttpServer } from "@/interfaces/http/httpServer.ts";
import { env } from "@/infra/config/env.ts";

const port = env.PORT;
const server = await buildHttpServer();

try {
  await server.listen({ port, host: "0.0.0.0" });
  server.log.info({ port }, "server started");
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
