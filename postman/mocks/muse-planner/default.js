// Test-only composer page. It does not generate content through a real model.
const http = require("http");
async function body(req) {
  if (req.body) return req.body;
  let text = "";
  for await (const p of req) text += p;
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}
function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
http
  .createServer(async (req, res) => {
    const path = new URL(req.url, "http://fixture").pathname;
    if (path === "/__control" && req.method === "POST") {
      await pm.state.set("planner.mode", (await body(req)).mode || "healthy");
      await pm.state.set("planner.sent", 0);
      return json(res, 200, { ok: true });
    }
    if (path === "/__submitted" && req.method === "POST") {
      await pm.state.set(
        "planner.sent",
        ((await pm.state.get("planner.sent")) || 0) + 1,
      );
      return json(res, 200, { ok: true });
    }
    if (path === "/__stats")
      return json(res, 200, {
        sent: (await pm.state.get("planner.sent")) || 0,
      });
    if (path === "/api/session")
      return json(res, 200, {
        status: "assigned",
        vm_id: "fixture-vm",
        vm_state: "RUNNING",
      });
    if (path === "/api/hatch/vm/wake") return json(res, 200, {});
    if (path === "/thread/new") {
      const mode = (await pm.state.get("planner.mode")) || "healthy";
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
      });
      return res.end(`<!doctype html><html><body><main><form onsubmit="event.preventDefault();send()"><textarea aria-label="Message"></textarea><button type="submit" data-testid="hatch-composer-send-button">Send</button></form></main><script>
      function send(){
        const ta=document.querySelector('textarea');const prompt=ta.value;if(!prompt)return;ta.value='';
        const stop=document.createElement('button');stop.dataset.testid='hatch-composer-stop-button';stop.textContent='Stop';document.body.append(stop);
        fetch(location.pathname.replace(/\\/thread\\/new$/,'')+'/__submitted',{method:'POST'});
        setTimeout(()=>{
          const match=prompt.match(/from 1: (\\[[^\\]]+\\])/);const times=match?JSON.parse(match[1]):[10];
          const script={characterBible:'A farmer in a blue jacket.',visualStyle:'Warm morning light.',scenes:times.map((seconds,index)=>({number:index+1,title:'Morning scene '+(index+1),prompt:'A farmer walks through misty coffee hills at sunrise.',durationSeconds:seconds,narration:''}))};
          const bubble=document.createElement('div');bubble.className='hatch-chat-groupable-bubble hatch-agent-bubble-bg';bubble.textContent=${JSON.stringify(mode)}==='invalid'?'Incomplete response':JSON.stringify(script);document.querySelector('main').append(bubble);stop.remove();
        },${mode === "slow" ? 8000 : 300});
      }
    </script></body></html>`);
    }
    json(res, 501, { error: "Endpoint not modeled by this fixture" });
  })
  .listen(process.env.PORT || 4500);
