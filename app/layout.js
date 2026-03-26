import "@/components/theme/theme.css";

export const metadata = {
  title: "Day Lab",
  description: "Your personal health and life dashboard.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Day Lab",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  verification: { google: "PASTE_YOUR_VERIFICATION_CODE_HERE" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#141412",
  viewportFit: "cover",
};

// This script runs synchronously before any paint — zero flash possible.
const THEME_SCRIPT = `(function(){
  try {
    var pref = localStorage.getItem("theme") || "auto";
    var t = pref;
    if (pref === "auto") {
      var h = new Date().getHours();
      t = (h >= 6 && h < 19) ? "light" : "dark";
    }
    var bg = t === "light" ? "#F4F1EC" : "#131211";
    var el = document.documentElement;
    el.style.setProperty("background", bg, "important");
    el.style.setProperty("background-color", bg, "important");
    el.setAttribute("data-theme", t);
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
        {/* PWA: iOS full-screen / status bar behavior */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Day Lab" />
        <style dangerouslySetInnerHTML={{ __html: `
          html, body { margin: 0; padding: 0; }
          html[data-theme="light"], html[data-theme="light"] body { background-color: #F4F1EC !important; }
          html[data-theme="dark"], html[data-theme="dark"] body { background-color: #131211 !important; }
          html:not([data-theme]) body { background-color: #131211 !important; }
        `}} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body style={{ margin: 0 }} suppressHydrationWarning>{children}</body>
    </html>
  );
}
