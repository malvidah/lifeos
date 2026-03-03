export const metadata = { title: "Day Loop", description: "Your AI dashboard" };
export const viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

// This script runs synchronously before any paint — zero flash possible.
// Sets bg on both <html> and <body>, and adds a data-theme attribute
// so CSS can also target it if needed.
const THEME_SCRIPT = `(function(){
  try {
    var t = localStorage.getItem("theme") || "dark";
    var bg = t === "light" ? "#EFEBE4" : "#0A0A0A";
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
          html[data-theme="light"], html[data-theme="light"] body { background: #EFEBE4 !important; }
          html[data-theme="dark"], html[data-theme="dark"] body { background: #0A0A0A !important; }
          html:not([data-theme]) body { background: #0A0A0A !important; }
        `}} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body style={{ margin: 0 }} suppressHydrationWarning>{children}</body>
    </html>
  );
}
