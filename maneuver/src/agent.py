import asyncio
import logging
import textwrap
import json
import os
import smtplib
from email.mime.text import MIMEText
from dataclasses import dataclass, asdict
from dotenv import load_dotenv

from livekit.agents import (
    Agent,
    AgentSession,
    AgentServer,
    JobContext,
    JobProcess,
    RunContext,
    function_tool,
    cli,
    room_io,
    ChatContext,
)

from livekit.plugins import deepgram, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from livekit.plugins import openai

logger = logging.getLogger("agent")
load_dotenv(".env.local")

SHARED_LLM = openai.LLM.with_ollama(
    model="qwen2.5:3b",
    base_url="http://localhost:11434/v1",
    temperature=0.3,
)

MANEUVER_KB = """
Maneuver is a Dubai-based AI automation agency that builds intelligent workflow systems for SMEs and enterprises.
We specialise in Voice AI Agents for 24/7 customer support, WhatsApp automation, CRM integrations with HubSpot and Salesforce, and end-to-end custom workflow automation.
Our process: Discovery, Scoping, Build (2-4 weeks), Deploy, Support.
Case studies: Dubai hospitality group cut response time from 4 hours to 2 minutes. UAE industrial supplier saved 3 hours of daily manual work.
Pricing starts from AED 15,000 per project. Retainer support from AED 3,000/month.

ABOUT HUSAIN:
Husain studied at SRM Institute of Science and Technology and worked at JP Morgan Chase and Deloitte before founding Maneuver.
He is hands-on with every client and brings enterprise-grade rigour to SME automation.
"""


@dataclass
class LeadInfo:
    name: str | None = None
    company: str | None = None
    problem: str | None = None
    timeline: str | None = None
    budget: str | None = None
    follow_up_date: str | None = None
    email: str | None = None
    transcript_summary: str | None = None


def _send_email_sync(userdata: LeadInfo):
    lead = asdict(userdata)
    gmail_user = os.getenv("GMAIL_USER", "").strip()
    gmail_pass = os.getenv("GMAIL_APP_PASSWORD", "").strip()
    if not gmail_user or not gmail_pass:
        raise ValueError("GMAIL_USER or GMAIL_APP_PASSWORD missing")
    body = (
        "New lead — Maneuver Talk-to-Founder\n\n"
        f"Name:         {lead.get('name') or 'Not captured'}\n"
        f"Company:      {lead.get('company') or 'Not captured'}\n"
        f"Problem:      {lead.get('problem') or 'Not captured'}\n"
        f"Timeline:     {lead.get('timeline') or 'Not captured'}\n"
        f"Budget:       {lead.get('budget') or 'Not captured'}\n"
        f"Follow-up:    {lead.get('follow_up_date') or 'Not scheduled'}\n"
        f"Client Email: {lead.get('email') or 'Not captured'}\n\n"
        f"Summary:\n{lead.get('transcript_summary') or 'Unavailable'}\n"
    )
    msg = MIMEText(body)
    msg["Subject"] = f"[Lead] {lead.get('name') or 'Unknown'} — {lead.get('company') or 'Unknown'}"
    msg["From"] = gmail_user
    client_email = lead.get("email")
    msg["To"] = f"{gmail_user}, {client_email}" if client_email and "@" in client_email else gmail_user
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(gmail_user, gmail_pass)
        smtp.send_message(msg)
    logger.info(f"Email sent to: {msg['To']}")


async def send_summary_email(userdata: LeadInfo):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email_sync, userdata)


