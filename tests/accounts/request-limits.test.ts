import assert from "node:assert/strict";
import { test } from "node:test";
import { requestPolicy } from "../../src/lib/server/rate-limit";
test("Run controls retain ordinary mutation capacity after admissions are exhausted", () => {
  const request = (path: string, method = "POST") =>
    new Request("https://fixture.invalid" + path, { method });
  assert.equal(requestPolicy(request("/api/runs")), "admission");
  assert.equal(
    requestPolicy(request("/api/runs/" + "a".repeat(64))),
    "mutation",
  );
  assert.equal(
    requestPolicy(request("/api/runs/" + "a".repeat(64), "GET")),
    "read",
  );
  assert.equal(requestPolicy(request("/api/files")), "upload");
  const upload = "/api/files/uploads/" + "a".repeat(64);
  assert.equal(requestPolicy(request("/api/files/uploads")), "upload");
  assert.equal(requestPolicy(request(upload + "/parts/12", "PUT")), "part");
  assert.equal(requestPolicy(request(upload + "/complete")), "mutation");
  assert.equal(requestPolicy(request(upload + "/parts/x", "PUT")), "mutation");
  assert.equal(
    requestPolicy(request("/api/files/" + "a".repeat(64), "DELETE")),
    "mutation",
  );
});
