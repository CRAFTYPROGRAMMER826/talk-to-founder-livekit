import asyncio
import contextlib
import json
import logging
import os
import re
import smtplib
from dataclasses import asdict, dataclass
from email.mime.text import MIMEText
from pathlib import Path

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    ChatContext,
    JobContext,
    JobProcess,
    RunContext,
    StopResponse,
    cli,
    function_tool,
    room_io,
)
from livekit.plugins import deepgram, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

logger = logging.getLogger("agent")
load_dotenv(".env.local")

OLLAMA_BASE = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")

LLM_HUSAIN = openai.LLM.with_ollama(
    model=os.getenv("OLLAMA_MODEL_HUSAIN", "qwen2.5:1.5b"),
    base_url=OLLAMA_BASE,
    temperature=0.6,
)

LLM_SARA = openai.LLM.with_ollama(
    model=os.getenv("OLLAMA_MODEL_SARA", "qwen2.5:1.5b"),
    base_url=OLLAMA_BASE,
    temperature=0.4,
)

UI_TOPIC = "maneuver.ui"
RPC_SUBMIT_SCHEDULING = "submit_scheduling"

DONE_WORDS = frozenset(
    {
        "done",
        "confirmed",
        "filled",
        "submitted",
        "ready",
        "yes",
        "okay",
        "ok",
        "yeah",
        "yep",
        "all set",
        "entered",
        "finished",
    }
)

MANEUVER_KB = """
Maneuver is a Dubai-based AI automation agency that builds intelligent workflow systems for SMEs.
Services: Voice AI Agents for 24/7 support, WhatsApp automation, CRM integrations (HubSpot, Salesforce), and custom workflow automation.
Process: Discovery → Scoping → Build (2-4 weeks) → Deploy → Support.
Case studies: Dubai hospitality group cut response time from 4 hours to 2 minutes; an industrial supplier saved roughly 3 hours of manual work per day.
Pricing starts from AED 15,000 per project; retainer support from AED 3,000/month.

Husain is the founder (studied at SRM; worked at JP Morgan Chase and Deloitte). He is hands-on and asks sharp workflow questions before proposing solutions.
"""

# Verbatim lines — spoken via session.say() (TTS only, no LLM paraphrasing).
HUSAIN_GREET = (
    "Hi, I'm Husain, founder of Maneuver — thanks for stopping by. "
    "What is the name of your company and what does it do?"
)
HUSAIN_TURN_1 = (
    "I appreciate you sharing your thoughts, it helps me understand you better. "
    "What's the biggest workflow or automation challenge you're trying to solve right now?"
)
HUSAIN_TURN_2 = (
    "That makes sense. We can discuss this in detail on another call — "
    "would you like to schedule a call?"
)
HUSAIN_HANDOFF = "Perfect — I'll connect you with Sara on our team to book a time."

HUSAIN_END_NO = "I appreciate you taking the time today feel free to contact me again if you think maneuver's services can help your company scale"

SARA_GREET = (
    "Hi, I'm Sara from Maneuver. I'll help you book your follow-up with Husain. "
    "Please enter your email, date, and time in the form on your screen, "
    "click Confirm, then say done when you're finished."
)
SARA_NEED_FORM = (
    "Please fill in your email, date, and time in the form on screen and click Confirm. "
    "I won't ask for your email out loud."
)
SARA_NEED_DONE = (
    "I have your details saved. Just say done when you're ready and I'll confirm."
)


@dataclass
class LeadInfo:
    name: str | None = None
    company: str | None = None
    problem: str | None = None
    timeline: str | None = None
    budget: str | None = None
    follow_up_date: str | None = None
    email: str | None = None
    scheduling_date: str | None = None
    scheduling_time: str | None = None
    scheduling_timezone: str | None = None
    form_submitted: bool = False
    verbal_done: bool = False
    transcript_summary: str | None = None


def _msg_text(message) -> str:
    if hasattr(message, "text_content") and message.text_content:
        return message.text_content.strip()
    return ""


def _normalize_email(raw: str | None) -> str | None:
    if not raw:
        return None
    e = raw.strip().lower()
    return e if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", e) else None


