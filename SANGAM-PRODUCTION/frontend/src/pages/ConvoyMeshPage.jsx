import { useState, useEffect, useRef } from "react";
import "../styles/convoy-mesh.css";

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
    if (b.hash !== hashFull(raw)) return { valid: false, at: b.block, reason: "data tampered - hash mismatch" };
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
  { event:"GENESIS", actor:"SYSTEM", shipmentId:"---", item:"SANGAM v3.0 genesis block - hash chain initialized", valid:true, deliveryConfirmed:false },
  { event:"CHECKPOINT", actor:"NODE-02", shipmentId:"---", item:"Jammu relay checkpoint verified", valid:true, deliveryConfirmed:false },
  { event:"MESH_SYNC", actor:"NODE-03", shipmentId:"---", item:"Offline queue synced - 3 events pushed", valid:true, deliveryConfirmed:false },
];
const INIT_CHAIN = GENESIS_DATA.reduce((c, d) => appendBlock(c, d), []);

const Badge = ({ children, color }) => {
  const m = { green:"cm-badge-green", red:"cm-badge-red", yellow:"cm-badge-yellow", blue:"cm-badge-blue", gray:"cm-badge-gray", orange:"cm-badge-orange", purple:"cm-badge-purple" };
  return <span className={"cm-badge " + (m[color] || m.gray)}>{children}</span>;
};

const Pulse = ({ color }) => (
  <span className={"cm-pulse cm-pulse-" + (color || "green")}>
    <span className="cm-pulse-inner cm-pulse-anim" />
    <span className="cm-pulse-dot" />
  </span>
);

