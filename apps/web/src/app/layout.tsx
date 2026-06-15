import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Company Brain",
  description:
    "Ask your company's knowledge questions in plain English — instant, cited, permission-aware answers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
