"use client";

import { type MutableRefObject, useEffect, useRef } from "react";

type Particula = {
	/** posicao de origem, para onde a mola sempre puxa */
	ox: number;
	oy: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	alpha: number;
	phase: number;
	/** multiplicador de mola por particula, para as chegadas nao sincronizarem */
	molaJitter: number;
	/** indice na paleta pre-calculada; nunca muda depois da amostragem */
	balde: number;
};

export type ParticleFieldProps = {
	src: string;
	/** passo de amostragem da imagem. Menor = mais denso */
	sampleStep?: number;
	/** corte de brilho 0-255 para um pixel virar particula */
	threshold?: number;
	/** escala do desenho em relacao a imagem amostrada */
	renderScale?: number;
	/** tamanho base do ponto, em pixels de dispositivo */
	dotSize?: number;
	/**
	 * Fracao dos pixels elegiveis que viram particula (0..1).
	 *
	 * O bloco original derivava isso da luminancia, o que so funciona com
	 * imagens em tons de cinza. Nosso monograma e branco chapado, entao a
	 * densidade precisa ser explicita — e e ela que devolve a textura
	 * granulada, em vez de um bloco solido de pontos.
	 */
	densidade?: number;
	/** forca com que o cursor repele os pontos */
	mouseForce?: number;
	/** raio de influencia do cursor, em pixels de dispositivo */
	mouseRadius?: number;
	/** constante da mola que puxa os pontos de volta a origem */
	spring?: number;
	/** amortecimento viscoso da velocidade */
	damping?: number;
	/**
	 * Paradas do gradiente, do nucleo da figura para as bordas. Aceita duas ou
	 * mais cores; sao interpoladas e quantizadas uma unica vez na amostragem.
	 */
	cores?: string[];
	className?: string;
	/** alinhamento do aglomerado dentro do canvas */
	align?: "center" | "bottom";
	/**
	 * O componente pai incrementa `current` a cada tecla; o campo decai o valor
	 * a cada frame e o usa para adicionar deriva e cintilacao, de modo que
	 * digitar no formulario anima a figura.
	 */
	typingImpulseRef?: MutableRefObject<number>;
};

const TYPING_IMPULSE_ADD = 0.14;
const TYPING_IMPULSE_CAP = 1.35;

const SUBMIT_IMPULSE_PRIMARY = 0.52;
const SUBMIT_IMPULSE_SECOND_MS = 120;
const SUBMIT_IMPULSE_SECONDARY = 0.2;

/** Numero de cores pre-calculadas entre nucleo e borda. */
const BALDES = 14;

/** Adiciona energia ao `typingImpulseRef`. */
export function pulseParticleTypingImpulse(
	impulseRef: MutableRefObject<number>,
	amount = TYPING_IMPULSE_ADD,
) {
	impulseRef.current = Math.min(impulseRef.current + amount, TYPING_IMPULSE_CAP);
}

/**
 * Pulso mais forte em dois tempos quando o formulario e enviado: a batida
 * principal mais uma repeticao rapida enquanto a primeira ainda decai.
 */
export function pulseParticleSubmitImpulse(impulseRef: MutableRefObject<number>) {
	pulseParticleTypingImpulse(impulseRef, SUBMIT_IMPULSE_PRIMARY);
	window.setTimeout(() => {
		pulseParticleTypingImpulse(impulseRef, SUBMIT_IMPULSE_SECONDARY);
	}, SUBMIT_IMPULSE_SECOND_MS);
}

/** Incrementa o impulso a partir de um handler de `keydown`. */
export function bumpParticleTypingImpulse(
	impulseRef: MutableRefObject<number>,
	e: Pick<KeyboardEvent, "repeat" | "metaKey" | "ctrlKey" | "altKey" | "key">,
) {
	if (e.repeat) return;
	if (e.metaKey || e.ctrlKey || e.altKey) return;
	if (e.key === "Tab" || e.key === "Escape") return;
	pulseParticleTypingImpulse(impulseRef, TYPING_IMPULSE_ADD);
}

