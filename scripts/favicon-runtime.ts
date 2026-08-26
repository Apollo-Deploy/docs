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

  document.head.append(link);
}

function ensureManagedFavicons() {
  document.head
    .querySelectorAll<HTMLLinkElement>(
      `link[rel~="icon"]:not(.${MANAGED_FAVICON_CLASS})`,
    )
    .forEach((link) => link.remove());

  if (
    !document.querySelector<HTMLLinkElement>(
      `.${MANAGED_FAVICON_CLASS}[type="image/svg+xml"]`,
    )
  ) {
    createManagedFavicon("image/svg+xml");
  }

  if (
    !document.querySelector<HTMLLinkElement>(
      `.${MANAGED_FAVICON_CLASS}[type="image/png"]`,
    )
  ) {
    createManagedFavicon("image/png");
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
  const scheduleUpdate = () => {
    if (updateScheduled) return;
    updateScheduled = true;
    queueMicrotask(() => {
      updateScheduled = false;
      updateFaviconForCurrentDocument();
    });
  };

  const originalPushState = window.history.pushState;
  window.history.pushState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    originalPushState.call(this, data, unused, url);
    scheduleUpdate();
  };

  const originalReplaceState = window.history.replaceState;
  window.history.replaceState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    originalReplaceState.call(this, data, unused, url);
    scheduleUpdate();
  };

  window.addEventListener("popstate", scheduleUpdate);

  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  colorScheme.addEventListener("change", () => {
    ensureManagedFavicons();
    syncFaviconToTheme();
  });

  const headObserver = new MutationObserver(scheduleUpdate);
  headObserver.observe(document.head, { childList: true });

  updateFaviconForCurrentDocument();
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
