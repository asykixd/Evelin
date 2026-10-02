// One IPC subscription for the whole app; packets are routed to tiles by serial.
import type { VideoPacket } from "@shared/types";

type Route = {
  packet(packet: VideoPacket): void;
  stopped(reason: string): void;
};

const routes = new Map<string, Route>();

window.farm.mirror.onPacket((serial, packet) => routes.get(serial)?.packet(packet));
window.farm.mirror.onStopped((serial, reason) => routes.get(serial)?.stopped(reason));

export function route(serial: string, r: Route): () => void {
  routes.set(serial, r);
  return () => {
    if (routes.get(serial) === r) routes.delete(serial);
  };
}
