import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LedgerProvider } from "@/components/providers/LedgerProvider";
import { AccountingSessionProvider } from "@/components/providers/AccountingSessionProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LedgerAI | Financial Intelligence",
  description: "Understand your financial data with LedgerAI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LedgerProvider>
          <AccountingSessionProvider>{children}</AccountingSessionProvider>
        </LedgerProvider>
      </body>
    </html>
  );
}