def _apply_form(ud: LeadInfo, payload: dict) -> bool:
    email = _normalize_email(payload.get("email"))
    date = (payload.get("date") or "").strip() or None
    time_v = (payload.get("time") or "").strip() or None
    tz = (payload.get("timezone") or "").strip() or None
    if email:
        ud.email = email
    if date:
        ud.scheduling_date = date
    if time_v:
        ud.scheduling_time = time_v
    if tz:
        ud.scheduling_timezone = tz
    ud.form_submitted = bool(ud.email and ud.scheduling_date and ud.scheduling_time)
    if ud.form_submitted:
        tz_bit = f" ({ud.scheduling_timezone})" if ud.scheduling_timezone else ""
        ud.follow_up_date = f"{ud.scheduling_date} at {ud.scheduling_time}{tz_bit}"
    return ud.form_submitted


def _build_summary(ud: LeadInfo) -> str:
    return (
        f"Client company: {ud.company or 'not captured'}. "
        f"Main topic: {ud.problem or 'not captured'}. "
        f"Follow-up call: {ud.follow_up_date or 'not scheduled'}. "
        f"Contact email: {ud.email or 'not captured'}."
    )


async def _publish_ui(room: rtc.Room, payload: dict) -> None:
    try:
        await room.local_participant.publish_data(
            json.dumps(payload).encode(),
            reliable=True,
            topic=UI_TOPIC,
        )
        if payload.get("type") == "active_agent":
            await room.local_participant.set_attributes(
                {"maneuver.agent": payload["agent"]}
            )
    except Exception as exc:
        logger.warning("UI publish failed: %s", exc)


async def _speak(session: AgentSession, text: str) -> None:
    """Speak exact text through TTS — bypasses the LLM so Qwen cannot improvise."""
    logger.info("SPEAK: %s", text[:100])
    handle = session.say(text, allow_interruptions=False, add_to_chat_ctx=True)
    await handle.wait_for_playout()


def _schedule_user_wants_call(text: str) -> bool:
    """Heuristic for yes/no scheduling based on the user's transcript."""
    t = (text or "").strip().lower()
    if not t:
        return False

    positive = {
        "yes",
        "yeah",
        "yep",
        "sure",
        "okay",
        "ok",
        "great",
        "lets",
        "let's",
        "interested",
        "schedule",
        "call",
        "book",
        "please",
        "definitely",
        "absolutely",
        "would love",
        "love to",
    }
    negative = {
        "no",
        "nope",
        "not",
        "never",
        "later",
        "not now",
        "maybe later",
        "can't",
        "cannot",
        "don't",
        "dont",
        "stop",
        "cancel",
    }

    # If they clearly say "no" (or variants), don't hand off.
    if any(n in t for n in negative):
        return False
    return any(p in t for p in positive)


def _sanitize_middle_fragment(fragment: str) -> str:
    # Avoid adding punctuation that would create extra questions/sentences.
    f = (fragment or "").replace("\n", " ").strip()
    f = f.replace("?", "")
    f = f.replace("!", "").replace(".", "")
    f = f.replace("—", "-")
    f = re.sub(r"\s+", " ", f).strip()
    return f[:60].strip()


async def _llm_middle_for_husain(user_text: str, *, mode: str) -> str:
    """
    Create a short insertion phrase (<=60 chars) to be spoken as part of a fixed script.
    Must never include questions, email addresses, dates, or times.
    """
    user_text = (user_text or "").strip()
    if not user_text:
        return ""

    sys = (
        "You are Maneuver voice Husain. Produce ONLY a short insertion phrase to insert "
        "between fixed scripted sentences. "
        "Rules: max 60 characters, no question marks, no emails, no dates/times, "
        "no markdown, and no extra greetings. "
        "If user asks about Maneuver/services/process/pricing, answer briefly from the KB. "
        "If user is rude/angry or off-topic, respond calmly and redirect to workflows."
    )

    ctx = ChatContext()
    ctx.add_message(role="system", content=sys)
    ctx.add_message(role="system", content=f"Knowledge base:\n{MANEUVER_KB}")
    ctx.add_message(
        role="user", content=f"Mode={mode}. User said: {user_text}\nInsertion phrase:"
    )

    try:
        resp = await LLM_HUSAIN.chat(chat_ctx=ctx).collect()
        frag = (resp.text or "").strip()
    except Exception as exc:
        logger.warning("LLM middle generation failed: %s", exc)
        return ""

    return _sanitize_middle_fragment(frag)


