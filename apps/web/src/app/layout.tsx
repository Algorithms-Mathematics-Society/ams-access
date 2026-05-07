import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AMS Access",
  description: "Exam monitoring system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
