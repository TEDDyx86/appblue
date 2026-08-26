"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Eye, EyeOff, Lock, Mail, ArrowRight, ShieldCheck, Sparkles, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/logo";
import { FloatingPaths } from "@/components/floating-paths";

export function AuthPage() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const response = await axios.post(`${API_URL}/api/auth/login`, {
				email: email.trim(),
				password,
			});

			// Salva tokens no localStorage
			localStorage.setItem("access_token", response.data.access_token);
			localStorage.setItem("refresh_token", response.data.refresh_token);

			router.push("/dashboard");
		} catch (err: any) {
			setError(err.response?.data?.detail || "Falha na autenticação. Verifique seu e-mail e senha.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<main className="relative min-h-screen bg-[#00061A] text-slate-100 lg:grid lg:grid-cols-12 overflow-x-hidden">
			{/* Left Column - Branding & Animated Paths */}
			<div className="relative hidden h-full flex-col justify-between border-r border-[#002060] bg-[#000926] p-12 lg:col-span-5 lg:flex xl:col-span-6 overflow-hidden">
				{/* Ambient Glows */}
				<div className="absolute top-0 left-0 w-96 h-96 bg-[#0092FF]/10 rounded-full blur-3xl pointer-events-none" />
				<div className="absolute bottom-0 right-0 w-96 h-96 bg-[#001D99]/20 rounded-full blur-3xl pointer-events-none" />
				<div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#000926]/40 to-[#00061A]/90 pointer-events-none" />

				{/* Brand Logo */}
				<div className="z-10">
					<Logo className="h-10" />
				</div>

				{/* Animated Vector Paths (Fixed without flickering) */}
				<div className="absolute inset-0 opacity-80 pointer-events-none">
					<FloatingPaths position={1} />
					<FloatingPaths position={-1} />
				</div>

				{/* Highlights Card & Testimonial */}
				<div className="z-10 mt-auto space-y-6">
					<div className="space-y-3 bg-[#000D38]/80 backdrop-blur-md p-6 rounded-2xl border border-[#002060] shadow-xl">
						<div className="flex items-center space-x-2 text-[#00FFFF] text-xs font-bold font-display uppercase tracking-wider">
							<Sparkles className="w-4 h-4" />
							<span>Inteligência & Automação</span>
						</div>
						<p className="text-base text-slate-200 leading-relaxed font-light">
							&ldquo;A sincronização automática entre reuniões, atas inteligentes e CRM garante agilidade máxima e precisão em cada planejamento patrimonial.&rdquo;
						</p>
						<div className="pt-2 border-t border-[#002060] flex items-center justify-between text-xs text-slate-400">
							<span className="font-semibold text-white">Robson Vieira Tavernard</span>
							<span>Planejamento Patrimonial</span>
						</div>
					</div>

					<div className="flex items-center space-x-6 text-xs text-slate-400">
						<div className="flex items-center space-x-2">
							<CheckCircle2 className="w-3.5 h-3.5 text-[#0092FF]" />
							<span>Tactiq & Drive</span>
						</div>
						<div className="flex items-center space-x-2">
							<CheckCircle2 className="w-3.5 h-3.5 text-[#0092FF]" />
							<span>Pipedrive CRM</span>
						</div>
						<div className="flex items-center space-x-2">
							<CheckCircle2 className="w-3.5 h-3.5 text-[#0092FF]" />
							<span>Agenda & Bookings</span>
						</div>
					</div>
				</div>
			</div>

			{/* Right Column - Login Form */}
			<div className="relative flex min-h-screen flex-col justify-center items-center px-6 py-12 lg:col-span-7 xl:col-span-6">
				{/* Top background accents */}
				<div
					aria-hidden
					className="absolute inset-0 isolate -z-10 opacity-40 pointer-events-none"
				>
					<div className="absolute top-0 right-0 h-96 w-96 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,146,255,0.15)_0,transparent_70%)]" />
					<div className="absolute bottom-0 left-0 h-96 w-96 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,29,153,0.2)_0,transparent_70%)]" />
				</div>

				<div className="w-full max-w-md space-y-6">
					{/* Mobile Brand Logo */}
					<div className="flex justify-center mb-2 lg:hidden">
						<Logo className="h-10" />
					</div>

					{/* Form Header */}
					<div className="space-y-1 text-center lg:text-left">
						<h1 className="text-2xl font-extrabold text-white tracking-tight font-display">
							Painel Executivo & CRM
						</h1>
						<p className="text-xs text-slate-400">
							Entre com seu e-mail e senha autorizados para acessar o sistema.
						</p>
					</div>

					{/* Error Alert */}
					{error && (
						<div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl text-xs animate-shake">
							{error}
						</div>
					)}

					{/* Form */}
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="space-y-1.5">
							<label className="block text-xs font-semibold text-slate-300 font-display">
								E-mail Corporativo
							</label>
							<div className="relative">
								<Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
								<input
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									className="w-full pl-10 pr-4 py-2.5 bg-[#000D38] border border-[#002060] rounded-xl text-xs text-white placeholder:text-slate-600 focus:ring-2 focus:ring-[#0092FF] focus:border-[#0092FF] outline-none transition-all"
									placeholder="seu.email@exemplo.com"
									required
								/>
							</div>
						</div>

						<div className="space-y-1.5">
							<label className="block text-xs font-semibold text-slate-300 font-display">
								Senha de Acesso
							</label>
							<div className="relative">
								<Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
								<input
									type={showPassword ? "text" : "password"}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									className="w-full pl-10 pr-10 py-2.5 bg-[#000D38] border border-[#002060] rounded-xl text-xs text-white placeholder:text-slate-600 focus:ring-2 focus:ring-[#0092FF] focus:border-[#0092FF] outline-none transition-all"
									placeholder="••••••••"
									required
								/>
								<button
									type="button"
									onClick={() => setShowPassword(!showPassword)}
									className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
								>
									{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
								</button>
							</div>
						</div>

						<button
							type="submit"
							disabled={loading}
							className="w-full mt-2 bg-[#0092FF] hover:bg-[#007AFF] text-white py-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-md shadow-[#0092FF]/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
						>
							<span>{loading ? "Autenticando..." : "Entrar no Sistema"}</span>
							{!loading && <ArrowRight className="w-4 h-4" />}
						</button>
					</form>

					{/* Access notice */}
					<div className="pt-4 border-t border-[#002060] text-center">
						<p className="text-[11px] text-slate-400 leading-relaxed">
							🔒 <span className="font-semibold text-slate-300">Acesso Restrito e Autorizado.</span>
							<br />
							A criação de novas contas é gerenciada exclusivamente pelo administrador.
						</p>
					</div>

					{/* Security badge */}
					<div className="flex items-center justify-center space-x-1.5 text-[11px] text-slate-400">
						<ShieldCheck className="w-3.5 h-3.5 text-[#0092FF]" />
						<span>Ambiente seguro protegido por criptografia de ponta a ponta</span>
					</div>
				</div>
			</div>
		</main>
	);
}
