export const metadata = { title: "Life OS", description: "Personal dashboard" };
export const viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

// Blocking script — runs synchronously before paint, so no flash ever
const themeScript = `
  (function(){
    var t = localStorage.getItem("theme") || "dark";
    var bg = t === "light" ? "#EFEBE4" : "#0D0D0F";
    document.documentElement.style.background = bg;
    document.body && (document.body.style.background = bg);
  })()
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
