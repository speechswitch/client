//! Types generated from SpeechSwitch's canonical TypeScript schemas.
//! Includes an injectable streaming HTTP runtime and a handwritten Mistral adapter.
pub mod generated;
pub mod runtime;
pub mod http;
pub mod sse;
mod json;
mod base64;
pub mod providers;