function lerHex(hex: string) {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Paleta do nucleo ate a borda, resolvida uma vez e reusada por todos os frames. */
function construirPaleta(cores: string[]) {
	const paradas = cores.map(lerHex);
	if (paradas.length === 1) paradas.push(paradas[0]);

	return Array.from({ length: BALDES }, (_, i) => {
		// Posicao global no gradiente -> par de paradas adjacentes + fracao entre elas.
		const escala = (i / (BALDES - 1)) * (paradas.length - 1);
		const idx = Math.min(paradas.length - 2, Math.floor(escala));
		const t = escala - idx;
		const a = paradas[idx];
		const b = paradas[idx + 1];
		const r = Math.round(a.r + (b.r - a.r) * t);
		const g = Math.round(a.g + (b.g - a.g) * t);
		const bl = Math.round(a.b + (b.b - a.b) * t);
		return `rgb(${r}, ${g}, ${bl})`;
	});
}

export function ParticleField({
	src,
	sampleStep = 3,
	threshold = 34,
	renderScale = 0.78,
	dotSize = 1,
	densidade = 0.5,
	mouseForce = 90,
	mouseRadius = 110,
	spring = 0.035,
	damping = 0.86,
	cores = ["#FFFFFF", "#00FFFF", "#0092FF"],
	className,
	align = "center",
	typingImpulseRef,
}: ParticleFieldProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	const pointerRef = useRef({ x: -9999, y: -9999, active: false });

	// As props de ajuste ficam em refs para o efeito principal continuar montado
	// quando elas mudam. Reconstruir o efeito derrubaria o canvas e o estado das
	// particulas a cada tweak.
	const srcRef = useRef(src);
	srcRef.current = src;
	const sampleStepRef = useRef(sampleStep);
	sampleStepRef.current = sampleStep;
	const thresholdRef = useRef(threshold);
	thresholdRef.current = threshold;
	const renderScaleRef = useRef(renderScale);
	renderScaleRef.current = renderScale;
	const dotSizeRef = useRef(dotSize);
	dotSizeRef.current = dotSize;
	const densidadeRef = useRef(densidade);
	densidadeRef.current = densidade;
	const mouseForceRef = useRef(mouseForce);
	mouseForceRef.current = mouseForce;
	const mouseRadiusRef = useRef(mouseRadius);
	mouseRadiusRef.current = mouseRadius;
	const springRef = useRef(spring);
	springRef.current = spring;
	const dampingRef = useRef(damping);
	dampingRef.current = damping;
	const alignRef = useRef(align);
	alignRef.current = align;
	// `cores` e um array vindo das props; a chave serializada evita reconstruir a
	// paleta a cada render quando o conteudo nao mudou.
	const chaveCores = cores.join();
	const paletaRef = useRef(construirPaleta(cores));
	const chaveAnteriorRef = useRef(chaveCores);
	if (chaveAnteriorRef.current !== chaveCores) {
		chaveAnteriorRef.current = chaveCores;
		paletaRef.current = construirPaleta(cores);
	}

	useEffect(() => {
		const canvas = canvasRef.current;
		const wrapper = wrapperRef.current;
		if (!canvas || !wrapper) return;

		const ctx = canvas.getContext("2d", { alpha: true });
		if (!ctx) return;

		let particulas: Particula[] = [];
		let dpr = Math.min(window.devicePixelRatio || 1, 2);
		let width = 0;
		let height = 0;
		let clusterW = 0;
		let clusterH = 0;
		let offsetX = 0;
		let offsetY = 0;
		let rafId = 0;
		let time = 0;
		/** 0 -> 1 no primeiro segundo, para a figura materializar em vez de piscar */
		let materializar = 0;
		let destruido = false;
		let resizeRaf = 0;
		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		let imagemAtual: HTMLImageElement | null = null;

		const ajustarCanvas = () => {
			const rect = wrapper.getBoundingClientRect();
			width = Math.max(1, Math.floor(rect.width));
			height = Math.max(1, Math.floor(rect.height));
			dpr = Math.min(window.devicePixelRatio || 1, 2);

			canvas.width = width * dpr;
			canvas.height = height * dpr;
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
		};

		const construir = (image: HTMLImageElement) => {
			if (!image.width || !image.height) return;
			ajustarCanvas();

			const srcRatio = image.width / image.height;
			const dstRatio = width / height;

			let drawW: number;
			let drawH: number;
			if (srcRatio > dstRatio) {
				drawH = height;
				drawW = height * srcRatio;
			} else {
				drawW = width;
				drawH = width / srcRatio;
			}
			drawW *= renderScaleRef.current;
			drawH *= renderScaleRef.current;

			const sampleW = Math.max(80, Math.floor(drawW / sampleStepRef.current));
			const sampleH = Math.max(80, Math.floor(drawH / sampleStepRef.current));

			const off = document.createElement("canvas");
			off.width = sampleW;
			off.height = sampleH;
			const offCtx = off.getContext("2d", { willReadFrequently: true });
			if (!offCtx) return;
			offCtx.drawImage(image, 0, 0, sampleW, sampleH);
			const data = offCtx.getImageData(0, 0, sampleW, sampleH).data;

			const cellW = drawW / sampleW;
			const cellH = drawH / sampleH;

			clusterW = drawW;
			clusterH = drawH;
			offsetX = (width - clusterW) / 2;
			offsetY =
				alignRef.current === "bottom"
					? height - clusterH - Math.min(40, height * 0.04)
					: (height - clusterH) / 2;

			const thresholdV = thresholdRef.current;
			const densidadeV = densidadeRef.current;
			const dotSizeV = dotSizeRef.current;

			// 1a passada: coleta os pixels que viram particula.
			const brutos: { px: number; py: number }[] = [];
			for (let y = 0; y < sampleH; y++) {
				for (let x = 0; x < sampleW; x++) {
					const idx = (y * sampleW + x) * 4;
					const brilho = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
					if (data[idx + 3] < 200 || brilho < thresholdV) continue;
					if (densidadeV < 1 && Math.random() > densidadeV) continue;

					brutos.push({
						px: (offsetX + x * cellW + cellW / 2) * dpr,
						py: (offsetY + y * cellH + cellH / 2) * dpr,
					});
				}
			}
			if (brutos.length === 0) return;

			// 2a passada: o gradiente segue a distancia ao centro da figura, nao a
			// luminancia. O monograma e branco chapado, entao a luminancia nao
			// carrega informacao nenhuma — a geometria carrega.
			let somaX = 0;
			let somaY = 0;
			for (const p of brutos) {
				somaX += p.px;
				somaY += p.py;
			}
			const centroX = somaX / brutos.length;
			const centroY = somaY / brutos.length;

			let distMax = 1;
			for (const p of brutos) {
				const d = Math.hypot(p.px - centroX, p.py - centroY);
				if (d > distMax) distMax = d;
			}

			particulas = brutos.map((p) => {
				// O expoente enviesa a escala para o nucleo: sem ele, a maioria das
				// particulas de uma marca larga cai na faixa distante e a figura
				// inteira sai azul escuro, sem o brilho central.
				const dist = Math.min(1, Math.hypot(p.px - centroX, p.py - centroY) / distMax);
				const t = dist ** 1.6;
				// Variacao aleatoria de tamanho e opacidade: sem ela, uma silhueta
				// chapada renderiza como um bloco uniforme, sem profundidade.
				const variacao = Math.random();
				return {
					ox: p.px,
					oy: p.py,
					x: p.px + (Math.random() - 0.5) * 40,
					y: p.py + (Math.random() - 0.5) * 40,
					vx: 0,
					vy: 0,
					size: (dotSizeV + variacao * 0.9) * dpr,
					alpha: 0.6 + variacao * 0.4,
					phase: Math.random() * Math.PI * 2,
					molaJitter: 0.9 + Math.random() * 0.2,
					balde: Math.min(BALDES - 1, Math.floor(t * BALDES)),
				};
			});

			// Ordenar por balde permite trocar `fillStyle` uma vez por cor em vez de
			// uma vez por particula — a troca de estado e o gargalo do canvas 2D.
			particulas.sort((a, b) => a.balde - b.balde);
		};

		const render = () => {
			if (destruido) return;
			time += 0.016;
			materializar = Math.min(1, materializar + 0.02);
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			const mouseForceV = mouseForceRef.current;
			const mouseRadiusV = mouseRadiusRef.current;
			const springV = springRef.current;
			const dampingV = dampingRef.current;
			const paleta = paletaRef.current;

			const px = pointerRef.current.x * dpr;
			const py = pointerRef.current.y * dpr;
			const mr = mouseRadiusV * dpr;
			const mr2 = mr * mr;

			const typing = typingImpulseRef?.current ?? 0;
			if (typingImpulseRef && typing > 1e-4) {
				typingImpulseRef.current *= 0.93;
			}
			const typingBoost = 1 + typing * 10;
			const rippleCx = (offsetX + clusterW * 0.5) * dpr;
			const rippleCy = (offsetY + clusterH * 0.48) * dpr;

			let baldeAtual = -1;
			for (let i = 0; i < particulas.length; i++) {
				const p = particulas[i];

				const s = springV * p.molaJitter;
				p.vx += (p.ox - p.x) * s;
				p.vy += (p.oy - p.y) * s;

				if (pointerRef.current.active) {
					const dx = p.x - px;
					const dy = p.y - py;
					const d2 = dx * dx + dy * dy;
					if (d2 < mr2 && d2 > 0.0001) {
						const d = Math.sqrt(d2);
						const forca = (1 - d / mr) * mouseForceV;
						p.vx += (dx / d) * forca * 0.04;
						p.vy += (dy / d) * forca * 0.04;
					}
				}

				p.vx += Math.sin(time * 0.8 + p.phase) * 0.08 * 0.05 * typingBoost;
				p.vy += Math.cos(time * 0.9 + p.phase) * 0.04 * typingBoost;

				if (typing > 1e-4) {
					p.vx += (Math.random() - 0.5) * typing * 2.8;
					p.vy += (Math.random() - 0.5) * typing * 2.8;
					const rdx = p.x - rippleCx;
					const rdy = p.y - rippleCy;
					const rd = Math.sqrt(rdx * rdx + rdy * rdy) + 0.5;
					const onda = (typing * 22 * dpr) / rd;
					p.vx += (rdx / rd) * onda * 0.018;
					p.vy += (rdy / rd) * onda * 0.018;
				}

				p.vx *= dampingV;
				p.vy *= dampingV;
				p.x += p.vx;
				p.y += p.vy;

				if (p.balde !== baldeAtual) {
					baldeAtual = p.balde;
					ctx.fillStyle = paleta[baldeAtual];
				}

				const cintilacao =
					0.85 + Math.sin(time * (1.4 + typing * 2.2) + p.phase) * (0.15 + typing * 0.35);
				ctx.globalAlpha = p.alpha * cintilacao * materializar;
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
			rafId = requestAnimationFrame(render);
		};

		const onPointerMove = (e: PointerEvent) => {
			const rect = wrapper.getBoundingClientRect();
			pointerRef.current.x = e.clientX - rect.left;
			pointerRef.current.y = e.clientY - rect.top;
			pointerRef.current.active = true;
		};
		const onPointerLeave = () => {
			pointerRef.current.active = false;
			pointerRef.current.x = -9999;
			pointerRef.current.y = -9999;
		};

		const ro = new ResizeObserver(() => {
			if (resizeRaf) cancelAnimationFrame(resizeRaf);
			resizeRaf = requestAnimationFrame(() => {
				if (resizeTimer) clearTimeout(resizeTimer);
				// Arrastar a janela dispara continuamente; a reamostragem e cara.
				resizeTimer = setTimeout(() => {
					if (imagemAtual) construir(imagemAtual);
				}, 120);
			});
		});

		// O loop comeca antes da imagem carregar: desenhar um array vazio nao custa
		// nada e evita corrida entre o primeiro frame e o `onload`.
		ro.observe(wrapper);
		rafId = requestAnimationFrame(render);

		const image = new Image();
		image.decoding = "async";
		image.onload = () => {
			if (destruido) return;
			imagemAtual = image;
			construir(image);
		};
		image.src = srcRef.current;

		wrapper.addEventListener("pointermove", onPointerMove);
		wrapper.addEventListener("pointerleave", onPointerLeave);

		return () => {
			destruido = true;
			cancelAnimationFrame(rafId);
			if (resizeRaf) cancelAnimationFrame(resizeRaf);
			if (resizeTimer) clearTimeout(resizeTimer);
			ro.disconnect();
			wrapper.removeEventListener("pointermove", onPointerMove);
			wrapper.removeEventListener("pointerleave", onPointerLeave);
		};
		// As props de ajuste sao lidas de refs, entao ficam fora das dependencias
		// de proposito: reexecutar este efeito derrubaria o canvas.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div
			ref={wrapperRef}
			className={className}
			style={{ position: "relative", width: "100%", height: "100%" }}
		>
			<canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
		</div>
	);
}
