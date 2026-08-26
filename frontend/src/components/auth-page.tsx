"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import {
	bumpParticleTypingImpulse,
	pulseParticleSubmitImpulse,
} from "@/components/particle-field";
import { AuthShell, useAuthTypingImpulse } from "@/components/auth-shell";

export function AuthPage() {
	return (
		<AuthShell>
			<LoginForm />
		</AuthShell>
	);
}

function LoginForm() {
	const router = useRouter();
	const typingImpulse = useAuthTypingImpulse();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError("");
		pulseParticleSubmitImpulse(typingImpulse);
		setLoading(true);

		try {
			const response = await axios.post(`${API_URL}/api/auth/login`, {
				email: email.trim(),
				password,
			});

			localStorage.setItem("access_token", response.data.access_token);
			localStorage.setItem("refresh_token", response.data.refresh_token);

			router.push("/dashboard");
		} catch (err: any) {
			setError(
				err.response?.data?.detail || "Falha na autenticação. Verifique seu e-mail e senha.",
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="w-full max-w-md">
			{/* Logo no mobile, onde a coluna de particulas nao aparece */}
			<div className="mb-8 flex justify-center lg:hidden">
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img
					src="/logo-rt-horizontal-white.png"
					alt="Robson Tavernard"
					className="h-11 w-auto max-w-[220px] object-contain drop-shadow-md"
				/>
			</div>

			<div className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-400">
				Acesso autorizado
			</div>
			<h1 className="mt-2 font-display text-3xl font-extrabold leading-tight tracking-tight text-white">
				Painel Executivo &amp; CRM
			</h1>
			<p className="mt-2 text-sm text-slate-400">
				Entre com suas credenciais para continuar.
			</p>

			{error && (
				<div
					role="alert"
					className="mt-6 animate-shake rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300"
				>
					{error}
				</div>
			)}

			<form
				onSubmit={handleSubmit}
				onKeyDown={(e) => bumpParticleTypingImpulse(typingImpulse, e)}
				className="mt-8 space-y-4"
			>
				<div className="space-y-1.5">
					<label
						htmlFor="login-email"
						className="block font-display text-xs font-semibold text-slate-300"
					>
						E-mail Corporativo
					</label>
					<div className="relative">
						<Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
						<input
							id="login-email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="campo-escuro w-full rounded-xl border border-[#002060] bg-[#000D38] py-2.5 pl-10 pr-4 text-xs text-white outline-none transition-all placeholder:text-slate-600 focus:border-[#0092FF] focus:ring-2 focus:ring-[#0092FF]"
							placeholder="seu.email@exemplo.com"
							autoComplete="email"
							required
						/>
					</div>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor="login-senha"
						className="block font-display text-xs font-semibold text-slate-300"
					>
						Senha de Acesso
					</label>
					<div className="relative">
						<Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
						<input
							id="login-senha"
							type={showPassword ? "text" : "password"}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="campo-escuro w-full rounded-xl border border-[#002060] bg-[#000D38] py-2.5 pl-10 pr-10 text-xs text-white outline-none transition-all placeholder:text-slate-600 focus:border-[#0092FF] focus:ring-2 focus:ring-[#0092FF]"
							placeholder="••••••••"
							autoComplete="current-password"
							required
						/>
						<button
							type="button"
							onClick={() => setShowPassword(!showPassword)}
							aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
							className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-300"
						>
							{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
						</button>
					</div>
				</div>

				<button
					type="submit"
					disabled={loading}
					className="mt-2 flex w-full cursor-pointer items-center justify-center space-x-2 rounded-xl bg-[#0092FF] py-3 text-xs font-bold text-white shadow-md shadow-[#0092FF]/30 transition-all hover:bg-[#007AFF] disabled:cursor-not-allowed disabled:opacity-50"
				>
					<span>{loading ? "Autenticando..." : "Entrar no Sistema"}</span>
					{!loading && <ArrowRight className="h-4 w-4" />}
				</button>
			</form>

			<div className="mt-6 border-t border-[#002060] pt-4 text-center">
				<p className="text-[11px] leading-relaxed text-slate-400">
					🔒 <span className="font-semibold text-slate-300">Acesso Restrito e Autorizado.</span>
					<br />
					A criação de novas contas é gerenciada exclusivamente pelo administrador.
				</p>
			</div>

			<div className="mt-6 flex items-center justify-center space-x-1.5 text-[11px] text-slate-400">
				<ShieldCheck className="h-3.5 w-3.5 text-[#0092FF]" />
				<span>Ambiente seguro protegido por criptografia de ponta a ponta</span>
			</div>
		</div>
	);
}
