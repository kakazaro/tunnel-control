import { describe, expect, it } from "vitest";
import { clockTime, formatUptime, relativeTime } from "../../src/client/lib/format";

describe("relativeTime", () => {
  it.each([
    [0, "0s ago"],
    [12_000, "12s ago"],
    [59_000, "59s ago"],
    [60_000, "1m ago"],
    [3_599_000, "59m ago"],
    [3_600_000, "1h ago"],
    [47 * 3_600_000, "47h ago"],
    [72 * 3_600_000, "3d ago"],
  ])("%i ms -> %s", (ms, text) => {
    expect(relativeTime(1_000_000, 1_000_000 + ms)).toBe(text);
  });

  it("never goes negative when the clock is behind", () => {
    expect(relativeTime(2_000, 1_000)).toBe("0s ago");
  });
});

describe("formatUptime", () => {
  it("formats HH:MM:SS", () => {
    expect(formatUptime(0)).toBe("00:00:00");
    expect(formatUptime(754_000)).toBe("00:12:34");
    expect(formatUptime(3_661_000)).toBe("01:01:01");
    expect(formatUptime(100 * 3_600_000)).toBe("100:00:00");
    expect(formatUptime(-5)).toBe("00:00:00");
  });
});

describe("clockTime", () => {
  it("formats HH:mm:ss - DD MMM YYYY in local time", () => {
    const at = new Date(2026, 9, 30, 8, 5, 9).getTime();
    expect(clockTime(at)).toBe("08:05:09 - 30 Oct 2026");
  });
});
