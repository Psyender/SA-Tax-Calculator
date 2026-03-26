import { useState, useEffect, useCallback } from "react";

// ─── SARS 2024/2025 ───────────────────────────────────────────────────────
const TAX_BRACKETS = [
  { min: 0,       max: 237100,   rate: 0.18, base: 0 },
  { min: 237101,  max: 370500,   rate: 0.26, base: 42678 },
  { min: 370501,  max: 512800,   rate: 0.31, base: 77362 },
  { min: 512801,  max: 673000,   rate: 0.36, base: 121475 },
  { min: 673001,  max: 857900,   rate: 0.39, base: 179147 },
  { min: 857901,  max: 1817000,  rate: 0.41, base: 251258 },
  { min: 1817001, max: Infinity, rate: 0.45, base: 644489 },
];
const PRIMARY_REBATE = 17235, SECONDARY_REBATE = 9444, TERTIARY_REBATE = 3145;
const MED_MAIN = 364, MED_ADD = 246, UIF_CAP = 177.12;

function calcTax(annual, age, med, ra) {
  if (annual <= 0) return {};
  const allowedRA = Math.min(ra, annual * 0.275, 350000);
  const taxable = Math.max(0, annual - allowedRA);
  const b = TAX_BRACKETS.find(x => taxable >= x.min && taxable <= x.max) || TAX_BRACKETS[TAX_BRACKETS.length - 1];
  let tax = b.base + (taxable - b.min) * b.rate;
  let rebate = PRIMARY_REBATE + (age >= 65 ? SECONDARY_REBATE : 0) + (age >= 75 ? TERTIARY_REBATE : 0);
  const medCredit = (Math.min(med, 2) * MED_MAIN + Math.max(med - 2, 0) * MED_ADD) * 12;
  tax = Math.max(0, tax - rebate - medCredit);
  const uif = Math.min(annual * 0.01, UIF_CAP * 12);
  const bNoRA = TAX_BRACKETS.find(x => annual >= x.min && annual <= x.max) || TAX_BRACKETS[TAX_BRACKETS.length - 1];
  let taxNoRA = Math.max(0, bNoRA.base + (annual - bNoRA.min) * bNoRA.rate - rebate - medCredit);
  return { tax, taxable, effectiveRate: (tax / annual) * 100, marginalRate: b.rate * 100, uif, takeHome: annual - tax - uif - allowedRA, allowedRA, taxSaved: taxNoRA - tax };
}

const fmt = n => "R " + Math.round(n).toLocaleString("en-ZA");

// ─── CLAUDE API ───────────────────────────────────────────────────────────
async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.map(c => c.text || "").join("") || "";
  return text.replace(/```json|```/g, "").trim();
}

async function fetchNews(type) {
  const today = new Date().toDateString();
  const prompt = type === "sa"
    ? `Generate 6 realistic South African current affairs news stories for ${today}. Cover politics, economy, Eskom/load shedding, social issues, sport. Return ONLY a JSON array, no explanation:\n[{"headline":"...","summary":"2-3 sentence summary...","category":"Politics|Economy|Energy|Social|Sport","time":"X hours ago"}]`
    : `Generate 6 realistic global technology news stories relevant to South Africans for ${today}. Cover AI, fintech, smartphones, local SA tech startups, cybersecurity. Return ONLY a JSON array, no explanation:\n[{"headline":"...","summary":"2-3 sentence summary...","category":"AI|Fintech|Smartphones|Startups|Security|Apps","time":"X hours ago"}]`;
  const text = await callClaude(prompt);
  try { return JSON.parse(text); } catch { return []; }
}

async function fetchMarkets() {
  const today = new Date().toDateString();
  const prompt = `Generate realistic SA financial market snapshot for ${today}. Return ONLY JSON:\n{"headline":"One sentence SA market sentiment","rates":[{"pair":"USD/ZAR","rate":"18.72","change":"+0.15","dir":"up"},{"pair":"EUR/ZAR","rate":"20.41","change":"-0.07","dir":"down"},{"pair":"GBP/ZAR","rate":"23.81","change":"+0.22","dir":"up"},{"pair":"CNY/ZAR","rate":"2.58","change":"-0.02","dir":"down"}],"indices":[{"name":"JSE All Share","value":"81,540","change":"+1.1%","dir":"up"},{"name":"JSE Top 40","value":"75,120","change":"+0.9%","dir":"up"},{"name":"S&P 500","value":"5,862","change":"-0.2%","dir":"down"},{"name":"Bitcoin","value":"$67,800","change":"+2.3%","dir":"up"}],"commodities":[{"name":"Gold","value":"$2,345/oz","change":"+0.4%","dir":"up"},{"name":"Brent Crude","value":"$84.50","change":"-0.9%","dir":"down"},{"name":"Platinum","value":"$1,025/oz","change":"+0.6%","dir":"up"}]}`;
  const text = await callClaude(prompt);
  try { return JSON.parse(text); } catch { return null; }
}

