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
)
from livekit.plugins import deepgram, groq, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from livekit.plugins import mistralai


logger = logging.getLogger("agent")
load_dotenv(".env.local")
SHARED_LLM = mistralai.LLM(model="magistral-medium-2509")
# ─── State shared across all agents ───────────────────────────────────────────
@dataclass
class LeadInfo:
    name: str | None = None
    company: str | None = None
    problem: str | None = None
    timeline: str | None = None
    budget: str | None = None
    follow_up_date: str | None = None
    email: str | None = None


# ─── Knowledge Base ────────────────────────────────────────────────────────────
MANEUVER_KB = """
Maneuver is a Dubai-based AI automation agency that builds intelligent workflow systems for SMEs and enterprises.

SERVICES:
- Voice AI Agents: 24/7 voice assistants for customer support, lead qualification, and operations
- WhatsApp Automation: Auto-reply, lead capture, and CRM sync via WhatsApp Business API
- CRM Integration: Connecting tools like HubSpot, Salesforce, Zoho with automated data entry
- Custom Workflow Automation: End-to-end process automation connecting any combination of tools
- Operations AI: Internal tools that automate repetitive ops tasks like scheduling, reporting, data entry

PROCESS:
1. Discovery Call: Understand your current workflows, pain points, and goals
2. Scoping: Define automation architecture and deliverables
3. Build: 2-4 week sprint to build and test the solution
4. Deploy: Go live with full handover and documentation
5. Support: Ongoing maintenance and iteration

CASE STUDIES:
- Dubai Hospitality Group: Built a 24/7 guest operations platform handling Airbnb, Booking.com, and WhatsApp communications. Reduced response time from 4 hours to under 2 minutes.
- Industrial Supplier (UAE): Automated WhatsApp order intake, data entry into ERP, and daily reporting. Saved 3 hours of manual work per day.

PRICING:
Project-based. 

FOUNDER - HUSAIN:
Husain is the founder of Maneuver. He's hands-on with every client, obsessed with clean systems,
and direct in communication. He asks sharp questions to understand your workflow before suggesting anything.
"""


# ─── Email helper ──────────────────────────────────────────────────────────────
async def send_summary_email(userdata: LeadInfo):
    """
    Sends lead summary to the founder (self) after call ends.

    TO ALSO EMAIL THE CLIENT:
    Uncomment the line below and change msg['To'] to send to both.
    client_email = userdata.email  # captured during scheduling
    """
    lead = asdict(userdata)
    body = f"""
New lead captured via Maneuver Talk-to-Founder:

Name:        {lead.get('name') or 'Not captured'}
Company:     {lead.get('company') or 'Not captured'}
Problem:     {lead.get('problem') or 'Not captured'}
Timeline:    {lead.get('timeline') or 'Not captured'}
Budget:      {lead.get('budget') or 'Not captured'}
Follow-up:   {lead.get('follow_up_date') or 'Not scheduled'}
Email:       {lead.get('email') or 'Not captured'}
    """.strip()

    msg = MIMEText(body)
    msg['Subject'] = f"New Lead: {lead.get('name') or 'Unknown'} — {lead.get('company') or 'Unknown'}"
    msg['From'] = os.getenv('GMAIL_USER')
    msg['To'] = os.getenv('GMAIL_USER')  # sends to founder (yourself)
    # To also CC the client, change the line above to:
    # msg['To'] = f"{os.getenv('GMAIL_USER')}, {lead.get('email') or ''}"

    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
        smtp.login(os.getenv('GMAIL_USER'), os.getenv('GMAIL_APP_PASSWORD'))
        smtp.send_message(msg)


# ─── Agent 1: Husain — Founder (Discovery + Q&A) ──────────────────────────────
class FounderAgent(Agent):
    AGENT_NAME = "Husain"

    def __init__(self, chat_ctx=None):
        kwargs = dict(
            llm=SHARED_LLM,
            stt=deepgram.STT(),
            tts=deepgram.TTS(model="aura-2-neptune-en"),
            instructions=textwrap.dedent(f"""
                Your name is Husain. You are the founder of Maneuver, an AI automation agency based in Dubai.
                You are on a discovery call with a potential client visiting your website.

                YOUR PERSONALITY:
                - Direct, warm, and curious. You ask one sharp question at a time.
                - You don't pitch until you understand the problem. You listen and diagnose first.
                - You speak like a real founder  natural, confident, human. Not a chatbot.
                - Ask the Client to calmdown if they show signs of anger and rudeness and redirect the conversations to the solutions

                YOUR TWO MODES:
                1. DISCOVERY (default): Ask about their business, current workflows, biggest pain points,
                   timeline to solve it, and rough budget. Flow naturally — branch based on what they say.
                   Never ask all questions at once. One at a time.
                   Key info to capture silently via update_lead_field: name, company, problem, timeline, budget.

                2. Q&A: If they ask about Maneuver's services, pricing, team, or process, answer from this knowledge base:
                {MANEUVER_KB}

                SWITCHING MODES: Move fluidly. If they ask a question mid-discovery, answer it warmly, then
                return to discovery naturally.

                GUARDRAILS:
                - Stay focused on questions related to business automation and Maneuver and the founder's background.
                - If asked anything off-topic, other than Maneuver's Services, Founder's Background and possible solutions fo client say: "That's a bit outside my lane — I'm best placed to help
                  you think through how we can automate your workflows."

                HANDOFF TO SCHEDULER:
                - When the user clearly expresses interest in working with Maneuver AND you have captured
                  their name, company, and main problem — call transfer_to_sara.
                - Say something like: "Great, I'd love to set up a proper follow-up call.
                  Let me pass you to Sara who handles our scheduling."
                - Never hand off without the three key fields confirmed.

                VOICE RULES:
                - Plain text only. No markdown, lists, or symbols.
                - Keep replies to 1-3 sentences max. Ask one question at a time.
                - Spell out numbers, abbreviations, and URLs.
            """),
        )
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions=(
                "Greet the visitor warmly. Introduce yourself as Husain, founder of Maneuver. "
                "Ask them what they're company is working on right now and keep it curious but calm"
            )
        )

    @function_tool()
    async def update_lead_field(self, context: RunContext[LeadInfo], field: str, value: str):
        """
        Silently capture lead information as the user reveals it during conversation.
        Call this whenever the user shares their name, company, problem, timeline, budget, or email.
        field: one of 'name', 'company', 'problem', 'timeline', 'budget', 'email'
        value: the exact value to store
        """
        if hasattr(context.userdata, field):
            setattr(context.userdata, field, value)
            logger.info(f"Lead field updated — {field}: {value}")
        return None

    @function_tool()
    async def transfer_to_sara(self, context: RunContext[LeadInfo]):
        """
        Transfer to Sara (the scheduling assistant) when the user is clearly interested
        in working with Maneuver and you have their name, company, and main problem.
        Only call this when all three are confirmed.
        """
        await self.session.generate_reply(
            instructions=(
                "Tell the user you'd love to set up a proper follow-up call with them. "
                "Say you're handing them to Sara, your scheduling assistant, who will sort out a time."
            )
        )
        return SchedulerAgent(
            userdata=context.userdata,
            chat_ctx=self.chat_ctx.copy(exclude_instructions=True),
        )


