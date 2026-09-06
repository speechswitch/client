//! Injectable OS randomness for provider correlation identifiers.
use crate::http::TransportError;

/// Fill every byte from the host's cryptographic operating-system RNG.
/// Never substitute a clock, fixed seed or application PRNG. Implementations
/// must not block the executor; errors are returned without a fallback.
pub trait Entropy: Send + Sync {
    fn fill(&self, bytes: &mut [u8]) -> Result<(), TransportError>;
}

impl<F> Entropy for F
where
    F: Fn(&mut [u8]) -> Result<(), TransportError> + Send + Sync,
{
    fn fill(&self, bytes: &mut [u8]) -> Result<(), TransportError> {
        self(bytes)
    }
}
