export interface PortObservation {
  port: string;
  status: string;
  inputPackets: number;
  outputPackets: number;
  description: string;
}

export interface SwitchAuditSnapshot {
  id: string;
  deviceId: string;
  capturedAt: number;
  ports: PortObservation[];
}

export interface PortAuditCandidate extends PortObservation {
  inactiveWeeks: number;
  packetDelta: number;
  protected: boolean;
  reason: string;
}

const protectedDescription = /(?:uplink|trunk|firewall|router|server|access point|\bap[-_ ]|wireless|wan|port-channel|peer-link)/i;
const disconnectedStatus = /^(?:notconnect|down|inactive)$/i;

export function parsePortSnapshot(input: string): PortObservation[] {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const dataLines = lines[0]?.toLowerCase().startsWith("port,") ? lines.slice(1) : lines;
  const ports = dataLines.map((line, index) => {
    const [port, status, inputPackets, outputPackets, ...description] = line.split(",").map((value) => value.trim());
    const inputCount = Number(inputPackets);
    const outputCount = Number(outputPackets);
    if (!port || !status || !Number.isFinite(inputCount) || !Number.isFinite(outputCount)) {
      throw new Error(`Invalid snapshot row ${index + 1}. Use port,status,inputPackets,outputPackets,description.`);
    }
    return { port, status, inputPackets: inputCount, outputPackets: outputCount, description: description.join(", ") };
  });
  if (!ports.length) throw new Error("Paste at least one port observation");
  return ports;
}

export function analyzePortSnapshots(snapshots: SwitchAuditSnapshot[], minimumWeeks: number): { candidates: PortAuditCandidate[]; historyWeeks: number; sufficientHistory: boolean } {
  const ordered = [...snapshots].sort((left, right) => left.capturedAt - right.capturedAt);
  const latest = ordered.at(-1);
  if (!latest) return { candidates: [], historyWeeks: 0, sufficientHistory: false };
  const cutoff = latest.capturedAt - minimumWeeks * 7 * 24 * 60 * 60 * 1000;
  const baseline = ordered.filter((snapshot) => snapshot.capturedAt <= cutoff).at(-1);
  const historyWeeks = Math.floor((latest.capturedAt - ordered[0].capturedAt) / (7 * 24 * 60 * 60 * 1000));
  if (!baseline) return { candidates: [], historyWeeks, sufficientHistory: false };
  const baselinePorts = new Map(baseline.ports.map((port) => [port.port.toLowerCase(), port]));
  const candidates = latest.ports.flatMap((port) => {
    const previous = baselinePorts.get(port.port.toLowerCase());
    if (!previous || !disconnectedStatus.test(previous.status) || !disconnectedStatus.test(port.status)) return [];
    const latestPackets = port.inputPackets + port.outputPackets;
    const previousPackets = previous.inputPackets + previous.outputPackets;
    if (latestPackets < previousPackets) return [];
    const packetDelta = latestPackets - previousPackets;
    if (packetDelta !== 0) return [];
    const inactiveWeeks = Math.floor((latest.capturedAt - baseline.capturedAt) / (7 * 24 * 60 * 60 * 1000));
    const protectedPort = protectedDescription.test(port.description);
    return [{ ...port, inactiveWeeks, packetDelta, protected: protectedPort, reason: protectedPort ? "No traffic, but description suggests infrastructure" : `No packet change and disconnected for at least ${inactiveWeeks} weeks` }];
  });
  return { candidates, historyWeeks, sufficientHistory: true };
}

export function ciscoAuditDemoSnapshots(deviceId: string, now = Date.now()): SwitchAuditSnapshot[] {
  const week = 7 * 24 * 60 * 60 * 1000;
  const ports = (stage: number): PortObservation[] => [
    { port: "Gi1/0/1", status: "connected", inputPackets: 180_000 + stage * 25_000, outputPackets: 150_000 + stage * 21_000, description: "USER-DESK-01" },
    { port: "Gi1/0/3", status: "connected", inputPackets: 900_000 + stage * 90_000, outputPackets: 840_000 + stage * 80_000, description: "AP-LONDON-01" },
    { port: "Gi1/0/7", status: "notconnect", inputPackets: 1_204, outputPackets: 888, description: "SPARE-DESK" },
    { port: "Gi1/0/8", status: stage < 2 ? "connected" : "notconnect", inputPackets: stage < 2 ? 8_000 + stage * 500 : 8_500, outputPackets: stage < 2 ? 7_100 + stage * 400 : 7_500, description: "MEETING-ROOM" },
    { port: "Gi1/0/47", status: "down", inputPackets: 50_000, outputPackets: 51_000, description: "DIST-UPLINK-B" },
  ];
  return [16, 12, 8, 4, 0].map((weeksAgo, index) => ({ id: `${deviceId}-${weeksAgo}`, deviceId, capturedAt: now - weeksAgo * week, ports: ports(index) }));
}
