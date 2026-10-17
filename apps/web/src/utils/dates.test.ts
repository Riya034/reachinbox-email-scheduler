import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toIsoFromLocalDateTime } from "./dates.js";

describe("toIsoFromLocalDateTime", () => {
  it("parses datetime-local as local wall time", () => {
    const local = "2026-10-17T04:24";
    const iso = toIsoFromLocalDateTime(local);
    const back = new Date(iso);
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(back);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    assert.equal(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`, local);
  });
});
