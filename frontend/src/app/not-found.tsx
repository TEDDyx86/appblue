import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Página não encontrada — Robson Tavernard",
	robots: { index: false, follow: false },
};

export default function NotFound() {
	return (
		<div className="relative min-h-svh overflow-hidden bg-[#00061A] text-slate-100">
			<Grade />

			{/* Glows ambiente, na mesma linguagem da tela de login */}
			<div className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-[#0092FF]/10 blur-3xl" />
			<div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-[#001D99]/20 blur-3xl" />

			<div className="relative mx-auto flex min-h-svh max-w-3xl flex-col items-center justify-center px-6 text-center">
				<div className="mb-6 font-mono text-[10px] uppercase tracking-[0.4em] text-slate-400">
					Status · 404
				</div>

				<NumeralGigante />

				<h1 className="mt-10 max-w-md font-display text-2xl font-extrabold leading-tight tracking-tight text-white md:text-3xl">
					Não encontramos essa página.
				</h1>
				{/* Sem links de navegacao: esta pagina e publica, e apontar rotas
				    internas para quem nao esta autenticado e exposicao desnecessaria. */}
				<p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
					O link pode estar desatualizado ou a página pode ter sido movida. Confira o
					endereço digitado.
				</p>
			</div>
		</div>
	);
}

function NumeralGigante() {
	return (
		<div className="relative font-display text-[clamp(8rem,22vw,16rem)] font-extrabold leading-none tracking-tighter">
			<span className="bg-gradient-to-b from-white via-[#00FFFF] to-[#0092FF]/20 bg-clip-text text-transparent">
				404
			</span>
			{/* Dissolve a base dos numerais no fundo */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 -bottom-2 h-1/2"
				style={{
					background:
						"radial-gradient(60% 100% at 50% 100%, rgba(0, 6, 26, 0.8) 50%, transparent 100%)",
				}}
			/>
		</div>
	);
}

function Grade() {
	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 opacity-[0.35]"
			style={{
				backgroundImage:
					"linear-gradient(to right, rgba(0, 32, 96, 0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(0, 32, 96, 0.55) 1px, transparent 1px)",
				backgroundSize: "48px 48px",
				maskImage: "radial-gradient(ellipse at center, black 35%, transparent 75%)",
				WebkitMaskImage: "radial-gradient(ellipse at center, black 35%, transparent 75%)",
			}}
		/>
	);
}
