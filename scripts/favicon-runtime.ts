import {
  syncFaviconToTheme,
  updateFaviconByHref,
} from "@apollo-deploy/core/favicon";

const APOLLO_FAVICON_HREF = "/favicon.svg";
const SIGNAL_FAVICON_HREF = "/favicons/signal/favicon.svg";
const MANAGED_FAVICON_CLASS = "js-site-favicon";

declare global {
  interface Window {
    __apolloDocsFaviconRuntimeInstalled?: boolean;
  }
}

export function isSignalDocsPath(pathname: string) {
  return pathname === "/signal" || pathname.startsWith("/signal/");
}

function createManagedFavicon(type: "image/svg+xml" | "image/png") {
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = type;
  link.classList.add(MANAGED_FAVICON_CLASS);

  if (type === "image/svg+xml") {
    link.href = APOLLO_FAVICON_HREF;
    link.setAttribute("data-base-href", "/favicon");
  } else {
    link.href = "/favicon.png";
    link.setAttribute("sizes", "32x32");
  }

  return link;
}

function getManagedFavicon(type: "image/svg+xml" | "image/png") {
  return document.querySelector<HTMLLinkElement>(
    `.${MANAGED_FAVICON_CLASS}[type="${type}"]`,
  );
}

function ensureManagedFavicons() {
  const svgFavicon =
    getManagedFavicon("image/svg+xml") ??
    createManagedFavicon("image/svg+xml");
  const pngFavicon =
    getManagedFavicon("image/png") ?? createManagedFavicon("image/png");
  const faviconLinks = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
  );
  const managedFaviconsAreLast =
    faviconLinks[faviconLinks.length - 2] === svgFavicon &&
    faviconLinks[faviconLinks.length - 1] === pngFavicon;

  if (!managedFaviconsAreLast) {
    document.head.append(svgFavicon, pngFavicon);
  }
}

function updateFaviconForCurrentDocument() {
  ensureManagedFavicons();
  updateFaviconByHref(
    isSignalDocsPath(window.location.pathname)
      ? SIGNAL_FAVICON_HREF
      : APOLLO_FAVICON_HREF,
  );
}

export function installFaviconRuntime() {
  if (window.__apolloDocsFaviconRuntimeInstalled) return;
  window.__apolloDocsFaviconRuntimeInstalled = true;

  let updateScheduled = false;
  let currentPathname = window.location.pathname;
  const applyCurrentFavicon = () => {
    updateFaviconForCurrentDocument();
    currentPathname = window.location.pathname;
  };
  const scheduleUpdate = () => {
    if (updateScheduled) return;
    updateScheduled = true;
    queueMicrotask(() => {
      updateScheduled = false;
      applyCurrentFavicon();
    });
  };

  const scheduleUpdateAfterNavigation = () => {
    if (window.location.pathname !== currentPathname) scheduleUpdate();
  };

  window.addEventListener("popstate", scheduleUpdate);

  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  colorScheme.addEventListener("change", () => {
    ensureManagedFavicons();
    syncFaviconToTheme();
  });

  const headObserver = new MutationObserver(scheduleUpdate);
  headObserver.observe(document.head, { childList: true });

  if (document.body) {
    const pageObserver = new MutationObserver(scheduleUpdateAfterNavigation);
    pageObserver.observe(document.body, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  applyCurrentFavicon();
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installFaviconRuntime, {
      once: true,
    });
  } else {
    installFaviconRuntime();
  }
}
