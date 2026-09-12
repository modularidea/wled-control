import { Bonjour, type Browser, type Service } from "bonjour-service";
import { scanSubnet } from "./subnetScan";

export interface DiscoveredWledDevice {
	name: string;
	host: string;
	port: number;
}

// Runs the subnet scan (primary) and an mDNS lookup (secondary, best-effort) in parallel.
export class WledDiscovery {
	private bonjour: Bonjour | null = null;
	private browser: Browser | null = null;
	private cancelToken = { cancelled: false };

	start(onFound: (device: DiscoveredWledDevice) => void): void {
		this.cancelToken = { cancelled: false };

		try {
			this.bonjour = new Bonjour();
			this.browser = this.bonjour.find({ type: "wled" }, (service: Service) => {
				const address = service.referer?.address ?? service.addresses?.[0];
				if (!address) return;
				onFound({ name: service.name, host: address, port: service.port });
			});
		} catch {
			this.bonjour = null;
			this.browser = null;
		}

		void scanSubnet(onFound, this.cancelToken);
	}

	stop(): void {
		this.cancelToken.cancelled = true;
		this.browser?.stop();
		this.browser = null;
		this.bonjour?.destroy();
		this.bonjour = null;
	}
}
