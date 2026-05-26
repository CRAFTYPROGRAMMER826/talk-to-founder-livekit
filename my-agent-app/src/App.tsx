import { useEffect, useState, useRef } from "react";
import {
  ControlBar,
  RoomAudioRenderer,
  useSession,
  SessionProvider,
  useAgent,
  BarVisualizer,
} from "@livekit/components-react";
import { TokenSource } from "livekit-client";
import "@livekit/components-styles";

const tokenSource = TokenSource.sandboxTokenServer("maneuver-qm1wle");

// Agent display config — maps agent identity/name to display info
const AGENT_CONFIG: Record<string, { name: string; initial: string; role: string }> = {
  husain: { name: "Husain", initial: "H", role: "Founder, Maneuver" },
  sara:   { name: "Sara",   initial: "S", role: "Scheduling Assistant" },
  system: { name: "System", initial: "✓", role: "Wrapping up..." },
};

function getAgentConfig(identity?: string) {
  if (!identity) return AGENT_CONFIG.husain;
  const key = identity.toLowerCase();
  for (const k of Object.keys(AGENT_CONFIG)) {
    if (key.includes(k)) return AGENT_CONFIG[k];
  }
  return AGENT_CONFIG.husain;
}

export default function App() {
  const session = useSession(tokenSource, { agentName: "maneuver" });
  useEffect(() => {
    session.start();
    return () => { session.end(); };
  }, []);

  return (
    <SessionProvider session={session}>
      <div style={s.root}>
        <header style={s.header}>
          <span style={s.logo}>MANEUVER</span>
          <span style={s.headerDivider}>|</span>
          <span style={s.tagline}>Talk to the Founder</span>
        </header>

        <main style={s.main}>
          <AgentView />
        </main>

        <footer style={s.footer}>
          <SchedulingPanel />
          <div style={s.controlWrap}>
            <ControlBar controls={{ microphone: true, camera: false, screenShare: false }} />
          </div>
        </footer>

        <RoomAudioRenderer />
      </div>
    </SessionProvider>
  );
}

function AgentView() {
  const agent = useAgent();
  const state = agent.state ?? "idle";
  const cfg = getAgentConfig(agent.agent?.identity);

  const stateColor: Record<string, string> = {
    listening: "#d4af37",
    thinking:  "#a07c1e",
    speaking:  "#f5d060",
    idle:      "#3a3020",
    initializing: "#3a3020",
  };

  const stateLabel: Record<string, string> = {
    listening:    `${cfg.name} is listening...`,
    thinking:     `${cfg.name} is thinking...`,
    speaking:     `${cfg.name} is speaking...`,
    idle:         "Connecting to Husain...",
    initializing: "Initializing...",
  };

  const ringColor = stateColor[state] ?? "#3a3020";
  const label = stateLabel[state] ?? "Connecting...";
  const isSpeaking = state === "speaking";

  return (
    <div style={s.agentBox}>
      {/* Animated ring */}
      <div style={{ position: "relative", width: 160, height: 160 }}>
        {/* Pulse rings when speaking */}
        {isSpeaking && (
          <>
            <div style={{ ...s.pulseRing, animationDelay: "0s",   borderColor: ringColor }} />
            <div style={{ ...s.pulseRing, animationDelay: "0.4s", borderColor: ringColor }} />
            <div style={{ ...s.pulseRing, animationDelay: "0.8s", borderColor: ringColor }} />
          </>
        )}
        {/* Main ring */}
        <div style={{ ...s.avatarRing, borderColor: ringColor }}>
          <div style={s.avatarInner}>
            <span style={s.avatarInitial}>{cfg.initial}</span>
          </div>
        </div>
      </div>

      <div style={s.agentInfo}>
        <div style={{ ...s.agentName, color: ringColor }}>{cfg.name}</div>
        <div style={s.agentRole}>{cfg.role}</div>
      </div>

      <div style={{ ...s.stateLabel, color: ringColor }}>{label}</div>

      {agent.canListen && (
        <div style={s.visualizerWrap}>
          <BarVisualizer
            track={agent.microphoneTrack}
            state={agent.state}
            barCount={16}
          />
        </div>
      )}
    </div>
  );
}

