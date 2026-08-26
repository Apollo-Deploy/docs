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
  const mediaQuery = {
    matches: false,
    addEventListener: (_event: string, listener: Listener) => {
      mediaListeners.push(listener);
    },
  };

  const head = {
    append: (link: FakeLink) => {
      links.push(link);
    },
    querySelectorAll: () =>
      links.filter(
        (link) =>
          link.rel.split(" ").includes("icon") &&
          !link.className.split(" ").includes("js-site-favicon"),
      ),
  };

  const document = {
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
    constructor(_listener: Listener) {}
    observe() {}
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
    document,
    history,
    links,
    mediaListeners,
    mediaQuery,
    MutationObserver: FakeMutationObserver,
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
  test("updates the favicon when product navigation changes the route", async () => {
    const browser = createBrowser("/signal/quickstart");
    Object.assign(globalThis, browser);

    installFaviconRuntime();

    expect(getManagedLink(browser.links, "image/svg+xml")?.href).toBe(
      "/favicons/signal/favicon.svg",
    );
    expect(getManagedLink(browser.links, "image/png")?.href).toBe(
      "/favicons/signal/favicon.png",
    );

    browser.history.pushState({}, "", "/deploy");
    await Promise.resolve();

    expect(getManagedLink(browser.links, "image/svg+xml")?.href).toBe(
      "/favicon.svg",
    );
    expect(getManagedLink(browser.links, "image/png")?.href).toBe(
      "/favicon.png",
    );

    browser.history.replaceState({}, "", "/signal/knowledge-base");
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
