import { useState, useEffect, useRef } from "react";

function ror(x, n) { return ((x >>> n) | (x << (32 - n))) | 0; }

function sha256(data) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H0 = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const b = [...new TextEncoder().encode(data)];
  const bl = b.length * 8;
  b.push(0x80);
  while ((b.length * 8) % 512 !== 448) b.push(0);
  for (let i = 0; i < 8; i++) b.push((bl >>> (56 - i * 8)) & 0xff);
  const w = [];
  for (let i = 0; i < b.length; i += 4) w.push((b[i]<<24)|(b[i+1]<<16)|(b[i+2]<<8)|b[i+3]);
  let H = [...H0];
  for (let i = 0; i < w.length; i += 16) {
    const W = w.slice(i, i + 16);
    for (let t = 16; t < 64; t++) {
      const s0 = ror(W[t-15],7)^ror(W[t-15],18)^(W[t-15]>>>3);
      const s1 = ror(W[t-2],17)^ror(W[t-2],19)^(W[t-2]>>>10);
      W[t] = (W[t-16] + s0 + W[t-7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = ror(e,6)^ror(e,11)^ror(e,25);
      const ch = (e&f)^(~e&g);
      const t1 = (h+S1+ch+K[t]+W[t])|0;
      const S0 = ror(a,2)^ror(a,13)^ror(a,22);
      const maj = (a&b)^(a&c)^(b&c);
      const t2 = (S0+maj)|0;
      h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
    }
    H = H.map((v,j)=>(v+[a,b,c,d,e,f,g,h][j])|0);
  }
  return H.map(v=>("00000000"+(v>>>0).toString(16)).slice(-8)).join("");
}

function hashFull(s) { return "0x" + sha256(s).toUpperCase(); }

function appendBlock(chain, data) {
  const prev = chain[chain.length - 1];
  const prevHash = prev ? prev.hash : "0000000000000000000000000000000000000000000000000000000000000000";
  const blockTime = data.time || nowStr();
  const raw = prevHash + data.event + (data.actor || "") + (data.shipmentId || "") + (data.item || "") + blockTime;
  return [...chain, { ...data, hash: hashFull(raw), previousHash: prevHash, time: blockTime, block: chain.length + 1 }];
}

function verifyChain(chain) {
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i];
    const p = chain[i - 1];
    const eph = p ? p.hash : "0000000000000000000000000000000000000000000000000000000000000000";
    if (b.previousHash !== eph) return { valid: false, at: b.block, reason: "previousHash link broken" };
    const raw = b.previousHash + b.event + (b.actor || "") + (b.shipmentId || "") + (b.item || "") + b.time;
    if (b.hash !== hashFull(raw)) return { valid: false, at: b.block, reason: "data tampered — hash mismatch" };
  }
  return { valid: true, blocks: chain.length };
}

function nowStr() { return new Date().toLocaleTimeString("en-IN", { hour12: false }); }
function nowISO() { return new Date().toISOString(); }

function hashPassword(pw) { return sha256("SANGAM-SALT-" + pw); }

const USERS = {
  CMD_VERMA:  { uid: "SEND-001", role: "sender",   name: "Col. R.K. Verma",  base: "Pathankot Supply Depot",    avatar: "V", password: hashPassword("SENDER001"), _plain: "SENDER001" },
  CMD_SINGH:  { uid: "SEND-002", role: "sender",   name: "Maj. P. Singh",    base: "Chandigarh Ordnance Depot", avatar: "S", password: hashPassword("SENDER002"), _plain: "SENDER002" },
  FWD_KAPOOR: { uid: "RECV-001", role: "receiver", name: "Capt. A. Kapoor",  base: "Siachen Forward Post",      avatar: "K", password: hashPassword("RECV001"),  _plain: "RECV001" },
  FWD_YADAV:  { uid: "RECV-002", role: "receiver", name: "Lt. S. Yadav",     base: "Ladakh Border Post",        avatar: "Y", password: hashPassword("RECV002"),  _plain: "RECV002" },
  COMMAND_CENTER: { uid: "CMD-CENTER", role: "command", name: "Command Center", base: "Central Operations", avatar: "C", password: hashPassword("CMDCENTER2024"), _plain: "CMDCENTER2024" },
};

const INIT_SHIPMENTS = {
  "SHP-2024-001": {
    id: "SHP-2024-001", sender: "SEND-001", receiver: "RECV-001",
    senderName: "Col. R.K. Verma", receiverName: "Capt. A. Kapoor",
    priority: "CRITICAL", status: "pending",
    items: [
      { id: "ITM-001", name: "Medical Kit Type-A",  qty: 50,   unit: "boxes",  tampered: false, willTamper: false },
      { id: "ITM-002", name: "Ration Pack (5-day)", qty: 200,  unit: "packs",  tampered: false, willTamper: false },
      { id: "ITM-003", name: "Ammunition 5.56mm",   qty: 5000, unit: "rounds", tampered: false, willTamper: true  },
      { id: "ITM-004", name: "Winter Gear Set",     qty: 30,   unit: "sets",   tampered: false, willTamper: false },
    ],
    dispatchTime: null, eta: null, dispatchNote: "",
  },
  "SHP-2024-002": {
    id: "SHP-2024-002", sender: "SEND-002", receiver: "RECV-002",
    senderName: "Maj. P. Singh", receiverName: "Lt. S. Yadav",
    priority: "HIGH", status: "pending",
    items: [
      { id: "ITM-005", name: "Fuel Canisters 20L",  qty: 100, unit: "units", tampered: false, willTamper: false },
      { id: "ITM-006", name: "Communication Radio", qty: 10,  unit: "units", tampered: false, willTamper: false },
      { id: "ITM-007", name: "Anti-tank Missiles",  qty: 20,  unit: "units", tampered: false, willTamper: false },
    ],
    dispatchTime: null, eta: null, dispatchNote: "",
  },
  "SHP-2024-003": {
    id: "SHP-2024-003", sender: "SEND-001", receiver: "RECV-002",
    senderName: "Col. R.K. Verma", receiverName: "Lt. S. Yadav",
    priority: "MEDIUM", status: "pending",
    items: [
      { id: "ITM-008", name: "Thermal Blankets",    qty: 75,  unit: "units", tampered: false, willTamper: false },
      { id: "ITM-009", name: "Water Purification",  qty: 40,  unit: "kits",  tampered: false, willTamper: false },
      { id: "ITM-010", name: "Field Dressing Kit",  qty: 60,  unit: "units", tampered: false, willTamper: true  },
    ],
    dispatchTime: null, eta: null, dispatchNote: "",
  },
};

const MESH_NODES_INIT = [
  { id: "NODE-01", name: "Pathankot Base",     lat: 32.27, lng: 75.65, online: true,  role: "source",  convoy: false, packets: 0, signal: 95 },
  { id: "NODE-02", name: "Jammu Relay",        lat: 32.73, lng: 74.87, online: true,  role: "relay",   convoy: false, packets: 0, signal: 88 },
  { id: "NODE-03", name: "Banihal Tunnel",     lat: 33.40, lng: 75.20, online: false, role: "relay",   convoy: false, packets: 0, signal: 0  },
  { id: "NODE-04", name: "Convoy Truck Alpha", lat: 33.20, lng: 74.84, online: false, role: "convoy",  convoy: true,  packets: 0, signal: 75 },
  { id: "NODE-05", name: "Convoy Truck Bravo", lat: 33.60, lng: 74.82, online: false, role: "convoy",  convoy: true,  packets: 0, signal: 70 },
  { id: "NODE-06", name: "Kargil Waypoint",    lat: 34.55, lng: 76.13, online: true,  role: "relay",   convoy: false, packets: 0, signal: 72 },
  { id: "NODE-07", name: "Siachen Forward",    lat: 35.42, lng: 77.10, online: true,  role: "dest",    convoy: false, packets: 0, signal: 91 },
  { id: "NODE-08", name: "Ladakh Post",        lat: 34.16, lng: 77.58, online: true,  role: "dest",    convoy: false, packets: 0, signal: 85 },
  { id: "NODE-09", name: "Srinagar Hub",       lat: 34.08, lng: 74.80, online: true,  role: "relay",   convoy: false, packets: 0, signal: 79 },
  { id: "NODE-10", name: "Leh Station",        lat: 34.16, lng: 77.20, online: true,  role: "relay",   convoy: false, packets: 0, signal: 66 },
  { id: "NODE-11", name: "Drass Checkpoint",   lat: 34.43, lng: 75.76, online: false, role: "relay",   convoy: false, packets: 0, signal: 0  },
  { id: "NODE-12", name: "Zoji La Pass",       lat: 34.27, lng: 75.47, online: false, role: "relay",   convoy: false, packets: 0, signal: 0  },
];

const GENESIS_DATA = [
  { event:"GENESIS", actor:"SYSTEM", shipmentId:"—", item:"SANGAM v3.0 genesis block — hash chain initialized", valid:true, deliveryConfirmed:false },
  { event:"CHECKPOINT", actor:"NODE-02", shipmentId:"—", item:"Jammu relay checkpoint verified", valid:true, deliveryConfirmed:false },
  { event:"MESH_SYNC", actor:"NODE-03", shipmentId:"—", item:"Offline queue synced — 3 events pushed", valid:true, deliveryConfirmed:false },
];
const INIT_CHAIN = GENESIS_DATA.reduce((c, d) => appendBlock(c, d), []);

