import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { installFaviconRuntime, isSignalDocsPath } from "./favicon-runtime";

type Listener = () => void;

class FakeLink {
  className = "";
  href = "";
  rel = "";
  sizes = "";
  type = "";

  private readonly attributes = new Map<string, string>();

  constructor(private readonly onRemove: () => void) {}

  readonly classList = {
    add: (className: string) => {
      this.className = className;
    },
  };

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  remove() {
    this.onRemove();
  }
}

function createBrowser(pathname: string) {
  const links: FakeLink[] = [];
  const eventListeners = new Map<string, Listener[]>();
  const mediaListeners: Listener[] = [];
  const mutationObservers: Array<{ listener: Listener; target: object }> = [];
  const mediaQuery = {
    matches: false,
    addEventListener: (_event: string, listener: Listener) => {
      mediaListeners.push(listener);
    },
  };

  const head = {
    append: (...appendedLinks: FakeLink[]) => {
      appendedLinks.forEach((link) => {
        const existingIndex = links.indexOf(link);
        if (existingIndex !== -1) links.splice(existingIndex, 1);
        links.push(link);
      });
    },
    querySelectorAll: (selector: string) => {
      const excludesManaged = selector.includes(
        ":not(.js-site-favicon)",
      );
      return links.filter((link) => {
        const isIcon = link.rel.split(" ").includes("icon");
        const isManaged = link.className
          .split(" ")
          .includes("js-site-favicon");
        return isIcon && (!excludesManaged || !isManaged);
      });
    },
  };

  const body = {};
  const document = {
    body,
    createElement: () => {
      const link = new FakeLink(() => {
        const index = links.indexOf(link);
        if (index !== -1) links.splice(index, 1);
      });
      return link;
    },
    head,
    querySelector: (selector: string) => {
      const type = selector.includes('type="image/svg+xml"')
        ? "image/svg+xml"
        : "image/png";
      return (
        links.find(
          (link) =>
            link.type === type &&
            link.className.split(" ").includes("js-site-favicon"),
        ) ?? null
      );
    },
  };

  const location = { pathname };
  const updatePath = (url?: string | URL | null) => {
    if (url) {
      location.pathname = new URL(
        url,
        "https://docs.apollodeploy.com",
      ).pathname;
    }
  };
  const history = {
    pushState: (_data: unknown, _unused: string, url?: string | URL | null) => {
      updatePath(url);
    },
    replaceState: (
      _data: unknown,
      _unused: string,
      url?: string | URL | null,
    ) => {
      updatePath(url);
    },
  };

  class FakeMutationObserver {
    constructor(private readonly listener: Listener) {}

    observe(target: object) {
      mutationObservers.push({ listener: this.listener, target });
    }
  }

  const window = {
    addEventListener: (event: string, listener: Listener) => {
      eventListeners.set(event, [
        ...(eventListeners.get(event) ?? []),
        listener,
      ]);
    },
    history,
    location,
    matchMedia: () => mediaQuery,
  };

  return {
    addFrameworkFavicon: () => {
      const link = document.createElement();
      link.rel = "icon";
      link.type = "image/png";
      link.href = "/favicons/favicon-32x32.png";
      head.append(link);
      return link;
    },
    document,
    history,
    links,
    mediaListeners,
    mediaQuery,
    MutationObserver: FakeMutationObserver,
    notifyMutation: (target: object) => {
      mutationObservers
        .filter((observer) => observer.target === target)
        .forEach((observer) => observer.listener());
    },
    setPath: updatePath,
    window,
  };
}

function getManagedLink(links: FakeLink[], type: string) {
  return links.find(
    (link) =>
      link.type === type &&
      link.className.split(" ").includes("js-site-favicon"),
  );
}

const originalGlobals = {
  document: globalThis.document,
  history: globalThis.history,
  location: globalThis.location,
  MutationObserver: globalThis.MutationObserver,
  window: globalThis.window,
};

const docsConfig = JSON.parse(
  readFileSync(new URL("../docs.json", import.meta.url), "utf8"),
) as { favicon?: unknown };

afterEach(() => {
  Object.assign(globalThis, originalGlobals);
});

describe("initial page favicon", () => {
  test("server-renders Signal artwork before the runtime starts", () => {
    expect(docsConfig.favicon).toEqual({
      light: "/favicons/signal/favicon.png",
      dark: "/favicons/signal/favicon-dark.png",
    });
  });
});

describe("isSignalDocsPath", () => {
  test.each([
    "/signal",
    "/signal/",
    "/signal/api-reference/emails/send-email",
  ])("recognizes Signal documentation at %s", (pathname) => {
    expect(isSignalDocsPath(pathname)).toBe(true);
  });

  test.each(["/", "/deploy", "/packages", "/signal-processing"])(
    "does not match non-Signal documentation at %s",
    (pathname) => {
      expect(isSignalDocsPath(pathname)).toBe(false);
    },
  );
});

describe("installFaviconRuntime", () => {
  test("does not replace the framework's History API methods", () => {
    const browser = createBrowser("/signal/quickstart");
    const originalPushState = browser.history.pushState;
    const originalReplaceState = browser.history.replaceState;
    Object.assign(globalThis, browser);

    installFaviconRuntime();

    expect(browser.history.pushState).toBe(originalPushState);
    expect(browser.history.replaceState).toBe(originalReplaceState);
  });

  test("preserves framework-owned favicon metadata", () => {
    const browser = createBrowser("/signal/quickstart");
    const frameworkFavicon = browser.addFrameworkFavicon();
    Object.assign(globalThis, browser);

    installFaviconRuntime();

    expect(browser.links).toContain(frameworkFavicon);
    expect(frameworkFavicon.href).toBe("/favicons/favicon-32x32.png");
  });

  test("updates the favicon after one client-side navigation", async () => {
    const browser = createBrowser("/signal/quickstart");
    Object.assign(globalThis, browser);

    installFaviconRuntime();

    expect(getManagedLink(browser.links, "image/svg+xml")?.href).toBe(
      "/favicons/signal/favicon.svg",
    );
    expect(getManagedLink(browser.links, "image/png")?.href).toBe(
      "/favicons/signal/favicon.png",
    );

    browser.setPath("/deploy");
    browser.notifyMutation(browser.document.body);
    await Promise.resolve();

    expect(getManagedLink(browser.links, "image/svg+xml")?.href).toBe(
      "/favicon.svg",
    );
    expect(getManagedLink(browser.links, "image/png")?.href).toBe(
      "/favicon.png",
    );

    browser.setPath("/signal/knowledge-base");
    browser.notifyMutation(browser.document.body);
    await Promise.resolve();

    expect(getManagedLink(browser.links, "image/svg+xml")?.href).toBe(
      "/favicons/signal/favicon.svg",
    );
  });

  test("keeps the Signal favicon synchronized with the system theme", () => {
    const browser = createBrowser("/signal");
    Object.assign(globalThis, browser);

    installFaviconRuntime();
    browser.mediaQuery.matches = true;
    browser.mediaListeners.forEach((listener) => listener());

    expect(getManagedLink(browser.links, "image/svg+xml")?.href).toBe(
      "/favicons/signal/favicon-dark.svg",
    );
    expect(getManagedLink(browser.links, "image/png")?.href).toBe(
      "/favicons/signal/favicon-dark.png",
    );
  });
});
