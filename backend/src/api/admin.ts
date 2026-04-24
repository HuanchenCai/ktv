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
): Promise<void> {
  fastify.post<{ Body: { max_depth?: number } }>(
    "/api/admin/scan",
    async (req) => {
      const result = await scanner.scan({
        maxDepth: req.body?.max_depth ?? 3,
      });
      return result;
    },
  );

  fastify.get("/api/admin/openlist-status", async () => {
    const alive = await openlist.ping();
    return { alive };
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