def _send_email_sync(ud: LeadInfo) -> None:
    founder = os.getenv("GMAIL_USER", "").strip()
    password = os.getenv("GMAIL_APP_PASSWORD", "").strip()
    if not founder or not password:
        raise ValueError("GMAIL_USER / GMAIL_APP_PASSWORD missing in .env.local")

    client = ud.email
    if not client or "@" not in client:
        raise ValueError(
            "No client email from scheduling form — cannot send confirmation"
        )

    body = (
        "Maneuver — Talk to the Founder\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "DISCOVERY\n"
        f"  Company:   {ud.company or 'Not captured'}\n"
        f"  Problem:   {ud.problem or 'Not captured'}\n"
        f"  Timeline:  {ud.timeline or 'Not captured'}\n"
        f"  Budget:    {ud.budget or 'Not captured'}\n\n"
        "SCHEDULED FOLLOW-UP (from booking form)\n"
        f"  Date:      {ud.scheduling_date or '—'}\n"
        f"  Time:      {ud.scheduling_time or '—'}\n"
        f"  Timezone:  {ud.scheduling_timezone or '—'}\n"
        f"  Combined:  {ud.follow_up_date or 'Not scheduled'}\n"
        f"  Email:     {client}\n\n"
        f"Notes:\n{ud.transcript_summary or _build_summary(ud)}\n\n"
        "— Maneuver scheduling system"
    )

    msg = MIMEText(body)
    msg["Subject"] = f"Maneuver follow-up confirmed — {ud.company or 'New lead'}"
    msg["From"] = founder
    msg["To"] = client
    msg["Cc"] = founder

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(founder, password)
        smtp.send_message(msg)
    logger.info("Email sent To=%s Cc=%s", client, founder)


async def send_summary_email(ud: LeadInfo) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, ud)