function SchedulingPanel() {
  const [email, setEmail]       = useState("");
  const [date, setDate]         = useState("");
  const [time, setTime]         = useState("");
  const [timezone, setTimezone] = useState("GST");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!email || !date || !time) return;
    console.log("Scheduling details submitted:", { email, date, time, timezone });
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div style={s.panel}>
        <div style={s.panelSuccess}>✓ Details received — Sara will confirm shortly.</div>
      </div>
    );
  }

  return (
    <div style={s.panel}>
      <div style={s.panelTitle}>SCHEDULE A FOLLOW-UP</div>
      <div style={s.panelHint}>Fill this in when Sara asks to book a call.</div>
      <div style={s.formRow}>
        <input
          style={s.input}
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <input
          style={s.input}
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <input
          style={s.input}
          type="time"
          value={time}
          onChange={e => setTime(e.target.value)}
        />
        <select style={s.input} value={timezone} onChange={e => setTimezone(e.target.value)}>
          <option value="GST">GST — Dubai</option>
          <option value="IST">IST — India</option>
          <option value="UTC">UTC</option>
          <option value="EST">EST</option>
          <option value="PST">PST</option>
        </select>
        <button
          style={email && date && time ? s.btnActive : s.btnDisabled}
          onClick={handleSubmit}
          disabled={!email || !date || !time}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: "#080705",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Georgia', 'Times New Roman', serif",
    color: "#e8d5a0",
    // Subtle gold grain texture via gradient
    backgroundImage: "radial-gradient(ellipse at 50% 0%, #1a1408 0%, #080705 70%)",
  },
  header: {
    padding: "20px 32px",
    borderBottom: "1px solid #2a2010",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    background: "rgba(0,0,0,0.4)",
  },
  logo: {
    fontSize: "12px",
    fontFamily: "'Courier New', monospace",
    letterSpacing: "0.4em",
    color: "#d4af37",
    fontWeight: "bold",
  },
  headerDivider: {
    color: "#2a2010",
    fontSize: "16px",
  },
  tagline: {
    fontSize: "12px",
    color: "#5a4a20",
    letterSpacing: "0.1em",
    fontStyle: "italic",
  },
  main: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 20px",
  },
  agentBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "20px",
  },
  pulseRing: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "160px",
    height: "160px",
    borderRadius: "50%",
    border: "1px solid",
    opacity: 0,
    animation: "pulse 1.5s ease-out infinite",
  } as React.CSSProperties,
  avatarRing: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "130px",
    height: "130px",
    borderRadius: "50%",
    border: "1.5px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "border-color 0.4s ease",
    background: "radial-gradient(circle, #1a1408 0%, #0d0b05 100%)",
  },
  avatarInner: {
    width: "110px",
    height: "110px",
    borderRadius: "50%",
    background: "radial-gradient(circle, #1f1a08 0%, #0a0805 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2a2010",
  },
  avatarInitial: {
    fontSize: "44px",
    color: "#d4af37",
    fontFamily: "'Georgia', serif",
    textShadow: "0 0 20px rgba(212,175,55,0.3)",
  },
  agentInfo: {
    textAlign: "center",
  },
  agentName: {
    fontSize: "22px",
    letterSpacing: "0.15em",
    fontFamily: "'Georgia', serif",
    transition: "color 0.4s ease",
  },
  agentRole: {
    fontSize: "11px",
    color: "#5a4a20",
    letterSpacing: "0.2em",
    fontFamily: "'Courier New', monospace",
    marginTop: "4px",
  },
  stateLabel: {
    fontSize: "13px",
    letterSpacing: "0.08em",
    fontStyle: "italic",
    transition: "color 0.3s ease",
    color: "#5a4a20",
  },
  visualizerWrap: {
    width: "280px",
    height: "50px",
    filter: "hue-rotate(30deg) sepia(0.5)",
  },
  footer: {
    borderTop: "1px solid #2a2010",
    padding: "16px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    background: "rgba(0,0,0,0.5)",
  },
  controlWrap: {
    display: "flex",
    justifyContent: "center",
  },
  panel: {
    background: "rgba(20,16,5,0.9)",
    borderRadius: "6px",
    padding: "14px 18px",
    border: "1px solid #2a2010",
  },
  panelTitle: {
    fontSize: "10px",
    letterSpacing: "0.25em",
    color: "#d4af37",
    fontFamily: "'Courier New', monospace",
    marginBottom: "4px",
  },
  panelHint: {
    fontSize: "11px",
    color: "#3a2e10",
    marginBottom: "10px",
    fontStyle: "italic",
  },
  panelSuccess: {
    fontSize: "13px",
    color: "#d4af37",
    textAlign: "center",
    padding: "8px",
    letterSpacing: "0.05em",
  },
  formRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  input: {
    background: "#0d0b05",
    border: "1px solid #2a2010",
    borderRadius: "4px",
    padding: "8px 12px",
    color: "#e8d5a0",
    fontSize: "12px",
    outline: "none",
    flex: "1",
    minWidth: "130px",
    fontFamily: "'Courier New', monospace",
    colorScheme: "dark",
  },
  btnActive: {
    background: "#d4af37",
    color: "#080705",
    border: "none",
    borderRadius: "4px",
    padding: "8px 20px",
    fontSize: "12px",
    cursor: "pointer",
    fontWeight: "bold",
    letterSpacing: "0.1em",
    fontFamily: "'Courier New', monospace",
    transition: "background 0.2s",
  },
  btnDisabled: {
    background: "#1a1408",
    color: "#3a2e10",
    border: "1px solid #2a2010",
    borderRadius: "4px",
    padding: "8px 20px",
    fontSize: "12px",
    cursor: "not-allowed",
    fontFamily: "'Courier New', monospace",
  },
};

// Inject pulse keyframe animation
const styleTag = document.createElement("style");
styleTag.textContent = `
  @keyframes pulse {
    0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.6; }
    100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
  }
  [data-lk-theme] {
    --lk-bg: transparent !important;
  }
  input[type="date"]::-webkit-calendar-picker-indicator,
  input[type="time"]::-webkit-calendar-picker-indicator {
    filter: invert(0.7) sepia(1) hue-rotate(10deg);
  }
`;
document.head.appendChild(styleTag);