const Badge = ({ children, color = "green" }) => {
  const c = { green: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40", red: "bg-red-500/20 text-red-400 border-red-500/40", yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40", blue: "bg-blue-500/20 text-blue-400 border-blue-500/40", gray: "bg-gray-500/20 text-gray-400 border-gray-500/40", orange: "bg-orange-500/20 text-orange-400 border-orange-500/40", purple: "bg-purple-500/20 text-purple-400 border-purple-500/40" };
  return <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${c[color] || c.gray}`}>{children}</span>;
};

const Pulse = ({ color = "green" }) => (
  <span className="relative flex h-2.5 w-2.5 shrink-0">
    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color === "green" ? "bg-emerald-400" : color === "orange" ? "bg-orange-400" : "bg-red-400"}`} />
    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color === "green" ? "bg-emerald-500" : color === "orange" ? "bg-orange-500" : "bg-red-500"}`} />
  </span>
);

function NotificationStack({ notifications, onDismiss }) {
  return (
    <div className="fixed top-16 right-3 z-[9999] flex flex-col gap-2 max-w-xs w-full pointer-events-none">
      {notifications.map(n => (
        <div key={n.id} className={`flex items-start gap-3 p-3 rounded-xl border shadow-2xl backdrop-blur-sm pointer-events-auto ${n.type === "dispatch" ? "bg-blue-950/95 border-blue-500/50" : n.type === "tamper" ? "bg-red-950/95 border-red-500/50" : n.type === "delivery" ? "bg-emerald-950/95 border-emerald-500/50" : "bg-black/95 border-gray-700"}`}>
          <div className="text-lg shrink-0">{n.type === "dispatch" ? "📦" : n.type === "tamper" ? "⚠️" : n.type === "delivery" ? "✅" : "🔔"}</div>
          <div className="flex-1 min-w-0">
            <div className={`text-[10px] font-mono font-bold ${n.type === "dispatch" ? "text-blue-300" : n.type === "tamper" ? "text-red-300" : "text-emerald-300"}`}>{n.title}</div>
            <div className="text-[9px] text-gray-400 font-mono mt-0.5 leading-relaxed">{n.body}</div>
          </div>
          <button onClick={() => onDismiss(n.id)} className="text-gray-600 hover:text-white text-xs ml-1 shrink-0">✕</button>
        </div>
      ))}
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dots, setDots] = useState("");

  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 500);
    return () => clearInterval(t);
  }, []);

  const handleLogin = () => {
    const key = username.trim().toUpperCase();
    const user = USERS[key];
    if (!user || user.password !== hashPassword(password.trim())) { setError("ACCESS DENIED — Invalid credentials"); return; }
    setLoading(true); setError("");
    setTimeout(() => { onLogin({ username: key, ...user }); setLoading(false); }, 1200);
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(rgba(0,255,100,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,100,0.025) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-xl">⛓️</div>
            <div className="text-left">
              <div className="text-xl font-black tracking-[0.25em] text-white font-mono">SANGAM</div>
              <div className="text-[9px] text-emerald-400/60 tracking-[0.3em] font-mono">SUPPLY CHAIN INTEGRITY SYSTEM</div>
            </div>
          </div>
          <div className="text-[9px] text-gray-600 font-mono">PERMISSIONED BLOCKCHAIN • OFFLINE-FIRST • DTN PROTOCOL</div>
          <div className="mt-1 text-[9px] text-emerald-500/40 font-mono">SYSTEM ONLINE{dots}</div>
        </div>
        <div className="bg-black border-2 border-emerald-900/40 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center gap-2 mb-4"><Pulse /><span className="text-[10px] font-mono text-emerald-400 tracking-widest">SECURE AUTHENTICATION PORTAL</span></div>
          <div className="space-y-3">
            <div>
              <label className="block text-[9px] font-mono text-gray-400 mb-1 tracking-widest">PERSONNEL CALLSIGN</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. CMD_VERMA" className="w-full bg-black border border-emerald-900/50 rounded-lg px-3 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-emerald-500/70 placeholder-gray-700 transition-all" />
            </div>
            <div>
              <label className="block text-[9px] font-mono text-gray-400 mb-1 tracking-widest">PASSWORD</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Enter password..." className="w-full bg-black border border-emerald-900/50 rounded-lg px-3 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-emerald-500/70 placeholder-gray-700 transition-all" />
            </div>
            {error && <div className="text-[9px] text-red-400 font-mono bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{error}</div>}
            <button onClick={handleLogin} disabled={loading || !username || !password} className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900/30 disabled:cursor-not-allowed text-white font-mono font-bold text-xs py-2.5 rounded-lg transition-all tracking-widest">
              {loading ? "AUTHENTICATING..." : "AUTHENTICATE & ENTER"}
            </button>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-800/60">
            <div className="text-[9px] font-mono text-gray-500 mb-2 tracking-widest">DEMO ACCOUNTS — CLICK TO AUTOFILL</div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(USERS).map(([k, u]) => (
                <button key={k} onClick={() => { setUsername(k); setPassword(u._plain); }} className="text-left bg-black border border-gray-800 hover:border-emerald-800/60 rounded-lg p-2 transition-all group">
                  <div className="text-[9px] font-mono text-emerald-400/80 group-hover:text-emerald-400 truncate">{k}</div>
                  <div className="text-[8px] text-gray-600 mt-0.5">{u.role.toUpperCase()} • {u.uid}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="text-center mt-3 text-[9px] text-gray-700 font-mono">SANGAM v3.0 • FIRECHAIN BRAHMINS • 🇮🇳 MADE IN INDIA</div>
      </div>
    </div>
  );
}

function MeshTab({ offlineMode, setOfflineMode, chain, setChain, nodes, setNodes, localLog, setLocalLog, routeLedger, setRouteLedger, clearRouteLedger, rotateLedger, pushNotif, shipments, setShipments, convoyShipments, setConvoyShipments, onShipmentDelivered }) {
  const [animPkts, setAnimPkts] = useState([]);
  // ── Per-truck log model ──────────────────────────────────────────────────
  // completedLog  = snapshot of the last finished journey (shown dimmed)
  // activeLog     = events accumulating in the current journey
  // On journey N complete:  completedLog = activeLog snapshot, activeLog = []
  // On journey N+1 complete: completedLog = that journey's snapshot, activeLog = []
  // So completed always shows the most recent finished journey, active shows ongoing.
  const [alphaCompleted, setAlphaCompleted] = useState([]); // last done journey
  const [alphaActive,    setAlphaActive]    = useState([]); // current journey
  const [bravoCompleted, setBravoCompleted] = useState([]);
  const [bravoActive,    setBravoActive]    = useState([]);
  // Derived for display
  const alphaLog = [...alphaCompleted.map(e=>({...e,_done:true})), ...alphaActive];
  const bravoLog = [...bravoCompleted.map(e=>({...e,_done:true})), ...bravoActive];
  // Keep compat aliases so existing setter calls work
  const alphaLapRef = useRef(0);
  const bravoLapRef = useRef(0);
  const [alphaSyncing, setAlphaSyncing] = useState(false);
  const [alphaSyncProg, setAlphaSyncProg] = useState(0);
  const [bravoSyncing, setBravoSyncing] = useState(false);
  const [bravoSyncProg, setBravoSyncProg] = useState(0);
  const tickRef = useRef(0);
  const [svgPositions, setSvgPositions] = useState({});
  const [dragging, setDragging] = useState(null);
  const svgRef = useRef(null);
  // Edges: only between static relay/dest nodes. Convoy trucks are animated separately.
  // Static relay edges — [1,8] Jammu→Srinagar is excluded here (rendered via convoy route overlay instead)
  const EDGES = [[0,1],[8,2],[2,11],[11,10],[10,5],[5,6],[5,9],[9,7],[1,8]]; // [1,8] kept last so convoy overlay renders on top
  // Alpha route: Pathankot→Jammu→Srinagar→Banihal→ZojiLa→Drass→Kargil→Siachen
  const CONVOY_ROUTE_ALPHA = [0, 1, 8, 2, 11, 10, 5, 6];
  // Bravo route: Pathankot→Jammu→Srinagar→Banihal→ZojiLa→Drass→Kargil→LehStation→LadakhPost
  const CONVOY_ROUTE_BRAVO = [0, 1, 8, 2, 11, 10, 5, 9, 7];
  // Keep generic name for shared logic
  const CONVOY_ROUTE = CONVOY_ROUTE_ALPHA;

  const toSVG = (lat, lng) => ({ x: ((lng - 74.5) / (78.0 - 74.5)) * 440 + 30, y: ((35.8 - lat) / (35.8 - 32.0)) * 270 + 20 });
  const getPos = (node) => svgPositions[node.id] || toSVG(node.lat, node.lng);

  // Convoy progress — paused when awaiting new shipment assignment
  const [alphaProgress, setAlphaProgress] = useState(0);
  const [bravoProgress, setBravoProgress] = useState(0);
  const [alphaPaused, setAlphaPaused] = useState(true);   // starts paused, needs shipment
  const [bravoPaused, setBravoPaused] = useState(true);
  const [alphaAtDest, setAlphaAtDest]   = useState(false); // sitting at destination
  const [bravoAtDest, setBravoAtDest]   = useState(false);
  const alphaArrivedRef  = useRef(false);
  const bravoArrivedRef  = useRef(false);
  const alphaCooldownRef = useRef(0);
  const bravoCooldownRef = useRef(0);
  const ARRIVAL_COOLDOWN = 5000;

  // Refs so the interval closure can read current paused/shipment state without stale values
  const alphaPausedRef = useRef(true);
  const bravoPausedRef = useRef(true);
  const convoyShipmentsRef = useRef(convoyShipments);
  useEffect(() => { alphaPausedRef.current = alphaPaused; }, [alphaPaused]);
  useEffect(() => { bravoPausedRef.current = bravoPaused; }, [bravoPaused]);
  useEffect(() => { convoyShipmentsRef.current = convoyShipments; }, [convoyShipments]);

  const handleArrival = (truck) => {
    const isAlpha = truck === "Alpha";
    const shipId = convoyShipmentsRef.current[isAlpha ? "alpha" : "bravo"];
    // Mark shipment delivered
    if (shipId) {
      onShipmentDelivered(shipId, truck);
      pushNotif({ type: "delivery", title: `📦 DELIVERED — ${shipId}`, body: `Convoy ${truck} completed delivery to ${isAlpha ? "Siachen Forward" : "Ladakh Post"}` });
    }
    // Rotate log
    rotateLedger({ id: Date.now()+Math.random(), truck, event:"ARRIVED",
      text: shipId ? `🏁 DELIVERED ${shipId} — ${isAlpha?"Siachen":"Ladakh"} reached. Awaiting next shipment.`
                   : `🏁 ARRIVED — ${isAlpha?"Siachen":"Ladakh"} reached. Awaiting shipment assignment.`,
      time: nowStr(), color:"green" });
    // Rotate queue logs
    if (isAlpha) {
      setAlphaActive(cur => { setAlphaCompleted(cur); return []; });
      alphaLapRef.current = (alphaLapRef.current + 1) % 2;
      prevAlphaSegRef.current = -1;
      alphaLastSyncRef.current = "__init__";
      alphaCooldownRef.current = Date.now() + ARRIVAL_COOLDOWN;
      setAlphaAtDest(true);
      setAlphaPaused(true);  // stop — wait for new shipment
    } else {
      setBravoActive(cur => { setBravoCompleted(cur); return []; });
      bravoLapRef.current = (bravoLapRef.current + 1) % 2;
      prevBravoSegRef.current = -1;
      bravoLastSyncRef.current = "__init__";
      bravoCooldownRef.current = Date.now() + ARRIVAL_COOLDOWN;
      setBravoAtDest(true);
      setBravoPaused(true);
    }
  };

  useEffect(() => {
    const t = setInterval(() => {
      setAlphaProgress(p => {
        if (alphaPausedRef.current) return p;
        const next = (p + 0.0015) % 1;
        if (p > 0.985 && next < p && !alphaArrivedRef.current) {
          alphaArrivedRef.current = true;
          setTimeout(() => { handleArrival("Alpha"); alphaArrivedRef.current = false; }, 50);
        }
        return next;
      });
      setBravoProgress(p => {
        if (bravoPausedRef.current) return p;
        const next = (p + 0.0013) % 1;
        if (p > 0.985 && next < p && !bravoArrivedRef.current) {
          bravoArrivedRef.current = true;
          setTimeout(() => { handleArrival("Bravo"); bravoArrivedRef.current = false; }, 50);
        }
        return next;
      });
    }, 80);
    return () => clearInterval(t);
  }, []);

  // Generic interpolator along any route array
  const getConvoyPos = (progress, route) => {
    const p = Math.max(0, Math.min(0.9999, progress));
    const totalSegs = route.length - 1;
    const seg = Math.min(Math.floor(p * totalSegs), totalSegs - 1);
    const segP = p * totalSegs - seg;
    const fromNode = nodes[route[seg]];
    const toNode = nodes[route[seg + 1]];
    const p1 = getPos(fromNode);
    const p2 = getPos(toNode);
    return { x: p1.x + (p2.x - p1.x) * segP, y: p1.y + (p2.y - p1.y) * segP };
  };

  const alphaPos = getConvoyPos(alphaProgress, CONVOY_ROUTE_ALPHA);
  const bravoPos = getConvoyPos(bravoProgress, CONVOY_ROUTE_BRAVO);

  // ─── Edge state: 0=green(both online), 1=yellow/DTN(one offline), 2=broken(both offline)
  const getEdgeState = (nodeA, nodeB) => {
    if (nodeA?.online && nodeB?.online) return 0;
    if (!nodeA?.online && !nodeB?.online) return 2;
    return 1;
  };

  // ─── Per-convoy segment helpers
  const getConvoySeg = (progress, route) => Math.min(Math.floor(progress * (route.length - 1)), route.length - 2);
  const alphaSeg = getConvoySeg(alphaProgress, CONVOY_ROUTE_ALPHA);
  const bravoSeg = getConvoySeg(bravoProgress, CONVOY_ROUTE_BRAVO);
  const alphaFromNode = nodes[CONVOY_ROUTE_ALPHA[alphaSeg]];
  const alphaToNode   = nodes[CONVOY_ROUTE_ALPHA[alphaSeg + 1]];
  const bravoFromNode = nodes[CONVOY_ROUTE_BRAVO[bravoSeg]];
  const bravoToNode   = nodes[CONVOY_ROUTE_BRAVO[bravoSeg + 1]];
  const alphaSegState = getEdgeState(alphaFromNode, alphaToNode);
  const bravoSegState = getEdgeState(bravoFromNode, bravoToNode);
  const alphaInBlackout = alphaSegState > 0;
  const bravoInBlackout = bravoSegState > 0;

  const getNextOnline = (seg, route) => {
    for (let i = seg + 1; i < route.length; i++) { if (nodes[route[i]]?.online) return i; }
    return route.length - 1;
  };
  const alphaNeedReroute = alphaSegState === 2;
  const bravoNeedReroute = bravoSegState === 2;
  const alphaRerouteTarget = alphaNeedReroute ? nodes[CONVOY_ROUTE_ALPHA[getNextOnline(alphaSeg, CONVOY_ROUTE_ALPHA)]] : null;
  const bravoRerouteTarget = bravoNeedReroute ? nodes[CONVOY_ROUTE_BRAVO[getNextOnline(bravoSeg, CONVOY_ROUTE_BRAVO)]] : null;
  const needsReroute = alphaNeedReroute || bravoNeedReroute;

  // ─── Critical alert: >50% non-convoy nodes offline
  const relayNodes = nodes.filter(n => !n.convoy);
  const offlineRelayCount = relayNodes.filter(n => !n.online).length;
  const criticalOffline = offlineRelayCount > relayNodes.length / 2;
  const prevCriticalRef = useRef(false);
  useEffect(() => {
    if (criticalOffline && !prevCriticalRef.current) {
      pushNotif({ type: "tamper", title: "🚨 CRITICAL — NETWORK DEGRADED", body: `${offlineRelayCount}/${relayNodes.length} nodes offline. Convoy communications at risk. Command Center alert.` });
      setRouteLedger(l => [{ id: Date.now() + Math.random(), truck: "SYSTEM", event: "CRITICAL_ALERT", text: `🚨 CRITICAL — ${offlineRelayCount}/${relayNodes.length} relay nodes offline — mesh network degraded`, time: nowStr(), color: "red" }, ...l]);
    }
    prevCriticalRef.current = criticalOffline;
  }, [criticalOffline]);

  // ─── Convoy segment event tracking — fires ONCE per segment crossing
  // Use refs for everything mutation-tracked to avoid stale closures
  const prevAlphaSegRef   = useRef(-1);
  const prevBravoSegRef   = useRef(-1);
  const alphaLastSyncRef  = useRef("__init__");
  const bravoLastSyncRef  = useRef("__init__");
  const nodesRef          = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Defined sync checkpoints: Banihal Tunnel, Drass Checkpoint, and final destination
  // Any online node works too, but these are named waypoints guaranteed to attempt sync
  const SYNC_CHECKPOINTS = new Set(["Banihal Tunnel", "Drass Checkpoint", "Kargil Waypoint",
    "Srinagar Hub", "Siachen Forward", "Ladakh Post", "Jammu Relay"]);

  // Sync writes confirmation to the current active slot
  const getAlphaSetLog = () => setAlphaActive;
  const getBravoSetLog = () => setBravoActive;
  const doAlphaSync = (nodeFrom) => {
    const key = "Alpha" + nodeFrom.name;
    if (key === alphaLastSyncRef.current) return;
    if (Date.now() < alphaCooldownRef.current) return;
    alphaLastSyncRef.current = key;
    const setLog = getAlphaSetLog();
    setTimeout(() => {
      setLog(currentLog => {
        const pending = currentLog.filter(e => !e.synced);
        if (pending.length === 0) return currentLog;
        const snapshot = [...pending];
        setAlphaSyncing(true); setAlphaSyncProg(0);
        const t = setInterval(() => {
          setAlphaSyncProg(p => {
            if (p >= 100) {
              clearInterval(t); setAlphaSyncing(false);
              snapshot.forEach((e, i) => setTimeout(() => {
                setChain(c => appendBlock(c, { event:"MESH_SYNC", actor:nodeFrom.id, shipmentId:convoyShipments?.alpha||"CONVOY-ALPHA", item:`[Alpha] ${e.text}`, time:e.time, valid:true, deliveryConfirmed:false }));
              }, i*80));
              return 100;
            }
            return p + 10;
          });
        }, 60);
        return [{ id:Date.now()+Math.random(), text:`✓ SYNCED at ${nodeFrom.name} — ${snapshot.length} events committed`, time:nowStr(), signed:true, synced:true }, ...currentLog.map(e=>({...e,synced:true})).slice(snapshot.length)];
      });
      setRouteLedger(l => [{ id:Date.now()+Math.random(), truck:"Alpha", event:"SYNC", text:`✓ SYNC at ${nodeFrom.name} — events committed`, time:nowStr(), color:"green" }, ...l]);
    }, 150);
  };
  const doBravoSync = (nodeFrom) => {
    const key = "Bravo" + nodeFrom.name;
    if (key === bravoLastSyncRef.current) return;
    if (Date.now() < bravoCooldownRef.current) return;
    bravoLastSyncRef.current = key;
    const setLog = getBravoSetLog();
    setTimeout(() => {
      setLog(currentLog => {
        const pending = currentLog.filter(e => !e.synced);
        if (pending.length === 0) return currentLog;
        const snapshot = [...pending];
        setBravoSyncing(true); setBravoSyncProg(0);
        const t = setInterval(() => {
          setBravoSyncProg(p => {
            if (p >= 100) {
              clearInterval(t); setBravoSyncing(false);
              snapshot.forEach((e, i) => setTimeout(() => {
                setChain(c => appendBlock(c, { event:"MESH_SYNC", actor:nodeFrom.id, shipmentId:convoyShipments?.bravo||"CONVOY-BRAVO", item:`[Bravo] ${e.text}`, time:e.time, valid:true, deliveryConfirmed:false }));
              }, i*80));
              return 100;
            }
            return p + 10;
          });
        }, 60);
        return [{ id:Date.now()+Math.random(), text:`✓ SYNCED at ${nodeFrom.name} — ${snapshot.length} events committed`, time:nowStr(), signed:true, synced:true }, ...currentLog.map(e=>({...e,synced:true})).slice(snapshot.length)];
      });
      setRouteLedger(l => [{ id:Date.now()+Math.random(), truck:"Bravo", event:"SYNC", text:`✓ SYNC at ${nodeFrom.name} — events committed`, time:nowStr(), color:"green" }, ...l]);
    }, 150);
  };

  const addToTruckLog = (truckName, entry) => {
    if (truckName === "Alpha") {
      if (Date.now() < alphaCooldownRef.current) return;
      const tagged = { ...entry, signed: true };
      setAlphaActive(l => [tagged, ...l]);
    } else {
      if (Date.now() < bravoCooldownRef.current) return;
      const tagged = { ...entry, signed: true };
      setBravoActive(l => [tagged, ...l]);
    }
  };

  useEffect(() => {
    const seg = alphaSeg;
    if (seg === prevAlphaSegRef.current) return;
    if (Date.now() < alphaCooldownRef.current) return;
    if (alphaPausedRef.current) return; // convoy standing by
    prevAlphaSegRef.current = seg;
    const ns = nodesRef.current;
    const fromN = ns[CONVOY_ROUTE_ALPHA[seg]];
    const toN   = ns[CONVOY_ROUTE_ALPHA[seg + 1]];
    if (!fromN || !toN) return;
    const aOn = fromN.online, bOn = toN.online;
    if (!aOn && !bOn) {
      let ni = seg + 1;
      while (ni < CONVOY_ROUTE_ALPHA.length && !ns[CONVOY_ROUTE_ALPHA[ni]]?.online) ni++;
      const re = ns[CONVOY_ROUTE_ALPHA[Math.min(ni, CONVOY_ROUTE_ALPHA.length-1)]];
      const entry = { id: Date.now()+Math.random(), truck:"Alpha", event:"REROUTE", text:`🔴 LINK BROKEN — ${fromN.name} & ${toN.name} offline — rerouting via ${re?.name||"?"}`, time:nowStr(), color:"red" };
      addToTruckLog("Alpha", entry); setRouteLedger(l => [entry, ...l]);
    } else if (!aOn || !bOn) {
      const offN = !aOn ? fromN.name : toN.name;
      const entry = { id: Date.now()+Math.random(), truck:"Alpha", event:"DTN", text:`⚠ DTN — ${fromN.name} → ${toN.name} (${offN} offline)`, time:nowStr(), color:"yellow" };
      addToTruckLog("Alpha", entry); setRouteLedger(l => [entry, ...l]);
    } else if (SYNC_CHECKPOINTS.has(fromN.name)) {
      doAlphaSync(fromN);
    }
  }, [alphaSeg]);

  useEffect(() => {
    const seg = bravoSeg;
    if (seg === prevBravoSegRef.current) return;
    if (Date.now() < bravoCooldownRef.current) return;
    if (bravoPausedRef.current) return;
    prevBravoSegRef.current = seg;
    const ns = nodesRef.current;
    const fromN = ns[CONVOY_ROUTE_BRAVO[seg]];
    const toN   = ns[CONVOY_ROUTE_BRAVO[seg + 1]];
    if (!fromN || !toN) return;
    const aOn = fromN.online, bOn = toN.online;
    if (!aOn && !bOn) {
      let ni = seg + 1;
      while (ni < CONVOY_ROUTE_BRAVO.length && !ns[CONVOY_ROUTE_BRAVO[ni]]?.online) ni++;
      const re = ns[CONVOY_ROUTE_BRAVO[Math.min(ni, CONVOY_ROUTE_BRAVO.length-1)]];
      const entry = { id: Date.now()+Math.random(), truck:"Bravo", event:"REROUTE", text:`🔴 LINK BROKEN — ${fromN.name} & ${toN.name} offline — rerouting via ${re?.name||"?"}`, time:nowStr(), color:"red" };
      addToTruckLog("Bravo", entry); setRouteLedger(l => [entry, ...l]);
    } else if (!aOn || !bOn) {
      const offN = !aOn ? fromN.name : toN.name;
      const entry = { id: Date.now()+Math.random(), truck:"Bravo", event:"DTN", text:`⚠ DTN — ${fromN.name} → ${toN.name} (${offN} offline)`, time:nowStr(), color:"yellow" };
      addToTruckLog("Bravo", entry); setRouteLedger(l => [entry, ...l]);
    } else if (SYNC_CHECKPOINTS.has(fromN.name)) {
      doBravoSync(fromN);
    }
  }, [bravoSeg]);

  useEffect(() => {
    const t = setInterval(() => {
      tickRef.current++;
      const edge = EDGES[tickRef.current % EDGES.length];
      const fromN = nodes[edge[0]]; const toN = nodes[edge[1]];
      setAnimPkts(p => [...p.slice(-10), { id: Date.now() + Math.random(), fromId: fromN.id, toId: toN.id, born: Date.now() }]);
    }, 1000);
    return () => clearInterval(t);
  }, [nodes]);

  // ── Signal strength degradation — drifts ±3% every 4s, auto-offline at 0 ──
  useEffect(() => {
    const t = setInterval(() => {
      setNodes(prev => prev.map(n => {
        if (n.convoy) return n;
        if (!n.online) return { ...n, signal: 0 };
        const drift = (Math.random() - 0.48) * 5; // slight downward bias
        const next = Math.max(0, Math.min(100, (n.signal || 80) + drift));
        if (next <= 5 && n.online) {
          // Auto-go offline when signal dies
          pushNotif({ type: "tamper", title: `📡 NODE LOST — ${n.name}`, body: `Signal degraded to 0% — node went offline.` });
          return { ...n, signal: 0, online: false };
        }
        return { ...n, signal: Math.round(next) };
      }));
    }, 4000);
    return () => clearInterval(t);
  }, []);

  // ── ETA calculation — based on progress and speed ──────────────────────
  const ALPHA_SPEED = 0.0015 / 0.08 * 60; // % per minute approximate
  const BRAVO_SPEED = 0.0013 / 0.08 * 60;
  const calcETA = (progress, speed) => {
    const remaining = (1 - progress) * 100;
    const mins = Math.round(remaining / speed);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins/60)}h ${mins%60}m`;
  };
  const alphaETA = calcETA(alphaProgress, ALPHA_SPEED);
  const bravoETA = calcETA(bravoProgress, BRAVO_SPEED);

  const getSVGCoords = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * (500 / rect.width), y: (clientY - rect.top) * (310 / rect.height) };
  };

  const handleNodeMouseDown = (e, nodeId) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getSVGCoords(e);
    const nodePos = svgPositions[nodeId] || toSVG(nodes.find(n => n.id === nodeId).lat, nodes.find(n => n.id === nodeId).lng);
    setDragging({ nodeId, offsetX: pos.x - nodePos.x, offsetY: pos.y - nodePos.y, moved: false });
  };

  const handleSVGMouseMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    const pos = getSVGCoords(e);
    const newX = Math.max(10, Math.min(490, pos.x - dragging.offsetX));
    const newY = Math.max(10, Math.min(300, pos.y - dragging.offsetY));
    setSvgPositions(prev => ({ ...prev, [dragging.nodeId]: { x: newX, y: newY } }));
    setDragging(prev => ({ ...prev, moved: true }));
  };

  const handleSVGMouseUp = () => setDragging(null);

  const handleNodeClick = (idx) => {
    if (dragging?.moved) return;
    const node = nodes[idx];
    if (node.convoy) return;
    const newOnline = !node.online;
    setNodes(prev => prev.map((n, i) => i === idx ? { ...n, online: newOnline } : n));
    const nodeEntry = { id: Date.now()+Math.random(), text: newOnline ? `${node.name} restored online — syncing pending` : `${node.name} offline — buffering locally`, time: nowStr(), signed: true };
    // Write node toggle event to the current active lap slot for each truck
    setAlphaActive(l => [nodeEntry, ...l]);
    const bravoEntry = { ...nodeEntry, id: Date.now()+Math.random()+1 };
    setBravoActive(l => [bravoEntry, ...l]);
  };

  // Manual force-sync flushes all pending events from active slots
  const handleManualSync = () => {
    const combined = [...alphaLog.filter(e=>!e.synced), ...bravoLog.filter(e=>!e.synced)];
    if (!combined.length) return;
    setAlphaSyncing(true); setAlphaSyncProg(0);
    const t = setInterval(() => {
      setAlphaSyncProg(p => {
        if (p >= 100) {
          clearInterval(t); setAlphaSyncing(false);
          combined.forEach((e, i) => setTimeout(() => {
            setChain(c => appendBlock(c, { event:"MESH_SYNC", actor:"NODE-03", shipmentId:"CONVOY", item:e.text, time:e.time, valid:true, deliveryConfirmed:false }));
          }, i*100));
          // Clear only active (Y/X depending on lap) slots
          setAlphaActive([]); setBravoActive([]);
          return 100;
        }
        return p + 8;
      });
    }, 70);
  };

  const hasOfflineNodes = nodes.some(n => !n.online && !n.convoy);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-mono text-gray-500 tracking-widest">MESH NETWORK:</span>
        {(alphaLog.filter(e=>!e.synced).length + bravoLog.filter(e=>!e.synced).length) > 0 && (
          <button onClick={handleManualSync} disabled={alphaSyncing||bravoSyncing} className="px-3 py-1.5 text-[10px] font-mono border border-yellow-700 text-yellow-400 hover:bg-yellow-900/20 rounded transition-all disabled:opacity-40">
            {(alphaSyncing||bravoSyncing) ? `SYNCING...` : `↑ FORCE SYNC ALL (${alphaLog.filter(e=>!e.synced).length + bravoLog.filter(e=>!e.synced).length} pending)`}
          </button>
        )}
        <span className="text-[10px] font-mono text-gray-600 ml-auto">Drag nodes to reposition · Click relay nodes to toggle</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 bg-black border border-emerald-900/40 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Pulse color={needsReroute ? "red" : hasOfflineNodes ? "orange" : "green"} />
            <span className="text-[10px] font-mono text-emerald-400 tracking-widest">LIVE MESH TOPOLOGY — DTN PROTOCOL</span>
            {needsReroute && <Badge color="red">⚠ REROUTING</Badge>}
            {!needsReroute && hasOfflineNodes && <Badge color="orange">DTN LINKS ACTIVE</Badge>}
          </div>
          <svg ref={svgRef} viewBox="0 0 500 310" className="w-full" style={{ cursor: dragging ? "grabbing" : "default", userSelect: "none" }}
            onMouseMove={handleSVGMouseMove} onMouseUp={handleSVGMouseUp} onMouseLeave={handleSVGMouseUp}
            onTouchMove={handleSVGMouseMove} onTouchEnd={handleSVGMouseUp}>
            <rect width="500" height="310" fill="#060d0a" />
            {[...Array(7)].map((_, i) => <line key={i} x1={0} y1={i*50+10} x2={500} y2={i*50+10} stroke="rgba(0,255,100,0.03)" strokeWidth="1" />)}
            {[...Array(9)].map((_, i) => <line key={i} x1={i*60+10} y1={0} x2={i*60+10} y2={310} stroke="rgba(0,255,100,0.03)" strokeWidth="1" />)}
            {EDGES.map(([a, b], i) => {
              const p1 = getPos(nodes[a]); const p2 = getPos(nodes[b]);
              const state = getEdgeState(nodes[a], nodes[b]);
              // 0=green, 1=yellow/DTN, 2=broken(red+dashed)
              const avgSignal = ((nodes[a].signal||80) + (nodes[b].signal||80)) / 200;
              const stroke = state === 0 ? `rgba(0,255,100,${0.15 + avgSignal*0.45})` : state === 1 ? "rgba(255,165,0,0.6)" : "rgba(255,60,60,0.35)";
              const dash   = state === 0 ? "none" : state === 1 ? "5,3" : "3,5";
              const width  = state === 0 ? 1 : 1.8;
              return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={stroke} strokeWidth={width} strokeDasharray={dash} />;
            })}
            {alphaNeedReroute && alphaRerouteTarget && (() => { const to = getPos(alphaRerouteTarget); return (<g><line x1={alphaPos.x} y1={alphaPos.y} x2={to.x} y2={to.y} stroke="rgba(255,60,60,0.5)" strokeWidth="1.2" strokeDasharray="4,3" /><text x={to.x} y={to.y-10} textAnchor="middle" fill="#ff4444" fontSize="6" fontFamily="monospace">ALPHA REROUTE</text></g>); })()}
            {bravoNeedReroute && bravoRerouteTarget && (() => { const to = getPos(bravoRerouteTarget); return (<g><line x1={bravoPos.x} y1={bravoPos.y} x2={to.x} y2={to.y} stroke="rgba(255,100,0,0.5)" strokeWidth="1.2" strokeDasharray="4,3" /><text x={to.x} y={to.y-10} textAnchor="middle" fill="#ffa500" fontSize="6" fontFamily="monospace">BRAVO REROUTE</text></g>); })()}
            {animPkts.map(pkt => {
              const prog = Math.min(1, (Date.now() - pkt.born) / 1800);
              const fromN = nodes.find(n => n.id === pkt.fromId); const toN = nodes.find(n => n.id === pkt.toId);
              if (!fromN || !toN) return null;
              const p1 = getPos(fromN); const p2 = getPos(toN);
              const cx = p1.x + (p2.x - p1.x) * prog;
              const cy = p1.y + (p2.y - p1.y) * prog;
              const state = getEdgeState(fromN, toN);
              // Only show packet dots on DTN/offline links as a "store-and-forward" pulse; green links are clean
              if (state === 0) return null;
              const col = state === 1 ? "#ffa500" : "#ff4444";
              return <circle key={pkt.id} cx={cx} cy={cy} r={2.5} fill={col} opacity={0.7 - prog * 0.4} />;
            })}
            {/* Static nodes — skip convoy trucks, they are rendered animated below */}
            {nodes.map((node, i) => {
              if (node.convoy) return null;
              const pos = getPos(node);
              const col = node.online ? "#00ff64" : "#ff4444";
              return (
                <g key={node.id} style={{ cursor: "grab" }}
                  onMouseDown={e => handleNodeMouseDown(e, node.id)}
                  onTouchStart={e => handleNodeMouseDown(e, node.id)}
                  onClick={() => handleNodeClick(i)}>
                  {dragging?.nodeId === node.id && <circle cx={pos.x} cy={pos.y} r={14} fill="none" stroke={col} strokeWidth="1" strokeDasharray="3,2" opacity={0.5} />}
                  <circle cx={pos.x} cy={pos.y} r={8} fill={`${col}22`} stroke={col} strokeWidth={1.5} opacity={(node.signal||80)/100*0.7+0.3} />
                  <circle cx={pos.x} cy={pos.y} r={3} fill={col} />
                  {node.signal < 40 && node.online && <circle cx={pos.x} cy={pos.y} r={11} fill="none" stroke="#ffaa00" strokeWidth="0.8" strokeDasharray="2,2" opacity={0.6} />}
                  <rect x={pos.x+11} y={pos.y-11} width={node.name.length*5+4} height={13} rx={2} fill="rgba(6,10,15,0.9)" />
                  <text x={pos.x+13} y={pos.y} fill={col} fontSize="7" fontFamily="monospace">{node.name}</text>
                  <text x={pos.x+13} y={pos.y+9} fill="rgba(255,255,255,0.3)" fontSize="5.5" fontFamily="monospace">{node.id}</text>
                </g>
              );
            })}
            {/* Animated convoy trucks — each on its own route */}
            {[
              { pos: alphaPos, label: "Alpha", dest: "Siachen", id: "NODE-04", inBlackout: alphaInBlackout, needReroute: alphaNeedReroute, paused: alphaPaused, shipId: convoyShipments.alpha },
              { pos: bravoPos, label: "Bravo", dest: "Ladakh",  id: "NODE-05", inBlackout: bravoInBlackout, needReroute: bravoNeedReroute, paused: bravoPaused, shipId: convoyShipments.bravo },
            ].map(({ pos, label, dest, id, inBlackout, needReroute, paused, shipId }) => {
              const col = paused ? "#888888" : needReroute ? "#ff4444" : inBlackout ? "#ffa500" : "#00ff64";
              const bgFill = paused ? "#1a1a1a" : needReroute ? "#3a0000" : inBlackout ? "#7a4a00" : "#003a18";
              const status = paused ? "STANDBY" : needReroute ? "REROUTE" : inBlackout ? "DTN" : "GPS✓";
              return (
                <g key={id}>
                  <circle cx={pos.x} cy={pos.y} r={13} fill="none" stroke={col} strokeWidth="0.8" opacity={0.3} />
                  <rect x={pos.x-10} y={pos.y-7} width={20} height={13} rx={3} fill={bgFill} stroke={col} strokeWidth={1.2} />
                  <text x={pos.x} y={pos.y+3} textAnchor="middle" fontSize="9">🚛</text>
                  <rect x={pos.x+13} y={pos.y-11} width={82} height={22} rx={2} fill="rgba(6,10,15,0.93)" />
                  <text x={pos.x+15} y={pos.y-2} fill={col} fontSize="7" fontFamily="monospace" fontWeight="bold">Convoy {label} → {dest}</text>
                  <text x={pos.x+15} y={pos.y+8} fill="rgba(255,255,255,0.35)" fontSize="5.5" fontFamily="monospace">{id} · {status}{shipId ? ` · ${shipId}` : ""}</text>
                </g>
              );
            })}
          </svg>
          <div className="flex gap-3 mt-1 text-[9px] font-mono text-gray-600 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-8 h-0.5 bg-emerald-500 inline-block rounded" /> GREEN = both online</span>
            <span className="flex items-center gap-1"><span className="w-8 h-0.5 bg-orange-500 inline-block rounded" style={{backgroundImage:"repeating-linear-gradient(90deg,#f97316 0,#f97316 4px,transparent 4px,transparent 7px)"}} /> YELLOW = 1 node offline (DTN)</span>
            <span className="flex items-center gap-1"><span className="w-8 h-0.5 bg-red-500 inline-block rounded" style={{backgroundImage:"repeating-linear-gradient(90deg,#ef4444 0,#ef4444 3px,transparent 3px,transparent 7px)"}} /> RED = both offline (reroute)</span>
          </div>
        </div>
        {/* Right panel — tabbed: Nodes / Queue / Route Ledger */}
        {(() => {
          const [rightTab, setRightTab] = useState("nodes");
          const alphaNear = nodes[CONVOY_ROUTE_ALPHA[Math.min(Math.round(alphaProgress * (CONVOY_ROUTE_ALPHA.length-1)), CONVOY_ROUTE_ALPHA.length-1)]]?.name || "";
          const bravoNear = nodes[CONVOY_ROUTE_BRAVO[Math.min(Math.round(bravoProgress * (CONVOY_ROUTE_BRAVO.length-1)), CONVOY_ROUTE_BRAVO.length-1)]]?.name || "";
          return (
            <div className="flex flex-col gap-0 bg-black border border-emerald-900/30 rounded-xl overflow-hidden" style={{minHeight: 480}}>
              {/* Tab bar */}
              <div className="flex border-b border-emerald-900/30">
                {[["nodes","🖧 NODES"],["queue","📥 QUEUE"],["ledger","📋 ROUTE LOG"]].map(([id,lbl]) => (
                  <button key={id} onClick={() => setRightTab(id)}
                    className={`flex-1 py-2 text-[8px] font-mono tracking-widest transition-all ${rightTab===id ? "bg-emerald-950/30 text-emerald-400 border-b-2 border-emerald-500" : "text-gray-600 hover:text-gray-400"}`}>
                    {lbl}{id==="queue" && (alphaLog.length+bravoLog.length)>0 ? ` (${alphaLog.filter(e=>!e.synced).length}+${bravoLog.filter(e=>!e.synced).length})` : ""}{id==="ledger" && routeLedger.length>0 ? ` (${routeLedger.length})` : ""}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-hidden flex flex-col p-3">
                {/* NODES tab */}
                {rightTab === "nodes" && (
                  <div className="space-y-1 overflow-y-auto flex-1">
                    {criticalOffline && (
                      <div className="flex items-center gap-2 p-2 rounded border border-red-700 bg-red-950/20 mb-2">
                        <span className="text-red-400 text-[9px] font-mono">🚨 CRITICAL — {offlineRelayCount}/{relayNodes.length} nodes offline. Command Center alerted.</span>
                      </div>
                    )}
                    {nodes.map((n, i) => {
                      if (n.convoy) {
                        const isAlpha = n.id === "NODE-04";
                        const progress = isAlpha ? alphaProgress : bravoProgress;
                        const paused   = isAlpha ? alphaPaused   : bravoPaused;
                        const atDest   = isAlpha ? alphaAtDest   : bravoAtDest;
                        const pct = Math.round(progress * 100);
                        const near = isAlpha ? alphaNear : bravoNear;
                        const bkout = isAlpha ? alphaInBlackout : bravoInBlackout;
                        const dest = isAlpha ? "Siachen Forward" : "Ladakh Post";
                        const eta = isAlpha ? alphaETA : bravoETA;
                        const truckKey = isAlpha ? "alpha" : "bravo";
                        const assignedId = convoyShipments[truckKey];
                        const assignedShip = assignedId ? (shipments||{})[assignedId] : null;
                        const availableShips = Object.values(shipments||{}).filter(s => s.status === "in-transit" && !Object.values(convoyShipments).includes(s.id));
                        const statusCol = atDest ? "purple" : paused ? "orange" : bkout ? "orange" : "green";
                        const statusLbl = atDest ? "AT DEST" : paused ? "STANDBY" : bkout ? "DTN" : "MOVING";
                        return (
                          <div key={n.id} className={`rounded border p-2 mb-1 ${atDest ? "border-purple-900/40 bg-purple-950/10" : paused ? "border-yellow-900/30 bg-yellow-950/5" : "border-emerald-900/30 bg-emerald-950/5"}`}>
                            {/* Header */}
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-base leading-none">🚛</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-[9px] font-mono text-white font-bold">Convoy {isAlpha ? "Alpha" : "Bravo"}</div>
                                <div className="text-[8px] font-mono text-gray-500">{n.id} · {atDest ? dest : `near ${near}`}</div>
                              </div>
                              <Badge color={statusCol}>{statusLbl}</Badge>
                            </div>
                            {/* Progress bar */}
                            <div className="flex items-center gap-2 mb-2">
                              <div className="flex-1 h-1.5 bg-gray-900 rounded-full overflow-hidden">
                                <div className={`h-full transition-all ${atDest ? "bg-purple-500" : "bg-emerald-500"}`} style={{width:`${pct}%`}} />
                              </div>
                              <span className="text-[7px] font-mono text-gray-500 shrink-0">{pct}%</span>
                              {!paused && <span className="text-[7px] font-mono text-emerald-400 shrink-0">ETA {eta}</span>}
                            </div>
                            {/* Shipment info / assignment */}
                            {assignedShip ? (
                              <div className="border border-emerald-900/30 rounded p-1.5 bg-black/30">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[8px] font-mono text-emerald-400 font-bold">{assignedShip.id}</span>
                                  <span className={`text-[7px] font-mono px-1 rounded ${assignedShip.priority==="CRITICAL"?"bg-red-900/50 text-red-400":assignedShip.priority==="HIGH"?"bg-orange-900/50 text-orange-400":"bg-yellow-900/50 text-yellow-400"}`}>{assignedShip.priority}</span>
                                </div>
                                <div className="text-[7px] font-mono text-gray-500 mb-1">→ {assignedShip.receiverName} · {assignedShip.items.length} items</div>
                                <div className="flex flex-wrap gap-1 mb-1.5">
                                  {assignedShip.items.slice(0,3).map(item => (
                                    <span key={item.id} className={`text-[6px] font-mono px-1 py-0.5 rounded ${item.tampered?"border border-red-700 text-red-400":"border border-gray-800 text-gray-500"}`}>
                                      {item.tampered?"⚠ ":""}{item.name} ×{item.qty}
                                    </span>
                                  ))}
                                  {assignedShip.items.length > 3 && <span className="text-[6px] font-mono text-gray-600">+{assignedShip.items.length-3} more</span>}
                                </div>
                                {paused && !atDest && (
                                  <button onClick={() => { isAlpha ? setAlphaPaused(false) : setBravoPaused(false); isAlpha ? setAlphaAtDest(false) : setBravoAtDest(false); setRouteLedger(l => [{ id:Date.now()+Math.random(), truck:isAlpha?"Alpha":"Bravo", event:"DISPATCH", text:`🚀 DISPATCHED — ${assignedShip.id} loaded, convoy moving to ${dest}`, time:nowStr(), color:"green" }, ...l]); }}
                                    className="w-full py-1 text-[8px] font-mono bg-emerald-900/30 border border-emerald-700 text-emerald-400 hover:bg-emerald-900/50 rounded transition-all">
                                    🚀 DISPATCH CONVOY
                                  </button>
                                )}
                                {atDest && (
                                  <div className="text-[7px] font-mono text-purple-400 text-center py-1">
                                    ✅ Delivered at {dest} — unassign to load next shipment
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="border border-gray-800/50 rounded p-1.5 bg-black/20">
                                <div className="text-[7px] font-mono text-gray-600 mb-1">CARGO: No shipment assigned</div>
                                <select value="" onChange={e => {
                                  if (!e.target.value) return;
                                  setConvoyShipments(p => ({...p, [truckKey]: e.target.value}));
                                  setShipments && setShipments(p => ({...p, [e.target.value]: {...p[e.target.value], status:"in-transit", dispatchTime: nowStr()}}));
                                }}
                                  className="w-full text-[7px] font-mono bg-black border border-gray-700 text-emerald-400 rounded px-1 py-1">
                                  <option value="">— assign shipment —</option>
                                  {availableShips.map(s => <option key={s.id} value={s.id}>{s.id} · {s.priority} · {s.receiverName}</option>)}
                                </select>
                                {atDest && <div className="text-[7px] font-mono text-purple-400 mt-1 text-center">Convoy at {dest} — ready to return</div>}
                                {!atDest && paused && availableShips.length === 0 && (
                                  <div className="text-[7px] font-mono text-yellow-600 mt-1">No in-transit shipments available — dispatch a shipment first</div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }
                      // Signal bar helper
                      const sig = n.signal ?? 80;
                      const sigCol = sig > 60 ? "#00ff64" : sig > 30 ? "#ffa500" : "#ff4444";
                      const bars = [25, 50, 75, 100].map(t => sig >= t);
                      return (
                        <div key={n.id} onClick={() => handleNodeClick(i)} className={`flex items-center gap-2 p-1.5 rounded border transition-all cursor-pointer ${n.online ? "border-emerald-900/30 bg-emerald-950/10" : "border-red-900/30 bg-red-950/10"}`}>
                          <Pulse color={n.online ? (sig < 30 ? "orange" : "green") : "red"} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[9px] font-mono text-white truncate">{n.name}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {bars.map((on, bi) => <span key={bi} style={{width:4,height:4+bi*2,display:"inline-block",borderRadius:1,backgroundColor:on&&n.online?sigCol:"#333",verticalAlign:"bottom"}} />)}
                              <span className="text-[7px] font-mono ml-1" style={{color:sigCol}}>{n.online ? `${sig}%` : "OFFLINE"}</span>
                            </div>
                          </div>
                          <Badge color={n.online ? (sig<30?"orange":"green") : "red"}>{n.online ? "ON" : "OFF"}</Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* QUEUE tab — split by truck */}
                {rightTab === "queue" && (
                  <div className="flex flex-col flex-1 overflow-hidden gap-3">
                    {[
                      { name:"Alpha", log: alphaLog, syncing: alphaSyncing, prog: alphaSyncProg, col:"emerald", syncFn: ()=>doAlphaSync(nodesRef.current.find(n=>n.name==="Banihal Tunnel")||nodesRef.current[0]) },
                      { name:"Bravo", log: bravoLog, syncing: bravoSyncing, prog: bravoSyncProg, col:"blue",    syncFn: ()=>doBravoSync(nodesRef.current.find(n=>n.name==="Drass Checkpoint")||nodesRef.current[0]) },
                    ].map(({ name, log, syncing: syn, prog, col, syncFn }) => {
                      const pending = log.filter(e=>!e.synced);
                      return (
                        <div key={name} className={`flex flex-col border rounded-lg p-2 ${col==="emerald" ? "border-emerald-900/40 bg-emerald-950/5" : "border-blue-900/40 bg-blue-950/5"}`} style={{flex:1,minHeight:0,overflow:"hidden"}}>
                          <div className="flex items-center justify-between mb-1.5 shrink-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-base leading-none">🚛</span>
                              <span className={`text-[9px] font-mono font-bold ${col==="emerald" ? "text-emerald-400" : "text-blue-400"}`}>Convoy {name}</span>
                              <span className="text-[8px] font-mono text-gray-600">{pending.length > 0 ? `(${pending.length} pending)` : log.length > 0 ? "(synced)" : "(clear)"}</span>
                            </div>
                            {pending.length > 0 && !syn && (
                              <button onClick={syncFn} className="px-1.5 py-0.5 text-[7px] font-mono border border-yellow-700 text-yellow-400 hover:bg-yellow-900/20 rounded">↑ SYNC</button>
                            )}
                          </div>
                          {syn && <div className="mb-1.5 shrink-0"><div className="text-[8px] font-mono text-yellow-400 mb-0.5">RECONCILING {prog}%</div><div className="h-1 bg-black rounded-full overflow-hidden"><div className="h-full bg-yellow-500 transition-all" style={{width:`${prog}%`}} /></div></div>}
                          {log.length === 0 && <div className="text-[8px] text-gray-600 font-mono text-center py-2">No events</div>}
                          {log.some(e=>e._done) && log.some(e=>!e._done) && (
                            <div className="text-[7px] font-mono text-gray-600 mb-1 flex items-center gap-1 border-b border-gray-800/40 pb-1">
                              <span className="opacity-40">📜</span> PREV JOURNEY (archived)
                              <span className="mx-1 opacity-30">|</span>
                              <span>▸</span> CURRENT JOURNEY (live)
                            </div>
                          )}
                          <div className="space-y-0.5 overflow-y-auto" style={{flex:1}}>
                            {log.map(e => {
                              const isPrev = e._done === true;
                              const isSynced = e.synced; const isBroken = e.text.startsWith("🔴"); const isDTN = e.text.startsWith("⚠");
                              const border = isPrev
                                ? "border-gray-800/40 bg-black/10 opacity-35"
                                : isSynced ? "border-emerald-800/40 bg-emerald-950/10"
                                : isBroken ? "border-red-900/40 bg-red-950/10"
                                : isDTN ? "border-yellow-900/40 bg-yellow-950/10"
                                : "border-orange-900/20 bg-black/40";
                              const icon = isPrev ? "📜" : isSynced ? "✅" : isBroken ? "🔴" : isDTN ? "🟡" : "🔒";
                              const txt = isPrev ? "text-gray-600" : isSynced ? "text-emerald-300" : isBroken ? "text-red-300" : isDTN ? "text-yellow-300" : "text-gray-400";
                              return (
                                <div key={e.id} className={`flex items-start gap-1 text-[8px] font-mono border rounded px-1.5 py-1 ${border}`}>
                                  <span className="shrink-0 text-[9px]">{icon}</span>
                                  <span className={`flex-1 leading-relaxed ${txt}`}>{e.text}</span>
                                  <span className="text-gray-600 shrink-0">{e.time}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* ROUTE LEDGER tab */}
                {rightTab === "ledger" && (
                  <div className="flex flex-col flex-1 overflow-hidden">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-mono text-emerald-400 tracking-widest">ROUTE LEDGER</span>
                      {routeLedger.length > 0 && <button onClick={clearRouteLedger} className="text-[8px] font-mono text-gray-600 hover:text-red-400 border border-gray-800 rounded px-2 py-0.5">CLEAR</button>}
                    </div>
                    {routeLedger.length === 0 && <div className="text-[9px] text-gray-600 font-mono text-center py-4">No route events yet</div>}
                    {routeLedger.some(e=>e._prev) && !routeLedger.some(e=>!e._prev) && <div className="text-[8px] text-gray-600 font-mono text-center py-1 mb-1">📜 Showing last completed journey</div>}
                    <div className="space-y-1 overflow-y-auto flex-1">
                      {routeLedger.some(e=>e._prev) && routeLedger.some(e=>!e._prev) && (
                        <div className="text-[7px] font-mono text-gray-600 mb-1 flex items-center gap-1 border-b border-gray-800/40 pb-1">
                          <span className="opacity-40">📜</span> PREV JOURNEY
                          <span className="mx-1 opacity-30">|</span>
                          <span>▸</span> CURRENT JOURNEY
                        </div>
                      )}
                      {routeLedger.map(e => { const isPrevEntry = e._prev === true;
                        const colMap = { green: "border-emerald-800/50 bg-emerald-950/10 text-emerald-300", yellow: "border-yellow-800/50 bg-yellow-950/10 text-yellow-300", red: "border-red-800/50 bg-red-950/10 text-red-300", orange: "border-orange-800/50 bg-orange-950/10 text-orange-300" };
                        const cls = isPrevEntry ? "border-gray-800/30 bg-black/10 opacity-35" : colMap[e.color] || "border-gray-800 text-gray-400";
                        const truckBadge = e.truck === "Alpha" ? "bg-emerald-900/40 text-emerald-400" : e.truck === "Bravo" ? "bg-blue-900/40 text-blue-400" : "bg-red-900/40 text-red-400";
                        return (
                          <div key={e.id} className={`flex items-start gap-1.5 text-[9px] font-mono border rounded px-2 py-1.5 ${cls}`}>
                            <span className={`shrink-0 px-1 rounded text-[7px] font-bold ${truckBadge}`}>{e.truck}</span>
                            <span className={`flex-1 leading-relaxed ${isPrevEntry ? "text-gray-600" : ""}`}>{e.text}</span>
                            <span className="text-gray-600 shrink-0 text-[8px]">{e.time}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function BlockchainLedger({ chain }) {
  const eventColor = { GENESIS:"gray", DISPATCH:"blue", CHECKPOINT:"green", MESH_SYNC:"yellow", TAMPER_ALERT:"red", QR_SCAN:"purple", DELIVERY_VERIFIED:"green", TAMPER_CONFIRMED:"red", DISPATCH_LOG:"blue", RECEIPT:"green" };
  return (
    <div className="bg-black border border-emerald-900/40 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3"><Pulse /><span className="text-[10px] font-mono text-emerald-400 tracking-widest">IMMUTABLE LEDGER — HYPERLEDGER FABRIC 2.5</span><span className="ml-auto text-[9px] font-mono text-gray-600">{chain.length} BLOCKS</span></div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead><tr className="border-b border-emerald-900/30">{["#","HASH","PREV HASH","EVENT","ACTOR","SHIPMENT","CONTENTS","TIME","STATUS"].map(h => <th key={h} className="text-left text-[9px] text-gray-600 tracking-widest pb-2 pr-2 whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {chain.map((e, i) => (
              <tr key={i} className={`border-b ${e.valid ? "border-emerald-900/10" : "border-red-900/20"}`}>
                <td className="py-1.5 pr-2 text-gray-600">{e.block}</td>
                <td className="py-1.5 pr-2 text-emerald-400 whitespace-nowrap text-[8px]">{e.hash.slice(0, 14)}…</td>
                <td className="py-1.5 pr-2 text-gray-600 whitespace-nowrap text-[8px]">{e.previousHash ? e.previousHash.slice(0, 10) + "…" : "—"}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap"><Badge color={eventColor[e.event] || "gray"}>{e.event}</Badge></td>
                <td className="py-1.5 pr-2 text-white whitespace-nowrap">{e.actor}</td>
                <td className="py-1.5 pr-2 text-blue-400 whitespace-nowrap">{e.shipmentId}</td>
                <td className="py-1.5 pr-2 text-white max-w-[160px]"><div className="truncate">{e.item}</div></td>
                <td className="py-1.5 pr-2 text-gray-500 whitespace-nowrap">{e.time}</td>
                <td className="py-1.5">{e.deliveryConfirmed ? <Badge color="green">✓ DELIVERED</Badge> : e.valid ? <Badge color="green">✓ VALID</Badge> : <Badge color="red">⚠ TAMPERED</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QRScanner({ user, chain, setChain }) {
  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState(null);
  const [scanLine, setScanLine] = useState(0);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!scanning) return;
    const t = setInterval(() => setScanLine(l => (l + 4) % 100), 25);
    return () => clearInterval(t);
  }, [scanning]);

  const doScan = (id) => {
    setScanTarget(id); setScanning(true); setResult(null);
    setTimeout(() => {
      setScanning(false); setResult(id);
      setChain(c => appendBlock(c, { event:"QR_SCAN", actor:user.uid, shipmentId:id, item:`QR tag authenticated: ${id}`, valid:true, deliveryConfirmed:false }));
    }, 2200);
  };

  return (
    <div className="max-w-sm space-y-4">
      <div className="bg-black border border-emerald-900/40 rounded-xl p-4">
        <div className="text-[10px] font-mono text-emerald-400 tracking-widest mb-4">QR CARGO AUTHENTICATION</div>
        <div className="relative w-40 h-40 mx-auto mb-4 bg-black rounded-lg border border-emerald-900/50 overflow-hidden">
          {["top-0 left-0 border-t-2 border-l-2","top-0 right-0 border-t-2 border-r-2","bottom-0 left-0 border-b-2 border-l-2","bottom-0 right-0 border-b-2 border-r-2"].map((c,i) => <div key={i} className={`absolute w-5 h-5 border-emerald-400 ${c}`}/>)}
          {scanning && <div className="absolute left-0 right-0 h-0.5 bg-emerald-400/80" style={{top:`${scanLine}%`}}/>}
          {result && <div className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-950/60"><div className="text-2xl">✓</div><div className="text-emerald-400 text-[10px] font-mono mt-1">{result}</div></div>}
          {!scanning && !result && <div className="absolute inset-0 flex items-center justify-center text-gray-700 text-xs font-mono">READY</div>}
        </div>
        <div className="space-y-2">
          {Object.keys(INIT_SHIPMENTS).map(id => (
            <button key={id} onClick={() => doScan(id)} disabled={scanning} className="w-full text-left bg-black/40 border border-emerald-900/30 hover:border-emerald-600/50 rounded-lg px-3 py-2 text-[10px] font-mono text-emerald-300 transition-all disabled:opacity-40">📦 Scan {id}</button>
          ))}
        </div>
        {result && <div className="mt-3 text-[10px] font-mono text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 rounded p-2">✓ {result} — authenticated (Block #{chain.length})</div>}
      </div>
    </div>
  );
}

function StatsDashboard({ shipments, chain, nodes }) {
  const vals = Object.values(shipments);
  const pending = vals.filter(s => s.status === "pending").length;
  const inTransit = vals.filter(s => s.status === "in-transit").length;
  const delivered = vals.filter(s => s.status === "delivered").length;
  const discrepancy = vals.filter(s => s.status === "discrepancy").length;
  const total = vals.length;
  const validBlocks = chain.filter(b => b.valid).length;
  const invalidBlocks = chain.filter(b => !b.valid).length;
  const integrityPct = chain.length > 0 ? Math.round((validBlocks / chain.length) * 100) : 100;
  const onlineNodes = nodes.filter(n => n.online).length;
  const offlineNodes = nodes.filter(n => !n.online && !n.convoy).length;
  const tamperEvents = chain.filter(b => b.event === "TAMPER_ALERT" || b.event === "TAMPER_CONFIRMED").length;
  const tamperRate = chain.length > 0 ? ((tamperEvents / chain.length) * 100).toFixed(1) : "0.0";
  const chainCheck = verifyChain(chain);

  const StatCard = ({ title, value, subtitle, color, icon }) => (
    <div className="bg-black/40 border border-gray-800 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1"><span className="text-[9px] font-mono text-gray-500 tracking-widest">{title}</span><span className="text-base">{icon}</span></div>
      <div className={`text-2xl font-mono font-bold ${color}`}>{value}</div>
      {subtitle && <div className="text-[8px] font-mono text-gray-600 mt-0.5">{subtitle}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-mono text-emerald-400 mb-2">📦 SHIPMENT STATUS</div>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          <StatCard title="TOTAL" value={total} color="text-white" icon="📊" />
          <StatCard title="PENDING" value={pending} color="text-gray-400" icon="⏳" subtitle={`${total ? Math.round((pending/total)*100) : 0}%`} />
          <StatCard title="IN TRANSIT" value={inTransit} color="text-blue-400" icon="🚛" subtitle={`${total ? Math.round((inTransit/total)*100) : 0}%`} />
          <StatCard title="DELIVERED" value={delivered} color="text-emerald-400" icon="✅" subtitle={`${total ? Math.round((delivered/total)*100) : 0}%`} />
          <StatCard title="DISCREPANCY" value={discrepancy} color="text-red-400" icon="⚠️" subtitle={`${total ? Math.round((discrepancy/total)*100) : 0}%`} />
        </div>
      </div>
      <div>
        <div className="text-xs font-mono text-emerald-400 mb-2">⛓️ BLOCKCHAIN INTEGRITY</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard title="TOTAL BLOCKS" value={chain.length} color="text-white" icon="🔗" />
          <StatCard title="CHAIN INTEGRITY" value={chainCheck.valid ? "✓ INTACT" : "✗ BROKEN"} color={chainCheck.valid ? "text-emerald-400" : "text-red-400"} icon="⛓" subtitle={chainCheck.valid ? `All ${chainCheck.blocks} blocks linked` : `Block #${chainCheck.at}: ${chainCheck.reason}`} />
          <StatCard title="VALID" value={validBlocks} color="text-emerald-400" icon="✓" subtitle={`${integrityPct}% integrity`} />
          <StatCard title="TAMPER RATE" value={`${tamperRate}%`} color={parseFloat(tamperRate) > 10 ? "text-red-400" : "text-emerald-400"} icon="📈" subtitle={`${tamperEvents} incidents`} />
        </div>
      </div>
      <div>
        <div className="text-xs font-mono text-emerald-400 mb-2">🌐 NETWORK STATUS</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard title="TOTAL NODES" value={nodes.length} color="text-white" icon="🔌" />
          <StatCard title="ONLINE" value={onlineNodes} color="text-emerald-400" icon="✓" subtitle={`${nodes.length ? Math.round((onlineNodes/nodes.length)*100) : 0}% uptime`} />
          <StatCard title="OFFLINE" value={offlineNodes} color="text-red-400" icon="✗" subtitle="relay down" />
          <StatCard title="CHAIN EVENTS" value={chain.length - 3} color="text-blue-400" icon="⚡" subtitle="since genesis" />
        </div>
      </div>
      <div>
        <div className="text-xs font-mono text-emerald-400 mb-2">⚡ RECENT EVENTS</div>
        <div className="bg-black/40 border border-gray-800 rounded-xl p-3 max-h-52 overflow-y-auto">
          {chain.slice(-8).reverse().map((e, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-800/50 last:border-0">
              <span className="text-[9px] text-gray-600">#{e.block}</span>
              <Badge color={e.valid ? "green" : "red"}>{e.event}</Badge>
              <span className="flex-1 text-[9px] font-mono text-white truncate">{e.item}</span>
              <span className="text-[8px] text-gray-600 font-mono">{e.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommandShipments({ shipments, setShipments, chain, setChain, pushNotif }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editPriority, setEditPriority] = useState("");
  const [newShip, setNewShip] = useState({ sender: "SEND-001", receiver: "RECV-001", priority: "HIGH", note: "", items: [{ name: "", qty: "", unit: "units" }] });

  const allShipments = Object.values(shipments);

  const dispatchShipment = (shpId) => {
    const shp = shipments[shpId];
    const updatedItems = shp.items.map(item => item.willTamper && !item.tampered ? { ...item, tampered: true } : item);
    setShipments(prev => ({ ...prev, [shpId]: { ...shp, status: "in-transit", dispatchTime: nowISO(), items: updatedItems } }));
    setChain(c => appendBlock(c, { event:"DISPATCH", actor:shp.sender, shipmentId:shpId, item:`${shpId} dispatched (CMD) → ${shp.receiver} — Priority: ${shp.priority}`, valid:true, deliveryConfirmed:false }));
    updatedItems.forEach((item, idx) => {
      setTimeout(() => {
        setChain(c => appendBlock(c, { event:item.tampered?"TAMPER_ALERT":"DISPATCH_LOG", actor:shp.sender, shipmentId:shpId, item:`${item.id} — ${item.name}: ${item.qty} ${item.unit}${item.tampered?" [WEIGHT MISMATCH]":" [OK]"}`, valid:!item.tampered, deliveryConfirmed:false }));
        if (item.tampered) pushNotif({ type: "tamper", title: "⚠ TAMPER ALERT", body: `${item.name} in ${shpId} — anomaly detected.` });
      }, idx * 300);
    });
    pushNotif({ type: "dispatch", title: "📦 DISPATCH CONFIRMED (CMD)", body: `${shpId} dispatched by command authority.` });
  };

  const saveEdit = (shpId) => {
    setShipments(prev => ({ ...prev, [shpId]: { ...prev[shpId], priority: editPriority } }));
    setChain(c => appendBlock(c, { event:"CHECKPOINT", actor:"CMD-CENTER", shipmentId:shpId, item:`Priority updated to ${editPriority} by Command`, valid:true, deliveryConfirmed:false }));
    setEditingId(null);
    pushNotif({ type: "dispatch", title: "✏️ SHIPMENT UPDATED", body: `${shpId} priority → ${editPriority}` });
  };

  const addNewShipment = () => {
    const id = "SHP-CMD-" + Date.now().toString(36).toUpperCase().slice(-4);
    const senderUser = Object.values(USERS).find(u => u.uid === newShip.sender);
    const recvUser = Object.values(USERS).find(u => u.uid === newShip.receiver);
    const newS = { id, sender: newShip.sender, receiver: newShip.receiver, senderName: senderUser?.name || newShip.sender, receiverName: recvUser?.name || newShip.receiver, priority: newShip.priority, status: "pending", dispatchNote: newShip.note, items: newShip.items.filter(i => i.name).map((it, idx) => ({ id: `ITM-CMD${idx+1}`, name: it.name, qty: parseInt(it.qty)||1, unit: it.unit, tampered: false, willTamper: false })), dispatchTime: null, eta: null };
    setShipments(prev => ({ ...prev, [id]: newS }));
    setChain(c => appendBlock(c, { event:"CHECKPOINT", actor:"CMD-CENTER", shipmentId:id, item:`${id} created by Command Center`, valid:true, deliveryConfirmed:false }));
    setShowCreate(false);
    setNewShip({ sender: "SEND-001", receiver: "RECV-001", priority: "HIGH", note: "", items: [{ name: "", qty: "", unit: "units" }] });
    pushNotif({ type: "dispatch", title: "📋 SHIPMENT CREATED (CMD)", body: `${id} enqueued with ${newS.items.length} items.` });
  };

  const sc = (s) => s === "in-transit" ? "blue" : s === "delivered" ? "green" : s === "discrepancy" ? "red" : "gray";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[10px] font-mono text-gray-500 tracking-widest">ALL SHIPMENTS — COMMAND AUTHORITY</span>
        <button onClick={() => setShowCreate(!showCreate)} className="px-3 py-1.5 text-[10px] font-mono border border-emerald-700 text-emerald-400 hover:bg-emerald-900/20 rounded transition-all">+ ENQUEUE SHIPMENT</button>
      </div>
      {showCreate && (
        <div className="bg-black border border-emerald-800/50 rounded-xl p-4 space-y-3">
          <div className="text-[10px] font-mono text-emerald-400 tracking-widest">NEW SHIPMENT — COMMAND AUTHORITY</div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-[9px] font-mono text-gray-600 block mb-1">SENDER</label>
              <select value={newShip.sender} onChange={e => setNewShip(s => ({ ...s, sender: e.target.value }))} className="w-full bg-black/60 border border-gray-800 rounded px-2 py-1.5 text-white font-mono text-[10px] focus:outline-none">
                {Object.values(USERS).filter(u => u.role === "sender").map(u => <option key={u.uid} value={u.uid}>{u.uid}</option>)}
              </select>
            </div>
            <div><label className="text-[9px] font-mono text-gray-600 block mb-1">RECEIVER</label>
              <select value={newShip.receiver} onChange={e => setNewShip(s => ({ ...s, receiver: e.target.value }))} className="w-full bg-black/60 border border-gray-800 rounded px-2 py-1.5 text-white font-mono text-[10px] focus:outline-none">
                {Object.values(USERS).filter(u => u.role === "receiver").map(u => <option key={u.uid} value={u.uid}>{u.uid}</option>)}
              </select>
            </div>
            <div><label className="text-[9px] font-mono text-gray-600 block mb-1">PRIORITY</label>
              <select value={newShip.priority} onChange={e => setNewShip(s => ({ ...s, priority: e.target.value }))} className="w-full bg-black/60 border border-gray-800 rounded px-2 py-1.5 text-white font-mono text-[10px] focus:outline-none">
                {["CRITICAL","HIGH","MEDIUM","LOW"].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div><label className="text-[9px] font-mono text-gray-600 block mb-1">DISPATCH NOTE</label>
            <input value={newShip.note} onChange={e => setNewShip(s => ({ ...s, note: e.target.value }))} placeholder="Optional mission note..." className="w-full bg-black/60 border border-gray-800 rounded px-2 py-1.5 text-white font-mono text-[10px] focus:outline-none placeholder-gray-700" />
          </div>
          <div><label className="text-[9px] font-mono text-gray-600 block mb-1">ITEMS</label>
            {newShip.items.map((it, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <input value={it.name} onChange={e => setNewShip(s => ({ ...s, items: s.items.map((x,j) => j===i ? { ...x, name: e.target.value } : x) }))} placeholder="Item name" className="flex-1 bg-black/60 border border-gray-800 rounded px-2 py-1 text-white font-mono text-[10px] focus:outline-none placeholder-gray-700" />
                <input value={it.qty} onChange={e => setNewShip(s => ({ ...s, items: s.items.map((x,j) => j===i ? { ...x, qty: e.target.value } : x) }))} placeholder="Qty" className="w-14 bg-black/60 border border-gray-800 rounded px-2 py-1 text-white font-mono text-[10px] focus:outline-none placeholder-gray-700" />
                <input value={it.unit} onChange={e => setNewShip(s => ({ ...s, items: s.items.map((x,j) => j===i ? { ...x, unit: e.target.value } : x) }))} placeholder="unit" className="w-16 bg-black/60 border border-gray-800 rounded px-2 py-1 text-white font-mono text-[10px] focus:outline-none placeholder-gray-700" />
              </div>
            ))}
            <button onClick={() => setNewShip(s => ({ ...s, items: [...s.items, { name: "", qty: "", unit: "units" }] }))} className="text-[9px] font-mono text-emerald-600 hover:text-emerald-400">+ ADD ITEM</button>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={addNewShipment} className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-mono text-[10px] rounded transition-all">ENQUEUE & SAVE</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 border border-gray-700 text-gray-500 font-mono text-[10px] rounded transition-all">CANCEL</button>
          </div>
        </div>
      )}
      {allShipments.map(shp => (
        <div key={shp.id} className="bg-black border border-emerald-900/30 rounded-xl p-4">
          <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
            <div>
              <div className="text-sm font-mono font-bold text-white">{shp.id}</div>
              <div className="text-[10px] text-gray-500 font-mono mt-0.5">{shp.senderName} → {shp.receiverName}</div>
              {shp.dispatchNote && <div className="text-[9px] text-gray-600 font-mono mt-0.5 italic">"{shp.dispatchNote}"</div>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color={shp.priority === "CRITICAL" ? "red" : shp.priority === "HIGH" ? "orange" : "yellow"}>{shp.priority}</Badge>
              <Badge color={sc(shp.status)}>{shp.status.toUpperCase()}</Badge>
              {shp.status === "pending" && <button onClick={() => dispatchShipment(shp.id)} className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white font-mono text-[9px] rounded transition-all">▶ DISPATCH</button>}
              {editingId !== shp.id ? (
                <button onClick={() => { setEditingId(shp.id); setEditPriority(shp.priority); }} className="px-3 py-1 border border-gray-700 text-gray-400 hover:border-emerald-700 hover:text-emerald-400 font-mono text-[9px] rounded transition-all">✏ EDIT</button>
              ) : (
                <div className="flex items-center gap-2">
                  <select value={editPriority} onChange={e => setEditPriority(e.target.value)} className="bg-black/60 border border-gray-700 rounded px-2 py-1 text-white font-mono text-[9px] focus:outline-none">
                    {["CRITICAL","HIGH","MEDIUM","LOW"].map(p => <option key={p}>{p}</option>)}
                  </select>
                  <button onClick={() => saveEdit(shp.id)} className="px-2 py-1 bg-emerald-700 text-white font-mono text-[9px] rounded">SAVE</button>
                  <button onClick={() => setEditingId(null)} className="px-2 py-1 border border-gray-700 text-gray-500 font-mono text-[9px] rounded">✕</button>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
            {shp.items.map(item => (
              <div key={item.id} className={`flex items-center gap-2 p-2 rounded border text-[9px] font-mono ${item.tampered ? "border-red-900/50 bg-red-950/10" : "border-gray-800 bg-black/30"}`}>
                <span>{item.tampered ? "⚠" : "📦"}</span>
                <span className="flex-1 truncate text-white">{item.name}</span>
                <span className="text-gray-600">{item.qty} {item.unit}</span>
                {item.tampered && <Badge color="red">TAMPER</Badge>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CommandCenterView({ shipments, chain, setChain, setShipments, pushNotif }) {
  const senderUser = { uid: "SEND-001", role: "sender", name: "Col. R.K. Verma", base: "Pathankot Supply Depot", avatar: "V" };
  const receiverUser = { uid: "RECV-001", role: "receiver", name: "Capt. A. Kapoor", base: "Siachen Forward Post", avatar: "K" };
  return (
    <div className="space-y-4">
      <div className="text-[10px] font-mono text-gray-500 tracking-widest">COMMAND CENTER — DUAL OPERATOR VIEW</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border-2 border-blue-700/40 rounded-xl p-4 bg-blue-950/10">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-blue-800/30">
            <div className="w-6 h-6 rounded-full bg-blue-800 flex items-center justify-center text-xs font-bold text-blue-300">S</div>
            <div><div className="text-xs font-mono text-blue-400 font-bold">SENDER CONSOLE</div><div className="text-[9px] text-gray-500 font-mono">{senderUser.name} — {senderUser.uid}</div></div>
          </div>
          <div className="max-h-96 overflow-y-auto"><SenderDashboard user={senderUser} shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} pushNotif={pushNotif} /></div>
        </div>
        <div className="border-2 border-yellow-700/40 rounded-xl p-4 bg-yellow-950/10">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-yellow-800/30">
            <div className="w-6 h-6 rounded-full bg-yellow-800 flex items-center justify-center text-xs font-bold text-yellow-300">R</div>
            <div><div className="text-xs font-mono text-yellow-400 font-bold">RECEIVER CONSOLE</div><div className="text-[9px] text-gray-500 font-mono">{receiverUser.name} — {receiverUser.uid}</div></div>
          </div>
          <div className="max-h-96 overflow-y-auto"><ReceiverDashboard user={receiverUser} shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} pushNotif={pushNotif} /></div>
        </div>
      </div>
      <div className="border-2 border-emerald-700/40 rounded-xl p-4 bg-emerald-950/10">
        <div className="flex items-center gap-2 mb-3"><Pulse /><span className="text-xs font-mono text-emerald-400 font-bold">LIVE BLOCKCHAIN LEDGER</span></div>
        <div className="max-h-64 overflow-y-auto"><BlockchainLedger chain={chain} /></div>
      </div>
    </div>
  );
}

function ConvoyMap({ offlineMode, localLog, setLocalLog, chain, setChain, pushNotif }) {
  const [progress, setProgress] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncProg, setSyncProg] = useState(0);
  const prevBlackoutRef = useRef(false);
  const prevOfflineModeRef = useRef(false);
  const lastWaypointRef = useRef("");
  const siachenSyncedRef = useRef(false);

  useEffect(() => { const t = setInterval(() => setProgress(p => (p + 0.003) % 1), 80); return () => clearInterval(t); }, []);

  const waypoints = [
    { name: "Pathankot", lat: 32.27, lng: 75.65 }, { name: "Jammu", lat: 32.73, lng: 74.87 },
    { name: "Banihal", lat: 33.40, lng: 75.20 }, { name: "Srinagar", lat: 34.08, lng: 74.80 },
    { name: "Kargil", lat: 34.55, lng: 76.13 }, { name: "Siachen", lat: 35.42, lng: 77.10 },
  ];
  const toXY = (lat, lng) => ({ x: ((lng - 74.5) / (78.0 - 74.5)) * 440 + 30, y: ((35.8 - lat) / (35.8 - 32.0)) * 260 + 20 });
  const seg = Math.min(Math.floor(progress * (waypoints.length - 1)), waypoints.length - 2);
  const segP = progress * (waypoints.length - 1) - seg;
  const from = toXY(waypoints[seg].lat, waypoints[seg].lng);
  const to = toXY(waypoints[seg + 1].lat, waypoints[seg + 1].lng);
  const cx = { x: from.x + (to.x - from.x) * segP, y: from.y + (to.y - from.y) * segP };
  // Blackout = in the corridor zone OR manual offline mode toggle
  const inBlackout = (progress > 0.22 && progress < 0.62) || offlineMode;

  // Detect manual offlineMode toggle → log immediately to local queue
  useEffect(() => {
    const wasOffline = prevOfflineModeRef.current;
    if (offlineMode && !wasOffline) {
      setLocalLog(l => [{ id: Date.now() + Math.random(), text: "⚠ BLACKOUT ACTIVATED (manual) — GPS link severed, DTN mesh engaged, all events buffering locally", time: nowStr(), signed: true }, ...l]);
    } else if (!offlineMode && wasOffline) {
      setLocalLog(l => [{ id: Date.now() + Math.random(), text: "✓ BLACKOUT LIFTED (manual) — GPS restored, buffered events queued for chain sync", time: nowStr(), signed: true }, ...l]);
    }
    prevOfflineModeRef.current = offlineMode;
  }, [offlineMode]);

  // Detect geographic blackout corridor transitions (animation-driven)
  useEffect(() => {
    const geoBkout = progress > 0.22 && progress < 0.62;
    const wasGeoBkout = prevBlackoutRef.current;
    if (geoBkout && !wasGeoBkout && !offlineMode) {
      setLocalLog(l => [{ id: Date.now() + Math.random(), text: "CONVOY entered blackout corridor — GPS link lost, DTN mesh active, buffering locally", time: nowStr(), signed: true }, ...l]);
    } else if (!geoBkout && wasGeoBkout && !offlineMode) {
      setLocalLog(l => [{ id: Date.now() + Math.random(), text: "CONVOY exited blackout corridor — GPS restored, queued events pending sync to chain", time: nowStr(), signed: true }, ...l]);
    }
    prevBlackoutRef.current = geoBkout;
  }, [progress > 0.22 && progress < 0.62]);

  // Log periodic checkpoint events while in blackout (every ~10% progress)
  const checkpointRef = useRef(-1);
  useEffect(() => {
    if (!inBlackout) return;
    const bucket = Math.floor(progress * 100 / 10);
    if (bucket !== checkpointRef.current) {
      checkpointRef.current = bucket;
      const nearestWP = waypoints[seg];
      setLocalLog(l => [{ id: Date.now() + Math.random(), text: `BLACKOUT CHECKPOINT — Near ${nearestWP.name}, ${Math.round(progress * 100)}% route, GPS unavailable, signed by onboard sensor`, time: nowStr(), signed: true }, ...l]);
    }
  }, [inBlackout, Math.floor(progress * 100 / 10)]);

  // Log waypoint arrivals
  useEffect(() => {
    const nearestWP = waypoints[Math.round(progress * (waypoints.length - 1))];
    if (nearestWP && nearestWP.name !== lastWaypointRef.current && Math.abs(progress * (waypoints.length - 1) - Math.round(progress * (waypoints.length - 1))) < 0.04) {
      lastWaypointRef.current = nearestWP.name;
      setLocalLog(l => [{ id: Date.now() + Math.random(), text: `WAYPOINT REACHED: ${nearestWP.name} — position logged${inBlackout ? " [OFFLINE — buffered]" : " [ONLINE — synced]"}`, time: nowStr(), signed: true }, ...l]);
    }
  }, [Math.round(progress * (waypoints.length - 1))]);

  // Auto-sync local queue when convoy reaches Siachen (progress >= 0.98)
  useEffect(() => {
    if (progress >= 0.98 && !siachenSyncedRef.current && localLog.length > 0 && !syncing) {
      siachenSyncedRef.current = true;
      setSyncing(true);
      setSyncProg(0);
      pushNotif({ type: 'delivery', title: '📡 SIACHEN REACHED', body: 'Auto-syncing ' + localLog.length + ' queued events to Hyperledger...' });
      const snapshotLog = [...localLog];
      const t = setInterval(() => {
        setSyncProg(p => {
          if (p >= 100) {
            clearInterval(t);
            setSyncing(false);
            snapshotLog.forEach((e, i) => {
              setTimeout(() => {
                setChain(c => appendBlock(c, { event:'MESH_SYNC', actor:'SIACHEN-FORWARD', shipmentId:'CONVOY', item:e.text, time:e.time, valid:true, deliveryConfirmed:false }));
              }, i * 150);
            });
            setLocalLog([]);
            pushNotif({ type: 'delivery', title: '✅ SYNC COMPLETE', body: snapshotLog.length + ' convoy events committed to blockchain at Siachen Forward Post.' });
            return 100;
          }
          return p + 5;
        });
      }, 80);
    }
    // Reset the flag when progress loops back to 0
    if (progress < 0.05) { siachenSyncedRef.current = false; }
  }, [Math.floor(progress * 100)]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-black border border-emerald-900/40 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2"><Pulse color={inBlackout ? "red" : "green"} /><span className="text-[10px] font-mono text-emerald-400 tracking-widest">LIVE CONVOY GPS TRACKER</span></div>
          <Badge color={inBlackout ? "red" : "green"}>{inBlackout ? "⚠ BLACKOUT — DTN ACTIVE" : "✓ ONLINE — GPS LOCKED"}</Badge>
        </div>
        <svg viewBox="0 0 500 300" className="w-full">
          <rect width="500" height="300" fill="#060d0a" />
          <rect x={120} y={55} width={185} height={140} rx={6} fill="rgba(255,0,0,0.04)" stroke="rgba(255,60,60,0.2)" strokeWidth="1.5" strokeDasharray="6,3" />
          <text x={212} y={73} textAnchor="middle" fill="rgba(255,80,80,0.45)" fontSize="8" fontFamily="monospace">⚠ BLACKOUT CORRIDOR</text>
          <polyline points={waypoints.map(w => { const p = toXY(w.lat, w.lng); return `${p.x},${p.y}`; }).join(" ")} fill="none" stroke="rgba(0,255,100,0.2)" strokeWidth="2" strokeDasharray="6,4" />
          {waypoints.map((w, i) => { const p = toXY(w.lat, w.lng); return (<g key={i}><circle cx={p.x} cy={p.y} r={5} fill="rgba(0,255,100,0.1)" stroke="rgba(0,255,100,0.4)" strokeWidth="1" /><text x={p.x+8} y={p.y+4} fill="rgba(0,255,100,0.65)" fontSize="8" fontFamily="monospace">{w.name}</text></g>); })}
          <rect x={cx.x-9} y={cx.y-8} width={18} height={12} rx={2} fill={inBlackout ? "#ffa500" : "#00ff64"} opacity={0.9} />
          <text x={cx.x} y={cx.y+1} textAnchor="middle" fontSize="8">🚛</text>
          <rect x={8} y={270} width={484} height={22} rx={4} fill="rgba(0,0,0,0.7)" />
          <text x={16} y={285} fill={inBlackout ? "#ffa500" : "#00ff64"} fontSize="8.5" fontFamily="monospace">
            {syncing ? `⛓ AUTO-SYNC IN PROGRESS — Pushing ${localLog.length > 0 ? localLog.length : '...'} events to Hyperledger | ${syncProg}% complete` : inBlackout ? `⚠ BLACKOUT — Mesh DTN active | Last sync: Jammu Relay | ${Math.round(progress*100)}% route` : progress >= 0.98 && siachenSyncedRef.current ? `✓ SIACHEN REACHED — All events synced to blockchain | Route complete` : `✓ ONLINE — GPS lock confirmed | Blockchain sync live | ${Math.round(progress*100)}% route`}
          </text>
        </svg>
      </div>
      <div className="bg-black border border-orange-900/30 rounded-xl p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Pulse color={syncing ? "orange" : localLog.length > 0 ? "orange" : "green"} />
            <span className="text-[9px] font-mono text-orange-400 tracking-widest">
              CONVOY LOCAL QUEUE {syncing ? "(SYNCING...)" : localLog.length > 0 ? `(${localLog.length} PENDING)` : "(SYNCED)"}
            </span>
          </div>
          {localLog.length > 0 && !syncing && (
            <button onClick={() => setLocalLog([])} className="px-2 py-1 text-[8px] font-mono border border-yellow-700 text-yellow-400 hover:bg-yellow-900/20 rounded transition-all">
              ↑ CLEAR
            </button>
          )}
        </div>
        {syncing && (
          <div className="mb-2">
            <div className="text-[9px] font-mono text-emerald-400 mb-1">⛓ RECONCILING TO HYPERLEDGER FABRIC... {syncProg}%</div>
            <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all duration-100" style={{ width: `${syncProg}%` }} />
            </div>
          </div>
        )}
        {!syncing && localLog.length === 0 && <div className="text-[9px] text-gray-600 font-mono text-center py-4">No offline events queued — convoy online</div>}
        {!syncing && localLog.length === 0 && siachenSyncedRef.current && (
          <div className="text-[9px] text-emerald-500 font-mono text-center py-1">✓ All events synced at Siachen Forward Post</div>
        )}
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {localLog.map(e => (
            <div key={e.id} className={`flex items-start gap-2 text-[9px] font-mono bg-black/40 border rounded px-2 py-1.5 ${e.text.includes("entered blackout") ? "border-red-900/40 bg-red-950/10" : e.text.includes("exited blackout") ? "border-emerald-900/40 bg-emerald-950/10" : "border-orange-900/20"}`}>
              <span className={`shrink-0 ${e.text.includes("entered blackout") ? "text-red-400" : e.text.includes("exited blackout") ? "text-emerald-400" : "text-orange-400"}`}>🔒</span>
              <span className={`flex-1 ${e.text.includes("entered blackout") ? "text-red-300" : e.text.includes("exited blackout") ? "text-emerald-300" : "text-gray-400"}`}>{e.text}</span>
              <span className="text-gray-600 shrink-0">{e.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SenderDashboard({ user, shipments, setShipments, chain, setChain, pushNotif }) {
  const myShipments = Object.values(shipments).filter(s => s.sender === user.uid);
  const [showCreate, setShowCreate] = useState(false);
  const [newShip, setNewShip] = useState({ receiver: "RECV-001", priority: "HIGH", note: "", items: [{ name: "", qty: "", unit: "units" }] });

  const dispatchShipment = (shpId) => {
    const shp = shipments[shpId];
    const updatedItems = shp.items.map(item => item.willTamper && !item.tampered ? { ...item, tampered: true } : item);
    setShipments(prev => ({ ...prev, [shpId]: { ...shp, status: "in-transit", dispatchTime: nowISO(), items: updatedItems } }));
    setChain(c => appendBlock(c, { event:"DISPATCH", actor:user.uid, shipmentId:shpId, item:`${shpId} dispatched to ${shp.receiver} (${shp.receiverName}) — Priority: ${shp.priority}`, valid:true, deliveryConfirmed:false }));
    updatedItems.forEach((item, idx) => {
      setTimeout(() => {
        setChain(c => appendBlock(c, { event:item.tampered?"TAMPER_ALERT":"DISPATCH_LOG", actor:user.uid, shipmentId:shpId, item:`${item.id} — ${item.name}: ${item.qty} ${item.unit}${item.tampered?" [WEIGHT MISMATCH DETECTED]":" [OK]"}`, valid:!item.tampered, deliveryConfirmed:false }));
        if (item.tampered) pushNotif({ type: "tamper", title: "⚠ TAMPER ALERT", body: `${item.name} in ${shpId} — weight sensor anomaly detected.` });
      }, idx * 300);
    });
    pushNotif({ type: "dispatch", title: "📦 DISPATCH CONFIRMED", body: `${shpId} is now in transit to ${shp.receiverName}.` });
  };

  const logItem = (shpId, item) => {
    setChain(c => appendBlock(c, { event:item.tampered?"TAMPER_ALERT":"DISPATCH_LOG", actor:user.uid, shipmentId:shpId, item:`${item.id} — ${item.name}: ${item.qty} ${item.unit}${item.tampered?" [TAMPER DETECTED]":""}`, valid:!item.tampered, deliveryConfirmed:false }));
    if (item.tampered) pushNotif({ type: "tamper", title: "⚠ TAMPER ALERT", body: `${item.name} in ${shpId} — anomaly logged to chain.` });
  };

  const addNewShipment = () => {
    const id = "SHP-CUSTOM-" + Date.now().toString(36).toUpperCase().slice(-4);
    const recv = Object.values(USERS).find(u => u.uid === newShip.receiver);
    const newS = { id, sender: user.uid, receiver: newShip.receiver, senderName: user.name, receiverName: recv?.name || newShip.receiver, priority: newShip.priority, status: "pending", dispatchNote: newShip.note, items: newShip.items.filter(i => i.name).map((it, idx) => ({ id: `ITM-C${idx+1}`, name: it.name, qty: parseInt(it.qty)||1, unit: it.unit, tampered: false, willTamper: false })), dispatchTime: null, eta: null };
    setShipments(prev => ({ ...prev, [id]: newS }));
    setShowCreate(false);
    setNewShip({ receiver: "RECV-001", priority: "HIGH", note: "", items: [{ name: "", qty: "", unit: "units" }] });
    pushNotif({ type: "dispatch", title: "📋 SHIPMENT CREATED", body: `${id} created with ${newS.items.length} items.` });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[10px] font-mono text-gray-500 tracking-widest">OUTBOUND SHIPMENTS — {user.uid}</span>
        <button onClick={() => setShowCreate(!showCreate)} className="px-3 py-1.5 text-[10px] font-mono border border-emerald-700 text-emerald-400 hover:bg-emerald-900/20 rounded transition-all">+ CREATE SHIPMENT</button>
      </div>
      {showCreate && (
        <div className="bg-black border border-emerald-800/50 rounded-xl p-4 space-y-3">
          <div className="text-[10px] font-mono text-emerald-400 tracking-widest">NEW SHIPMENT</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[9px] font-mono text-gray-600 block mb-1">RECEIVER</label>
              <select value={newShip.receiver} onChange={e => setNewShip(s => ({ ...s, receiver: e.target.value }))} className="w-full bg-black/60 border border-gray-800 rounded px-2 py-1.5 text-white font-mono text-[10px] focus:outline-none">
                {Object.values(USERS).filter(u => u.role === "receiver").map(u => <option key={u.uid} value={u.uid}>{u.uid} — {u.name}</option>)}
              </select>
            </div>
            <div><label className="text-[9px] font-mono text-gray-600 block mb-1">PRIORITY</label>
              <select value={newShip.priority} onChange={e => setNewShip(s => ({ ...s, priority: e.target.value }))} className="w-full bg-black/60 border border-gray-800 rounded px-2 py-1.5 text-white font-mono text-[10px] focus:outline-none">
                {["CRITICAL","HIGH","MEDIUM","LOW"].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div><label className="text-[9px] font-mono text-gray-600 block mb-1">DISPATCH NOTE</label>
            <input value={newShip.note} onChange={e => setNewShip(s => ({ ...s, note: e.target.value }))} placeholder="Optional mission note..." className="w-full bg-black/60 border border-gray-800 rounded px-2 py-1.5 text-white font-mono text-[10px] focus:outline-none placeholder-gray-700" />
          </div>
          <div><label className="text-[9px] font-mono text-gray-600 block mb-1">ITEMS</label>
            {newShip.items.map((it, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <input value={it.name} onChange={e => setNewShip(s => ({ ...s, items: s.items.map((x,j) => j===i ? { ...x, name: e.target.value } : x) }))} placeholder="Item name" className="flex-1 bg-black/60 border border-gray-800 rounded px-2 py-1 text-white font-mono text-[10px] focus:outline-none placeholder-gray-700" />
                <input value={it.qty} onChange={e => setNewShip(s => ({ ...s, items: s.items.map((x,j) => j===i ? { ...x, qty: e.target.value } : x) }))} placeholder="Qty" className="w-14 bg-black/60 border border-gray-800 rounded px-2 py-1 text-white font-mono text-[10px] focus:outline-none placeholder-gray-700" />
                <input value={it.unit} onChange={e => setNewShip(s => ({ ...s, items: s.items.map((x,j) => j===i ? { ...x, unit: e.target.value } : x) }))} placeholder="unit" className="w-16 bg-black/60 border border-gray-800 rounded px-2 py-1 text-white font-mono text-[10px] focus:outline-none placeholder-gray-700" />
              </div>
            ))}
            <button onClick={() => setNewShip(s => ({ ...s, items: [...s.items, { name: "", qty: "", unit: "units" }] }))} className="text-[9px] font-mono text-emerald-600 hover:text-emerald-400">+ ADD ITEM</button>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={addNewShipment} className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-mono text-[10px] rounded transition-all">CREATE & SAVE</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 border border-gray-700 text-gray-500 font-mono text-[10px] rounded transition-all">CANCEL</button>
          </div>
        </div>
      )}
      {myShipments.map(shp => (
        <div key={shp.id} className="bg-black border border-emerald-900/30 rounded-xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div>
              <div className="text-sm font-mono font-bold text-white">{shp.id}</div>
              <div className="text-[10px] text-gray-500 font-mono mt-0.5">→ {shp.receiver} ({shp.receiverName}) · {shp.priority}</div>
              {shp.dispatchNote && <div className="text-[9px] text-gray-600 font-mono mt-0.5 italic">"{shp.dispatchNote}"</div>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color={shp.priority === "CRITICAL" ? "red" : shp.priority === "HIGH" ? "orange" : "yellow"}>{shp.priority}</Badge>
              <Badge color={shp.status === "in-transit" ? "blue" : shp.status === "delivered" ? "green" : shp.status === "discrepancy" ? "red" : "gray"}>{shp.status.toUpperCase()}</Badge>
              {shp.status === "pending" && <button onClick={() => dispatchShipment(shp.id)} className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white font-mono text-[9px] rounded transition-all">▶ DISPATCH</button>}
            </div>
          </div>
          <div className="space-y-1.5">
            {shp.items.map(item => (
              <div key={item.id} className={`flex items-center gap-3 p-2.5 rounded-lg border ${item.tampered ? "border-red-900/50 bg-red-950/15" : "border-emerald-900/20 bg-emerald-950/10"}`}>
                <div className={`text-base ${item.tampered ? "text-red-500" : "text-emerald-500"}`}>{item.tampered ? "⚠" : "📦"}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono text-white">{item.name}</div>
                  <div className="text-[9px] font-mono text-gray-600">{item.id} · Qty: {item.qty} {item.unit}</div>
                </div>
                {item.tampered && <Badge color="red">TAMPER</Badge>}
                <button onClick={() => logItem(shp.id, item)} className="px-2.5 py-1 text-[9px] font-mono border border-emerald-800 text-emerald-500 hover:bg-emerald-900/30 rounded transition-all">⛓ LOG</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReceiverDashboard({ user, shipments, setShipments, chain, setChain, pushNotif }) {
  const [shipId, setShipId] = useState("");
  const [counts, setCounts] = useState({});
  const [step, setStep] = useState("enter");
  const [report, setReport] = useState(null);
  const incomingShipments = Object.values(shipments).filter(s => s.receiver === user.uid && s.status === "in-transit");
  const myReceived = Object.values(shipments).filter(s => s.receiver === user.uid);
  const loadedShip = shipments[shipId.trim().toUpperCase()];

  const finalize = () => {
    if (!loadedShip) return;
    const results = loadedShip.items.map(item => {
      const entered = parseInt(counts[item.id] || 0);
      const status = item.tampered ? "TAMPERED" : entered === 0 ? "MISSING" : entered !== item.qty ? "QUANTITY_MISMATCH" : "OK";
      return { ...item, entered, expected: item.qty, status };
    });
    const anyIssue = results.some(r => r.status !== "OK");
    const rpt = { id: "RPT-"+Date.now().toString(36).toUpperCase().slice(-6), shipmentId: loadedShip.id, senderUID: loadedShip.sender, receiverUID: user.uid, senderName: loadedShip.senderName, receiverName: user.name, verifiedAt: nowISO(), items: results, verdict: anyIssue ? "DISCREPANCY DETECTED" : "FULLY VERIFIED — ALL CLEAR", verdictOk: !anyIssue };
    setReport(rpt); setStep("report");
    setShipments(prev => ({ ...prev, [loadedShip.id]: { ...loadedShip, status: anyIssue ? "discrepancy" : "delivered" } }));
    setChain(c => {
      const upd = c.map(entry => entry.shipmentId === loadedShip.id && entry.event === "DISPATCH" ? { ...entry, deliveryConfirmed: !anyIssue } : entry);
      return appendBlock(upd, { event: anyIssue ? "TAMPER_CONFIRMED" : "DELIVERY_VERIFIED", actor: user.uid, shipmentId: loadedShip.id, item: anyIssue ? `${rpt.id}: ${results.filter(r=>r.status!=="OK").map(r=>r.name+" ["+r.status+"]").join(", ")}` : `${rpt.id}: All ${results.length} items verified by ${user.uid}`, valid: !anyIssue, deliveryConfirmed: !anyIssue });
    });
    pushNotif({ type: anyIssue ? "tamper" : "delivery", title: anyIssue ? "⚠ DISCREPANCY REPORT" : "✅ DELIVERY CONFIRMED", body: `${loadedShip.id} — ${rpt.verdict}.` });
  };

  const sb = (s) => s === "OK" ? "green" : s === "TAMPERED" ? "red" : s === "QUANTITY_MISMATCH" ? "yellow" : "red";

  return (
    <div className="space-y-4">
      {incomingShipments.length > 0 && (
        <div className="bg-blue-950/30 border border-blue-700/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2"><Pulse /><span className="text-[10px] font-mono text-blue-400 tracking-widest">INCOMING SHIPMENTS</span></div>
          {incomingShipments.map(s => (
            <div key={s.id} className="flex items-center gap-3 flex-wrap">
              <span className="text-[10px] font-mono text-white">{s.id}</span>
              <span className="text-[10px] text-gray-500 font-mono">from {s.senderName}</span>
              <Badge color="blue">IN TRANSIT</Badge>
              <button onClick={() => { setShipId(s.id); setStep("verify"); setCounts({}); }} className="text-[9px] font-mono px-2 py-1 border border-emerald-700 text-emerald-400 hover:bg-emerald-900/20 rounded">VERIFY →</button>
            </div>
          ))}
        </div>
      )}
      {step === "enter" && (
        <div className="bg-black border border-emerald-900/40 rounded-xl p-5">
          <div className="text-[10px] font-mono text-emerald-400 tracking-widest mb-3">STEP 1 — ENTER SHIPMENT ID TO VERIFY</div>
          <div className="text-[10px] text-gray-500 font-mono mb-3">Enter the shipment ID from the physical tag to begin verification.</div>
          <div className="flex gap-3 flex-wrap">
            <input value={shipId} onChange={e => setShipId(e.target.value)} placeholder="e.g. SHP-2024-001" className="flex-1 bg-black/60 border border-emerald-900/40 rounded-lg px-4 py-2 text-white font-mono text-sm focus:outline-none focus:border-emerald-500 min-w-[180px]" />
            <button onClick={() => { if (shipments[shipId.trim().toUpperCase()]) { setStep("verify"); setCounts({}); } }} className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white font-mono text-[10px] rounded-lg transition-all">LOAD</button>
          </div>
          <div className="mt-2 flex gap-2 flex-wrap">
            {myReceived.map(s => <button key={s.id} onClick={() => setShipId(s.id)} className="text-[9px] font-mono border border-emerald-900/30 text-emerald-600 hover:text-emerald-400 rounded px-2 py-1 transition-all">{s.id}</button>)}
          </div>
        </div>
      )}
      {step === "verify" && loadedShip && (
        <div className="bg-black border border-emerald-900/40 rounded-xl p-5">
          <div className="text-[10px] font-mono text-emerald-400 tracking-widest mb-1">STEP 2 — PHYSICAL COUNT ENTRY</div>
          <div className="text-[10px] text-gray-500 font-mono mb-4">Enter actual quantity physically received for each item.</div>
          <div className="space-y-2 mb-4">
            {loadedShip.items.map(item => (
              <div key={item.id} className="flex items-center gap-3 p-3 bg-black/40 border border-gray-800 rounded-lg flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <div className="text-[10px] font-mono text-white">{item.id} — {item.name}</div>
                  <div className="text-[9px] font-mono text-gray-600">Unit: {item.unit}</div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[9px] font-mono text-gray-500">QTY RECEIVED:</label>
                  <input type="number" min="0" value={counts[item.id] ?? ""} onChange={e => setCounts(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder="0" className="w-20 bg-black/70 border border-emerald-900/50 rounded px-2 py-1 text-white font-mono text-xs text-center focus:outline-none" />
                </div>
                {counts[item.id] !== undefined && counts[item.id] !== "" ? <Badge color="green">ENTERED</Badge> : <Badge color="gray">PENDING</Badge>}
              </div>
            ))}
          </div>
          <div className="flex gap-3 flex-wrap">
            <button onClick={finalize} className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white font-mono font-bold text-xs rounded-lg transition-all tracking-widest">FINALIZE & VERIFY ON CHAIN</button>
            <button onClick={() => setStep("enter")} className="px-4 py-2.5 border border-gray-700 text-gray-500 font-mono text-[10px] rounded-lg transition-all">← BACK</button>
          </div>
        </div>
      )}
      {step === "report" && report && (
        <div className={`bg-black border ${report.verdictOk ? "border-emerald-600/50" : "border-red-600/50"} rounded-xl p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`text-3xl ${report.verdictOk ? "text-emerald-400" : "text-red-400"}`}>{report.verdictOk ? "✓" : "⚠"}</div>
            <div>
              <div className={`text-sm font-mono font-bold ${report.verdictOk ? "text-emerald-400" : "text-red-400"}`}>{report.verdict}</div>
              <div className="text-[9px] font-mono text-gray-500 mt-0.5">{report.id}</div>
            </div>
          </div>
          <div className="space-y-1.5 mb-4">
            {report.items.map(item => (
              <div key={item.id} className={`flex items-center gap-3 p-2.5 rounded border text-[10px] font-mono ${item.status === "OK" ? "border-emerald-900/30 bg-emerald-950/10" : "border-red-900/30 bg-red-950/15"}`}>
                <span>{item.status === "OK" ? "✓" : "⚠"}</span>
                <span className="flex-1 text-white">{item.name}</span>
                <span className="text-gray-500">Got: <span className="text-white">{item.entered}</span> / Expected: <span className="text-white">{item.expected}</span> {item.unit}</span>
                <Badge color={sb(item.status)}>{item.status}</Badge>
              </div>
            ))}
          </div>
          <div className={`p-3 rounded-lg border text-[10px] font-mono ${report.verdictOk ? "border-emerald-800 bg-emerald-950/20 text-emerald-400" : "border-red-800 bg-red-950/20 text-red-400"}`}>
            📋 Report committed to Hyperledger.{!report.verdictOk && " ⚠ Security incident flagged. Command notified."}
          </div>
          <button onClick={() => { setStep("enter"); setShipId(""); setCounts({}); setReport(null); }} className="mt-3 w-full py-2 border border-gray-700 text-gray-500 font-mono text-[10px] rounded-lg hover:border-emerald-800 transition-all">NEW VERIFICATION</button>
        </div>
      )}
    </div>
  );
}

const RESET_CODE = "RESET-SANGAM-2024";
const RESET_WINDOW = 40000;
let resetAttempts = [];

function checkResetCondition() {
  const now = Date.now();
  resetAttempts = resetAttempts.filter(a => now - a.timestamp < RESET_WINDOW);
  return resetAttempts.some(a => a.role === "sender") && resetAttempts.some(a => a.role === "receiver");
}
function addResetAttempt(uid, role) { resetAttempts = resetAttempts.filter(a => a.uid !== uid); resetAttempts.push({ uid, role, timestamp: Date.now() }); }
function clearResetAttempt(uid) { resetAttempts = resetAttempts.filter(a => a.uid !== uid); }

function loadState(key, fallback) {
  try { const s = localStorage.getItem("sangam-" + key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
}

export default function SANGAM() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [chain, setChain] = useState(() => loadState("chain", INIT_CHAIN));
  const [shipments, setShipments] = useState(() => loadState("shipments", INIT_SHIPMENTS));
  const [offlineMode, setOfflineMode] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetInput, setResetInput] = useState("");
  const [resetStatus, setResetStatus] = useState("");
  const [autoDemo, setAutoDemo] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [nodes, setNodes] = useState(() => loadState("nodes", MESH_NODES_INIT));
  const [routeLedgerPrev, setRouteLedgerPrev] = useState([]); // last completed journey
  const [routeLedgerCur,  setRouteLedgerCur]  = useState([]); // current journey
  const routeLedger = [...routeLedgerPrev.map(e=>({...e,_prev:true})), ...routeLedgerCur];
  const setRouteLedger = (fn) => setRouteLedgerCur(fn); // default writes go to cur
  const [localLog, setLocalLog] = useState([]);
  const [alertInbox, setAlertInbox] = useState(() => loadState("alerts", []));
  const [convoyShipments, setConvoyShipments] = useState({ alpha: null, bravo: null });
  useEffect(() => { localStorage.setItem("sangam-chain", JSON.stringify(chain)); }, [chain]);
  useEffect(() => { localStorage.setItem("sangam-shipments", JSON.stringify(shipments)); }, [shipments]);
  useEffect(() => { localStorage.setItem("sangam-alerts", JSON.stringify(alertInbox)); }, [alertInbox]);
  useEffect(() => { localStorage.setItem("sangam-nodes", JSON.stringify(nodes)); }, [nodes]);
  const pushAlert = (alert) => {
    const id = Date.now() + Math.random();
    setAlertInbox(prev => [{ ...alert, id, time: nowStr(), read: false }, ...prev]);
  };

  const pushNotif = (n) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { ...n, id }]);
    setTimeout(() => setNotifications(prev => prev.filter(x => x.id !== id)), 6000);
    // Persist tamper + critical alerts to command inbox
    if (n.type === "tamper" || n.title?.includes("CRITICAL") || n.type === "delivery") {
      setAlertInbox(prev => [{ ...n, id: id + 0.1, time: nowStr(), read: false }, ...prev.slice(0, 99)]);
    }
  };
  const dismissNotif = (id) => setNotifications(prev => prev.filter(x => x.id !== id));

  const runAutoDemo = () => {
    setAutoDemo(true); setDemoStep(0);
    pushNotif({ type: "delivery", title: "🎮 AUTO-DEMO STARTED", body: "Running full workflow demonstration..." });
    setTimeout(() => {
      setDemoStep(1);
      const demoShipId = "SHP-DEMO-" + Date.now().toString(36).toUpperCase().slice(-4);
      const demoShip = { id: demoShipId, sender: "SEND-001", receiver: "RECV-001", senderName: "Col. R.K. Verma", receiverName: "Capt. A. Kapoor", priority: "CRITICAL", status: "pending", items: [{ id: "ITM-D1", name: "Demo Medical Supplies", qty: 100, unit: "units", tampered: false, willTamper: false }, { id: "ITM-D2", name: "Demo Ammunition", qty: 500, unit: "rounds", tampered: false, willTamper: true }], dispatchTime: null, eta: null, dispatchNote: "Auto-generated demo shipment" };
      setShipments(prev => ({ ...prev, [demoShipId]: demoShip }));
      pushNotif({ type: "dispatch", title: "📋 DEMO: Shipment Created", body: `${demoShipId} created` });
      setTimeout(() => {
        setDemoStep(2);
        const updatedItems = demoShip.items.map(item => item.willTamper ? { ...item, tampered: true } : item);
        setShipments(prev => ({ ...prev, [demoShipId]: { ...demoShip, status: "in-transit", dispatchTime: nowISO(), items: updatedItems } }));
        setChain(c => appendBlock(c, { event:"DISPATCH", actor:"SEND-001", shipmentId:demoShipId, item:`${demoShipId} dispatched (AUTO-DEMO)`, valid:true, deliveryConfirmed:false }));
        pushNotif({ type: "dispatch", title: "📦 DEMO: Dispatched", body: "Shipment in transit..." });
        setTimeout(() => {
          setDemoStep(3);
          setChain(c => appendBlock(c, { event:"TAMPER_ALERT", actor:"NODE-04", shipmentId:demoShipId, item:"ITM-D2 Demo Ammunition — weight mismatch detected", valid:false, deliveryConfirmed:false }));
          pushNotif({ type: "tamper", title: "⚠️ DEMO: Tamper Detected", body: "Demo Ammunition anomaly detected" });
          setTimeout(() => {
            setDemoStep(4);
            setShipments(prev => ({ ...prev, [demoShipId]: { ...prev[demoShipId], status: "discrepancy" } }));
            setChain(c => appendBlock(c, { event:"TAMPER_CONFIRMED", actor:"RECV-001", shipmentId:demoShipId, item:`${demoShipId}: Discrepancy confirmed [TAMPERED]`, valid:false, deliveryConfirmed:false }));
            pushNotif({ type: "tamper", title: "⚠️ DEMO: Verification Failed", body: "Receiver confirmed discrepancy." });
            setTimeout(() => { setDemoStep(5); setAutoDemo(false); pushNotif({ type: "delivery", title: "✅ AUTO-DEMO COMPLETE", body: "Full workflow: Create → Dispatch → Tamper → Verify" }); }, 2000);
          }, 3000);
        }, 2000);
      }, 2000);
    }, 1000);
  };

  // Refs to hold active reset timer handles — prevents stale closure bugs and double-submit races
  const resetActiveRef = useRef(false);
  const resetCdownRef = useRef(null);
  const resetChkRef = useRef(null);
  const resetTimeoutRef = useRef(null);

  const clearResetTimers = () => {
    resetActiveRef.current = false;
    if (resetCdownRef.current) { clearInterval(resetCdownRef.current); resetCdownRef.current = null; }
    if (resetChkRef.current) { clearInterval(resetChkRef.current); resetChkRef.current = null; }
    if (resetTimeoutRef.current) { clearTimeout(resetTimeoutRef.current); resetTimeoutRef.current = null; }
  };

  const doSystemReset = () => {
    clearResetTimers();
    resetAttempts = [];
    const freshChain = GENESIS_DATA.reduce((c, d) => appendBlock(c, d), []);
    setChain(freshChain); setShipments(INIT_SHIPMENTS); setOfflineMode(false); setLocalLog([]);
    ["chain","shipments","alerts","nodes"].forEach(k => localStorage.removeItem("sangam-" + k));
    setResetStatus("✓ SYSTEM RESET COMPLETE");
    pushNotif({ type: "delivery", title: "✅ SYSTEM RESET", body: "All data cleared. Fresh start." });
    setTimeout(() => { setShowResetModal(false); setResetInput(""); setResetStatus(""); }, 2000);
  };

  const handleResetSubmit = () => {
    if (resetInput.trim().toUpperCase() !== RESET_CODE) { setResetStatus("❌ INVALID CODE"); setTimeout(() => setResetStatus(""), 2000); return; }
    // If timers already running (re-submit), cancel and restart
    if (resetActiveRef.current) { clearResetTimers(); }
    addResetAttempt(user.uid, user.role);
    if (checkResetCondition()) { doSystemReset(); return; }

    const waitingFor = user.role === "sender" ? "RECEIVER" : "SENDER";
    const startTime = Date.now();
    resetActiveRef.current = true;

    // Countdown display
    resetCdownRef.current = setInterval(() => {
      if (!resetActiveRef.current) { clearInterval(resetCdownRef.current); resetCdownRef.current = null; return; }
      const rem = Math.max(0, Math.floor((RESET_WINDOW - (Date.now() - startTime)) / 1000));
      setResetStatus(`⏳ WAITING FOR ${waitingFor} (${rem}s remaining)`);
    }, 1000);

    // Poll for other party completing
    resetChkRef.current = setInterval(() => {
      if (!resetActiveRef.current) { clearInterval(resetChkRef.current); resetChkRef.current = null; return; }
      if (checkResetCondition()) { doSystemReset(); }
    }, 500);

    // Hard timeout
    resetTimeoutRef.current = setTimeout(() => {
      if (!resetActiveRef.current) return;
      clearResetTimers();
      setResetStatus("⚠ TIMEOUT — Other party did not respond in time");
      clearResetAttempt(user.uid);
      setTimeout(() => { setResetStatus(""); setResetInput(""); }, 3500);
    }, RESET_WINDOW);
  };

  const TABS = user?.role === "command"
    ? [{ id: "shipments", label: "📦 SHIPMENTS" }, { id: "convoy", label: "🛻 LIVE GPS" }, { id: "stats", label: "📊 STATS" }, { id: "overview", label: "🎯 OVERVIEW" }, { id: "alerts", label: "🔔 ALERTS" }, { id: "reset", label: "🔄 RESET SYSTEM" }]
    : user?.role === "sender"
    ? [{ id: "dashboard", label: "📦 SHIPMENTS" }, { id: "convoy", label: "🛻 CONVOY" }, { id: "mesh", label: "🌐 MESH NET" }, { id: "chain", label: "⛓ LEDGER" }, { id: "qr", label: "📷 QR SCAN" }]
    : [{ id: "dashboard", label: "✅ VERIFY" }, { id: "convoy", label: "🛻 CONVOY" }, { id: "mesh", label: "🌐 MESH NET" }, { id: "chain", label: "⛓ LEDGER" }];

  if (!user) return <LoginPage onLogin={(u) => { setUser(u); setTab(u.role === "command" ? "shipments" : "dashboard"); pushNotif({ type: "delivery", title: "✓ AUTHENTICATED", body: `Welcome ${u.name} — ${u.base}` }); }} />;

  const onlineNodes = nodes.filter(n => n.online).length;
  const chainCheck = verifyChain(chain);

  return (
    <div className="min-h-screen bg-black text-white" style={{ fontFamily: "'Courier New',monospace" }}>
      <style>{`
        @keyframes ping{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.5);opacity:0}}
        @keyframes blink-critical{0%,100%{opacity:1;background-color:rgba(220,38,38,0.15)}50%{opacity:0.6;background-color:rgba(220,38,38,0.25)}}
        .animate-blink-critical{animation:blink-critical 1.5s ease-in-out infinite}
        ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(0,255,100,0.2);border-radius:2px}
      `}</style>

      <NotificationStack notifications={notifications} onDismiss={dismissNotif} />

      {/* TOPBAR */}
      <div className="border-b border-emerald-900/30 bg-black sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-sm">⛓️</div>
            <div>
              <div className="text-sm font-black tracking-[0.2em] text-emerald-400">SANGAM</div>
              <div className="text-[7px] text-gray-600 tracking-widest hidden sm:block">DEFENCE SUPPLY CHAIN • DTN BLOCKCHAIN</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="hidden sm:flex items-center gap-3 text-[9px] font-mono text-gray-600">
              <span className="flex items-center gap-1"><Pulse />{onlineNodes}/{nodes.length} NODES</span>
              <span>⛓ {chain.length} BLOCKS</span>
              <span>🇮🇳</span>
            </div>
            <div className="flex items-center gap-1.5 bg-black/40 border border-gray-800 rounded-lg px-2 py-1.5">
              <div className="w-5 h-5 rounded-full bg-emerald-800 flex items-center justify-center text-[10px] font-bold text-emerald-300">{user.avatar}</div>
              <div className="hidden sm:block">
                <div className="text-[9px] text-white font-mono">{user.name}</div>
                <div className="text-[8px] text-gray-500">{user.uid}</div>
              </div>
            </div>
            <Badge color={user.role === "sender" ? "blue" : user.role === "command" ? "purple" : "yellow"}>{user.role.toUpperCase()}</Badge>
            <button onClick={() => { clearResetTimers(); clearResetAttempt(user.uid); setShowResetModal(false); setResetInput(""); setResetStatus(""); setUser(null); }} className="text-[9px] font-mono text-gray-600 hover:text-red-400 border border-gray-800 hover:border-red-900 rounded px-2 py-1.5 transition-all">LOGOUT</button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-3 flex gap-0.5 overflow-x-auto">
          {TABS.map(t => {
            const unread = t.id === "alerts" ? alertInbox.filter(a=>!a.read).length : 0;
            return (
              <button key={t.id} onClick={() => { setTab(t.id); if (t.id==="alerts") setAlertInbox(p=>p.map(a=>({...a,read:true}))); }} className={`relative px-3 py-2 text-[9px] font-mono tracking-widest whitespace-nowrap border-b-2 transition-all ${tab === t.id ? "border-emerald-500 text-emerald-400" : "border-transparent text-gray-600 hover:text-gray-400"}`}>
                {t.label}
                {unread > 0 && <span className="absolute top-1 right-0 w-4 h-4 rounded-full bg-red-600 text-white text-[7px] flex items-center justify-center font-bold">{unread}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 py-4">
        {/* STATUS BAR */}
        <div className="flex items-center gap-3 mb-4 px-3 py-2 bg-black border border-emerald-900/25 rounded-xl text-[9px] font-mono text-gray-400 flex-wrap">
          <span className="flex items-center gap-1.5"><Pulse /> SYSTEM OPERATIONAL</span>
          <span className="text-gray-700">|</span>
          <span>BASE: {user.base}</span>
          <span className="text-gray-700">|</span>
          <span>{Object.values(shipments).filter(s => s.status === "in-transit").length} IN TRANSIT</span>
          <span className="text-gray-700">|</span>
          <span className={chainCheck.valid ? "text-emerald-400" : "text-red-400"}>⛓ {chainCheck.valid ? "CHAIN INTACT" : "⚠ CHAIN BROKEN"}</span>
          <span className="text-gray-700">|</span>
          <span className={offlineMode ? "text-red-400" : "text-emerald-400"}>{offlineMode ? "⚠ OFFLINE MODE" : "✓ ONLINE"}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={runAutoDemo} disabled={autoDemo} className="px-2.5 py-1 rounded border border-purple-700 text-purple-400 hover:bg-purple-950/20 text-[9px] font-mono transition-all disabled:opacity-50">
              {autoDemo ? `🎮 DEMO ${demoStep}/5` : "🎮 RUN DEMO"}
            </button>
            <button onClick={() => setOfflineMode(o => !o)} className={`px-2.5 py-1 rounded border text-[9px] font-mono transition-all ${offlineMode ? "border-red-700 text-red-400 bg-red-950/20" : "border-gray-700 text-gray-500 hover:border-emerald-800"}`}>
              {offlineMode ? "BLACKOUT ON" : "BLACKOUT OFF"}
            </button>
            {user.role === "command" && (
              <button onClick={() => setShowResetModal(true)} className="px-2.5 py-1 rounded border border-orange-700 text-orange-400 hover:bg-orange-950/20 text-[9px] font-mono transition-all">🔄 RESET</button>
            )}
          </div>
        </div>

        {/* RESET MODAL */}
        {showResetModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[99999] p-4">
            <div className="bg-black border-2 border-orange-600/60 rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="text-3xl">⚠️</div>
                <div>
                  <div className="text-lg font-mono font-bold text-orange-400">SYSTEM RESET</div>
                  <div className="text-[10px] text-gray-500 font-mono mt-0.5">REQUIRES BOTH SENDER & RECEIVER</div>
                </div>
              </div>
              <div className="bg-orange-950/30 border border-orange-800/40 rounded-lg p-3 mb-4">
                <div className="text-[10px] font-mono text-orange-300 leading-relaxed">
                  ⚠ <strong>WARNING:</strong> Clears all shipments, blockchain logs, and resets to initial state.<br/><br/>
                  <strong>BOTH</strong> a sender and receiver must enter the reset code within <strong>40 seconds</strong>.
                </div>
              </div>
              <div className="bg-emerald-950/40 border-2 border-emerald-600/50 rounded-xl p-4 mb-4 text-center">
                <div className="text-[9px] font-mono text-gray-400 tracking-widest mb-1">🔑 RESET CODE — SHARE THIS WITH SENDER & RECEIVER</div>
                <div className="text-xl font-mono font-bold text-emerald-300 tracking-[0.2em] select-all">RESET-SANGAM-2024</div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-mono text-gray-400 mb-1.5 tracking-widest">ENTER RESET CODE</label>
                  <input type="text" value={resetInput} onChange={e => setResetInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleResetSubmit()} placeholder="RESET-SANGAM-2024" className="w-full bg-black border border-orange-900/50 rounded-lg px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-orange-500/70 placeholder-gray-700 transition-all" />
                </div>
                {resetStatus && (
                  <div className={`text-[10px] font-mono p-2 rounded border ${resetStatus.includes("✓") ? "bg-emerald-950/30 border-emerald-700/40 text-emerald-400" : resetStatus.includes("⏳") ? "bg-blue-950/30 border-blue-700/40 text-blue-400" : "bg-red-950/30 border-red-700/40 text-red-400"}`}>{resetStatus}</div>
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={handleResetSubmit} disabled={!resetInput.trim()} className="flex-1 px-4 py-2.5 bg-orange-700 hover:bg-orange-600 disabled:bg-orange-900/30 disabled:cursor-not-allowed text-white font-mono text-[10px] rounded-lg transition-all tracking-widest">SUBMIT CODE</button>
                  <button onClick={() => { clearResetTimers(); clearResetAttempt(user.uid); setShowResetModal(false); setResetInput(""); setResetStatus(""); }} className="px-4 py-2.5 border border-gray-700 text-gray-500 hover:text-white hover:border-gray-500 font-mono text-[10px] rounded-lg transition-all">CANCEL</button>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-800/60 text-[9px] text-gray-600 font-mono text-center">Your role: <span className="text-white">{user.role.toUpperCase()}</span> ({user.uid})</div>
            </div>
          </div>
        )}

        {/* TAB CONTENT */}
        {user.role === "command" && tab === "alerts" && (
          <div className="bg-black border border-emerald-900/40 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2"><Pulse color="red" /><span className="text-[10px] font-mono text-red-400 tracking-widest">COMMAND ALERT INBOX</span><span className="text-[9px] font-mono text-gray-600">{alertInbox.filter(a=>!a.read).length} unread</span></div>
              <button onClick={()=>setAlertInbox([])} className="text-[8px] font-mono text-gray-600 hover:text-red-400 border border-gray-800 rounded px-2 py-1">CLEAR ALL</button>
            </div>
            {alertInbox.length === 0 && <div className="text-[9px] text-gray-600 font-mono text-center py-8">No alerts</div>}
            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
              {alertInbox.map(a => {
                const col = a.type==="tamper" ? "border-red-900/50 bg-red-950/10" : a.type==="dispatch" ? "border-blue-900/40 bg-blue-950/10" : "border-emerald-900/40 bg-emerald-950/10";
                const dot = a.type==="tamper" ? "bg-red-500" : a.type==="dispatch" ? "bg-blue-500" : "bg-emerald-500";
                return (
                  <div key={a.id} className={`flex items-start gap-2 p-2.5 rounded border ${col} ${!a.read ? "opacity-100" : "opacity-50"}`}>
                    <span className={`w-2 h-2 rounded-full mt-0.5 shrink-0 ${dot} ${!a.read ? "animate-pulse" : ""}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] font-mono text-white font-bold">{a.title}</div>
                      <div className="text-[8px] font-mono text-gray-400 mt-0.5">{a.body}</div>
                    </div>
                    <span className="text-[8px] font-mono text-gray-600 shrink-0">{a.time}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {tab === "dashboard" && user.role !== "command" && (user.role === "sender" ? <SenderDashboard user={user} shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} pushNotif={pushNotif} /> : <ReceiverDashboard user={user} shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} pushNotif={pushNotif} />)}

        {user.role === "command" && tab === "shipments" && <CommandShipments shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} pushNotif={pushNotif} />}
        {user.role === "command" && tab === "stats" && <StatsDashboard shipments={shipments} chain={chain} nodes={nodes} />}
        {user.role === "command" && tab === "overview" && <CommandCenterView shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} pushNotif={pushNotif} />}
        {user.role === "command" && tab === "reset" && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-black border-2 border-orange-600/60 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="text-3xl">⚠️</div>
                <div>
                  <div className="text-lg font-mono font-bold text-orange-400">SYSTEM RESET CONTROL</div>
                  <div className="text-[10px] text-gray-500 font-mono mt-0.5">COMMAND CENTER AUTHORITY</div>
                </div>
              </div>
              <div className="bg-emerald-950/40 border-2 border-emerald-600/50 rounded-xl p-6 mb-5 text-center">
                <div className="text-[10px] font-mono text-gray-400 tracking-widest mb-2">🔑 RESET CODE — SHARE WITH SENDER & RECEIVER</div>
                <div className="text-2xl font-mono font-bold text-emerald-300 tracking-[0.25em] select-all">RESET-SANGAM-2024</div>
                <div className="text-[9px] font-mono text-gray-500 mt-2">Both must enter this within 40 seconds to confirm reset</div>
              </div>
              <div className="text-xs font-mono text-gray-400 leading-relaxed mb-5">
                Distribute this code to one sender and one receiver simultaneously. Both must enter it within the 40-second window for the reset to execute. Use between demonstration rounds to clear all shipments, blockchain logs, and return to initial state.
              </div>
              <button onClick={() => setShowResetModal(true)} className="w-full py-3 bg-orange-700 hover:bg-orange-600 text-white font-mono font-bold text-sm rounded-lg transition-all">INITIATE RESET SEQUENCE</button>
            </div>
          </div>
        )}

        {tab === "convoy" && <ConvoyMap offlineMode={offlineMode} localLog={localLog} setLocalLog={setLocalLog} chain={chain} setChain={setChain} pushNotif={pushNotif} />}
        {tab === "mesh" && <MeshTab offlineMode={offlineMode} setOfflineMode={setOfflineMode} chain={chain} setChain={setChain} nodes={nodes} setNodes={setNodes} localLog={localLog} setLocalLog={setLocalLog} routeLedger={routeLedger} setRouteLedger={setRouteLedger} clearRouteLedger={()=>{setRouteLedgerPrev([]);setRouteLedgerCur([]);}} rotateLedger={(entry)=>{setRouteLedgerCur(cur=>{setRouteLedgerPrev(cur);return[entry];});}} pushNotif={pushNotif} shipments={shipments} convoyShipments={convoyShipments} setConvoyShipments={setConvoyShipments} setShipments={setShipments} onShipmentDelivered={(shpId,truck)=>{setShipments(p=>({...p,[shpId]:{...p[shpId],status:"delivered",deliveredBy:truck,deliveredAt:nowStr()}}));setConvoyShipments(p=>({...p,[truck==='Alpha'?'alpha':'bravo']:null}));}} />}
        {tab === "chain" && <BlockchainLedger chain={chain} />}
        {tab === "qr" && user.role !== "command" && <QRScanner user={user} chain={chain} setChain={setChain} />}
      </div>
    </div>
  );
}
