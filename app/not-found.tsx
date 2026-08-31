import type { Metadata } from "next";
import { NotFoundContent } from "@/components/ui/NotFoundContent";

export const metadata: Metadata = {
  title: "Página no encontrada | Nómadas Tours",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return <NotFoundContent />;
}
