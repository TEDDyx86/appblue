"use client";

import { useMemo } from "react";
import { motion } from "motion/react";

// Duração estática e fixa para cada um dos 36 caminhos (evita recalculação e Math.random)
const PATH_DURATIONS = [
	21.5, 26.8, 23.2, 28.4, 20.9, 27.3, 24.1, 29.6, 22.4, 25.7,
	28.1, 21.8, 26.3, 23.9, 29.1, 22.6, 27.8, 24.5, 20.6, 28.7,
	23.4, 26.1, 21.3, 29.4, 24.8, 27.6, 22.1, 25.4, 28.9, 23.7,
	26.5, 21.0, 29.8, 24.3, 27.1, 22.8
];

export function FloatingPaths({ position = 1 }: { position?: number }) {
	const paths = useMemo(() => {
		return Array.from({ length: 36 }, (_, i) => ({
			id: i,
			d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
				380 - i * 5 * position
			} -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
				152 - i * 5 * position
			} ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
				684 - i * 5 * position
			} ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
			width: 0.6 + i * 0.025,
			opacity: 0.12 + i * 0.025,
			duration: PATH_DURATIONS[i] || 25,
		}));
	}, [position]);

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden isolate transform-gpu">
			<svg
				className="h-full w-full text-[#0092FF] dark:text-[#00FFFF]"
				fill="none"
				viewBox="0 0 696 316"
				preserveAspectRatio="none"
				style={{ willChange: "transform, opacity" }}
			>
				<title>Background Paths</title>
				{paths.map((path) => (
					<motion.path
						key={path.id}
						d={path.d}
						stroke="currentColor"
						strokeWidth={path.width}
						strokeOpacity={path.opacity}
						initial={{ pathLength: 0.4, opacity: 0.3 }}
						animate={{
							pathLength: [0.4, 0.95, 0.4],
							opacity: [0.25, 0.65, 0.25],
							pathOffset: [0, 1, 0],
						}}
						transition={{
							duration: path.duration,
							repeat: Number.POSITIVE_INFINITY,
							ease: "linear",
						}}
					/>
				))}
			</svg>
		</div>
	);
}
