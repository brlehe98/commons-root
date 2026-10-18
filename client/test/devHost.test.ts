import { describe, expect, it } from "vitest";
import { fixDevHostImageUrl } from "../src/devHost";

describe("fixDevHostImageUrl", () => {
  it("moves the resolution inside the query the dev host reads", () => {
    expect(fixDevHostImageUrl("http://localhost:8081/asset?query=root://asset/AB-c_d&resolution=large")).toBe(
      "http://localhost:8081/asset?query=" + encodeURIComponent("root://asset/AB-c_d?resolution=large"),
    );
  });

  it("leaves other addresses alone", () => {
    const url = "https://cdn.rootapp.com/assets/abc.png?w=512";
    expect(fixDevHostImageUrl(url)).toBe(url);
  });
});
