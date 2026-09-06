//! Types generated from SpeechSwitch's canonical TypeScript schemas.
//! Includes injectable streaming transports and Mistral, Async and CAMB adapters.
pub mod generated;
pub mod runtime;
pub mod http;
pub mod websocket;
pub mod sse;
mod json;
mod endpoint;
pub(crate) mod clients;
mod base64;
pub mod providers;
