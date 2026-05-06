import type { ReactNode } from "react";

export const metadata = {
  title: "Cruce Chile MCP — demo",
  description: "Placeholder UI; cliente del MCP server interno.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#0b0d10",
          color: "#e6e8eb",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
