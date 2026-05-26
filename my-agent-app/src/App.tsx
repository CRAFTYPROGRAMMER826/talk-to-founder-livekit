import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BarVisualizer,
  ControlBar,
  RoomAudioRenderer,
  SessionProvider,
  useAgent,
  useRoomContext,
  useSession,
} from "@livekit/components-react";
import { ParticipantKind, RoomEvent, TokenSource } from "livekit-client";
import "@livekit/components-styles";

const tokenSource = TokenSource.sandboxTokenServer("maneuver-qm1wle");
const UI_TOPIC = "maneuver.ui";
const RPC_METHOD = "submit_scheduling";

type AgentKey = "husain" | "sara" | "system";

const THEMES: Record<
  AgentKey,
  { name: string; initial: string; role: string; primary: string; secondary: string; glow: string }
> = {
  husain: {
    name: "Husain",
    initial: "H",
    role: "Founder, Maneuver",
    primary: "#d4af37",
    secondary: "#a07c1e",
    glow: "rgba(212,175,55,0.35)",
  },
  sara: {
    name: "Sara",
    initial: "S",
    role: "Scheduling",
    primary: "#c4a0ff",
    secondary: "#8b5cf6",
    glow: "rgba(139,92,246,0.35)",
  },
  system: {
    name: "System",
    initial: "✓",
    role: "Confirming booking",
    primary: "#6ee7b7",
    secondary: "#34d399",
    glow: "rgba(52,211,153,0.35)",
  },
};

const LEAD_KEYS = ["name", "company", "problem", "timeline", "budget"] as const;

function parseAgent(raw?: string): AgentKey {
  const k = (raw ?? "husain").toLowerCase();
  if (k.includes("sara")) return "sara";
  if (k.includes("system")) return "system";
  return "husain";
}

type UiState = {
  activeAgent: AgentKey;
  sessionEnded: boolean;
  lead: Partial<Record<(typeof LEAD_KEYS)[number], string>>;
};

const UiCtx = createContext<UiState>({ activeAgent: "husain", sessionEnded: false, lead: {} });

function UiProvider({ children }: { children: ReactNode }) {
  const room = useRoomContext();
  const [activeAgent, setActiveAgent] = useState<AgentKey>("husain");
  const [sessionEnded, setSessionEnded] = useState(false);
  const [lead, setLead] = useState<UiState["lead"]>({});

  useEffect(() => {
    const onData = (payload: Uint8Array, _p?: unknown, _k?: unknown, topic?: string) => {
      if (topic && topic !== UI_TOPIC) return;
      try {
        const m = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
          agent?: string;
          field?: string;
          value?: string;
        };
        if (m.type === "active_agent" && m.agent) setActiveAgent(parseAgent(m.agent));
        if (m.type === "lead_field" && m.field && m.value) {
          setLead((prev) => ({ ...prev, [m.field!]: m.value }));
        }
        if (m.type === "session_ended") setSessionEnded(true);
      } catch {
        /* ignore */
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => room.off(RoomEvent.DataReceived, onData);
  }, [room]);

  useEffect(() => {
    const sync = () => {
      for (const p of room.remoteParticipants.values()) {
        const a = p.attributes?.["maneuver.agent"];
        if (a) {
          setActiveAgent(parseAgent(a));
          return;
        }
      }
    };
    sync();
    room.on(RoomEvent.ParticipantAttributesChanged, sync);
    return () => room.off(RoomEvent.ParticipantAttributesChanged, sync);
  }, [room]);

  const value = useMemo(
    () => ({ activeAgent, sessionEnded, lead }),
    [activeAgent, sessionEnded, lead],
  );
  return <UiCtx.Provider value={value}>{children}</UiCtx.Provider>;
}

function useUi() {
  return useContext(UiCtx);
}

export default function App() {
  const session = useSession(tokenSource, { agentName: "maneuver" });
  useEffect(() => {
    session.start();
    return () => session.end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SessionProvider session={session}>
      <UiProvider>
        <div style={s.root}>
          <header style={s.header}>
            <span style={s.logo}>MANEUVER</span>
            <span style={s.div}>|</span>
            <span style={s.tag}>Talk to the Founder</span>
          </header>
          <main style={s.main}>
            <AgentView />
            <LeadSidebar />
          </main>
          <footer style={s.footer}>
            <ScheduleForm />
            <div style={s.controlWrap}>
              <ControlBar controls={{ microphone: true, camera: false, screenShare: false }} />
            </div>
          </footer>
          <RoomAudioRenderer />
        </div>
      </UiProvider>
    </SessionProvider>
  );
}

function AgentView() {
  const agent = useAgent();
  const { activeAgent, sessionEnded } = useUi();
  const theme = THEMES[activeAgent];
  const state = agent.state ?? "idle";

  const ring =
    state === "listening"
      ? theme.secondary
      : state === "speaking"
        ? theme.primary
        : state === "thinking"
          ? theme.primary
          : theme.secondary;

  const label =
    state === "listening"
      ? `${theme.name} is listening…`
      : state === "speaking"
        ? `${theme.name} is speaking…`
        : state === "thinking"
          ? `${theme.name} is thinking…`
          : `Connecting to ${theme.name}…`;

  return (
    <div style={s.agentCol}>
      <div style={{ position: "relative", width: 170, height: 170 }}>
        {state === "speaking" && (
          <>
            <div style={{ ...s.pulse, borderColor: ring, animationDelay: "0s" }} />
            <div style={{ ...s.pulse, borderColor: ring, animationDelay: "0.4s" }} />
          </>
        )}
        <div
          style={{
            ...s.ring,
            borderColor: ring,
            boxShadow: `0 0 28px ${theme.glow}`,
            animation: state === "thinking" ? "spin 2.5s linear infinite" : undefined,
          }}
        >
          <div style={{ ...s.inner, borderColor: ring }}>
            <span style={{ fontSize: 42, color: theme.primary }}>{theme.initial}</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 22, letterSpacing: "0.12em", color: theme.primary }}>{theme.name}</div>
      <div style={s.role}>{theme.role}</div>
      <div style={{ ...s.state, color: ring }}>{label}</div>
      {agent.canListen && (
        <div style={{ width: 260, height: 48, filter: `hue-rotate(${activeAgent === "sara" ? 220 : activeAgent === "system" ? 90 : 25}deg)` }}>
          <BarVisualizer track={agent.microphoneTrack} state={agent.state} barCount={14} />
        </div>
      )}
      {sessionEnded && <div style={s.ended}>Call complete — check your email for confirmation.</div>}
    </div>
  );
}

