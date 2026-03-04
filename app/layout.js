export const metadata = {
  title: "Day Lab",
  description: "Your personal health and life dashboard.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/favicon.png", sizes: "1024x1024", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  verification: { google: "PASTE_YOUR_VERIFICATION_CODE_HERE" },
};
export const viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

// This script runs synchronously before any paint — zero flash possible.
// Sets bg on both <html> and <body>, and adds a data-theme attribute
// so CSS can also target it if needed.
const THEME_SCRIPT = `(function(){
  try {
    var t = localStorage.getItem("theme") || "dark";
    var bg = t === "light" ? "#D4CCB8" : "#141412";
    var el = document.documentElement;
    el.style.setProperty("background", bg, "important");
    el.style.setProperty("background-color", bg, "important");
    el.setAttribute("data-theme", t);
    // Also set body if already available (rare but safe)
    if (document.body) {
      document.body.style.setProperty("background", bg, "important");
      document.body.style.setProperty("background-color", bg, "important");
    }
  } catch(e) {}
})()`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `
          html, body { margin: 0; padding: 0; }
          html[data-theme="light"], html[data-theme="light"] body { background: #D4CCB8 !important; }
          html[data-theme="dark"], html[data-theme="dark"] body { background: #141412 !important; }
          html:not([data-theme]) body { background: #141412 !important; }
        `}} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body style={{ margin: 0 }} suppressHydrationWarning>{children}</body>
    </html>
  );
}