# ── Agent 1: Husain ────────────────────────────────────────────────────────────
class FounderAgent(Agent):
    AGENT_DISPLAY_NAME = "Husain"

    def __init__(self, job_ctx: JobContext, chat_ctx=None):
        self._job_ctx = job_ctx
        self._turn_count = 0
        self._handoff_triggered = False

        kwargs = dict(
            llm=openai.LLM.with_ollama(
    model="qwen2.5:1.5b",
    base_url="http://localhost:11434/v1",
    temperature=0.3,
),
            stt=deepgram.STT(),
            tts=deepgram.TTS(model="aura-2-neptune-en"),
            instructions=textwrap.dedent(f"""
                Your name is Husain. You are the founder of Maneuver, an AI automation agency in Dubai.
                A potential client just landed on your website and you are speaking with them.

                KNOWLEDGE BASE — use this to answer any questions about Maneuver or yourself:
                {MANEUVER_KB}

                STRICT CONVERSATION RULES:
                - You ask EXACTLY 2 questions total. No more ever.
                - Question 1: What does their company do?
                - Question 2: What is their biggest workflow challenge?
                - After 2 questions and their answers, say:
                  "Sounds like there is something real here. I would love to go deeper on a proper call — would that work for you?"
                - When they say yes or agree, say:
                  "Perfect — I will hand you to Sara now, she handles our scheduling."
                - Do not say anything else after that. The system will switch to Sara automatically.

                Q&A MODE:
                If they ask about Maneuver or your background at any point, answer from the knowledge base,
                then return to the discovery flow naturally.

                GUARDRAILS:
                - Only discuss: their business, Maneuver services, your background, workflow automation.
                - Off-topic: "That is outside what I can help with here."
                - Rude or angry user: "I understand — let us focus on how I can help you."
                - If asked if you are AI: "I am an AI assistant representing Husain."

                VOICE RULES:
                - Plain spoken English only. No markdown, no lists, no symbols, no asterisks.
                - Max 2 sentences per reply. One question per turn. Never ask two things at once.
                - Always respond. Never go silent.
            """),
        )
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)

    async def on_enter(self):
        await asyncio.sleep(0.5)
        await self.session.generate_reply(
            instructions=(
                "Greet NOW before the user says anything. Say exactly: "
                "Hi, I am Husain, founder of Maneuver — thanks for dropping by. "
                "What does your company do?"
            )
        )

    async def on_user_turn_completed(self, turn_ctx, new_message):
        # Guard: if handoff already triggered, skip
        if self._handoff_triggered:
            return

        self._turn_count += 1
        logger.info(f"Husain turn count: {self._turn_count}")

        # After turn 2, check if user shows interest and force handoff
        if self._turn_count >= 2:
            text = ""
            if hasattr(new_message, "text_content") and new_message.text_content:
                text = new_message.text_content.lower()
            elif hasattr(new_message, "content") and new_message.content:
                text = str(new_message.content).lower()

            interest_words = [
                "yes", "sure", "sounds good", "okay", "ok", "great",
                "lets", "let's", "interested", "schedule", "call",
                "yeah", "yep", "please", "definitely", "absolutely", "works"
            ]

            if any(w in text for w in interest_words):
                self._handoff_triggered = True
                logger.info("Interest detected — forcing handoff to Sara")

                # Generate farewell reply first
                await self.session.generate_reply(
                    instructions=(
                        "Say exactly one sentence: "
                        "Perfect — I will hand you to Sara now, she handles our scheduling."
                    )
                )

                # Switch agent immediately — no sleep, no race condition
                self.session.update_agent(
                    SchedulerAgent(
                        job_ctx=self._job_ctx,
                        userdata=self.session.userdata,
                        chat_ctx=self.chat_ctx.copy(exclude_instructions=True),
                    )
                )
                return

        # Normal turn processing
        await super().on_user_turn_completed(turn_ctx, new_message)

    @function_tool()
    async def update_lead_field(self, context: RunContext[LeadInfo], field: str, value: str):
        """
        Silently capture lead info whenever user shares name, company, problem, timeline, budget, email.
        field: one of those keys. value: what they said. Never mention this to the user.
        """
        if hasattr(context.userdata, field):
            setattr(context.userdata, field, value)
            logger.info(f"Lead — {field}: {value}")
        return None


# ── Agent 2: Sara ──────────────────────────────────────────────────────────────
class SchedulerAgent(Agent):
    AGENT_DISPLAY_NAME = "Sara"

    def __init__(self, job_ctx: JobContext, userdata: LeadInfo, chat_ctx=None):
        self._job_ctx = job_ctx
        self._userdata = userdata
        self._booking_triggered = False

        kwargs = dict(
            llm=SHARED_LLM,
            stt=deepgram.STT(),
            tts=deepgram.TTS(model="aura-2-phoebe-en"),
            instructions=textwrap.dedent("""
                Your name is Sara. You are the scheduling assistant at Maneuver.
                Husain has just handed this call to you to book a follow-up meeting.

                YOUR ONLY PURPOSE: Book the follow-up call. Nothing else.

                FLOW:
                Step 1 — Greet immediately before user speaks. Introduce yourself as Sara.
                Step 2 — Tell them to fill in their preferred date, time, and email in the form on screen.
                Step 3 — Ask them to say "done" or "confirmed" when they have filled it in.
                Step 4 — When they say done or confirmed, call confirm_booking with the details they mentioned.

                GUARDRAILS:
                - Only discuss scheduling. Refuse everything else politely.
                - If asked about Maneuver: "Husain will cover that on your call!"
                - If rude: "Let us get this sorted quickly for you." Then continue scheduling.
                - Never ask for email verbally — the screen form handles it.
                - Never go silent. Always respond immediately.

                VOICE RULES:
                - Plain English only. One sentence at a time.
                - Never read out email addresses.
            """),
        )
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)

    async def on_enter(self):
        await asyncio.sleep(0.5)
        await self.session.generate_reply(
            instructions=(
                "Greet IMMEDIATELY. Do not wait for user to speak. Say exactly: "
                "Hi, I am Sara from Maneuver! "
                "Please fill in your preferred date, time, and email in the form on screen, "
                "then just say done when you are ready and I will confirm your booking."
            )
        )

    async def on_user_turn_completed(self, turn_ctx, new_message):
        if self._booking_triggered:
            return

        text = ""
        if hasattr(new_message, "text_content") and new_message.text_content:
            text = new_message.text_content.lower()
        elif hasattr(new_message, "content") and new_message.content:
            text = str(new_message.content).lower()

        confirm_words = ["done", "confirmed", "filled", "submitted", "ready", "yes", "okay", "ok", "entered"]

        if any(w in text for w in confirm_words):
            self._booking_triggered = True
            logger.info("Booking confirmation detected — switching to SummaryAgent")

            await self.session.generate_reply(
                instructions=(
                    "Say exactly one sentence: "
                    "Great — your booking is confirmed, let me wrap this up for you."
                )
            )

            self.session.update_agent(
                SummaryAgent(
                    job_ctx=self._job_ctx,
                    userdata=self._userdata,
                    chat_ctx=self.chat_ctx.copy(exclude_instructions=True),
                )
            )
            return

        await super().on_user_turn_completed(turn_ctx, new_message)

    @function_tool()
    async def confirm_booking(self, context: RunContext[LeadInfo], date: str, time: str, email: str):
        """
        Call when user verbally confirms they filled the form.
        date: e.g. 'June 3rd', time: e.g. '3 PM GST', email: from screen form.
        """
        if self._booking_triggered:
            return None
        self._booking_triggered = True
        context.userdata.follow_up_date = f"{date} at {time}"
        context.userdata.email = email
        logger.info(f"Booking tool — {date} at {time}, {email}")
        self.session.update_agent(
            SummaryAgent(
                job_ctx=self._job_ctx,
                userdata=context.userdata,
                chat_ctx=self.chat_ctx.copy(exclude_instructions=True),
            )
        )
        return None


