//! Types generated from SpeechSwitch's canonical TypeScript schemas.
//! Includes injectable streaming transports and handwritten Mistral/Async adapters.
pub mod generated;
pub mod runtime;
pub mod http;
pub mod websocket;
pub mod sse;
mod json;
mod base64;
pub mod providers;