# ─── Agent 2: Sara — Scheduler ────────────────────────────────────────────────
class SchedulerAgent(Agent):
    AGENT_NAME = "Sara"

    def __init__(self, userdata: LeadInfo, chat_ctx=None):
        kwargs = dict(
            llm=SHARED_LLM,
            stt=deepgram.STT(),
            tts=deepgram.TTS(model="aura-2-phoebe-en"),
            instructions=textwrap.dedent("""
                Your name is Sara. You are the scheduling assistant at Maneuver.
                Husain has just handed this call to you to book a follow-up meeting.

                YOUR ONLY JOB:
                1. Ask for their preferred date and time for a follow-up call with Husain.
                2. Ask for their email address to send the calendar invite.
                3. Once you have both, call confirm_booking.
                
                GUARDRAILS:
                - If user 
                PERSONALITY:
                - Warm, efficient, friendly. You make booking feel easy.
                - Don't get drawn into questions about Maneuver's services — say:
                  "Husain will be best placed to answer that on your follow-up call!"

                VOICE RULES:
                - Plain text only. 1-2 sentences at a time.
                - Spell out numbers and email addresses letter by letter if needed.
            """),
        )
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)
        self._userdata = userdata

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions=(
                "Introduce yourself as Sara from Maneuver. "
                "Ask the user what date and time works best for a follow-up call with Husain."
            )
        )

    @function_tool()
    async def confirm_booking(self, context: RunContext[LeadInfo], date: str, time: str, email: str):
        """
        Call this once you have the follow-up date, time, and the user's email address confirmed.
        date: the confirmed date (e.g. 'June 3rd')
        time: the confirmed time (e.g. '3 PM Dubai time')
        email: the user's email address
        """
        context.userdata.follow_up_date = f"{date} at {time}"
        context.userdata.email = email
        await self.session.generate_reply(
            instructions=(
                f"Confirm the booking warmly. Tell them Husain is booked for {date} at {time}. "
                f"Say a calendar invite will be sent to {email}. "
                "Thank them for their time and say you're looking forward to speaking soon."
            )
        )
        return SummaryAgent(
            userdata=context.userdata,
            chat_ctx=self.chat_ctx.copy(exclude_instructions=True),
        )


# ─── Agent 3: System — Summary + Lead Save + Email ────────────────────────────
class SummaryAgent(Agent):
    AGENT_NAME = "System"

    def __init__(self, userdata: LeadInfo, chat_ctx=None):
        kwargs = dict(
            llm=SHARED_LLM,
            stt=deepgram.STT(),
            tts=deepgram.TTS(model="aura-2-saturn-en"),
            instructions="You wrap up the call gracefully. The booking is confirmed. Be brief and warm.",
        )
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)
        self._userdata = userdata

    async def on_enter(self) -> None:
        # 1. Save lead to leads.json
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
        logger.info(f"Lead saved to leads.json: {asdict(self._userdata)}")

        # 2. Send summary email to founder
        try:
            await send_summary_email(self._userdata)
            logger.info("Summary email sent successfully")
        except Exception as e:
            logger.error(f"Email failed (non-critical): {e}")

        # 3. Close the call warmly
        await self.session.generate_reply(
            instructions=(
                "Thank the user genuinely for their time today. "
                "Tell them Husain is looking forward to the call. "
                "Say a warm goodbye and end naturally."
            )
        )


# ─── Server setup ──────────────────────────────────────────────────────────────
server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="maneuver")
async def my_agent(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    session = AgentSession[LeadInfo](
        userdata=LeadInfo(),
        vad=ctx.proc.userdata["vad"],
        turn_detection=MultilingualModel(),
        preemptive_generation=True,
    )

    await session.start(
        agent=FounderAgent(),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(),
        ),
    )

    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)