# ── Agent 3: System ────────────────────────────────────────────────────────────
class SummaryAgent(Agent):
    AGENT_DISPLAY_NAME = "System"

    def __init__(self, job_ctx: JobContext, userdata: LeadInfo, chat_ctx=None):
        self._job_ctx = job_ctx
        self._userdata = userdata
        kwargs = dict(
            llm=SHARED_LLM,
            stt=deepgram.STT(),
            tts=deepgram.TTS(model="aura-2-cordelia-en"),
            instructions="Close this call. State the confirmed date. Thank them warmly. Two sentences max.",
        )
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)

    async def on_enter(self):
        # 1. Generate summary
        try:
            summary_ctx = ChatContext()
            summary_ctx.add_message(
                role="system",
                content=(
                    "Summarise this discovery call in 3 sentences: "
                    "who the client is, their main problem, and the follow-up date scheduled."
                )
            )
            for item in self.chat_ctx.items:
                if hasattr(item, "role") and hasattr(item, "text_content"):
                    if item.role in ("user", "assistant") and item.text_content:
                        summary_ctx.add_message(
                            role="user",
                            content=f"{item.role}: {item.text_content}"
                        )
            response = await SHARED_LLM.chat(chat_ctx=summary_ctx).collect()
            self._userdata.transcript_summary = response.text
            logger.info(f"Summary: {self._userdata.transcript_summary}")
        except Exception as e:
            logger.error(f"Summary failed: {e}")
            self._userdata.transcript_summary = "Summary unavailable."

        # 2. Save JSON
        output_path = "leads.json"
        leads = []
        if os.path.exists(output_path):
            with open(output_path, "r") as f:
                try:
                    leads = json.load(f)
                except json.JSONDecodeError:
                    leads = []
        leads.append(asdict(self._userdata))
        with open(output_path, "w") as f:
            json.dump(leads, f, indent=2)
        logger.info("Lead saved to leads.json")

        # 3. Send email
        try:
            await send_summary_email(self._userdata)
        except Exception as e:
            logger.error(f"Email failed: {e}")

        # 4. Close call
        follow_up = self._userdata.follow_up_date or "the scheduled time"
        await asyncio.sleep(0.3)
        await self.session.generate_reply(
            instructions=(
                f"Say warmly and finally: "
                f"You are all set — Husain is looking forward to speaking with you on {follow_up}. "
                "Thank them genuinely and say goodbye. Two sentences max. Sound warm and final."
            )
        )

        # 5. End session after TTS finishes
        await asyncio.sleep(5)
        try:
            await self._job_ctx.room.disconnect()
            logger.info("Session ended.")
        except Exception as e:
            logger.error(f"Session end error: {e}")


# ── Server ─────────────────────────────────────────────────────────────────────
server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="maneuver")
async def my_agent(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}
    logger.info(f"Session started — room: {ctx.room.name}")

    session = AgentSession[LeadInfo](
        userdata=LeadInfo(),
        vad=ctx.proc.userdata["vad"],
        turn_detection=MultilingualModel(),
        preemptive_generation=False,
    )

    await session.start(
        agent=FounderAgent(job_ctx=ctx),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(),
        ),
    )

    await ctx.connect()
    logger.info("Agent connected")


if __name__ == "__main__":
    cli.run_app(server)