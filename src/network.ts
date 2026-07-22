export interface SubnetResult {
  cidr: string;
  mask: string;
  wildcard: string;
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  total: number;
  usable: number;
  binary: string;
  isPrivate: boolean;
}

const octetsToNumber = (octets: number[]) =>
  (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;

const numberToIp = (value: number) =>
  [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");

export function calculateSubnet(input: string): SubnetResult {
  const match = input.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) throw new Error("Enter an IPv4 address in CIDR notation");

  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((octet) => octet > 255) || prefix < 0 || prefix > 32) {
    throw new Error("That address or prefix is outside the valid range");
  }

  const ip = octetsToNumber(octets);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  const usable = prefix === 32 ? 1 : prefix === 31 ? 2 : Math.max(0, total - 2);
  const firstHost = prefix >= 31 ? network : network + 1;
  const lastHost = prefix >= 31 ? broadcast : broadcast - 1;
  const first = octets[0];
  const second = octets[1];

  return {
    cidr: `${numberToIp(network)}/${prefix}`,
    mask: numberToIp(mask),
    wildcard: numberToIp(~mask >>> 0),
    network: numberToIp(network),
    broadcast: numberToIp(broadcast),
    firstHost: numberToIp(firstHost >>> 0),
    lastHost: numberToIp(lastHost >>> 0),
    total,
    usable,
    binary: octets.map((octet) => octet.toString(2).padStart(8, "0")).join("."),
    isPrivate: first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168),
  };
}