// ─── SHARED UI ────────────────────────────────────────────────────────────
const AdBanner = ({ label }) => (
  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.09)", borderRadius: "8px", padding: "11px", textAlign: "center", color: "rgba(255,255,255,0.18)", fontSize: "10px", letterSpacing: "0.12em", fontFamily: "'Space Mono',monospace", margin: "12px 0" }}>
    [ ADSENSE — {label} ]
  </div>
);

const Spinner = ({ msg = "Fetching with AI..." }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: "14px" }}>
    <div style={{ width: "34px", height: "34px", border: "3px solid rgba(255,255,255,0.08)", borderTop: "3px solid #f59e0b", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono',monospace" }}>{msg}</div>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
);

// ─── TAX CALCULATOR ───────────────────────────────────────────────────────
function TaxCalc() {
  const [income, setIncome] = useState(25000);
  const [period, setPeriod] = useState("monthly");
  const [age, setAge] = useState(30);
  const [med, setMed] = useState(1);
  const [ra, setRa] = useState(0);
  const [sub, setSub] = useState("calc");

  const annual = period === "monthly" ? income * 12 : income;
  const r = calcTax(annual, age, med, ra * 12);
  const { tax = 0, effectiveRate = 0, marginalRate = 0, uif = 0, takeHome = 0, allowedRA = 0, taxSaved = 0, taxable = annual } = r;

  const Card = ({ label, value, accent, green, red }) => (
    <div style={{ background: accent ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${accent ? "rgba(245,158,11,0.28)" : green ? "rgba(52,211,153,0.22)" : red ? "rgba(248,113,113,0.18)" : "rgba(255,255,255,0.07)"}`, borderRadius: "10px", padding: "11px 13px" }}>
      <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.32)", letterSpacing: "0.1em", fontFamily: "'Space Mono',monospace", marginBottom: "5px" }}>{label}</div>
      <div style={{ fontSize: "17px", fontWeight: "700", fontFamily: "'Fraunces',serif", color: accent ? "#f59e0b" : green ? "#34d399" : red ? "#f87171" : "#fff" }}>{value}</div>
    </div>
  );

  const Slide = ({ label, min, max, step, val, set, disp, hi }) => (
    <div style={{ marginBottom: "15px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontSize: "9px", color: hi ? "rgba(52,211,153,0.75)" : "rgba(255,255,255,0.38)", fontFamily: "'Space Mono',monospace", letterSpacing: "0.07em" }}>{label}</span>
        <span style={{ fontSize: "11px", fontWeight: "600", color: hi ? "#34d399" : "#f59e0b", fontFamily: "'Space Mono',monospace" }}>{disp(val)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val} onChange={e => set(+e.target.value)} style={{ width: "100%", accentColor: hi ? "#34d399" : "#f59e0b", cursor: "pointer" }} />
    </div>
  );

  return (
    <div style={{ padding: "14px 16px 80px" }}>
      <AdBanner label="728×90 TOP" />
      <div style={{ display: "flex", gap: "5px", marginBottom: "14px", background: "rgba(255,255,255,0.03)", padding: "4px", borderRadius: "10px" }}>
        {[["calc","⚡ Calculate"],["split","📊 Split"],["ra","🏦 RA"]].map(([k,v]) => (
          <button key={k} onClick={() => setSub(k)} style={{ flex:1, padding:"7px 4px", borderRadius:"7px", border:"none", background: sub===k ? "rgba(245,158,11,0.14)" : "transparent", color: sub===k ? "#f59e0b" : "rgba(255,255,255,0.38)", cursor:"pointer", fontFamily:"'Space Mono',monospace", fontSize:"9px" }}>{v}</button>
        ))}
      </div>

      {sub === "calc" && <>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"13px", padding:"16px", marginBottom:"12px" }}>
          <div style={{ display:"flex", gap:"6px", marginBottom:"16px" }}>
            {["monthly","annual"].map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ flex:1, padding:"7px", borderRadius:"7px", border: period===p?"1px solid #f59e0b":"1px solid rgba(255,255,255,0.09)", background: period===p?"rgba(245,158,11,0.09)":"transparent", color: period===p?"#f59e0b":"rgba(255,255,255,0.38)", cursor:"pointer", fontFamily:"'Space Mono',monospace", fontSize:"9px" }}>
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <Slide label={`${period.toUpperCase()} INCOME`} min={period==="monthly"?2000:24000} max={period==="monthly"?200000:2400000} step={period==="monthly"?500:6000} val={income} set={setIncome} disp={v=>`R ${v.toLocaleString("en-ZA")}`} />
          <Slide label="AGE" min={18} max={80} step={1} val={age} set={setAge} disp={v=>`${v} yrs`} />
          <Slide label="MEDICAL AID MEMBERS" min={0} max={8} step={1} val={med} set={setMed} disp={v=>v===0?"None":`${v}`} />
          <Slide label="RA CONTRIBUTION / MONTH" min={0} max={Math.max(100,Math.round(annual*0.275/12))} step={100} val={ra} set={setRa} disp={v=>v===0?"None":`R ${v.toLocaleString("en-ZA")}`} hi />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
          <Card label="MONTHLY TAKE HOME" value={fmt(takeHome/12)} accent />
          <Card label="ANNUAL TAKE HOME" value={fmt(takeHome)} />
          <Card label="MONTHLY TAX" value={fmt(tax/12)} red />
          <Card label="EFFECTIVE RATE" value={`${effectiveRate.toFixed(1)}%`} />
          <Card label="MARGINAL RATE" value={`${marginalRate}%`} />
          <Card label="MONTHLY UIF" value={fmt(uif/12)} />
          {ra>0 && <Card label="TAX SAVED (RA/YR)" value={fmt(taxSaved)} green />}
          {ra>0 && <Card label="NET RA COST/YR" value={fmt(Math.max(0,ra*12-taxSaved))} />}
        </div>
        <AdBanner label="300×250 BOTTOM" />
      </>}

      {sub === "split" && (() => {
        const slices = [
          {l:"Take Home",v:takeHome,c:"#34d399"},
          {l:"Income Tax",v:tax,c:"#f87171"},
          {l:"UIF",v:uif,c:"#fb923c"},
          ...(allowedRA>0?[{l:"RA",v:allowedRA,c:"#60a5fa"}]:[]),
        ];
        return (
          <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"13px", padding:"16px" }}>
            <div style={{ display:"flex", borderRadius:"7px", overflow:"hidden", height:"30px", marginBottom:"18px" }}>
              {slices.map((s,i) => <div key={i} style={{ width:`${(s.v/annual)*100}%`, background:s.c, opacity:0.82, transition:"width 0.5s ease" }} />)}
            </div>
            {slices.map((s,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom: i<slices.length-1?"1px solid rgba(255,255,255,0.05)":"none" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"9px" }}>
                  <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:s.c }} />
                  <span style={{ fontSize:"13px", color:"rgba(255,255,255,0.62)" }}>{s.l}</span>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:"13px", fontWeight:"600", fontFamily:"'Space Mono',monospace" }}>{fmt(s.v)}</div>
                  <div style={{ fontSize:"9px", color:"rgba(255,255,255,0.28)", fontFamily:"'Space Mono',monospace" }}>{((s.v/annual)*100).toFixed(1)}%</div>
                </div>
              </div>
            ))}
            <AdBanner label="300×250 MID" />
          </div>
        );
      })()}

      {sub === "ra" && (
        <div style={{ display:"grid", gap:"11px" }}>
          <div style={{ background:"rgba(52,211,153,0.05)", border:"1px solid rgba(52,211,153,0.18)", borderRadius:"13px", padding:"16px" }}>
            <div style={{ fontSize:"9px", color:"rgba(52,211,153,0.75)", fontFamily:"'Space Mono',monospace", letterSpacing:"0.1em", marginBottom:"7px" }}>🏦 RETIREMENT ANNUITY DEDUCTION</div>
            <p style={{ fontSize:"12px", color:"rgba(255,255,255,0.58)", lineHeight:"1.7" }}>Contribute up to <strong style={{ color:"#34d399" }}>27.5% of income</strong> (max R350k/yr) and deduct it before tax. SARS co-funds your retirement.</p>
          </div>
          <Slide label="RA CONTRIBUTION / MONTH" min={0} max={Math.max(100,Math.round(annual*0.275/12))} step={100} val={ra} set={setRa} disp={v=>v===0?"None":`R ${v.toLocaleString("en-ZA")}`} hi />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
            <Card label="MONTHLY CONTRIBUTION" value={ra===0?"R 0":fmt(ra)} />
            <Card label="TAX SAVED / YEAR" value={fmt(taxSaved)} green />
            <Card label="NET COST / YEAR" value={fmt(Math.max(0,ra*12-taxSaved))} />
            <Card label="TAXABLE INCOME" value={fmt(taxable)} />
          </div>
          {ra>0 && <div style={{ background:"rgba(52,211,153,0.05)", border:"1px solid rgba(52,211,153,0.18)", borderRadius:"11px", padding:"13px", fontSize:"12px", color:"rgba(255,255,255,0.58)", lineHeight:"1.8" }}>
            You invest <strong style={{ color:"#fff" }}>{fmt(ra*12)}/yr</strong> but SARS gives back <strong style={{ color:"#34d399" }}>{fmt(taxSaved)}</strong>. Real out-of-pocket: <strong style={{ color:"#fff" }}>{fmt(Math.max(0,ra*12-taxSaved))}/yr</strong>.
          </div>}
          <AdBanner label="300×250 BOTTOM" />
        </div>
      )}
    </div>
  );
}

// ─── NEWS FEED ────────────────────────────────────────────────────────────
const CAT_COLORS = {
  Politics:"#f87171", Economy:"#fb923c", Energy:"#fbbf24", Social:"#60a5fa",
  Sport:"#a78bfa", AI:"#34d399", Fintech:"#f59e0b", Smartphones:"#60a5fa",
  Startups:"#f59e0b", Security:"#f87171", Apps:"#34d399", General:"#9ca3af",
};

function NewsFeed({ type }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [fetched, setFetched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setExpanded(null);
    const data = await fetchNews(type);
    setArticles(data);
    setLoading(false);
    setFetched(true);
  }, [type]);

  useEffect(() => { if (!fetched) load(); }, [load, fetched]);

  const isSA = type === "sa";
  const accentColor = isSA ? "#f87171" : "#34d399";

  return (
    <div style={{ padding:"14px 16px 80px" }}>
      <AdBanner label="728×90 TOP" />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
        <div>
          <div style={{ fontSize:"9px", color:accentColor, fontFamily:"'Space Mono',monospace", letterSpacing:"0.12em", marginBottom:"3px" }}>
            {isSA ? "🇿🇦 SOUTH AFRICA · TODAY" : "💻 GLOBAL TECH · TODAY"}
          </div>
          <div style={{ fontSize:"19px", fontWeight:"700", fontFamily:"'Fraunces',serif" }}>
            {isSA ? "Current Affairs" : "Tech News"}
          </div>
        </div>
        <button onClick={load} disabled={loading} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:"8px", padding:"7px 11px", color:"rgba(255,255,255,0.55)", cursor: loading?"not-allowed":"pointer", fontFamily:"'Space Mono',monospace", fontSize:"9px" }}>
          {loading ? "..." : "↻ Refresh"}
        </button>
      </div>

      {loading && <Spinner msg={isSA ? "Generating SA news..." : "Generating tech news..."} />}

      {!loading && fetched && articles.length === 0 && (
        <div style={{ textAlign:"center", padding:"48px 20px", color:"rgba(255,255,255,0.28)", fontSize:"13px" }}>
          Could not load articles.{" "}
          <button onClick={load} style={{ color:"#f59e0b", background:"none", border:"none", cursor:"pointer", fontFamily:"'Space Mono',monospace", fontSize:"11px" }}>Retry</button>
        </div>
      )}

      {!loading && articles.map((a, i) => {
        const cc = CAT_COLORS[a.category] || "#9ca3af";
        const open = expanded === i;
        return (
          <div key={i}>
            <div onClick={() => setExpanded(open ? null : i)} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderLeft:`3px solid ${cc}`, borderRadius:"11px", padding:"13px 14px", marginBottom:"9px", cursor:"pointer" }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:"10px", marginBottom:"7px" }}>
                <div style={{ fontSize:"14px", fontWeight:"600", color:"#fff", lineHeight:"1.4", flex:1 }}>{a.headline}</div>
                <div style={{ color:"rgba(255,255,255,0.3)", fontSize:"12px", flexShrink:0, marginTop:"2px" }}>{open?"▲":"▼"}</div>
              </div>
              <div style={{ display:"flex", gap:"7px", alignItems:"center" }}>
                <span style={{ fontSize:"9px", color:cc, border:`1px solid ${cc}38`, padding:"2px 7px", borderRadius:"20px", fontFamily:"'Space Mono',monospace" }}>{a.category}</span>
                <span style={{ fontSize:"10px", color:"rgba(255,255,255,0.28)", fontFamily:"'Space Mono',monospace" }}>{a.time}</span>
              </div>
              {open && (
                <div style={{ marginTop:"10px", paddingTop:"10px", borderTop:"1px solid rgba(255,255,255,0.06)", fontSize:"13px", color:"rgba(255,255,255,0.58)", lineHeight:"1.72" }}>
                  {a.summary}
                </div>
              )}
            </div>
            {i === 2 && <AdBanner label="300×250 MID-FEED" />}
          </div>
        );
      })}

      {!loading && articles.length > 0 && <AdBanner label="300×250 BOTTOM" />}
    </div>
  );
}

// ─── MARKETS ──────────────────────────────────────────────────────────────
function Markets() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchMarkets();
    setData(d);
    setLoading(false);
    setFetched(true);
  }, []);

  useEffect(() => { if (!fetched) load(); }, [load, fetched]);

  const Grid = ({ title, items, cols = "1fr 1fr" }) => (
    <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"13px", padding:"15px", marginBottom:"11px" }}>
      <div style={{ fontSize:"9px", color:"rgba(255,255,255,0.32)", fontFamily:"'Space Mono',monospace", letterSpacing:"0.1em", marginBottom:"11px" }}>{title}</div>
      <div style={{ display:"grid", gridTemplateColumns:cols, gap:"7px" }}>
        {items?.map((item,i) => (
          <div key={i} style={{ background:"rgba(255,255,255,0.03)", borderRadius:"9px", padding:"10px 11px", border:`1px solid ${item.dir==="up"?"rgba(52,211,153,0.14)":"rgba(248,113,113,0.14)"}` }}>
            <div style={{ fontSize:"9px", color:"rgba(255,255,255,0.38)", fontFamily:"'Space Mono',monospace", marginBottom:"4px" }}>{item.pair||item.name}</div>
            <div style={{ fontSize:"15px", fontWeight:"700", fontFamily:"'Fraunces',serif", color:"#fff", marginBottom:"2px" }}>{item.rate||item.value}</div>
            <div style={{ fontSize:"10px", color: item.dir==="up"?"#34d399":"#f87171", fontFamily:"'Space Mono',monospace" }}>
              {item.dir==="up"?"▲":"▼"} {item.change}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ padding:"14px 16px 80px" }}>
      <AdBanner label="728×90 TOP" />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
        <div>
          <div style={{ fontSize:"9px", color:"#60a5fa", fontFamily:"'Space Mono',monospace", letterSpacing:"0.12em", marginBottom:"3px" }}>📈 JSE & FX · TODAY</div>
          <div style={{ fontSize:"19px", fontWeight:"700", fontFamily:"'Fraunces',serif" }}>Markets & ZAR</div>
        </div>
        <button onClick={load} disabled={loading} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:"8px", padding:"7px 11px", color:"rgba(255,255,255,0.55)", cursor: loading?"not-allowed":"pointer", fontFamily:"'Space Mono',monospace", fontSize:"9px" }}>
          {loading ? "..." : "↻ Refresh"}
        </button>
      </div>

      {loading && <Spinner msg="Generating market data..." />}

      {!loading && data && <>
        {data.headline && (
          <div style={{ background:"rgba(96,165,250,0.06)", border:"1px solid rgba(96,165,250,0.18)", borderRadius:"11px", padding:"12px 14px", marginBottom:"13px" }}>
            <div style={{ fontSize:"9px", color:"#60a5fa", fontFamily:"'Space Mono',monospace", marginBottom:"4px" }}>MARKET SENTIMENT</div>
            <div style={{ fontSize:"13px", color:"rgba(255,255,255,0.65)", lineHeight:"1.65" }}>{data.headline}</div>
          </div>
        )}
        <Grid title="ZAR EXCHANGE RATES" items={data.rates} />
        <AdBanner label="300×250 MID" />
        <Grid title="INDICES" items={data.indices} />
        <Grid title="COMMODITIES" items={data.commodities} cols="1fr 1fr 1fr" />
        <AdBanner label="300×250 BOTTOM" />
      </>}

      {!loading && fetched && !data && (
        <div style={{ textAlign:"center", padding:"48px 20px", color:"rgba(255,255,255,0.28)", fontSize:"13px" }}>
          Failed to load.{" "}
          <button onClick={load} style={{ color:"#f59e0b", background:"none", border:"none", cursor:"pointer", fontFamily:"'Space Mono',monospace", fontSize:"11px" }}>Retry</button>
        </div>
      )}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("tax");

  const nav = [
    { id:"tax",     icon:"🧮", label:"Tax",     color:"#f59e0b" },
    { id:"news",    icon:"🇿🇦", label:"SA News", color:"#f87171" },
    { id:"tech",    icon:"💻", label:"Tech",    color:"#34d399" },
    { id:"markets", icon:"📈", label:"Markets", color:"#60a5fa" },
  ];

  const meta = {
    tax:     { title:"SA Tax Calculator",  eyebrow:"🇿🇦 SARS 2024/2025",    color:"#f59e0b" },
    news:    { title:"Current Affairs",    eyebrow:"🗞️ SOUTH AFRICA TODAY", color:"#f87171" },
    tech:    { title:"Tech News",          eyebrow:"💡 GLOBAL TECH",        color:"#34d399" },
    markets: { title:"Markets & ZAR",      eyebrow:"💹 JSE & FX",           color:"#60a5fa" },
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,700;0,9..144,900;1,9..144,400&family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#080b10}
        input[type=range]{-webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.09);border-radius:3px;height:3px;outline:none;width:100%}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#f59e0b;cursor:pointer;box-shadow:0 0 5px rgba(245,158,11,0.45)}
        ::-webkit-scrollbar{width:2px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}
      `}</style>

      <div style={{ minHeight:"100vh", background:"linear-gradient(180deg,#080b10 0%,#0c1018 100%)", color:"#fff", fontFamily:"'DM Sans',sans-serif", maxWidth:"480px", margin:"0 auto", position:"relative" }}>

        {/* Header */}
        <div style={{ background:"rgba(8,11,16,0.92)", backdropFilter:"blur(18px)", borderBottom:"1px solid rgba(255,255,255,0.05)", padding:"13px 17px", position:"sticky", top:0, zIndex:20 }}>
          <div style={{ fontSize:"9px", color:meta[tab].color, letterSpacing:"0.15em", fontFamily:"'Space Mono',monospace", marginBottom:"2px" }}>{meta[tab].eyebrow}</div>
          <div style={{ fontSize:"19px", fontWeight:"700", fontFamily:"'Fraunces',serif" }}>{meta[tab].title}</div>
        </div>

        {/* Content */}
        <div style={{ minHeight:"calc(100vh - 120px)" }}>
          {tab === "tax"     && <TaxCalc />}
          {tab === "news"    && <NewsFeed key="sa"   type="sa" />}
          {tab === "tech"    && <NewsFeed key="tech" type="tech" />}
          {tab === "markets" && <Markets />}
        </div>

        {/* Bottom Nav */}
        <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:"480px", background:"rgba(6,9,14,0.97)", backdropFilter:"blur(22px)", borderTop:"1px solid rgba(255,255,255,0.07)", display:"flex", zIndex:30 }}>
          {nav.map(({ id, icon, label, color }) => (
            <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:"11px 4px 9px", display:"flex", flexDirection:"column", alignItems:"center", gap:"4px", background:"none", border:"none", cursor:"pointer", borderTop: tab===id ? `2px solid ${color}` : "2px solid transparent", transition:"all 0.18s" }}>
              <span style={{ fontSize:"19px", lineHeight:1 }}>{icon}</span>
              <span style={{ fontSize:"9px", fontFamily:"'Space Mono',monospace", color: tab===id ? color : "rgba(255,255,255,0.3)", letterSpacing:"0.04em" }}>{label}</span>
            </button>
          ))}
        </div>

      </div>
    </>
  );
}
