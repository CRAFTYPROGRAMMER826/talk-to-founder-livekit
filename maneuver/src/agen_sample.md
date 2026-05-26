import logging
import textwrap
import json
import os
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

logger = logging.getLogger("agent")
load_dotenv(".env.local")

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

# ─── Knowledge Base (inlined) ─────────────────────────────────────────────────
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
Project-based. Typical engagements start from AED 15,000. Retainer support from AED 3,000/month.

TEAM:
Small, founder-led team based in Dubai. Husain (founder) leads all client relationships and solution design.

FOUNDER - HUSAIN:
Husain is the founder of Maneuver. He's hands-on with every client, obsessed with clean systems, and direct in communication. He asks sharp questions to understand your workflow before suggesting anything.
"""

# ─── Agent 1: Founder (Discovery + Q&A) ──────────────────────────────────────
class FounderAgent(Agent):
    def __init__(self, chat_ctx=None):
        kwargs = dict(
            llm=groq.LLM(model="llama-3.1-8b-instant"),
            stt=deepgram.STT(),
            tts=deepgram.TTS("aura-2-neptune-en"),
            instructions=textwrap.dedent(f"""
                You are Husain, founder of Maneuver — an AI automation agency based in Dubai.
                You are on a discovery call with a potential client.
                
                YOUR PERSONALITY:
                - Direct, warm, curious. You ask one sharp question at a time.
                - You don't pitch — you listen and diagnose first.
                - You speak like a founder, not a chatbot. Natural, confident, human.
                
                YOUR TWO MODES:
                1. DISCOVERY (default): Ask about their business, workflows, pain points, timeline, budget.
                   Flow naturally — don't make it feel like a form. Branch based on what they say.
                   Key info to capture: name, company, main problem, timeline, rough budget.
                
                2. Q&A: If they ask about Maneuver, answer from this knowledge base:
                {MANEUVER_KB}
                
                SWITCHING: Move fluidly between modes. If they ask a question mid-discovery, answer it, then return to discovery.
                
                GUARDRAILS:
                - Stay focused on business automation and Maneuver's services.
                - If asked something unrelated (politics, personal topics), say: "That's a bit outside my lane — I'm best placed to talk about how we can help your business."
                
                HANDOFF RULES:
                - If the user expresses clear interest in working together AND you have their name/company/problem, call transfer_to_scheduler.
                - Never hand off without confirming you have the key lead info first.
                
                VOICE RULES:
                - Plain text only. No markdown, no lists, no bullet points.
                - Keep replies to 1-3 sentences. Ask one question at a time.
                - Spell out numbers and abbreviations.
            """),
        )
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions="Greet the visitor warmly. Introduce yourself as Husain, founder of Maneuver. Ask them what they're working on right now."
        )

    @function_tool()
    async def update_lead_field(self, context: RunContext[LeadInfo], field: str, value: str):
        """
        Call this silently whenever the user reveals key information.
        field: one of 'name', 'company', 'problem', 'timeline', 'budget', 'email'
        value: the captured value
        """
        if hasattr(context.userdata, field):
            setattr(context.userdata, field, value)
            logger.info(f"Lead updated: {field} = {value}")
        return None

    @function_tool()
    async def transfer_to_scheduler(self, context: RunContext[LeadInfo]):
        """
        Transfer to the scheduler agent when the user expresses clear interest
        in working with Maneuver and you have captured their basic info.
        """
        await self.session.generate_reply(
            instructions="Tell the user you'd love to set up a proper follow-up call. Say you're passing them to your scheduling assistant."
        )
        return SchedulerAgent(
            userdata=context.userdata,
            chat_ctx=self.chat_ctx.copy(exclude_instructions=True)
        )

# ─── Agent 2: Scheduler ───────────────────────────────────────────────────────
class SchedulerAgent(Agent):
    def __init__(self, userdata: LeadInfo, chat_ctx=None):
        kwargs = dict(
            llm=groq.LLM(model="llama-3.1-8b-instant"),
            stt=deepgram.STT(),
            tts=deepgram.TTS(),
            instructions=textwrap.dedent("""
                You are a scheduling assistant for Maneuver.
                Your only job: confirm a date and time for a follow-up call, and get the user's email.
                Be warm and brief. Once you have a date and email, call confirm_booking.
                Voice rules: plain text only, 1-2 sentences at a time.
            """),
        )
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)
        self._userdata = userdata

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions="Ask the user what date and time works best for a follow-up call with Husain."
        )

    @function_tool()
    async def confirm_booking(self, context: RunContext[LeadInfo], date: str, time: str, email: str):
        """Call this when you have confirmed the follow-up date, time, and user's email."""
        context.userdata.follow_up_date = f"{date} at {time}"
        context.userdata.email = email
        await self.session.generate_reply(
            instructions=f"Confirm the booking for {date} at {time}. Tell them Husain will send a calendar invite to {email}. Thank them warmly and close the call."
        )
        return SummaryAgent(
            userdata=context.userdata,
            chat_ctx=self.chat_ctx.copy(exclude_instructions=True)
        )

# ─── Agent 3: Summary (silent — saves JSON) ───────────────────────────────────
class SummaryAgent(Agent):
    def __init__(self, userdata: LeadInfo, chat_ctx=None):
        kwargs = dict(
            llm=groq.LLM(model="llama-3.1-8b-instant"),
            stt=deepgram.STT(),
            tts=deepgram.TTS(),
            instructions="You wrap up the call gracefully and save the lead summary.",
        )
        if chat_ctx:
            kwargs["chat_ctx"] = chat_ctx
        super().__init__(**kwargs)
        self._userdata = userdata

    async def on_enter(self) -> None:
        # Save lead to JSON
        output_path = "leads.json"
        leads = []
        if os.path.exists(output_path):
            with open(output_path, "r") as f:
                leads = json.load(f)
        leads.append(asdict(self._userdata))
        with open(output_path, "w") as f:
            json.dump(leads, f, indent=2)
        logger.info(f"Lead saved: {asdict(self._userdata)}")

        await self.session.generate_reply(
            instructions="Thank the user for their time. Tell them Husain is looking forward to the call. Say goodbye warmly and end naturally."
        )

# ─── Server setup ─────────────────────────────────────────────────────────────
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