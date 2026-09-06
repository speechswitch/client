> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://murf.ai/api/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://murf.ai/_mcp/server.

# Falcon 2

Falcon 2 is an ultra-fast, scalable, and reliable speech synthesis model built for real-time conversational AI. Designed for production environments, Falcon 2 delivers natural, human-like speech with \~100ms time-to-first-audio and scales effortlessly to thousands of concurrent sessions.

## Ideal for

* **Customer support voice agents**: Enable fast, natural conversations that feel human, reducing wait times and improving user satisfaction.
* **Debt servicing and collections**: Automate payment reminders, due date alerts, and customer interactions with clear, compliant voice communication.
* **Healthcare assistants**: Support patients with empathetic, fast, and accurate voice responses for scheduling, triage, or medication info.
* **Sales leads qualification**: Serve as the first point of contact for inbound and outbound leads, qualifying them efficiently before handover to human agents.
* **Virtual assistants and chatbots**: Power smooth voice interactions across apps and devices with instant response times.
* **Voice IVR systems**: Deliver dynamic, real-time responses for inbound and outbound calls in high-volume environments.

## Why Falcon 2

Falcon 2 is built for enterprise Conversational AI applications where speed, scale and natural speech quality cannot be compromised.

## Ultra-low Latency

Falcon 2 model is optimized for real-time use cases where responsiveness is critical. With time-to-first-audio under 100ms, it ensures conversations feel seamless, natural, and instant. Deployments near your data center ensure lower latency while meeting privacy and data residency requirements.

## Enterprise scale concurrency

Built for large-scale deployments, Falcon 2 can support 10,000+ concurrent calls in parallel without compromising audio quality or stability. This makes it ideal for enterprises running high-volume customer interactions.

## Multinative speech

Falcon 2 voices can seamlessly switch between multiple languages within a single sentence while preserving natural pronunciation for each language. For example, a customer support agent could effortlessly switch between English and Spanish, or Hindi and English, just like a bilingual human speaker.

#### [Quickstart](/api/docs/introduction/quickstart)

Make your first Text-to-speech Falcon 2 API call

## Falcon 2 Supported Voices

#### [Find your Perfect Voice](https://murf.ai/api/products/text-to-speech/Falcon?utm_source=murf_api_docs)

Explore, preview, and select from 150+ voices in 20+ expressive styles

## Expressive speech

Falcon 2 reproduces the intonation, rhythm, and natural pauses of human speech, creating conversations that feel authentic and empathetic. Its speech patterns are tailored for conversational AI, virtual assistants, and customer-facing agents.

## Unparalleled pronunciation accuracy

With 99.37% accuracy, Falcon 2 ensures clarity across industries where precision matters, from financial transactions and healthcare communication to legal and compliance-driven conversations.

## Data Residency

Murf offers [**data residency**](/api/docs/text-to-speech/data-residency) through isolated regional environments for the streaming & websocket **TTS API**, allowing Enterprise customers to choose where their text and audio processing takes place.

## Global Router

The **Global Router** (`https://global.api.murf.ai/v1/speech/stream`) is a smart routing layer that automatically directs traffic to the nearest available server region based on the user's geographic location. This helps minimize latency and ensures optimal audio streaming performance without needing to manually specify a regional endpoint.

When to use the Global Router

* Ideal for quick setup and testing environments where you don’t need strict control over region selection.
* Suitable for global applications with users spread across multiple regions.

When to use a specific regional endpoint

* Recommended for production deployments requiring guaranteed data residency.
* Enterprises can configure their integration to use a fixed endpoint (for example, `https://{region}.api.murf.ai/v1/speech/stream`) to maintain compliance or optimize performance.

## Pricing

With one of the lowest latency, Falcon 2 is also a very low-cost solution for your needs.\
Falcon 2 costs 1 cent per 1000 characters.

[See Pricing](https://murf.ai/pricing?product=api)

## Available Regions

Use the region closest to your users for the lowest latency.

| Region (City/Area)                    | Endpoint                                          |
| ------------------------------------- | ------------------------------------------------- |
| Global (Routes to the nearest server) | `https://global.api.murf.ai/v1/speech/stream`     |
| US-East                               | `https://us-east.api.murf.ai/v1/speech/stream`    |
| US-West                               | `https://us-west.api.murf.ai/v1/speech/stream`    |
| India                                 | `https://in.api.murf.ai/v1/speech/stream`         |
| Canada                                | `https://ca.api.murf.ai/v1/speech/stream`         |
| South Korea                           | `https://kr.api.murf.ai/v1/speech/stream`         |
| UAE                                   | `https://me.api.murf.ai/v1/speech/stream`         |
| Japan                                 | `https://jp.api.murf.ai/v1/speech/stream`         |
| Australia                             | `https://au.api.murf.ai/v1/speech/stream`         |
| EU (Central)                          | `https://eu-central.api.murf.ai/v1/speech/stream` |
| UK                                    | `https://uk.api.murf.ai/v1/speech/stream`         |
| South America (São Paulo)             | `https://sa-east.api.murf.ai/v1/speech/stream`    |

The **Global Router** automatically picks the nearest region automatically.The
concurrency limit is **5** for the **US-East**
region and **2** for all other regions. To get higher
concurrency, use the **US-East** endpoint directly or [contact us](https://murf.ai/enterprise?src=d_contact_sales_api_docs) to increase
limits for regional endpoints.