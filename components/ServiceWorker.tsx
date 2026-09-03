"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the app work offline.
 *
 * Renders nothing. It exists as a component only because registration needs to
 * happen in the browser and the layout around it is a server component.
 *
 * Not registered in development: a worker intercepting every request while
 * Next is hot-reloading serves confusing results, and the thing being
 * developed is almost never the offline path. The test suite runs against a
 * production build, so it exercises the same path a visitor gets.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // After load rather than during it: registration competes with the
    // page's own requests for the connection, and nothing on the first
    // visit depends on the worker being there.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs the offline path and nothing else, so
        // there is nothing here worth showing a visitor.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
