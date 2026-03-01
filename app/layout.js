export const metadata = { title: "Life OS", description: "Personal dashboard" };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0A0A0A" }}>{children}</body>
    </html>
  );
}
