import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("static demo", () => {
  it("renders fictional sample purchases without making API requests", () => {
    const fetchMock = vi.fn();
    vi.stubEnv("VITE_STATIC_DEMO", "true");
    vi.stubGlobal("fetch", fetchMock);

    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Fictional sample data");
    expect(markup).toContain("20V Cordless Drill");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
