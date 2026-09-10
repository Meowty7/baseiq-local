# Philips Hackathon Challenge — Customer Installed Base Intelligence

> Fuente: `doc-1788886999143-c967da0a.docx` (brief oficial del reto, en inglés).
> Convertido a markdown el 2026-09-10. Contenido fiel al original; solo se dio estructura.

Turning field observations into a living, trusted and actionable view of customer technology environments.

## Participant Challenge Brief

Build a prototype that makes capturing installed-base observations as easy as having a conversation.

## Challenge Statement

How might we transform observations made during customer visits into structured, reliable, and actionable visibility of the technology installed across our customer base?

Every day, field service engineers, sales teams, application specialists, account managers, and other customer-facing colleagues visit healthcare facilities and gain valuable insights about the equipment installed at those locations.

For example, during a hospital visit, a colleague may observe that the customer has several MR systems, CT systems, ultrasound systems, monitoring solutions, or other equipment from different manufacturers.

Today, much of this knowledge remains unstructured, distributed, or simply in people's heads.

The challenge is to create a simple and intelligent way to capture these observations and transform them into a structured Customer Installed Base Intelligence dataset.

## The Problem

We currently have limited visibility into the complete technology landscape installed at many customer sites. Customer-facing employees frequently see and learn information that could help us better understand each customer's environment. However:

- Information may remain in personal notes, conversations, or memory.
- Capturing information manually can be time-consuming.
- Equipment descriptions may be inconsistent.
- Multiple employees may report the same equipment.
- Observations may be incomplete or uncertain.
- It can be difficult to aggregate information across hospitals, cities, countries, or regions.

Valuable field knowledge is therefore difficult to transform into actionable insights.

We want to explore how AI, conversational interfaces, automation, and data visualization could solve this problem.

## Your Mission

Build a prototype that makes capturing customer installed-base observations as easy as having a conversation.

Imagine that after visiting a customer, a field colleague could open an app or Microsoft Teams and simply say:

> "I visited Hospital Alpha today. They have three MR systems, two CT systems and four ultrasound systems. Two of the MR systems appear to be around 8–10 years old."

> "I'm at Hospital Alpha in São Paulo. I saw two CT systems and three MR systems. One of the MR systems looks relatively new."

The solution should interpret the conversation, identify the relevant information, structure it, and update a customer installed-base repository. Over time, these individual observations should build a richer picture of the technology landscape across our customers.

## What Could You Build?

### 1. Conversational Data Capture

Intuitive interface where employees report what they observe. It could be:

- A Microsoft Teams agent
- A mobile/web application
- A voice-enabled assistant
- A chatbot
- Another creative solution

The user should communicate naturally instead of completing a long form. The solution should transform the conversation into structured data.

### 2. AI-Powered Information Extraction

Use AI to identify relevant information from natural language:

| Information Area | Example Fields |
|---|---|
| Customer | Customer/facility name, city, country, site/location |
| Equipment | Modality or equipment category, manufacturer, product/model (when known), quantity, approximate age or installation year (when known), additional observations |
| Observation | Who submitted it, date, confidence level, source/type, comments |

Gracefully handle incomplete information. Example: a user may know "There are three MR systems" without knowing the exact model or age. That information should still be valuable.

### 3. Intelligent Validation

- Ask follow-up questions. Example: User: "They have two CTs." → Assistant: "Do you know the manufacturer or model?" → User: "I know one is approximately six years old, but I don't know the model."
- Identify possible duplicates or conflicting observations.
- Maintain information states instead of treating every observation as fact:

**Confirmed | Reported | Estimated | Unknown**

## Expected Output

### Customer 360 View

Customer profile with the known equipment landscape. Example: Hospital Alpha — São Paulo. Drill down to individual observations and when information was last updated.

| Equipment Type | Quantity | Approx. Age | Confidence |
|---|---|---|---|
| MR | 3 | 4–10 years | High |
| CT | 2 | Unknown | Medium |
| Ultrasound | 5 | Mixed | Medium |

### Geographic Installed-Base Map

Map with customer locations. Navigate: Region → Country → City → Customer → Installed Equipment. Example: selecting Brazil shows facilities with collected observations, summarized by modality.

### Dashboard & Analytics

- Installed equipment by modality / geography / estimated age
- Customers with aging technology
- Customers with incomplete information
- Recently updated customer sites
- Confidence / freshness of information
- Potential technology refresh opportunities

## The Hackathon Prototype

End-to-end concept (not production-ready):

**Capture → Understand → Structure → Validate → Store → Visualize → Generate Insight**

### Minimum Viable Prototype

- Natural-language capture of a customer observation
- AI extraction of structured equipment information
- Storage in a structured dataset
- Customer-level installed-base view
- Basic aggregation or visualization across multiple customers

### Stretch Goals

- Voice capture (dictate right after the visit)
- Photo-assisted capture (labels/plates, where permitted)
- Duplicate detection
- Confidence scoring (completeness, recency, independent confirmation)
- Data freshness (highlight not-recently-verified info)
- AI follow-up questions (ask for the most valuable missing datum)
- Natural-language analytics ("customers in Brazil with MR systems older than seven years")
- Opportunity identification (refresh/upgrade/engagement)

## Design Considerations

- **Simplicity:** seconds, not minutes.
- **Adoption:** why would a field employee use this after every visit?
- **Data Quality:** observation vs. verified information.
- **Trust:** where info came from, when last observed.
- **Security & Privacy:** access controls, responsible governance.
- **Scalability:** thousands of customers, multiple countries.

## The Big Question

Can you turn thousands of individual field observations into a living, trusted, and actionable view of our customer installed base?

## Data guardrail

Use a small **synthetic** dataset. Do not use confidential customer information or real competitive information. Use fictional customers, manufacturers, models, and locations where appropriate.