# ── Husain ─────────────────────────────────────────────────────────────────────
class FounderAgent(Agent):
    def __init__(self, job_ctx: JobContext, chat_ctx: ChatContext | None = None):
        self._job_ctx = job_ctx
        self._turn = 0
        self._handoff = False
        kwargs = {
            "llm": LLM_HUSAIN,
            "stt": deepgram.STT(),
            "tts": deepgram.TTS(model="aura-2-neptune-en"),
            # LLM stays wired for the pipeline but Husain never calls generate_reply — only say().
            "instructions": "You are Husain. All spoken lines are pre-scripted by the system.",
        }
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)

    async def on_enter(self) -> None:
        await _publish_ui(
            self._job_ctx.room, {"type": "active_agent", "agent": "husain"}
        )
        await _speak(self.session, HUSAIN_GREET)

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        if self._handoff:
            raise StopResponse()

        self._turn += 1
        text = _msg_text(new_message)
        ud = self.session.userdata
        logger.info("Husain turn %s", self._turn)

        if self._turn == 1:
            if text:
                ud.company = text[:160]
                # Best-effort: if they already include the core pain, capture it.
                if any(
                    k in text.lower()
                    for k in (
                        "pain",
                        "challenge",
                        "workflow",
                        "automation",
                        "process",
                        "struggle",
                        "bottleneck",
                        "manual",
                    )
                ):
                    ud.problem = text[:200]
                await _publish_ui(
                    self._job_ctx.room,
                    {"type": "lead_field", "field": "company", "value": ud.company},
                )
            middle = await _llm_middle_for_husain(text, mode="discovery")
            spoken = HUSAIN_TURN_1
            if middle:
                spoken = spoken.replace(
                    "I appreciate you sharing your thoughts, it helps me understand you better. ",
                    f"I appreciate you sharing your thoughts, it helps me understand you better. {middle} ",
                )
            await _speak(self.session, spoken)
            raise StopResponse()

        if self._turn == 2:
            if text:
                ud.problem = text[:200]
                await _publish_ui(
                    self._job_ctx.room,
                    {"type": "lead_field", "field": "problem", "value": ud.problem},
                )
            middle = await _llm_middle_for_husain(text, mode="schedule")
            spoken = HUSAIN_TURN_2
            if middle:
                spoken = spoken.replace(
                    "That makes sense. ", f"That makes sense. {middle} "
                )
            await _speak(self.session, spoken)
            raise StopResponse()

        if self._turn == 3:
            if _schedule_user_wants_call(text):
                await self._handoff_to_sara()
            else:
                # Negative scheduling response: end the call without handing off.
                await _speak(self.session, HUSAIN_END_NO)
                ud.transcript_summary = _build_summary(ud)

                out_path = Path(__file__).parent.parent / "leads.json"
                leads = []
                if out_path.exists():
                    try:
                        leads = json.loads(out_path.read_text(encoding="utf-8"))
                    except json.JSONDecodeError:
                        leads = []
                leads.append(asdict(ud))
                out_path.write_text(json.dumps(leads, indent=2), encoding="utf-8")

                await _publish_ui(self._job_ctx.room, {"type": "session_ended"})
                await asyncio.sleep(1.5)
                with contextlib.suppress(Exception):
                    await self._job_ctx.room.disconnect()
            raise StopResponse()

        raise StopResponse()

    async def _handoff_to_sara(self) -> None:
        if self._handoff:
            return
        self._handoff = True
        await _speak(self.session, HUSAIN_HANDOFF)
        await asyncio.sleep(0.4)
        self.session.update_agent(
            SchedulerAgent(
                job_ctx=self._job_ctx,
                userdata=self.session.userdata,
                chat_ctx=self.chat_ctx.copy(exclude_instructions=True),
            )
        )

    @function_tool()
    async def update_lead_field(
        self, context: RunContext[LeadInfo], field: str, value: str
    ):
        """Capture name, company, problem, timeline, budget when mentioned."""
        if field in {"name", "company", "problem", "timeline", "budget"}:
            setattr(context.userdata, field, value)
            await _publish_ui(
                self._job_ctx.room,
                {"type": "lead_field", "field": field, "value": value},
            )
        return None


# ── Sara (hardcoded turns — form is source of truth) ───────────────────────────
class SchedulerAgent(Agent):
    def __init__(
        self,
        job_ctx: JobContext,
        userdata: LeadInfo,
        chat_ctx: ChatContext | None = None,
    ):
        self._job_ctx = job_ctx
        self._userdata = userdata
        self._done = False
        self._reminders = 0
        kwargs = {
            "llm": LLM_SARA,
            "stt": deepgram.STT(),
            "tts": deepgram.TTS(model="aura-2-phoebe-en"),
            "instructions": "You are Sara. All spoken lines are pre-scripted by the system.",
        }
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)

    async def on_enter(self) -> None:
        await _publish_ui(self._job_ctx.room, {"type": "active_agent", "agent": "sara"})
        await _speak(self.session, SARA_GREET)

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        if self._done:
            raise StopResponse()

        text = _msg_text(new_message).lower()
        if any(w in text for w in DONE_WORDS):
            self._userdata.verbal_done = True

        ud = self._userdata
        logger.info(
            "Sara — verbal_done=%s form=%s email=%s",
            ud.verbal_done,
            ud.form_submitted,
            ud.email,
        )

        if ud.form_submitted and ud.verbal_done:
            await self._finish()
            raise StopResponse()

        if not ud.form_submitted:
            self._reminders += 1
            await _speak(self.session, SARA_NEED_FORM)
            raise StopResponse()

        await _speak(self.session, SARA_NEED_DONE)
        raise StopResponse()

    async def _finish(self) -> None:
        if self._done:
            return
        self._done = True
        ud = self._userdata
        slot = ud.follow_up_date or "your selected time"
        email = ud.email or ""

        await _speak(
            self.session,
            f"Thanks — your follow-up is booked for {slot}. "
            f"We'll send confirmation to {email}.",
        )
        await asyncio.sleep(0.3)
        self.session.update_agent(SummaryAgent(job_ctx=self._job_ctx, userdata=ud))