function NotificationStack({ notifications, onDismiss }) {
  return (
    <div className="cm-notif-stack">
      {notifications.map(n => (
        <div key={n.id} className={"cm-notif " + (n.type === "dispatch" ? "cm-notif-dispatch" : n.type === "tamper" ? "cm-notif-tamper" : n.type === "delivery" ? "cm-notif-delivery" : "cm-notif-default")}>
          <div className="cm-text-lg cm-shrink-0">{n.type === "dispatch" ? "\uD83D\uDCE6" : n.type === "tamper" ? "\u26A0\uFE0F" : n.type === "delivery" ? "\u2705" : "\uD83D\uDD14"}</div>
          <div className="cm-flex-1 cm-min-w-0">
            <div className={"cm-text-[9px] cm-font-mono cm-font-bold " + (n.type === "dispatch" ? "cm-text-blue-400" : n.type === "tamper" ? "cm-text-red-400" : "cm-text-emerald-400")}>{n.title}</div>
            <div className="cm-text-[9px] cm-text-gray-600 cm-font-mono cm-mt-0.5 cm-leading-relaxed">{n.body}</div>
          </div>
          <button onClick={() => onDismiss(n.id)} className="cm-text-gray-600 cm-hover:text-white cm-text-xs cm-ml-1 cm-shrink-0" style={{background:"none",border:"none",cursor:"pointer"}}>?</button>
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
    if (!user || user.password !== hashPassword(password.trim())) { setError("ACCESS DENIED - Invalid credentials"); return; }
    setLoading(true); setError("");
    setTimeout(() => { onLogin({ username: key, ...user }); setLoading(false); }, 1200);
  };

  return (
    <div className="cm-min-h-screen cm-bg-black cm-flex cm-flex-col cm-items-center cm-justify-center cm-relative cm-overflow-hidden">
      <div className="cm-login-grid" />
      <div className="cm-relative cm-z-10 cm-w-full cm-max-w-md cm-px-4">
        <div className="cm-text-center cm-mb-6">
          <div className="cm-inline-flex cm-items-center cm-gap-3 cm-mb-3">
            <div className="cm-w-10 cm-h-10 cm-rounded-xl" style={{background:"rgba(0,255,100,0.1)",border:"1px solid rgba(0,255,100,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px"}}>??</div>
            <div className="cm-text-left">
              <div className="cm-text-xl cm-font-black cm-tracking-widest cm-text-white cm-font-mono">SANGAM</div>
              <div className="cm-text-[9px] cm-text-emerald-400 cm-tracking-widest cm-font-mono" style={{opacity:0.6}}>SUPPLY CHAIN INTEGRITY SYSTEM</div>
            </div>
          </div>
          <div className="cm-text-[9px] cm-text-gray-600 cm-font-mono">PERMISSIONED BLOCKCHAIN / OFFLINE-FIRST / DTN PROTOCOL</div>
          <div className="cm-mt-1 cm-text-[9px] cm-font-mono" style={{color:"rgba(0,255,100,0.4)"}}>SYSTEM ONLINE{dots}</div>
        </div>
        <div className="cm-bg-black cm-border-2 cm-border-emerald-900/40 cm-rounded-2xl cm-p-6">
          <div className="cm-flex cm-items-center cm-gap-2 cm-mb-4"><Pulse /><span className="cm-text-[10px] cm-font-mono cm-text-emerald-400 cm-tracking-widest">SECURE AUTHENTICATION PORTAL</span></div>
          <div className="cm-space-y-3">
            <div>
              <label className="cm-block cm-text-[9px] cm-font-mono cm-text-gray-400 cm-mb-1 cm-tracking-widest">PERSONNEL CALLSIGN</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. CMD_VERMA" className="cm-input cm-w-full" style={{padding:"10px 12px",fontSize:"13px"}} />
            </div>
            <div>
              <label className="cm-block cm-text-[9px] cm-font-mono cm-text-gray-400 cm-mb-1 cm-tracking-widest">PASSWORD</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Enter password..." className="cm-input cm-w-full" style={{padding:"10px 12px",fontSize:"13px"}} />
            </div>
            {error && <div className="cm-text-[9px] cm-text-red-400 cm-font-mono cm-bg-red-500/10 cm-border cm-border-red-500/20 cm-rounded cm-px-3 cm-py-2">{error}</div>}
            <button onClick={handleLogin} disabled={loading || !username || !password} className="cm-w-full cm-bg-emerald-700 cm-hover-bg-emerald-600 cm-disabled-bg-emerald-900/30 cm-disabled-cursor-not-allowed cm-text-white cm-font-mono cm-font-bold cm-text-xs cm-py-2.5 cm-rounded-lg cm-transition-all cm-tracking-widest">
              {loading ? "AUTHENTICATING..." : "AUTHENTICATE & ENTER"}
            </button>
          </div>
          <div className="cm-mt-4 cm-pt-3 cm-border-t" style={{borderColor:"rgba(31,41,55,0.6)"}}>
            <div className="cm-text-[9px] cm-font-mono cm-text-gray-500 cm-mb-2 cm-tracking-widest">DEMO ACCOUNTS - CLICK TO AUTOFILL</div>
            <div className="cm-grid cm-grid-cols-2 cm-gap-1.5">
              {Object.entries(USERS).map(([k, u]) => (
                <button key={k} onClick={() => { setUsername(k); setPassword(u._plain); }} className="cm-text-left cm-bg-black cm-border cm-border-gray-800 cm-hover-border-emerald-800/60 cm-rounded-lg cm-p-2 cm-transition-all" style={{cursor:"pointer"}}>
                  <div className="cm-text-[9px] cm-font-mono cm-text-emerald-400 cm-truncate" style={{opacity:0.8}}>{k}</div>
                  <div className="cm-text-[8px] cm-text-gray-600 cm-mt-0.5">{u.role.toUpperCase()} / {u.uid}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="cm-text-center cm-mt-3 cm-text-[9px] cm-text-gray-700 cm-font-mono">SANGAM v3.0 / FIRECHAIN BRAHMINS / MADE IN INDIA</div>
      </div>
    </div>
  );
}

const MeshNodeSVG = ({ node, selected, onClick, x, y, mapPos }) => {
  const s = selected && node.id === selected.id;
  const isOffline = !node.online;
  const label = x === undefined;
  const idText = node.id.replace("NODE-", "");

  const color = isOffline ? "#1f2937" : s ? "#00ff64" : node.role === "source" ? "#60a5fa" : node.role === "dest" ? "#a855f7" : node.convoy ? "#fde047" : "#00ff64";

  if (label) {
    return (
      <div onClick={() => onClick && onClick(node)}
        className={"cm-bg-black cm-border cm-rounded-lg cm-px-2.5 cm-py-1.5 cm-cursor-pointer cm-transition-all " + (s ? "cm-border-emerald-700" : "cm-border-gray-800/50 cm-hover-border-emerald-800/60")}
        style={{ opacity: isOffline ? 0.35 : 1 }}>
        <div className="cm-flex cm-items-center cm-gap-2">
          <span className={"cm-flex-shrink-0 cm-rounded-full"} style={{ width:6, height:6, background:color }} />
          <span className="cm-text-[9px] cm-font-mono cm-text-gray-400 cm-truncate">{node.name}</span>
        </div>
        <div className="cm-flex cm-items-center cm-gap-2 cm-mt-0.5">
          <span className={"cm-text-[8px] cm-font-mono " + (isOffline ? "cm-text-gray-600" : "cm-text-emerald-400")}>{isOffline ? "OFFLINE" : "ONLINE"}</span>
          {!isOffline && <span className="cm-text-[6px] cm-text-gray-600 cm-font-mono">SIG {node.signal}%</span>}
        </div>
      </div>
    );
  }
  const ox = x - mapPos.x, oy = y - mapPos.y;
  const svgX = 30 + ox * 0.5, svgY = 30 + oy * 0.5;
  return (
    <g>
      <circle cx={svgX} cy={svgY} r={s ? 10 : 7} fill={isOffline ? "#1f2937" : color} opacity={isOffline ? 0.3 : s ? 1 : 0.7} />
      <text x={svgX} y={svgY + 0.5} textAnchor="middle" dominantBaseline="central" fill={isOffline ? "#4b5563" : "#000"} fontSize="6" fontFamily="monospace" fontWeight="bold">{idText}</text>
      {node.convoy && (
        <text x={svgX} y={svgY - 14} textAnchor="middle" fill="#fde047" fontSize="5" opacity={0.7} fontFamily="monospace">{node.online ? "CONVOY" : "OFFLINE"}</text>
      )}
    </g>
  );
};

function MeshTab({ meshNodes, setMeshNodes, chain, setChain, setNotifications, shipmentId }) {
  const [selected, setSelected] = useState(null);
  const [manualNode, setManualNode] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [mapPos, setMapPos] = useState({ x:0, y:0 });
  const svgRef = useRef(null);
  const dragRef = useRef({ startX:0, startY:0, startMapX:0, startMapY:0 });

  const isOnline = n => meshNodes.find(m => m.id === n.id)?.online ?? n.online;

  const toggleOnline = (node) => {
    setMeshNodes(prev => prev.map(n => n.id === node.id ? { ...n, online: !n.online } : n));
    const nxt = !isOnline(node);
    const ev = nxt ? { event:"NODE_ONLINE", actor:node.id, shipmentId:shipmentId||"---", item:node.name + " came online", valid:true, deliveryConfirmed:false }
                  : { event:"NODE_OFFLINE", actor:node.id, shipmentId:shipmentId||"---", item:node.name + " went offline", valid:true, deliveryConfirmed:false };
    setChain(prev => appendBlock(prev, ev));
    setSelected({ ...node, online: nxt });
  };

  const startDrag = (e) => {
    if (e.button !== 0) return; setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startMapX: mapPos.x, startMapY: mapPos.y };
  };

  const onDrag = (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragRef.current.startX, dy = e.clientY - dragRef.current.startY;
    setMapPos({ x: dragRef.current.startMapX + dx, y: dragRef.current.startMapY + dy });
  };

  const stopDrag = () => setDragging(false);

  const createDtnPacket = () => {
    if (!manualNode) return;
    setSelected(prev => ({ ...prev, online: true }));
    const n = meshNodes.find(m => m.id === manualNode.id) || manualNode;
    const ev = { event:"DTN_BUNDLE", actor:manualNode.id, shipmentId:shipmentId||"---", item:"DTN bundle delivered to " + manualNode.id, valid:true, deliveryConfirmed:false };
    setChain(prev => appendBlock(prev, ev));
    setMeshNodes(prev => prev.map(m => m.id === manualNode.id ? { ...m, online:true } : m));
    setNotifications(prev => [...prev, { id:Date.now(), type:"dispatch", title:"DTN DELIVERY", body:"Bundle delivered via DTN to " + manualNode.name }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== Date.now())), 4000);
    setManualNode(null);
  };

  return (
    <div className="cm-flex cm-flex-col cm-gap-3">
      <div className="cm-flex cm-flex-wrap cm-gap-2 cm-items-center">
        <div className="cm-flex cm-items-center cm-gap-2 cm-bg-black/30 cm-border cm-border-gray-800/30 cm-rounded-xl cm-px-4 cm-py-2">
          <Pulse color="green" /><span className="cm-text-[10px] cm-font-mono cm-text-emerald-400 cm-tracking-widest">TACTICAL MESH NETWORK</span>
          <span className="cm-text-[9px] cm-font-mono cm-text-gray-600">| {meshNodes.filter(n => n.online).length}/{meshNodes.length} nodes online</span>
        </div>
      </div>

      <div className="cm-grid cm-lg-grid-cols-2 cm-gap-3">
        <div className={"cm-relative cm-rounded-2xl cm-overflow-hidden cm-bg-black cm-border " + (dragging ? "cm-border-emerald-700" : "cm-border-gray-800")}
          style={{ minHeight:480, cursor:dragging ? "grabbing" : "grab" }}
          onMouseDown={startDrag} onMouseMove={onDrag} onMouseUp={stopDrag} onMouseLeave={stopDrag}>
          <svg viewBox="0 0 400 480" className="cm-svg-map" ref={svgRef}>
            <rect width="400" height="480" className="cm-svg-bg" />
            <g opacity="0.08">
              {Array.from({ length:20 }).map((_, i) => (<line key={"gl"+i} x1={i*20} y1={0} x2={0} y2={i*24} stroke="#00ff64" strokeWidth="0.3" />))}
              {Array.from({ length:20 }).map((_, i) => (<line key={"gr"+i} x1={400-i*20} y1={0} x2={400} y2={i*24} stroke="#00ff64" strokeWidth="0.3" />))}
            </g>
            <text x="200" y="30" textAnchor="middle" fill="#4b5563" fontSize="7" fontFamily="monospace" letterSpacing="2">SANGAM MESH NETWORK TOPOLOGY</text>

            {meshNodes.filter(n => isOnline(n)).map(n => {
              const p = meshNodes.find(m => m.id === n.id) || n;
              const ox = 60 + (n.lng - 74.5) * 120, oy = 40 + (n.lat - 32) * 60;
              return <circle key={"rng"+n.id} cx={30 + (ox-mapPos.x)*0.5} cy={30 + (oy-mapPos.y)*0.5} r={20} fill="none" stroke={n.online ? "rgba(0,255,100,0.08)" : "rgba(31,41,55,0.3)"} strokeWidth="0.5" />;
            })}

            {meshNodes.filter(n => isOnline(n)).map(n => {
              const ox = 60 + (n.lng - 74.5) * 120, oy = 40 + (n.lat - 32) * 60;
              const svgX = 30 + (ox-mapPos.x)*0.5, svgY = 30 + (oy-mapPos.y)*0.5;
              const nodeColor = isOnline(n) ? (n.role === "source" ? "#60a5fa" : n.role === "dest" ? "#a855f7" : n.convoy ? "#fde047" : "#00ff64") : "#1f2937";
              const s = selected && selected.id === n.id;
              return (
                <g key={n.id}>
                  <text x={svgX} y={svgY - 16} textAnchor="middle" fill={nodeColor} fontSize="5" opacity="0.6" fontFamily="monospace">{n.name.toUpperCase()}</text>
                  <circle cx={svgX} cy={svgY} r={s ? 12 : 8} fill={isOnline(n) ? nodeColor : "#1f2937"} opacity={isOnline(n) ? (s ? 1 : 0.8) : 0.3}
                    style={{ cursor:"pointer", transition:"all 0.15s" }}
                    onClick={(e) => { e.stopPropagation(); setSelected(n); }} />
                  <text x={svgX} y={svgY + 0.5} textAnchor="middle" dominantBaseline="central" fill={isOnline(n) ? "#000" : "#374151"} fontSize="6" fontFamily="monospace" fontWeight="bold">{n.id.replace("NODE-","")}</text>
                  {n.convoy && <text x={svgX} y={svgY - 26} textAnchor="middle" fill="#fde047" fontSize="5" fontFamily="monospace" opacity="0.7">CONVOY</text>}
                </g>
              );
            })}

            {meshNodes.filter(n => isOnline(n) && !n.convoy).map(n1 => {
              const nbrs = meshNodes.filter(n2 => isOnline(n2) && n2.id !== n1.id && !n2.convoy);
              const p1 = { x:30 + (60+(n1.lng-74.5)*120-mapPos.x)*0.5, y:30 + (40+(n1.lat-32)*60-mapPos.y)*0.5 };
              return nbrs.map(n2 => {
                const p2 = { x:30 + (60+(n2.lng-74.5)*120-mapPos.x)*0.5, y:30 + (40+(n2.lat-32)*60-mapPos.y)*0.5 };
                const dist = Math.sqrt((p1.x-p2.x)**2 + (p1.y-p2.y)**2);
                const sig = Math.min(100, Math.round(1000 / (dist + 0.1)));
                if (sig < 20 || dist > 180) return null;
                return <line key={n1.id+"-"+n2.id} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke={"rgba(0,255,100," + (sig/200) + ")"} strokeWidth={Math.max(0.15, sig/200)} />;
              });
            })}

            <text x="200" y="470" textAnchor="middle" fill="#4b5563" fontSize="6" fontFamily="monospace">
              DRAG TO PAN • CLICK NODE FOR DETAILS • {meshNodes.filter(n=>isOnline(n)).length} ACTIVE NODES
            </text>
          </svg>

          {selected && (
            <div style={{ position:"absolute", bottom:8, left:8, right:8 }}>
              <div className="cm-bg-black/60 cm-backdrop-blur cm-border cm-border-gray-800 cm-rounded-xl cm-p-3">
                <div className="cm-flex cm-items-center cm-justify-between cm-mb-1.5">
                  <div className="cm-flex cm-items-center cm-gap-2">
                    <span className={"cm-rounded-full"} style={{ width:8, height:8, background:isOnline(selected) ? "#00ff64" : "#1f2937" }} />
                    <span className="cm-text-[9px] cm-font-mono cm-text-white cm-tracking-widest">{selected.name}</span>
                    <Badge color={selected.role === "source" ? "blue" : selected.role === "dest" ? "purple" : selected.convoy ? "yellow" : "green"}>{selected.role.toUpperCase()}</Badge>
                  </div>
                  <div className="cm-flex cm-gap-2">
                    <button onClick={() => toggleOnline(selected)} className="cm-text-[8px] cm-font-mono cm-px-2.5 cm-py-1 cm-rounded cm-border cm-transition-all"
                      style={{background:"rgba(0,0,0,0.4)",borderColor:"rgba(31,41,55,0.6)",color:isOnline(selected) ? "#ff4444" : "#00ff64",cursor:"pointer"}}>
                      {isOnline(selected) ? "TAKE OFFLINE" : "BRING ONLINE"}
                    </button>
                    <button onClick={() => setManualNode(selected)} className="cm-text-[8px] cm-font-mono cm-px-2.5 cm-py-1 cm-rounded cm-border cm-transition-all"
                      style={{background:"rgba(66,32,6,0.1)",borderColor:"rgba(255,165,0,0.3)",color:"#ffa500",cursor:"pointer"}}>
                      DTN DELIVERY
                    </button>
                  </div>
                </div>
                <div className="cm-grid cm-grid-cols-3 cm-gap-2 cm-text-[9px] cm-font-mono">
                  <div><span className="cm-text-gray-600">NODE</span><br /><span className="cm-text-white">{selected.id}</span></div>
                  <div><span className="cm-text-gray-600">SIGNAL</span><br /><span className={"cm-text-" + (isOnline(selected) ? "emerald-400" : "gray-600")}>{isOnline(selected) ? selected.signal + "%" : "N/A"}</span></div>
                  <div><span className="cm-text-gray-600">STATUS</span><br /><span className={isOnline(selected) ? "cm-text-emerald-400" : "cm-text-red-400"}>{isOnline(selected) ? "ACTIVE" : "OFFLINE"}</span></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {manualNode && (
          <div className="cm-fixed cm-inset-0 cm-z-[9999] cm-flex cm-items-center cm-justify-center cm-bg-black/60" style={{backdropFilter:"blur(4px)"}} onClick={() => setManualNode(null)}>
            <div className="cm-bg-black cm-border-2 cm-border-orange-900/50 cm-rounded-2xl cm-p-6 cm-max-w-sm cm-w-full" onClick={e => e.stopPropagation()}>
              <div className="cm-flex cm-items-center cm-gap-2 cm-mb-3"><span className="cm-text-orange-400">\u26A0\uFE0F</span><span className="cm-text-[10px] cm-font-mono cm-text-orange-400 cm-tracking-widest">DTN BUNDLE DELIVERY</span></div>
              <div className="cm-text-[9px] cm-font-mono cm-text-gray-400 cm-mb-4">Deliver DTN bundle to <span className="cm-text-white">{manualNode.name}</span> ({manualNode.id})</div>
              <div className="cm-qr-scanner" style={{width:"100%",height:120,marginBottom:12}}>
                <div className="cm-flex cm-items-center cm-justify-center cm-h-full">
                  <div className="cm-text-[9px] cm-font-mono cm-text-gray-600">MANUAL DTN OVERRIDE</div>
                </div>
              </div>
              <div className="cm-flex cm-gap-2">
                <button onClick={createDtnPacket} className="cm-flex-1 cm-bg-orange-900/50 cm-hover-bg-yellow-900/20 cm-text-orange-400 cm-font-mono cm-font-bold cm-text-[9px] cm-py-2 cm-rounded-lg cm-border cm-border-yellow-700 cm-transition-all" style={{cursor:"pointer"}}>CONFIRM DTN DELIVERY</button>
                <button onClick={() => setManualNode(null)} className="cm-flex-1 cm-bg-gray-900 cm-text-gray-400 cm-font-mono cm-text-[9px] cm-py-2 cm-rounded-lg cm-border cm-border-gray-700 cm-transition-all" style={{cursor:"pointer"}}>CANCEL</button>
              </div>
            </div>
          </div>
        )}
        <div className="cm-flex cm-flex-col cm-gap-2 cm-max-h-[480px] cm-overflow-y-auto cm-scroll cm-pr-1">
          <div className="cm-text-[10px] cm-font-mono cm-text-gray-500 cm-tracking-widest cm-pb-1">NODE LIST — {meshNodes.filter(n=>n.online).length} ONLINE</div>
          {meshNodes.map(n => (
            <div key={n.id} onClick={() => setSelected(n)}
              className={"cm-flex cm-items-center cm-justify-between cm-px-3 cm-py-2 cm-rounded-lg cm-border cm-cursor-pointer cm-transition-all cm-text-[9px] cm-font-mono "
                + (selected && selected.id === n.id ? "cm-border-emerald-700 cm-bg-emerald-950/10" : "cm-border-gray-800/40 cm-hover-border-emerald-800/60")}
              style={{ opacity: n.online ? 1 : 0.35 }}>
              <div className="cm-flex cm-items-center cm-gap-2 cm-min-w-0">
                <Pulse color={n.online ? (n.role==="dest"?"purple":"green") : "red"} />
                <div className="cm-truncate">
                  <span className="cm-text-white cm-text-[9px]">{n.name}</span>
                  <div className="cm-flex cm-gap-1.5 cm-mt-0.5">
                    <Badge color={n.role==="source"?"blue":n.role==="dest"?"purple":n.convoy?"yellow":"green"}>{n.role}</Badge>
                    <span className={"cm-text-[8px] " + (n.online ? "cm-text-emerald-400" : "cm-text-red-400")}>{n.online ? n.signal+"%" : "OFFLINE"}</span>
                  </div>
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); toggleOnline(n); }}
                className={"cm-shrink-0 cm-text-[8px] cm-font-mono cm-border cm-rounded cm-px-2 cm-py-0.5 cm-transition-all " + (n.online ? "cm-border-red-900/30 cm-text-red-400" : "cm-border-emerald-900/30 cm-text-emerald-400")}
                style={{background:"rgba(0,0,0,0.2)",cursor:"pointer"}}>
                {n.online ? "OFFLINE" : "ONLINE"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QRScanner({ chain, setChain, setNotifications, onScan }) {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const scanRef = useRef(null);

  const items = chain.filter(b => b.item && b.shipmentId && b.shipmentId !== "---");
  const lastScanned = items[items.length - 1];

  const simulateScan = () => {
    if (scanning) return;
    setScanning(true); setResult(null);
    setTimeout(() => {
      const sampleItems = ["Medical Kit Type-A batch#MKA-1204", "Ration Pack (5-day) batch#RAT-8873", "Ammunition 5.56mm crate#AMM-5541", "Winter Gear Set batch#WGS-3301", "Fuel Canisters 20L batch#FUL-2210", "Communication Radio S/N CR-4492"];
      const item = sampleItems[Math.floor(Math.random() * sampleItems.length)];
      setResult(item);
      setScanning(false);
      const ev = { event:"SCAN_OK", actor:"QR_SCANNER", shipmentId:"SHP-2024-001", item, valid:true, deliveryConfirmed:false };
      setChain(prev => appendBlock(prev, ev));
      setNotifications(prev => [...prev, { id:Date.now(), type:"dispatch", title:"QR SCAN ACCEPTED", body:item }]);
      setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== Date.now())), 3000);
    }, 1800);
  };

  return (
    <div className="cm-flex cm-flex-col cm-gap-3">
      <div className="cm-flex cm-items-center cm-gap-2 cm-bg-black/30 cm-border cm-border-gray-800/30 cm-rounded-xl cm-px-4 cm-py-2">
        <Pulse color="green" /><span className="cm-text-[10px] cm-font-mono cm-text-emerald-400 cm-tracking-widest">CARGO QR SCANNER</span>
      </div>
      <div className="cm-create-shipment">
        <div className="cm-qr-scanner">
          {scanning ? (
            <div className="cm-flex cm-items-center cm-justify-center cm-h-full">
              <Pulse color="orange" />
              <span className="cm-text-[9px] cm-font-mono cm-text-yellow-400 cm-ml-2">SCANNING...</span>
            </div>
          ) : result ? (
            <div className="cm-qr-result cm-p-2">
              <div className="cm-text-[18px] cm-mb-1">\u2705</div>
              <div className="cm-text-[8px] cm-font-mono cm-text-emerald-400 cm-text-center cm-leading-relaxed">{result}</div>
              <button onClick={() => { setResult(null); }} className="cm-mt-2 cm-text-[8px] cm-font-mono cm-text-gray-500 cm-border cm-border-gray-800 cm-rounded cm-px-2 cm-py-0.5" style={{cursor:"pointer",background:"rgba(0,0,0,0.4)"}}>CLEAR</button>
            </div>
          ) : (
            <div className="cm-flex cm-items-center cm-justify-center cm-h-full">
              <button onClick={simulateScan} disabled={scanning} className="cm-flex cm-flex-col cm-items-center cm-gap-1 cm-cursor-pointer cm-text-[9px] cm-font-mono" style={{background:"none",border:"none",color:"#6B7280"}}>
                <span className="cm-text-2xl">\uD83D\uDCF7</span>
                <span>SIMULATE SCAN</span>
              </button>
            </div>
          )}
        </div>
        <div className="cm-text-[9px] cm-font-mono cm-text-gray-600 cm-mt-2">SANGAM-QR-INTEGRITY verification protocol</div>
      </div>
      {lastScanned && <div className="cm-text-[9px] cm-font-mono cm-text-emerald-400 cm-bg-emerald-950/5 cm-border cm-border-emerald-900/10 cm-rounded-lg cm-p-2.5">\u2705 Last verified: {lastScanned.item}</div>}
    </div>
  );
}
function StatsDashboard({ chain, meshNodes }) {
  const blocksPerSec = chain.length / Math.max(1, (Date.now() - 1700000000000) / 1000);
  const upstream = meshNodes.filter(n => n.online).reduce((s, n) => s + n.signal, 0);
  const maxSig = meshNodes.filter(n => n.online).length * 100;

  return (
    <div className="cm-flex cm-flex-col cm-gap-3">
      <div className="cm-flex cm-items-center cm-gap-2 cm-bg-black/30 cm-border cm-border-gray-800/30 cm-rounded-xl cm-px-4 cm-py-2">
        <Pulse color="green" /><span className="cm-text-[10px] cm-font-mono cm-text-emerald-400 cm-tracking-widest">CHAIN & NETWORK STATISTICS</span>
      </div>
      <div className="cm-grid cm-grid-cols-3 cm-gap-2">
        <div className="cm-stat-card"><div className="cm-text-[10px] cm-font-mono cm-text-gray-600">BLOCKS</div><div className="cm-text-xl cm-font-black cm-font-mono cm-text-white">{chain.length}</div><div className="cm-text-[9px] cm-font-mono cm-text-emerald-400">{blocksPerSec.toFixed(3)} blk/s</div></div>
        <div className="cm-stat-card"><div className="cm-text-[10px] cm-font-mono cm-text-gray-600">NODES ONLINE</div><div className="cm-text-xl cm-font-black cm-font-mono cm-text-emerald-400">{meshNodes.filter(n => n.online).length}/{meshNodes.length}</div><div className="cm-text-[9px] cm-font-mono cm-text-gray-600">{meshNodes.filter(n => n.online).filter(n => n.convoy).length} convoy / {meshNodes.filter(n => n.online).filter(n => n.role === "relay").length} relay</div></div>
        <div className="cm-stat-card"><div className="cm-text-[10px] cm-font-mono cm-text-gray-600">NETWORK SIG</div><div className="cm-text-xl cm-font-black cm-font-mono cm-text-emerald-400">{maxSig > 0 ? Math.round(upstream / maxSig * 100) : 0}%</div><div className="cm-progress-track cm-mt-1 cm-h-1.5"><div className={"cm-progress-fill " + (maxSig > 0 && upstream / maxSig > 0.7 ? "cm-progress-fill-green" : "cm-progress-fill-yellow")} style={{width:(maxSig > 0 ? upstream / maxSig * 100 : 0) + "%"}} /></div></div>
      </div>
    </div>
  );
}

function CommandShipments({ shipments, setShipments, chain, setChain, setNotifications }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState("all");

  const dispatch = (sid) => {
    const s = shipments[sid]; if (!s) return;
    const etaHrs = Math.floor(Math.random() * 18 + 6);
    setShipments(prev => ({ ...prev, [sid]: { ...prev[sid], status:"in_transit", dispatchTime:nowStr(), eta:etaHrs+"h", dispatchNote:"Dispatched from " + (Math.random() > 0.5 ? "Pathankot" : "Chandigarh") + " base" } }));
    const ev = { event:"DISPATCH", actor:"CMD-CENTER", shipmentId:sid, item:s.id + " dispatched - ETA " + etaHrs + "h", valid:true, deliveryConfirmed:false };
    setChain(prev => appendBlock(prev, ev));
    setNotifications(prev => [...prev, { id:Date.now(), type:"dispatch", title:"SHIPMENT DISPATCHED", body:s.id + " dispatched — ETA " + etaHrs + " hours" }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== Date.now())), 4000);
  };

  const complete = (sid) => {
    const s = shipments[sid]; if (!s) return;
    setShipments(prev => ({ ...prev, [sid]: { ...prev[sid], status:"delivered" } }));
    const ev = { event:"DELIVERY", actor:"CMD-CENTER", shipmentId:sid, item:s.id + " delivered to " + s.receiverName, valid:true, deliveryConfirmed:true };
    setChain(prev => appendBlock(prev, ev));
    setNotifications(prev => [...prev, { id:Date.now(), type:"delivery", title:"DELIVERY CONFIRMED", body:s.id + " delivered to " + s.receiverName }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== Date.now())), 5000);
  };

  const list = Object.values(shipments).filter(s => filter === "all" || s.status === filter);
  const pcolors = { CRITICAL:"red", HIGH:"orange", MEDIUM:"yellow", LOW:"gray" };

  return (
    <div className="cm-flex cm-flex-col cm-gap-3">
      <div className="cm-flex cm-items-center cm-justify-between cm-flex-wrap cm-gap-2">
        <div className="cm-flex cm-items-center cm-gap-2 cm-bg-black/30 cm-border cm-border-gray-800/30 cm-rounded-xl cm-px-4 cm-py-2">
          <Pulse color="green" /><span className="cm-text-[10px] cm-font-mono cm-text-emerald-400 cm-tracking-widest">SHIPMENT COMMAND</span>
        </div>
        <div className="cm-flex cm-gap-1">
          {["all","pending","in_transit","delivered"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={"cm-view-tab " + (filter === f ? "cm-view-tab-active" : "cm-view-tab-inactive")}>{f.toUpperCase()}</button>
          ))}
        </div>
      </div>
      {list.map(s => (
        <div key={s.id} className={"cm-shipment-card cm-border-2 " + (s.status === "pending" ? "cm-border-emerald-900/40" : s.status === "in_transit" ? "cm-border-blue-900/40" : "cm-border-purple-900/40")}>
          <div className="cm-flex cm-items-center cm-justify-between cm-mb-2">
            <div className="cm-flex cm-items-center cm-gap-2">
              <span className="cm-text-[10px] cm-font-mono cm-font-bold cm-text-white cm-tracking-widest">{s.id}</span>
              <Badge color={pcolors[s.priority]}>{s.priority}</Badge>
              <Badge color={s.status === "delivered" ? "green" : s.status === "in_transit" ? "blue" : "yellow"}>{s.status}</Badge>
            </div>
          </div>
          <div className="cm-grid cm-grid-cols-2 cm-gap-2 cm-text-[9px] cm-font-mono cm-mb-3">
            <div><span className="cm-text-gray-600">FROM</span><br /><span className="cm-text-white">{s.senderName}</span></div>
            <div><span className="cm-text-gray-600">TO</span><br /><span className="cm-text-white">{s.receiverName}</span></div>
            {s.dispatchTime && <div><span className="cm-text-gray-600">DISPATCH</span><br /><span className="cm-text-emerald-400">{s.dispatchTime}</span></div>}
            {s.eta && <div><span className="cm-text-gray-600">ETA</span><br /><span className="cm-text-yellow-400">{s.eta}</span></div>}
          </div>
          <div className="cm-space-y-1 cm-mb-3">
            {s.items.map(it => (
              <div key={it.id} className="cm-flex cm-items-center cm-gap-2 cm-text-[9px] cm-font-mono cm-bg-black/20 cm-rounded cm-px-2 cm-py-1">
                <span className={"cm-w-1.5 cm-h-1.5 cm-rounded-full " + (it.tampered ? "cm-bg-red-500/10 cm-border cm-border-red-700" : "cm-bg-emerald-950/60 cm-border cm-border-emerald-700")} />
                <span className="cm-text-gray-400">{it.name}</span>
                <span className="cm-ml-auto cm-text-gray-600">{it.qty} {it.unit}</span>
                {it.willTamper && <Badge color="red">TAMPER-RISK</Badge>}
              </div>
            ))}
          </div>
          <div className="cm-flex cm-gap-2">
            {s.status === "pending" && <button onClick={() => dispatch(s.id)} className="cm-flex-1 cm-bg-emerald-700 cm-hover-bg-emerald-600 cm-text-white cm-font-mono cm-font-bold cm-text-[9px] cm-py-1.5 cm-rounded-lg cm-transition-all" style={{cursor:"pointer",border:"none"}}>DISPATCH SHIPMENT</button>}
            {s.status === "in_transit" && <button onClick={() => complete(s.id)} className="cm-flex-1 cm-bg-purple-700 cm-hover-bg-purple-600 cm-text-white cm-font-mono cm-font-bold cm-text-[9px] cm-py-1.5 cm-rounded-lg cm-transition-all" style={{cursor:"pointer",border:"none",background:"#6b21a8"}}>CONFIRM DELIVERY</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
function BlockchainLedger({ chain, setChain, setNotifications }) {
  const [expanded, setExpanded] = useState(chain.length);
  const chainResult = verifyChain(chain);
  const integrityPct = chain.length > 0 ? Math.round((chain.length - (chain.length - (chainResult.valid ? chain.length : 0)) / chain.length) * 100) : 0;

  const simulateTamper = () => {
    if (chain.length < 3) return;
    const targetIdx = Math.floor(Math.random() * (chain.length - 1)) + 1;
    const target = chain[targetIdx];
    const tampered = { ...target, hash: "0x" + sha256("TAMPERED" + Date.now()).toUpperCase() };
    const newChain = [...chain]; newChain[targetIdx] = tampered;
    setChain(newChain);
    setNotifications(prev => [...prev, { id:Date.now(), type:"tamper", title:"TAMPER DETECTED!", body:"Block #" + target.block + " hash mismatch - chain integrity compromised" }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== Date.now())), 6000);
  };

  const verifyAndSync = () => {
    const result = verifyChain(chain);
    if (result.valid) {
      setNotifications(prev => [...prev, { id:Date.now(), type:"delivery", title:"CHAIN VERIFIED", body:result.blocks + " blocks verified - integrity: " + integrityPct + "%" }]);
    } else {
      setNotifications(prev => [...prev, { id:Date.now(), type:"tamper", title:"CHAIN COMPROMISED", body:"Block #" + result.at + " failed: " + result.reason }]);
    }
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== Date.now() || Math.random() > 0.5)), 4000);
  };

  const visible = chain.slice(-expanded);

  return (
    <div className="cm-flex cm-flex-col cm-gap-3">
      <div className="cm-flex cm-items-center cm-justify-between cm-flex-wrap cm-gap-2">
        <div className="cm-flex cm-items-center cm-gap-2 cm-bg-black/30 cm-border cm-border-gray-800/30 cm-rounded-xl cm-px-4 cm-py-2">
          <Pulse color={chainResult.valid ? "green" : "red"} />
          <span className="cm-text-[10px] cm-font-mono cm-text-emerald-400 cm-tracking-widest">BLOCKCHAIN LEDGER</span>
          <Badge color={chainResult.valid ? "green" : "red"}>{chainResult.valid ? "INTEGRITY: 100%" : "COMPROMISED"}</Badge>
          <span className="cm-text-[9px] cm-font-mono cm-text-gray-600">| {chain.length} blocks</span>
        </div>
        <div className="cm-flex cm-gap-1">
          <button onClick={simulateTamper} className="cm-bg-red-950/20 cm-hover-bg-red-950/10 cm-text-red-400 cm-font-mono cm-text-[8px] cm-border cm-border-red-900/30 cm-rounded cm-px-2.5 cm-py-1 cm-transition-all" style={{cursor:"pointer"}}>SIMULATE TAMPER</button>
          <button onClick={verifyAndSync} className="cm-bg-emerald-950/30 cm-hover-bg-emerald-900/50 cm-text-emerald-400 cm-font-mono cm-text-[8px] cm-border cm-border-emerald-900/40 cm-rounded cm-px-2.5 cm-py-1 cm-transition-all" style={{cursor:"pointer"}}>VERIFY CHAIN</button>
        </div>
      </div>

      <div className="cm-bg-black cm-border cm-border-gray-800 cm-rounded-2xl cm-overflow-hidden">
        <div className="cm-flex cm-items-center cm-gap-3 cm-px-4 cm-py-2 cm-border-b cm-border-gray-800 cm-text-[9px] cm-font-mono cm-text-gray-600">
          <span className="cm-w-12">BLOCK</span>
          <span className="cm-w-16">EVENT</span>
          <span className="cm-flex-1 cm-truncate">DATA / ITEM</span>
          <span className="cm-w-20 cm-text-right">TIME</span>
          <span className="cm-w-24 cm-text-right cm-truncate">HASH (first 8)</span>
          <span className="cm-w-8 cm-text-center">OK</span>
        </div>
        <div className="cm-overflow-y-auto cm-scroll" style={{maxHeight:340}}>
          {[...visible].reverse().map(b => {
            const v = b.valid !== false;
            return (
              <div key={b.block} className={"cm-flex cm-items-center cm-gap-3 cm-px-4 cm-py-1.5 cm-text-[9px] cm-font-mono cm-border-t " + (v ? "cm-border-emerald-900/10" : "cm-border-red-900/30")}
                style={{background:v ? "transparent" : "rgba(127,29,29,0.1)"}}>
                <span className={"cm-w-12 cm-font-bold " + (v ? "cm-text-gray-400" : "cm-text-red-400")}>#{b.block}</span>
                <span className="cm-w-16">
                  <Badge color={b.event === "GENESIS" ? "purple" : b.event === "DELIVERY" ? "green" : b.event === "TAMPER" || b.event === "TAMPERED" ? "red" : b.event === "SCAN_OK" ? "blue" : b.event === "DTN_BUNDLE" ? "orange" : "gray"}>{b.event}</Badge>
                </span>
                <span className={"cm-flex-1 cm-truncate " + (v ? "cm-text-gray-400" : "cm-text-red-400")}>{b.item && b.item.length > 40 ? b.item.slice(0, 40) + "..." : b.item || "---"}</span>
                <span className="cm-w-20 cm-text-right cm-text-gray-600">{b.time}</span>
                <span className="cm-w-24 cm-text-right cm-text-gray-600 cm-truncate">{b.hash ? b.hash.slice(0, 10) + "..." : "---"}</span>
                <span className="cm-w-8 cm-text-center">{v ? "\u2705" : "\u274C"}</span>
              </div>
            );
          })}
        </div>
      </div>
      {chain.length > 5 && <div className="cm-text-center">
        <button onClick={() => setExpanded(expanded === chain.length ? 5 : chain.length)}
          className="cm-text-[9px] cm-font-mono cm-text-gray-600 cm-hover-text-emerald-400 cm-cursor-pointer" style={{background:"none",border:"none"}}>
          {expanded === chain.length ? "SHOW LAST 5" : "SHOW ALL " + chain.length + " BLOCKS"}
        </button>
      </div>}
    </div>
  );
}
function ConvoyMap({ meshNodes, onNodeClick }) {
  return (
    <div className="cm-flex cm-flex-col cm-gap-3">
      <div className="cm-flex cm-items-center cm-gap-2 cm-bg-black/30 cm-border cm-border-gray-800/30 cm-rounded-xl cm-px-4 cm-py-2">
        <Pulse color="green" /><span className="cm-text-[10px] cm-font-mono cm-text-emerald-400 cm-tracking-widest">CONVOY ROUTE MAP</span>
      </div>
      <div className="cm-flex cm-flex-col cm-gap-2 cm-max-h-[480px] cm-overflow-y-auto cm-scroll cm-pr-1">
        {meshNodes.filter(n => n.convoy || n.role === "dest").map(n => {
          const dest = meshNodes.find(d => d.role === "dest") || meshNodes[meshNodes.length - 1];
          return (
            <div key={n.id} onClick={() => onNodeClick && onNodeClick(n)}
              className={"cm-rounded-lg cm-border cm-p-3 cm-cursor-pointer cm-transition-all " + (n.convoy && n.online ? "cm-convoy-moving" : n.convoy && !n.online ? "cm-convoy-standby" : "cm-convoy-dest")}>
              <div className="cm-flex cm-items-center cm-justify-between cm-mb-1">
                <span className="cm-text-[9px] cm-font-mono cm-font-bold cm-text-white">{n.name}</span>
                <Pulse color={n.online ? (n.role==="dest"?"purple":"green") : "orange"} />
              </div>
              <div className="cm-flex cm-items-center cm-gap-2 cm-text-[8px] cm-font-mono">
                <Badge color={n.role==="dest"?"purple":"yellow"}>{n.role.toUpperCase()}</Badge>
                <span className={n.online ? "cm-text-emerald-400" : "cm-text-orange-400"}>{n.online ? "ACTIVE" : "STANDBY"}</span>
                {n.convoy && n.online && dest.online && <span className="cm-text-gray-600">to {dest.name}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CommandCenterView({ user, shipments, setShipments, chain, setChain, setNotifications, onLogout, meshNodes }) {
  const sList = Object.values(shipments);
  return (
    <div className="cm-flex cm-flex-col cm-gap-4 cm-p-3">
      <div className="cm-flex cm-items-center cm-justify-between cm-mb-2">
        <div className="cm-flex cm-items-center cm-gap-3">
          <div className="cm-avatar cm-bg-emerald-950/60 cm-text-emerald-400 cm-border cm-border-emerald-700">{user.avatar}</div>
          <div>
            <div className="cm-text-[10px] cm-font-mono cm-font-bold cm-text-white">{user.name}</div>
            <div className="cm-text-[9px] cm-font-mono cm-text-emerald-400">{user.base}</div>
          </div>
        </div>
        <button onClick={onLogout} className="cm-text-[8px] cm-font-mono cm-text-gray-600 cm-hover-text-red-400 cm-border cm-border-gray-800 cm-rounded-lg cm-px-3 cm-py-1.5 cm-transition-all" style={{cursor:"pointer",background:"rgba(0,0,0,0.4)"}}>LOGOUT</button>
      </div>
      <StatsDashboard chain={chain} meshNodes={meshNodes} />
      <BlockchainLedger chain={chain} setChain={setChain} setNotifications={setNotifications} />
      <CommandShipments shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} setNotifications={setNotifications} />
    </div>
  );
}
function SenderDashboard({ user, shipments, setShipments, chain, setChain, setNotifications, onLogout, meshNodes }) {
  const [activeTab, setActiveTab] = useState("shipments");
  const myShipments = Object.values(shipments).filter(s => s.sender === user.uid);

  return (
    <div className="cm-flex cm-flex-col cm-gap-4 cm-p-3">
      <div className="cm-flex cm-items-center cm-justify-between cm-mb-2">
        <div className="cm-flex cm-items-center cm-gap-3">
          <div className="cm-avatar cm-bg-blue-950/10 cm-text-blue-400 cm-border cm-border-blue-400" style={{background:"rgba(29,78,216,0.15)"}}>{user.avatar}</div>
          <div>
            <div className="cm-text-[10px] cm-font-mono cm-font-bold cm-text-white">{user.name}</div>
            <div className="cm-text-[9px] cm-font-mono cm-text-blue-400">{user.base}</div>
          </div>
        </div>
        <button onClick={onLogout} className="cm-text-[8px] cm-font-mono cm-text-gray-600 cm-hover-text-red-400 cm-border cm-border-gray-800 cm-rounded-lg cm-px-3 cm-py-1.5 cm-transition-all" style={{cursor:"pointer",background:"rgba(0,0,0,0.4)"}}>LOGOUT</button>
      </div>
      <div className="cm-flex cm-gap-2">
        {["shipments","mesh"].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={"cm-tab-btn " + (activeTab === tab ? "cm-tab-active" : "cm-tab-inactive")}>{tab === "shipments" ? "MY SHIPMENTS" : "MESH NETWORK"}</button>
        ))}
      </div>
      {activeTab === "shipments" ? (
        <div className="cm-space-y-3">
          {myShipments.length === 0 && <div className="cm-text-[10px] cm-font-mono cm-text-gray-600 cm-text-center cm-py-4">No shipments assigned to you.</div>}
          {myShipments.map(s => (
            <div key={s.id} className="cm-shipment-card">
              <div className="cm-flex cm-items-center cm-justify-between cm-mb-2">
                <span className="cm-text-[10px] cm-font-mono cm-font-bold cm-text-white cm-tracking-widest">{s.id}</span>
                <Badge color={s.status === "pending" ? "yellow" : s.status === "in_transit" ? "blue" : "green"}>{s.status}</Badge>
              </div>
              <div className="cm-text-[9px] cm-font-mono cm-text-gray-400 cm-mb-2">TO: {s.receiverName}</div>
              <div className="cm-space-y-1">
                {s.items.map(it => (
                  <div key={it.id} className="cm-flex cm-items-center cm-gap-2 cm-text-[9px] cm-font-mono cm-bg-black/20 cm-rounded cm-px-2 cm-py-1">
                    <span className={"cm-w-1.5 cm-h-1.5 cm-rounded-full " + (it.tampered ? "cm-bg-red-500/10" : "cm-bg-emerald-950/60")} />
                    <span className="cm-text-gray-400">{it.name}</span>
                    <span className="cm-ml-auto cm-text-gray-600">{it.qty} {it.unit}</span>
                  </div>
                ))}
              </div>
              {s.dispatchTime && <div className="cm-text-[9px] cm-font-mono cm-text-emerald-400 cm-mt-2">Dispatched: {s.dispatchTime} | ETA: {s.eta}</div>}
            </div>
          ))}
        </div>
      ) : (
        <MeshTab meshNodes={meshNodes} setMeshNodes={() => {}} chain={chain} setChain={setChain} setNotifications={setNotifications} shipmentId={myShipments.length > 0 ? myShipments[0].id : "---"} />
      )}
    </div>
  );
}

function ReceiverDashboard({ user, shipments, setShipments, chain, setChain, setNotifications, onLogout, meshNodes }) {
  const [activeTab, setActiveTab] = useState("incoming");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const myShipments = Object.values(shipments).filter(s => s.receiver === user.uid);
  const incoming = myShipments.filter(s => s.status === "in_transit");

  const confirmDelivery = (sid) => {
    const s = shipments[sid];
    setShipments(prev => ({ ...prev, [sid]: { ...prev[sid], status:"delivered" } }));
    const ev = { event:"DELIVERY", actor:user.uid, shipmentId:sid, item:s.id + " received at " + user.base, valid:true, deliveryConfirmed:true };
    setChain(prev => appendBlock(prev, ev));
    setNotifications(prev => [...prev, { id:Date.now(), type:"delivery", title:"DELIVERY ACKNOWLEDGED", body:s.id + " received at " + user.base }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== Date.now())), 5000);
  };

  const simulateScan = () => {
    if (scanning) return; setScanning(true); setScanResult(null);
    const items = ["Cargo manifest QR-4421", "Ammunition crate AM-5598", "Medical supplies batch MS-3310", "Ration consignment RC-7792"];
    setTimeout(() => {
      const r = items[Math.floor(Math.random() * items.length)];
      setScanResult(r); setScanning(false);
      setNotifications(prev => [...prev, { id:Date.now(), type:"dispatch", title:"SCAN RESULT", body:r }]);
      setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== Date.now())), 3000);
    }, 1500);
  };

  return (
    <div className="cm-flex cm-flex-col cm-gap-4 cm-p-3">
      <div className="cm-flex cm-items-center cm-justify-between cm-mb-2">
        <div className="cm-flex cm-items-center cm-gap-3">
          <div className="cm-avatar cm-bg-purple-950/10 cm-text-purple-400 cm-border cm-border-purple-400" style={{background:"rgba(76,29,149,0.15)"}}>{user.avatar}</div>
          <div>
            <div className="cm-text-[10px] cm-font-mono cm-font-bold cm-text-white cm-tracking-widest">{user.name}</div>
            <div className="cm-text-[9px] cm-font-mono cm-text-purple-400">{user.base}</div>
          </div>
        </div>
        <button onClick={onLogout} className="cm-text-[8px] cm-font-mono cm-text-gray-600 cm-hover-text-red-400 cm-border cm-border-gray-800 cm-rounded-lg cm-px-3 cm-py-1.5 cm-transition-all" style={{cursor:"pointer",background:"rgba(0,0,0,0.4)"}}>LOGOUT</button>
      </div>

      <div className="cm-flex cm-gap-2">
        {["incoming","delivered","scan","mesh"].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={"cm-tab-btn " + (activeTab === tab ? "cm-tab-active" : "cm-tab-inactive")}>
            {tab === "incoming" ? "INCOMING" : tab === "delivered" ? "RECEIVED" : tab === "scan" ? "SCAN" : "MESH"}
          </button>
        ))}
      </div>

      {activeTab === "incoming" && (
        <div className="cm-space-y-3">
          {incoming.length === 0 && <div className="cm-text-[10px] cm-font-mono cm-text-gray-600 cm-text-center cm-py-4">No incoming shipments in transit.</div>}
          {incoming.map(s => (
            <div key={s.id} className="cm-shipment-card">
              <div className="cm-flex cm-items-center cm-justify-between cm-mb-2">
                <span className="cm-text-[10px] cm-font-mono cm-font-bold cm-text-white">{s.id}</span>
                <Pulse color="blue" />
              </div>
              <div className="cm-grid cm-grid-cols-2 cm-gap-2 cm-text-[9px] cm-font-mono cm-mb-3">
                <div><span className="cm-text-gray-600">FROM</span><br /><span className="cm-text-white">{s.senderName}</span></div>
                <div><span className="cm-text-gray-600">ETA</span><br /><span className="cm-text-yellow-400">{s.eta}</span></div>
              </div>
              <div className="cm-space-y-1 cm-mb-3">
                {s.items.map(it => (
                  <div key={it.id} className="cm-flex cm-items-center cm-gap-2 cm-text-[9px] cm-font-mono cm-bg-black/20 cm-rounded cm-px-2 cm-py-1">
                    <span className="cm-w-1.5 cm-h-1.5 cm-rounded-full cm-bg-emerald-950/60" />
                    <span className="cm-text-gray-400">{it.name}</span>
                    <span className="cm-ml-auto cm-text-gray-600">{it.qty} {it.unit}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => confirmDelivery(s.id)}
                className="cm-w-full cm-bg-purple-700 cm-hover-bg-purple-600 cm-text-white cm-font-mono cm-font-bold cm-text-[9px] cm-py-2 cm-rounded-lg cm-transition-all" style={{cursor:"pointer",border:"none",background:"rgba(168,85,247,0.2)",color:"#a855f7",border:"1px solid rgba(168,85,247,0.4)"}}>
                ACKNOWLEDGE DELIVERY
              </button>
            </div>
          ))}
        </div>
      )}

      {activeTab === "delivered" && (
        <div className="cm-space-y-3">
          {myShipments.filter(s => s.status === "delivered").length === 0 && <div className="cm-text-[10px] cm-font-mono cm-text-gray-600 cm-text-center cm-py-4">No delivered shipments yet.</div>}
          {myShipments.filter(s => s.status === "delivered").map(s => (
            <div key={s.id} className="cm-shipment-card cm-border-emerald-900/50">
              <div className="cm-flex cm-items-center cm-gap-2 cm-mb-1">
                <span className="cm-text-[10px] cm-font-mono cm-font-bold cm-text-white">{s.id}</span>
                <span className="cm-text-[9px] cm-font-mono cm-text-emerald-400">\u2705 DELIVERED</span>
              </div>
              <div className="cm-text-[9px] cm-font-mono cm-text-gray-500">FROM {s.senderName}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "scan" && (
        <div className="cm-create-shipment">
          <div className="cm-text-[10px] cm-font-mono cm-text-emerald-400 cm-mb-3 cm-tracking-widest">INCOMING CARGO SCANNER</div>
          <div className="cm-qr-scanner">
            {scanning ? (
              <div className="cm-flex cm-items-center cm-justify-center cm-h-full"><Pulse color="orange" /><span className="cm-text-[9px] cm-font-mono cm-text-yellow-400 cm-ml-2">SCANNING...</span></div>
            ) : scanResult ? (
              <div className="cm-qr-result cm-p-2">
                <div className="cm-text-lg cm-mb-1">\uD83D\uDCE6</div>
                <div className="cm-text-[8px] cm-font-mono cm-text-emerald-400 cm-text-center">{scanResult}</div>
                <button onClick={() => setScanResult(null)} className="cm-mt-2 cm-text-[8px] cm-font-mono cm-text-gray-500 cm-border cm-border-gray-800 cm-rounded cm-px-2 cm-py-0.5" style={{cursor:"pointer",background:"rgba(0,0,0,0.4)"}}>CLEAR</button>
              </div>
            ) : (
              <div className="cm-flex cm-items-center cm-justify-center cm-h-full">
                <button onClick={simulateScan} className="cm-flex cm-flex-col cm-items-center cm-gap-1 cm-text-[9px] cm-font-mono" style={{background:"none",border:"none",color:"#6B7280",cursor:"pointer"}}>
                  <span className="cm-text-2xl">\uD83D\uDCF7</span>
                  <span>SCAN CARGO</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === "mesh" && (
        <MeshTab meshNodes={meshNodes} setMeshNodes={() => {}} chain={chain} setChain={setChain} setNotifications={setNotifications} shipmentId={myShipments.length > 0 ? myShipments[0].id : "---"} />
      )}
    </div>
  );
}
export default function ConvoyMeshPage() {
  const [user, setUser] = useState(null);
  const [chain, setChain] = useState(INIT_CHAIN);
  const [shipments, setShipments] = useState(INIT_SHIPMENTS);
  const [meshNodes, setMeshNodes] = useState(MESH_NODES_INIT);
  const [notifications, setNotifications] = useState([]);
  const [rightTab, setRightTab] = useState("ledger");
  const [leftView, setLeftView] = useState("dashboard");
  const [showLogin, setShowLogin] = useState(false);
  const meshRef = useRef(null);

  const addNotification = (title, body, type) => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, title, body, type: type || "default" }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 4000);
  };

  return (
    <div className="cm-min-h-screen cm-bg-black cm-text-white cm-font-mono cm-flex cm-flex-col">
      {!user ? (
        <LoginPage onLogin={setUser} />
      ) : (
        <div className="cm-flex cm-flex-col cm-min-h-screen">
          <header className="cm-bg-black cm-border-b cm-border-emerald-900/30 cm-px-4 cm-py-2 cm-flex cm-items-center cm-justify-between cm-shrink-0">
            <div className="cm-flex cm-items-center cm-gap-3">
              <div className="cm-flex cm-items-center cm-gap-2">
                <span className="cm-text-base" style={{color:"rgba(0,255,100,0.8)"}}>\u26A1</span>
                <span className="cm-text-sm cm-font-black cm-tracking-widest" style={{color:"rgba(0,255,100,0.9)"}}>SANGAM</span>
              </div>
              <div className="cm-h-4 cm-w-px cm-bg-gray-800" />
              <div className="cm-flex cm-items-center cm-gap-2">
                <Badge color={user.role === "sender" ? "blue" : user.role === "receiver" ? "purple" : "green"}>{user.role.toUpperCase()}</Badge>
                <span className="cm-text-[9px] cm-text-gray-500">{user.uid}</span>
                <span className="cm-text-[9px] cm-text-gray-600">|</span>
                <span className="cm-text-[9px] cm-text-emerald-400">{user.name}</span>
              </div>
            </div>
            <div className="cm-flex cm-items-center cm-gap-3">
              <div className="cm-flex cm-items-center cm-gap-2 cm-text-[9px] cm-font-mono cm-text-gray-600">
                <Pulse color="green" />
                <span>CHAIN: {chain.length}</span>
              </div>
              <button onClick={() => setShowLogin(true)}
                className="cm-text-[9px] cm-font-mono cm-text-gray-500 cm-hover-text-red-400 cm-cursor-pointer cm-border cm-border-gray-800 cm-rounded cm-px-2.5 cm-py-1"
                style={{background:"rgba(0,0,0,0.4)"}}>SWITCH USER</button>
            </div>
          </header>
          {showLogin && (
            <div className="cm-fixed cm-inset-0 cm-z-[9999] cm-flex cm-items-center cm-justify-center cm-bg-black/60" style={{backdropFilter:"blur(8px)"}} onClick={() => setShowLogin(false)}>
              <div onClick={e => e.stopPropagation()} style={{maxWidth:480,width:"100%",margin:"0 16px"}}>
                <LoginPage onLogin={(u) => { setUser(u); setShowLogin(false); }} />
              </div>
            </div>
          )}

          <div className="cm-flex cm-flex-col cm-lg-flex-row cm-flex-1 cm-overflow-hidden">
            <div className="cm-flex-1 cm-overflow-y-auto cm-scroll">
              {user.role === "sendcenter" || user.role === "command" ? (
                <CommandCenterView user={user} shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} setNotifications={setNotifications} onLogout={() => setUser(null)} meshNodes={meshNodes} />
              ) : user.role === "sender" ? (
                <SenderDashboard user={user} shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} setNotifications={setNotifications} onLogout={() => setUser(null)} meshNodes={meshNodes} />
              ) : user.role === "receiver" ? (
                <ReceiverDashboard user={user} shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} setNotifications={setNotifications} onLogout={() => setUser(null)} meshNodes={meshNodes} />
              ) : (
                <CommandCenterView user={user} shipments={shipments} setShipments={setShipments} chain={chain} setChain={setChain} setNotifications={setNotifications} onLogout={() => setUser(null)} meshNodes={meshNodes} />
              )}
            </div>
            <div className="cm-w-full cm-lg-max-w-md cm-shrink-0 cm-border-t cm-lg-border-t-0 cm-lg-border-l cm-border-emerald-900/30 cm-bg-black/40">
              <div className="cm-right-panel-tabs">
                {["ledger","mesh","stats"].map(tab => (
                  <button key={tab} onClick={() => setRightTab(tab)}
                    className={"cm-tab-btn " + (rightTab === tab ? "cm-tab-active" : "cm-tab-inactive")}>
                    {tab === "ledger" ? "LEDGER" : tab === "mesh" ? "MESH" : "STATS"}
                  </button>
                ))}
              </div>
              <div className="cm-flex-1 cm-overflow-y-auto cm-scroll cm-p-2 cm-space-y-3">
                {rightTab === "ledger" && <BlockchainLedger chain={chain} setChain={setChain} setNotifications={setNotifications} />}
                {rightTab === "mesh" && (
                  <MeshTab meshNodes={meshNodes} setMeshNodes={setMeshNodes} chain={chain} setChain={setChain} setNotifications={setNotifications} shipmentId={Object.values(shipments).filter(s => s.status !== "delivered")[0]?.id || "---"} />
                )}
                {rightTab === "stats" && <StatsDashboard chain={chain} meshNodes={meshNodes} />}
              </div>
            </div>
          </div>
        </div>
      )}
      <NotificationStack notifications={notifications} onDismiss={id => setNotifications(prev => prev.filter(n => n.id !== id))} />
    </div>
  );
}
