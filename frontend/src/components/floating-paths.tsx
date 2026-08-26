"use client";

import { useMemo } from "react";
import { motion } from "motion/react";

export function FloatingPaths({ position = 1 }: { position?: number }) {
	const paths = useMemo(() => {
		return Array.from({ length: 32 }, (_, i) => ({
			id: i,
			d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
				380 - i * 5 * position
			} -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
				152 - i * 5 * position
			} ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
				684 - i * 5 * position
			} ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
			width: 0.8 + (i % 4) * 0.3,
			opacity: 0.15 + (i % 5) * 0.08,
			duration: 22 + (i % 10) * 1.5,
		}));
	}, [position]);

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<svg
				className="h-full w-full text-[#0092FF] dark:text-[#00FFFF]"
				fill="none"
				viewBox="0 0 696 316"
				preserveAspectRatio="xMidYMid slice"
			>
				<title>Background Paths</title>
				{paths.map((path) => (
					<motion.path
						key={path.id}
						d={path.d}
						stroke="currentColor"
						strokeWidth={path.width}
						strokeOpacity={path.opacity}
						initial={{ pathLength: 0.4, opacity: 0.4 }}
						animate={{
							pathLength: [0.3, 1, 0.3],
							opacity: [0.2, 0.7, 0.2],
							pathOffset: [0, 1, 0],
						}}
						transition={{
							duration: path.duration,
							repeat: Number.POSITIVE_INFINITY,
							ease: "easeInOut",
						}}
					/>
				))}
			</svg>
		</div>
	);
}
