import type React from "react";

export const Logo = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={`flex items-center ${className}`} {...props}>
		<img
			src="/logo-rt-horizontal-white.png"
			alt="Robson Tavernard"
			style={{ maxHeight: "46px", maxWidth: "210px" }}
			className="h-10 w-auto max-w-[210px] object-contain drop-shadow-md"
		/>
	</div>
);

export const LogoIcon = (props: React.ComponentProps<"svg">) => (
	<svg
		viewBox="0 0 32 32"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<rect width="32" height="32" rx="8" fill="#002060" />
		<path
			d="M8 10h10a4 4 0 0 1 0 8H8V10zm0 8h8l5 6"
			stroke="#0092FF"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);
