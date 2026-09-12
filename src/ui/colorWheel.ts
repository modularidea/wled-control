import { hsvToRgb, rgbToHsv } from "./color";

export interface ColorWheelHandle {
	el: HTMLElement;
	update: (rgb: [number, number, number]) => void;
	destroy: () => void;
}

const SIZE = 180;

// HSV color wheel; value is fixed at 1 (brightness is the separate BrightnessSlider).
export function createColorWheel(
	parent: HTMLElement,
	onChange: (rgb: [number, number, number]) => void
): ColorWheelHandle {
	const wrap = parent.createDiv({ cls: "wled-color-wheel" });
	const canvas = wrap.createEl("canvas");
	canvas.width = SIZE;
	canvas.height = SIZE;
	const marker = wrap.createDiv({ cls: "wled-color-wheel-marker" });
	const ctx = canvas.getContext("2d");
	const radius = SIZE / 2;
	let dragging = false;

	function drawWheel(): void {
		if (!ctx) return;
		ctx.clearRect(0, 0, SIZE, SIZE);
		if (typeof ctx.createConicGradient === "function") {
			const conic = ctx.createConicGradient(0, radius, radius);
			for (let deg = 0; deg <= 360; deg += 30) {
				const [r, g, b] = hsvToRgb(deg, 1, 1);
				conic.addColorStop(deg / 360, `rgb(${r},${g},${b})`);
			}
			ctx.fillStyle = conic;
		} else {
			ctx.fillStyle = "#888"; // fallback for very old Chromium without createConicGradient
		}
		ctx.beginPath();
		ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2);
		ctx.fill();

		const radial = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius - 1);
		radial.addColorStop(0, "rgba(255,255,255,1)");
		radial.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = radial;
		ctx.beginPath();
		ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2);
		ctx.fill();
	}

	function setMarker(hue: number, sat: number): void {
		const angle = (hue * Math.PI) / 180;
		const dist = sat * (radius - 1);
		const x = radius + dist * Math.cos(angle);
		const y = radius + dist * Math.sin(angle);
		marker.style.left = `${x}px`;
		marker.style.top = `${y}px`;
	}

	function handlePointer(ev: PointerEvent): void {
		const rect = canvas.getBoundingClientRect();
		const x = ev.clientX - rect.left - radius;
		const y = ev.clientY - rect.top - radius;
		const dist = Math.min(Math.sqrt(x * x + y * y), radius - 1);
		const sat = dist / (radius - 1);
		let hue = (Math.atan2(y, x) * 180) / Math.PI;
		if (hue < 0) hue += 360;
		setMarker(hue, sat);
		const rgb = hsvToRgb(hue, sat, 1);
		onChange(rgb);
	}

	function onPointerDown(ev: PointerEvent): void {
		dragging = true;
		canvas.setPointerCapture(ev.pointerId);
		handlePointer(ev);
	}
	function onPointerMove(ev: PointerEvent): void {
		if (!dragging) return;
		handlePointer(ev);
	}
	function onPointerUp(ev: PointerEvent): void {
		dragging = false;
		canvas.releasePointerCapture(ev.pointerId);
	}

	canvas.addEventListener("pointerdown", onPointerDown);
	canvas.addEventListener("pointermove", onPointerMove);
	canvas.addEventListener("pointerup", onPointerUp);

	function update(rgb: [number, number, number]): void {
		if (dragging) return;
		const [h, s] = rgbToHsv(...rgb);
		setMarker(h, s);
	}

	function destroy(): void {
		canvas.removeEventListener("pointerdown", onPointerDown);
		canvas.removeEventListener("pointermove", onPointerMove);
		canvas.removeEventListener("pointerup", onPointerUp);
	}

	drawWheel();
	setMarker(0, 0);
	return { el: wrap, update, destroy };
}
