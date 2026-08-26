import { AuthPage } from "@/components/auth-page";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Preview Novo Login — @efferd/auth-5",
  description: "Página de visualização e teste do novo design de autenticação",
};

export default function LoginPreviewPage() {
  return <AuthPage />;
}
