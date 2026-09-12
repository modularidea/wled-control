import * as os from "os";
import { probeWledInfo } from "./httpUtil";
import type { DiscoveredWledDevice } from "./discovery";

const CONCURRENCY = 24;
const PROBE_TIMEOUT_MS = 400;

// Active HTTP scan of the local /24 subnet(s) for WLED controllers (/json/info). Primary
// discovery method — see docs/concept.md §8 for why mDNS alone is unreliable here.
export async function scanSubnet(
	onFound: (device: DiscoveredWledDevice) => void,
	cancelToken: { cancelled: boolean }
): Promise<void> {
	const candidates = buildCandidates();
	const seen = new Set<string>();
	let index = 0;

	async function worker(): Promise<void> {
		while (index < candidates.length && !cancelToken.cancelled) {
			const host = candidates[index++];
			const info = await probeWledInfo(host, PROBE_TIMEOUT_MS);
			if (info && !seen.has(host)) {
				seen.add(host);
				onFound({ name: info.name || host, host, port: 80 });
			}
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}

function buildCandidates(): string[] {
	const bases = localIPv4Bases();
	const candidates: string[] = [];
	for (const base of bases) {
		for (let i = 1; i <= 254; i++) candidates.push(`${base}.${i}`);
	}
	return candidates;
}

// Only real LAN interfaces (RFC 1918) — excludes CGNAT/VPN ranges like Tailscale.
function isRfc1918(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
	const [a, b] = parts;
	return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function localIPv4Bases(): string[] {
	const ifaces = os.networkInterfaces();
	const bases = new Set<string>();
	for (const list of Object.values(ifaces)) {
		for (const iface of list ?? []) {
			if (iface.family === "IPv4" && !iface.internal && isRfc1918(iface.address)) {
				const parts = iface.address.split(".");
				bases.add(parts.slice(0, 3).join("."));
			}
		}
	}
	return [...bases];
}