function LeadSidebar() {
  const { lead, activeAgent } = useUi();
  const c = THEMES[activeAgent].primary;
  return (
    <aside style={s.sidebar}>
      <div style={{ ...s.sideTitle, color: c }}>DISCOVERY</div>
      {LEAD_KEYS.map((k) => (
        <div key={k} style={s.sideRow}>
          <span style={s.sideKey}>{k}</span>
          <span style={lead[k] ? s.sideVal : s.sideEmpty}>{lead[k] ?? "—"}</span>
        </div>
      ))}
    </aside>
  );
}

function agentIdentity(room: ReturnType<typeof useRoomContext>, hookId?: string) {
  if (hookId) return hookId;
  for (const p of room.remoteParticipants.values()) {
    if (p.kind === ParticipantKind.AGENT) return p.identity;
  }
  return room.remoteParticipants.values().next().value?.identity;
}

function ScheduleForm() {
  const room = useRoomContext();
  const lkAgent = useAgent();
  const { activeAgent } = useUi();
  const theme = THEMES[activeAgent];

  const [email, setEmail] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timezone, setTimezone] = useState("GST");
  const [sent, setSent] = useState(false);
  const [summary, setSummary] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = activeAgent === "sara" || sent;

  const submit = useCallback(async () => {
    if (!email || !date || !time) return;
    setBusy(true);
    setErr(null);
    const body = {
      type: "scheduling_form",
      email: email.trim(),
      date,
      time,
      timezone,
    };
    const payload = JSON.stringify(body);
    try {
      const dest = agentIdentity(room, lkAgent.agent?.identity);
      if (dest) {
        try {
          await room.localParticipant.performRpc({
            destinationIdentity: dest,
            method: RPC_METHOD,
            payload,
          });
        } catch {
          await room.localParticipant.publishData(new TextEncoder().encode(payload), {
            reliable: true,
            topic: UI_TOPIC,
          });
        }
      } else {
        await room.localParticipant.publishData(new TextEncoder().encode(payload), {
          reliable: true,
          topic: UI_TOPIC,
        });
      }
      setSummary(`${email} · ${date} ${time} (${timezone})`);
      setSent(true);
    } catch (e) {
      console.error(e);
      setErr("Could not reach agent — try Confirm again.");
    } finally {
      setBusy(false);
    }
  }, [date, email, lkAgent.agent?.identity, room, time, timezone]);

  if (!visible) {
    return <p style={s.muted}>Scheduling opens when Sara takes over.</p>;
  }
  if (sent) {
    return (
      <div style={s.panel}>
        <p style={{ color: theme.primary, textAlign: "center", margin: 0 }}>
          ✓ Sent: {summary}
        </p>
        <p style={s.muted}>Say &quot;done&quot; so Sara can confirm. Confirmation email goes to this address.</p>
      </div>
    );
  }

  return (
    <div style={{ ...s.panel, borderColor: `${theme.primary}33` }}>
      <div style={{ color: theme.primary, fontSize: 10, letterSpacing: "0.2em" }}>BOOK FOLLOW-UP</div>
      <div style={s.formRow}>
        <input style={s.input} type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={s.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input style={s.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <select style={s.input} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          <option value="GST">GST</option>
          <option value="UTC">UTC</option>
          <option value="IST">IST</option>
          <option value="EST">EST</option>
        </select>
        <button
          style={email && date && time ? { ...s.btn, background: theme.primary } : s.btnOff}
          disabled={!email || !date || !time || busy}
          onClick={() => void submit()}
        >
          {busy ? "Sending…" : "Confirm"}
        </button>
      </div>
      {err && <p style={{ color: "#f87171", fontSize: 11 }}>{err}</p>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: "#080705",
    backgroundImage: "radial-gradient(ellipse at 50% 0%, #1a1408 0%, #080705 70%)",
    display: "flex",
    flexDirection: "column",
    color: "#e8d5a0",
    fontFamily: "Georgia, serif",
  },
  header: { padding: "18px 28px", borderBottom: "1px solid #2a2010", display: "flex", gap: 10, alignItems: "center" },
  logo: { fontFamily: "monospace", fontSize: 11, letterSpacing: "0.35em", color: "#d4af37", fontWeight: "bold" },
  div: { color: "#2a2010" },
  tag: { fontSize: 11, color: "#5a4a20", fontStyle: "italic" },
  main: { flex: 1, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 40, padding: 32 },
  agentCol: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14 },
  pulse: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 160,
    height: 160,
    borderRadius: "50%",
    border: "1px solid",
    transform: "translate(-50%, -50%)",
    animation: "pulse 1.5s ease-out infinite",
  } as React.CSSProperties,
  ring: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 132,
    height: 132,
    borderRadius: "50%",
    border: "2px solid",
    transform: "translate(-50%, -50%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "border-color 0.35s",
  },
  inner: {
    width: 108,
    height: 108,
    borderRadius: "50%",
    border: "1px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "radial-gradient(circle, #151208 0%, #0a0805 100%)",
  },
  role: { fontSize: 10, letterSpacing: "0.18em", color: "#5a4a20", fontFamily: "monospace" },
  state: { fontSize: 12, fontStyle: "italic" },
  ended: {
    marginTop: 8,
    padding: "8px 14px",
    border: "1px solid #34d39944",
    borderRadius: 6,
    color: "#6ee7b7",
    fontSize: 11,
  },
  sidebar: {
    minWidth: 200,
    padding: 16,
    border: "1px solid #2a2010",
    borderRadius: 6,
    background: "rgba(10,8,4,0.85)",
  },
  sideTitle: { fontSize: 9, letterSpacing: "0.22em", fontFamily: "monospace", marginBottom: 10 },
  sideRow: { display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 },
  sideKey: { color: "#5a4a20", textTransform: "capitalize", fontFamily: "monospace" },
  sideVal: { color: "#e8d5a0", textAlign: "right", maxWidth: "55%" },
  sideEmpty: { color: "#2a2010" },
  footer: { borderTop: "1px solid #2a2010", padding: 14, background: "rgba(0,0,0,0.45)" },
  controlWrap: { display: "flex", justifyContent: "center", marginTop: 10 },
  panel: { padding: 14, borderRadius: 6, border: "1px solid #2a2010", background: "rgba(18,14,6,0.92)" },
  muted: { fontSize: 11, color: "#3a2e10", fontStyle: "italic", textAlign: "center", margin: 0 },
  formRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 },
  input: {
    flex: 1,
    minWidth: 120,
    padding: "8px 10px",
    background: "#0d0b05",
    border: "1px solid #2a2010",
    borderRadius: 4,
    color: "#e8d5a0",
    fontSize: 12,
    fontFamily: "monospace",
    colorScheme: "dark",
  },
  btn: {
    border: "none",
    borderRadius: 4,
    padding: "8px 18px",
    fontWeight: "bold",
    color: "#080705",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: 11,
  },
  btnOff: {
    padding: "8px 18px",
    background: "#1a1408",
    color: "#3a2e10",
    border: "1px solid #2a2010",
    borderRadius: 4,
    fontFamily: "monospace",
    fontSize: 11,
  },
};

if (typeof document !== "undefined" && !document.getElementById("lk-anim")) {
  const el = document.createElement("style");
  el.id = "lk-anim";
  el.textContent = `
    @keyframes pulse { 0% { transform: translate(-50%,-50%) scale(1); opacity: 0.5; } 100% { transform: translate(-50%,-50%) scale(1.7); opacity: 0; } }
    @keyframes spin { from { transform: translate(-50%,-50%) rotate(0deg); } to { transform: translate(-50%,-50%) rotate(360deg); } }
    [data-lk-theme] { --lk-bg: transparent !important; }
  `;
  document.head.appendChild(el);
}
