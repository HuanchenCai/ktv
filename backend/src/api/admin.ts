import type { FastifyInstance } from "fastify";
import type { Scanner } from "../scanner.ts";
import type { OpenListClient } from "../openlist-client.ts";
import QRCode from "qrcode";
import { networkInterfaces } from "node:os";

export async function registerAdminRoutes(
  fastify: FastifyInstance,
  scanner: Scanner,
  openlist: OpenListClient,
  http_port: number,
  getOpenlistInitialPassword: () => string | null = () => null,
): Promise<void> {
  fastify.post<{ Body: { max_depth?: number } }>(
    "/api/admin/scan",
    async (req, rep) => {
      try {
        const result = await scanner.scan({
          maxDepth: req.body?.max_depth ?? 3,
        });
        return result;
      } catch (err) {
        return rep.code(500).send({
          error: err instanceof Error ? err.message : String(err),
          hint:
            "check config.json.baidu_root and that OpenList has the Baidu storage configured + api_token is set",
        });
      }
    },
  );

  fastify.get("/api/admin/openlist-status", async () => {
    const alive = await openlist.ping();
    return {
      alive,
      initial_password: getOpenlistInitialPassword(),
    };
  });

  fastify.get("/api/admin/qrcode", async () => {
    const lanIps = getLanIps();
    const host = lanIps[0] ?? "localhost";
    const url = `http://${host}:${http_port}`;
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      width: 256,
    });
    return { url, qr_data_url: dataUrl, lan_ips: lanIps };
  });
}

function getLanIps(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue;
    for (const net of ifaces) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}
