// Local fixture derived from the reference Muse web-session client.
// Control and stats routes are test-only; no production credentials belong here.
const http = require("http");
async function body(req) {
  if (req.body) return req.body;
  let text = "";
  for await (const part of req) text += part;
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}
function json(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}
http
  .createServer(async (req, res) => {
    const path = new URL(req.url, "http://fixture").pathname;
    if (path === "/__control" && req.method === "POST") {
      await pm.state.set("muse.mode", (await body(req)).mode || "healthy");
      await pm.state.set("muse.running", false);
      return json(res, 200, { ok: true });
    }
    if (path === "/__stats")
      return json(res, 200, (await pm.state.get("muse.calls")) || []);
    const mode = (await pm.state.get("muse.mode")) || "healthy";
    const calls = (await pm.state.get("muse.calls")) || [];
    calls.push({
      method: req.method,
      path,
      hasSession: (req.headers.cookie || "").includes("hatch_sess="),
    });
    await pm.state.set("muse.calls", calls);
    if (path === "/api/session") {
      if (mode === "timeout")
        await new Promise((resolve) => setTimeout(resolve, 1500));
      if (mode === "invalid")
        return json(res, 401, { error: "fixture unauthorized" });
      if (mode === "forbidden") return json(res, 403, {});
      if (mode === "rate-limit") return json(res, 429, {});
      if (mode === "html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("Unavailable");
      }
      return json(
        res,
        200,
        {
          status: "assigned",
          vm_id: "fixture-vm",
          vm_state: (await pm.state.get("muse.running"))
            ? "RUNNING"
            : "STOPPED",
        },
        {
          "Set-Cookie":
            "hatch_vml=fixture-rotated-workspace; Max-Age=172800; Path=/; HttpOnly",
        },
      );
    }
    if (path === "/api/hatch/vm/wake" && req.method === "POST") {
      const values = await body(req);
      if (values.vm_id !== "fixture-vm" || !values.connect_attempt_id)
        return json(res, 400, {});
      await pm.state.set("muse.running", mode !== "wake-pending");
      return json(res, 200, {});
    }
    if (path === "/thread/new") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(`<!doctype html><html><body>
      <button data-testid="hatch-dock-more" onclick="document.getElementById('menu').style.display='block'">Settings</button>
      <div id="menu" role="menu" style="display:none"><button role="menuitem" onclick="document.getElementById('usage').style.display='block'">Settings</button></div>
      <div id="usage" role="dialog" style="display:none"><h2>Settings</h2><h3>Usage</h3><p>Free plan</p><p>Weekly limit resets on Monday</p><p>${mode === "bad-quota" ? "Usage unavailable" : "37% used"}</p><p>Additional tokens</p><p>Never expires</p><p>0% used (2B tokens left)</p><h3>Language</h3></div>
      </body></html>`);
    }
    json(res, 501, { error: "This fixture does not model this endpoint." });
  })
  .listen(process.env.PORT || 4500);