# ── System ─────────────────────────────────────────────────────────────────────
class SummaryAgent(Agent):
    def __init__(self, job_ctx: JobContext, userdata: LeadInfo):
        self._job_ctx = job_ctx
        self._userdata = userdata
        super().__init__(
            llm=LLM_HUSAIN,
            stt=deepgram.STT(),
            tts=deepgram.TTS(model="aura-2-saturn-en"),
            instructions="Scripted closing agent.",
        )

    async def on_enter(self) -> None:
        await _publish_ui(
            self._job_ctx.room, {"type": "active_agent", "agent": "system"}
        )
        ud = self._userdata
        ud.transcript_summary = _build_summary(ud)

        slot = ud.follow_up_date or "your scheduled time"
        await _speak(
            self.session,
            f"You're all set for {slot}. "
            "Husain is looking forward to speaking with you. Thank you for your time — goodbye.",
        )

        out = Path(__file__).parent.parent / "leads.json"
        leads = []
        if out.exists():
            with contextlib.suppress(json.JSONDecodeError):
                leads = json.loads(out.read_text())
        leads.append(asdict(ud))
        out.write_text(json.dumps(leads, indent=2))

        if ud.form_submitted and ud.email:
            try:
                await send_summary_email(ud)
                logger.info("Confirmation email sent to %s", ud.email)
            except Exception as exc:
                logger.error("Email failed: %s", exc)
        else:
            logger.error("Skipped email — form not submitted or missing email")

        await _publish_ui(self._job_ctx.room, {"type": "session_ended"})
        await asyncio.sleep(4)
        try:
            await self._job_ctx.room.disconnect()
        except Exception as exc:
            logger.error("Disconnect: %s", exc)


server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


def _wire_form_handlers(ctx: JobContext, session: AgentSession[LeadInfo]) -> None:
    pending_tasks: list[asyncio.Task[None]] = []

    async def ingest(payload: dict) -> None:
        ok = _apply_form(session.userdata, payload)
        logger.info(
            "Form ingested ok=%s email=%s slot=%s",
            ok,
            session.userdata.email,
            session.userdata.follow_up_date,
        )
        await _publish_ui(
            ctx.room,
            {
                "type": "scheduling_submitted",
                "email": session.userdata.email,
                "date": session.userdata.scheduling_date,
                "time": session.userdata.scheduling_time,
                "timezone": session.userdata.scheduling_timezone,
            },
        )
        agent = session.current_agent
        if (
            ok
            and session.userdata.verbal_done
            and isinstance(agent, SchedulerAgent)
            and not agent._done
        ):
            t = asyncio.create_task(agent._finish())
            pending_tasks.append(t)

    @ctx.room.local_participant.register_rpc_method(RPC_SUBMIT_SCHEDULING)
    async def submit_scheduling(data: rtc.RpcInvocationData) -> str:
        try:
            payload = json.loads(data.payload or "{}")
        except json.JSONDecodeError:
            return json.dumps({"ok": False})
        await ingest(payload)
        return json.dumps({"ok": True, "email": session.userdata.email})

    @ctx.room.on("data_received")
    def on_data(pkt: rtc.DataPacket):
        if getattr(pkt, "topic", None) and pkt.topic != UI_TOPIC:
            return
        try:
            msg = json.loads(pkt.data.decode())
        except Exception:
            return
        if msg.get("type") in ("scheduling_form", "scheduling_submit"):
            t = asyncio.create_task(ingest(msg))
            pending_tasks.append(t)


@server.rtc_session(agent_name="maneuver")
async def my_agent(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    session = AgentSession[LeadInfo](
        userdata=LeadInfo(),
        vad=ctx.proc.userdata["vad"],
        turn_detection=MultilingualModel(),
        preemptive_generation=False,
    )

    await session.start(
        agent=FounderAgent(job_ctx=ctx),
        room=ctx.room,
        room_options=room_io.RoomOptions(audio_input=room_io.AudioInputOptions()),
    )
    await ctx.connect()
    _wire_form_handlers(ctx, session)
    await _publish_ui(ctx.room, {"type": "active_agent", "agent": "husain"})


if __name__ == "__main__":
    cli.run_app(server)
