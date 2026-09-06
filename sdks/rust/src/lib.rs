//! Types generated from SpeechSwitch's canonical TypeScript schemas.
//! Includes injectable streaming transports and Mistral, Async, CAMB, Cartesia and Deepdub adapters.
pub mod generated;
pub mod runtime;
pub mod http;
pub mod websocket;
pub mod entropy;
pub mod sse;
mod json;
mod endpoint;
pub(crate) mod clients;
mod base64;
pub mod providers;
