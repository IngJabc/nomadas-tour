import type { Metadata } from "next";
import { Poppins, Montserrat } from "next/font/google";
import { Navbar } from "@/components/ui/Navbar";
import { Toaster } from "react-hot-toast";
import "./globals.css";
import "./design-tokens.css";

const poppins = Poppins({
  // reuse the existing CSS variable name to keep globals.css unchanged
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const montserrat = Montserrat({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["700", "800"],
});

export const metadata: Metadata = {
  title: "Nómadas Tours | Dejando huellas por Venezuela",
  description:
    "Sistema de selección y reserva de asientos de autobús en tiempo real",
  icons: {
    icon: "/brand/logo-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${poppins.variable} ${montserrat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-brand-surface text-brand-navy">
        {/* Global navbar */}
        <Navbar />
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 4000,
            style: {
              borderRadius: "12px",
              padding: "12px 16px",
              fontSize: "14px",
              background: "var(--color-brand-navy)",
              color: "var(--color-brand-surface)",
            },
            success: {
              iconTheme: {
                primary: "var(--color-brand-cyan)",
                secondary: "var(--color-brand-surface)",
              },
            },
            error: {
              iconTheme: {
                primary: "#fb923c",
                secondary: "var(--color-brand-surface)",
              },
            },
          }}
        />
      </body>
    </html>
  );
}
