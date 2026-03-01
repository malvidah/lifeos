export const metadata = { title: "Life OS", description: "Personal dashboard" };
export const viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0A0A0A" }}>{children}</body>
    </html>
  );
}
