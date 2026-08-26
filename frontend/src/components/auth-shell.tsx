"use client";

import { createContext, useContext, useRef, type MutableRefObject, type ReactNode } from "react";
import { ParticleField } from "@/components/particle-field";

const TypingImpulseContext = createContext<MutableRefObject<number> | null>(null);

/**
 * Referencia compartilhada de energia do campo de particulas. O formulario a
 * incrementa; o canvas a consome e decai a cada frame.
 */
export function useAuthTypingImpulse(): MutableRefObject<number> {
	const ctx = useContext(TypingImpulseContext);
	if (!ctx) throw new Error("useAuthTypingImpulse fora de <AuthShell>");
	return ctx;
}

export function AuthShell({ children }: { children: ReactNode }) {
	const typingImpulseRef = useRef(0);

	return (
		<TypingImpulseContext.Provider value={typingImpulseRef}>
			<div className="relative min-h-svh bg-[#00061A] text-slate-100">
				<div className="relative mx-auto flex h-svh w-full max-w-[1600px] overflow-hidden">
					{/* Coluna esquerda - campo de particulas */}
					<div className="relative hidden flex-1 overflow-hidden border-r border-[#002060] bg-[#000926] lg:block">
						{/* Glows ambiente, atras das particulas */}
						<div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#0092FF]/10 blur-3xl" />
						<div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#001D99]/20 blur-3xl" />

						{/* Halo atras do monograma: separa a figura do fundo sem clarear a coluna toda */}
						<div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0092FF]/[0.07] blur-[90px]" />

						<ParticleField
							src="/rt-monogram.png"
							sampleStep={2}
							threshold={34}
							dotSize={1}
							densidade={0.45}
							renderScale={0.72}
							align="center"
							/* Raio e forca acima do padrao do bloco original: nosso monograma
							   e uma silhueta cheia, e o valor original abria um vao pequeno
							   demais para ler como interacao. */
							mouseForce={105}
							mouseRadius={145}
							cores={["#FFFFFF", "#00FFFF", "#0092FF"]}
							typingImpulseRef={typingImpulseRef}
						/>

						{/* Vinheta: escurece as bordas para o texto respirar sobre as particulas */}
						<div
							aria-hidden
							className="pointer-events-none absolute inset-0"
							style={{
								background:
									"radial-gradient(900px 700px at 50% 50%, transparent 62%, rgba(0, 9, 38, 0.8) 100%)",
							}}
						/>

						<div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-12">
							<div className="pointer-events-auto flex items-center gap-2.5 font-mono text-sm">
								<span className="inline-block h-2 w-2 rounded-full bg-[#00FFFF]" />
								<span className="uppercase tracking-[0.2em] text-slate-200">
									Robson Tavernard
								</span>
							</div>

							<div className="max-w-md">
								<div className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-400">
									Planejamento Patrimonial
								</div>
								<p className="mt-3 font-display text-xl leading-snug text-slate-100 md:text-2xl">
									Reunioes, atas inteligentes e CRM sincronizados num unico painel.
								</p>
							</div>
						</div>
					</div>

					{/* Coluna direita - formulario */}
					<div className="relative flex w-full flex-col items-center justify-center overflow-y-auto px-6 py-10 lg:w-[560px] lg:px-14">
						<div
							aria-hidden
							className="pointer-events-none absolute inset-0 -z-10 opacity-40"
						>
							<div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,146,255,0.15)_0,transparent_70%)]" />
							<div className="absolute bottom-0 left-0 h-96 w-96 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,29,153,0.2)_0,transparent_70%)]" />
						</div>
						{children}
					</div>
				</div>
			</div>
		</TypingImpulseContext.Provider>
	);
}
